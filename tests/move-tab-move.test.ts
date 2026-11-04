import { describe, expect, test } from "bun:test";
import { movedNote, resumeArgv } from "../mods/move-tab/logic.js";
import { moveTab } from "../mods/move-tab/move.js";

const WORKTREES = "worktree /r/main\nbranch refs/heads/main\n\nworktree /r/wt\nbranch refs/heads/feat/x\n";
const ARGV = resumeArgv({ session: "new-id", args: ["--model", "opus"], note: movedNote({ from: "/r/main", fromBranch: "main", to: "/r/wt", toBranch: "feat/x" }) });
const RESUME = "cd /r/main && claude --resume new-id --model opus";

const claudeInfo = (state = "idle") => ({
  pid: 10,
  cwd: "/r/main",
  foreground: { pid: 11, argv: ["claude", "--resume", "old-id", "--model", "opus"], cwd: "/r/main", name: "2.1.318" },
  status: { app: "claude-code", state },
});
const shellInfo = (pid: number, cwd: string) => ({ pid, cwd, foreground: { pid, argv: ["-zsh"], cwd, name: "zsh" } });
const block = (pane: string, terminal: string) => ({ type: "block", id: pane, content: { terminal } });
const pane = (id: string, terminal: string, tab: string, cwd: string, program: string) => ({ pane: id, terminal, tab, title: program, cwd, program: { name: program } });
const tabInfo = (id: string, index: number, name = String(index), named = false) => ({ id, index, name, named });

function world(changes: any = {}) {
  return {
    spaces: [
      { id: "s1", name: "main", named: false, folder: "/r/main", machine: null, tabs: [tabInfo("tb1", 1), tabInfo("tb2", 2)] },
      { id: "s2", name: "wt", named: false, folder: "/r/wt", machine: null, tabs: [tabInfo("tb3", 1)] },
    ],
    panes: [pane("p1", "t1", "tb1", "/r/main", "Claude Code"), pane("p3", "t3", "tb3", "/r/wt", "Shell")],
    terminals: [] as any[],
    infos: { t1: claudeInfo() } as Record<string, any>,
    sessions: { 11: { session: "new-id", cwd: "/r/main" } } as Record<number, any>,
    worktrees: WORKTREES,
    trees: { tb1: { type: "row", children: [block("p1", "t1")] } } as Record<string, any>,
    folders: [] as string[],
    stubborn: false,
    fail: {} as Record<string, string>,
    ...changes,
  };
}

function fakeIo(w: any) {
  const log: string[] = [];
  const notices: any[] = [];
  const polls: Record<number, number> = {};
  let clock = 0;
  let next = 10;
  let focused: string | null = null;
  const tabOf = (id: string | null) => w.panes.find((p: any) => p.pane === id)?.tab;
  return {
    log,
    notices,
    spaces: () => w.spaces,
    panes: () => w.panes,
    terminals: () => w.terminals,
    get: async (address: string) => w.infos[address] ?? null,
    session: async (pid: number) => w.sessions[pid] ?? null,
    worktrees: async (_folder: string) => w.worktrees,
    tree: async (tab: string) => w.trees[tab] ?? null,
    exists: async (folder: string) => w.folders.includes(folder),
    signal: async (pid: number) => {
      log.push(`signal ${pid}`);
      polls[pid] = 0;
    },
    alive: async (pid: number) => {
      const value = w.stubborn || !(pid in polls) || polls[pid]++ === 0;
      log.push(`alive ${pid} → ${value}`);
      return value;
    },
    act: async (name: string, args: any) => {
      log.push(`act ${name} ${JSON.stringify(args)}`);
      if (w.fail[name]) throw new Error(w.fail[name]);
      if (name === "space.new") {
        const id = next++;
        w.panes.push(pane(`p${id}`, `t${id}`, `tb${id}`, args.folder, "Shell"));
        return { space: `s${id}`, tab: `tb${id}`, terminal: `t${id}` };
      }
      if (name === "tab.new") {
        const id = next++;
        const terminal = args.mod ? undefined : `t${id}`;
        w.panes.push({ pane: `p${id}`, terminal: terminal ?? null, tab: `tb${id}`, cwd: args.folder ?? null, program: { name: "Shell" } });
        return { space: args.space, tab: `tb${id}`, terminal };
      }
      if (name === "pane.focus") focused = args.pane;
      if (name === "terminal.open") {
        const id = next++;
        w.panes.push(pane(`p${id}`, `t${id}`, tabOf(focused), args.folder, "Shell"));
        return { terminal: `t${id}` };
      }
      if (name === "pane.split") {
        const id = next++;
        w.panes.push({ pane: `p${id}`, terminal: null, mod: args.mod, tab: tabOf(args.pane), cwd: null, program: { name: args.mod } });
        return { pane: `p${id}` };
      }
      return {};
    },
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    notify: (notice: any) => {
      notices.push(notice);
    },
  };
}

function actsOf(log: string[]) {
  return log.flatMap((line) => {
    const found = /^act (\S+) (.*)$/.exec(line);
    return found ? [{ name: found[1], args: JSON.parse(found[2]) }] : [];
  });
}

async function move(w: any, request: any = {}) {
  const io = fakeIo(w);
  const result = await moveTab({ id: "r1", tab: "tb1", space: "s1", to: "/r/wt", toSpace: "s2", at: 0, ...request }, io);
  expect(io.notices).toHaveLength(1);
  return { io, result, notice: io.notices[0], acts: actsOf(io.log) };
}

describe("moveTab", () => {
  test("ends the old Claude before the new one starts", async () => {
    const { io, result, acts } = await move(world());
    const signalled = io.log.indexOf("signal 11");
    const ended = io.log.indexOf("alive 11 → false");
    const resumed = io.log.findIndex((line) => line.startsWith("act ") && line.includes('"--resume"'));
    expect(signalled).toBeGreaterThanOrEqual(0);
    expect(signalled).toBeLessThan(ended);
    expect(ended).toBeLessThan(resumed);
    expect(acts[0]).toEqual({ name: "tab.new", args: { space: "s2", folder: "/r/wt", argv: ARGV } });
    expect(result).toEqual({ moved: true });
  });

  test("refuses a working Claude and changes nothing", async () => {
    const { io, result, notice } = await move(world({ infos: { t1: claudeInfo("working") } }));
    expect(io.log).toEqual([]);
    expect(notice).toEqual({ title: "Can't move this tab", body: "Claude is working in this tab. Move it when the turn ends.", level: "warning" });
    expect(result).toEqual({ moved: false });
  });

  test("names the program of a busy pane", async () => {
    const w = world({
      infos: { t1: claudeInfo(), t2: { pid: 20, cwd: "/r/main", foreground: { pid: 21, argv: ["node", "vite"], cwd: "/r/main", name: "node" } } },
      trees: { tb1: { type: "row", children: [block("p1", "t1"), block("p2", "t2")] } },
    });
    w.panes.push(pane("p2", "t2", "tb1", "/r/main", "Vite"));
    const { io, notice } = await move(w);
    expect(io.log).toEqual([]);
    expect(notice.body).toBe("Vite is running in pane 2.");
  });

  test("refuses a Claude with live sub-agents", async () => {
    const { io, notice } = await move(world({ terminals: [{ address: "t7", parent: "t1", state: "live" }] }));
    expect(io.log).toEqual([]);
    expect(notice.body).toBe("Claude has sub-agents running in this tab.");
    const { result } = await move(world({ terminals: [{ address: "t7", parent: "t1", state: "exited" }] }));
    expect(result).toEqual({ moved: true });
  });

  test("refuses its own space and a gone checkout", async () => {
    const own = await move(world(), { toSpace: "s1" });
    expect([own.io.log, own.notice.body]).toEqual([[], "The tab is already there."]);
    const sameCheckout = await move(world(), { to: "/r/main", toSpace: null });
    expect([sameCheckout.io.log, sameCheckout.notice.body]).toEqual([[], "The tab is already there."]);
    const gone = await move(world(), { to: "/r/old", toSpace: null });
    expect([gone.io.log, gone.notice.body]).toEqual([[], "That checkout is gone."]);
  });

  test("refuses a tab that is gone, unreadable or on another machine", async () => {
    expect((await move(world(), { tab: "tb9" })).notice.body).toBe("The tab is gone.");
    expect((await move(world({ trees: {} }))).notice.body).toBe("The tab is gone.");
    const remote = world();
    remote.spaces[0].machine = "vps";
    expect((await move(remote)).notice.body).toBe("Tabs on other machines can't move yet.");
    expect((await move(world({ worktrees: null }))).notice.body).toBe("This tab isn't in a git repo.");
  });

  test("a Claude that won't exit stops the move", async () => {
    const { io, result, notice } = await move(world({ stubborn: true }));
    expect(io.log[0]).toBe("signal 11");
    expect(io.log.slice(1).every((line) => line === "alive 11 → true")).toBe(true);
    expect(notice.level).toBe("error");
    expect(notice.body).toContain(RESUME);
    expect(io.now()).toBeGreaterThanOrEqual(10000);
    expect(result).toEqual({ moved: false });
  });

  test("opens a space for a checkout without one and closes its extra tab", async () => {
    const w = world();
    w.spaces = w.spaces.slice(0, 1);
    w.panes = w.panes.slice(0, 1);
    const { acts } = await move(w, { toSpace: null });
    expect(acts.slice(0, 3)).toEqual([
      { name: "space.new", args: { folder: "/r/wt" } },
      { name: "tab.new", args: { space: "s10", folder: "/r/wt", argv: ARGV } },
      { name: "tab.close", args: { id: "tb10", confirmed: true } },
    ]);
  });

  test("lands in another space of the checkout when the chosen one closed", async () => {
    const { acts } = await move(world(), { toSpace: "s9" });
    expect(acts[0]).toEqual({ name: "tab.new", args: { space: "s2", folder: "/r/wt", argv: ARGV } });
    expect(acts.some((act) => act.name === "space.new")).toBe(false);
  });

  test("gives the old space a shell when the tab was its only one", async () => {
    const w = world();
    w.spaces[0].tabs = [tabInfo("tb1", 1)];
    const { acts } = await move(w);
    expect(acts).toEqual([
      { name: "tab.new", args: { space: "s2", folder: "/r/wt", argv: ARGV } },
      { name: "tab.new", args: { space: "s1", folder: "/r/main" } },
      { name: "tab.close", args: { id: "tb1", confirmed: true } },
      { name: "space.select", args: { id: "s2" } },
      { name: "tab.select", args: { id: "tb10" } },
    ]);
  });

  test("the success notice says background work ended", async () => {
    const w = world();
    w.spaces[0].tabs[0] = tabInfo("tb1", 1, "fix login", true);
    const { notice } = await move(w);
    expect(notice).toEqual({ title: "Moved the tab", body: "fix login is now in feat/x. Anything Claude ran in the background ended with it.", level: "success", timeout: 4000 });
  });

  test("keeps a named tab's name", async () => {
    const w = world();
    w.spaces[0].tabs[0] = tabInfo("tb1", 1, "fix login", true);
    expect((await move(w)).acts[0].args.name).toBe("fix login");
    expect("name" in (await move(world())).acts[0].args).toBe(false);
  });

  test("lands panes in the matching folder or the root", async () => {
    const shell = (changes: any = {}) => world({ infos: { t1: shellInfo(20, "/r/main/src") }, sessions: {}, ...changes });
    const matched = await move(shell({ folders: ["/r/wt/src"] }));
    expect(matched.acts[0]).toEqual({ name: "tab.new", args: { space: "s2", folder: "/r/wt/src" } });
    expect(matched.notice.body).toBe("The tab is now in feat/x.");
    expect((await move(shell())).acts[0].args).toEqual({ space: "s2", folder: "/r/wt" });
    const spaced = world({
      infos: { t1: shellInfo(20, "/r/máin dir/a b") },
      worktrees: "worktree /r/máin dir\nbranch refs/heads/main\n\nworktree /r/wt ç\nbranch refs/heads/feat/x\n",
      folders: ["/r/wt ç/a b"],
    });
    spaced.spaces[0].folder = "/r/máin dir";
    spaced.spaces[1].folder = "/r/wt ç";
    spaced.panes[1].cwd = "/r/wt ç";
    expect((await move(spaced, { to: "/r/wt ç" })).acts[0].args).toEqual({ space: "s2", folder: "/r/wt ç/a b" });
  });

  test("rebuilds a split tab", async () => {
    const props = { file: "/r/main/README.md" };
    const w = world({
      infos: { t1: claudeInfo(), t2: shellInfo(20, "/r/main") },
      trees: {
        tb1: { type: "row", children: [block("p1", "t1"), { type: "column", children: [block("p2", "t2"), { type: "block", id: "p4", content: { mod: "vjr-markdown", props } }] }] },
      },
    });
    w.panes.push(pane("p2", "t2", "tb1", "/r/main", "Shell"), { pane: "p4", terminal: null, mod: "vjr-markdown", tab: "tb1", cwd: null, program: { name: "vjr-markdown" } });
    const { acts, result } = await move(w);
    expect(acts.slice(0, 4)).toEqual([
      { name: "tab.new", args: { space: "s2", folder: "/r/wt", argv: ARGV } },
      { name: "pane.focus", args: { pane: "p10" } },
      { name: "terminal.open", args: { place: "right", folder: "/r/wt" } },
      { name: "pane.split", args: { direction: "down", pane: "p11", mod: "vjr-markdown", props } },
    ]);
    expect(result).toEqual({ moved: true });
  });

  test("a failed act after Claude ended keeps the old tab", async () => {
    const { io, result, notice, acts } = await move(world({ fail: { "tab.new": "boom" } }));
    expect(io.log).toContain("signal 11");
    expect(acts.map((act) => act.name)).toEqual(["tab.new"]);
    expect(notice.level).toBe("error");
    expect(notice.body.startsWith("boom.")).toBe(true);
    expect(notice.body).toContain(RESUME);
    expect(result).toEqual({ moved: false });
  });
});
