import { describe, expect, test } from "bun:test";
import { movedNote, resumeArgv } from "../mods/move-tab/logic.js";
import { moveTab } from "../mods/move-tab/move.js";

const WORKTREES = "worktree /r/main\nbranch refs/heads/main\n\nworktree /r/wt\nbranch refs/heads/feat/x\n";
const NOTE = movedNote({ from: "/r/main", fromBranch: "main", to: "/r/wt", toBranch: "feat/x" });
const ARGV = resumeArgv({ session: "new-id", args: ["--model", "opus"], note: NOTE });
const RESUME = "cd /r/main && claude --resume new-id --model opus";
const SECOND = "cd /r/main/api && claude --resume two-id --effort high";
const FIRST_ACTION = { name: "tab.new", args: { space: "s1", folder: "/r/main", argv: ["claude", "--resume", "new-id", "--model", "opus"] } };
const SECOND_ACTION = { name: "tab.new", args: { space: "s1", folder: "/r/main/api", argv: ["claude", "--resume", "two-id", "--effort", "high"] } };
const REQUEST = { id: "r1", tab: "tb1", space: "s1", to: "/r/wt", toSpace: "s2", at: 0 };

const claudeInfo = (state = "idle") => ({
  pid: 10,
  cwd: "/r/main",
  foreground: { pid: 11, argv: ["claude", "--resume", "old-id", "--model", "opus"], cwd: "/r/main", name: "2.1.318" },
  status: { app: "claude-code", state },
});
const secondInfo = (state = "idle") => ({
  pid: 20,
  cwd: "/r/main/api",
  foreground: { pid: 21, argv: ["claude", "--effort", "high"], cwd: "/r/main/api", name: "2.1.318" },
  status: { app: "claude-code", state },
});
const ownInfo = () => ({ ...claudeInfo(), pid: 11 });
const shellInfo = (pid: number, cwd: string) => ({ pid, cwd, foreground: { pid, argv: ["-zsh"], cwd, name: "zsh" } });
const block = (pane: string, terminal: string) => ({ type: "block", id: pane, content: { terminal } });
const pane = (id: string, terminal: string, tab: string, cwd: string, program: string) => ({ pane: id, terminal, tab, title: program, cwd, program: { name: program } });
const tabInfo = (id: string, index: number, name = String(index), named = false) => ({ id, index, name, named });

function world(changes: any = {}) {
  return {
    spaces: [
      { id: "s1", name: "main", named: false, folder: "/r/main", machine: null as string | null, tabs: [tabInfo("tb1", 1), tabInfo("tb2", 2)] },
      { id: "s2", name: "wt", named: false, folder: "/r/wt", machine: null as string | null, tabs: [tabInfo("tb3", 1)] },
    ],
    panes: [pane("p1", "t1", "tb1", "/r/main", "Claude Code"), pane("p3", "t3", "tb3", "/r/wt", "Shell")] as any[],
    terminals: [] as any[],
    infos: { t1: claudeInfo() } as Record<string, any>,
    sessions: { 11: { session: "new-id", cwd: "/r/main" } } as Record<number, any>,
    worktrees: WORKTREES,
    trees: { tb1: { type: "row", children: [block("p1", "t1")] } } as Record<string, any>,
    folders: [] as string[],
    stubborn: [] as number[],
    fail: {} as Record<string, string>,
    failAfter: {} as Record<string, string>,
    listed: false,
    throwRaw: false,
    notifyThrows: false,
    onSignal: null as ((w: any) => void) | null,
    ...changes,
  };
}

function twoClaudes(changes: any = {}) {
  const w = world({
    infos: { t1: claudeInfo(), t2: secondInfo() },
    trees: { tb1: { type: "row", children: [block("p1", "t1"), block("p2", "t2")] } },
    ...changes,
  });
  w.sessions[21] = { session: "two-id", cwd: "/r/main/api" };
  w.panes.push(pane("p2", "t2", "tb1", "/r/main/api", "Claude Code"));
  return w;
}

function fakeIo(w: any) {
  const log: string[] = [];
  const notices: any[] = [];
  const polls: Record<number, number> = {};
  const reads: Record<string, number> = {};
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
    get: async (address: string) => {
      const value = w.infos[address];
      if (!Array.isArray(value)) return value ?? null;
      const read = reads[address] ?? 0;
      reads[address] = read + 1;
      return value[Math.min(read, value.length - 1)];
    },
    session: async (pid: number) => w.sessions[pid] ?? null,
    worktrees: async (_folder: string) => w.worktrees,
    tree: async (tab: string) => w.trees[tab] ?? null,
    exists: async (folder: string) => w.folders.includes(folder),
    signal: async (pid: number) => {
      log.push(`signal ${pid}`);
      polls[pid] = 0;
      w.onSignal?.(w);
    },
    alive: async (pid: number) => {
      const value = w.stubborn.includes(pid) || !(pid in polls) || polls[pid]++ === 0;
      log.push(`alive ${pid} → ${value}`);
      return value;
    },
    act: async (name: string, args: any) => {
      log.push(`act ${name} ${JSON.stringify(args)}`);
      if (name in w.fail) throw w.throwRaw ? w.fail[name] : new Error(w.fail[name]);
      const made = create(name, args);
      if (!(name in w.failAfter)) return made;
      if (w.listed) w.terminals.push({ address: made.terminal, state: "live", argv: ["/bin/zsh", "-l"], foreground: { argv: args.argv } });
      throw new Error(w.failAfter[name]);
    },
    sleep: async (ms: number) => {
      clock += ms;
    },
    now: () => clock,
    notify: (notice: any) => {
      notices.push(notice);
      if (w.notifyThrows) throw new Error("the toast broke");
    },
  };

  function create(name: string, args: any): any {
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
  }
}

function actsOf(log: string[]) {
  return log.flatMap((line) => {
    const found = /^act (\S+) (.*)$/.exec(line);
    return found ? [{ name: found[1], args: JSON.parse(found[2]) }] : [];
  });
}

async function move(w: any, request: any = {}) {
  const io = fakeIo(w);
  const result = await moveTab({ ...REQUEST, ...request }, io);
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

  test("ends every Claude before the first one resumes", async () => {
    const { io, result, acts } = await move(twoClaudes());
    const resumed = io.log.findIndex((line) => line.startsWith("act ") && line.includes('"--resume"'));
    expect(io.log.indexOf("alive 11 → false")).toBeGreaterThanOrEqual(0);
    expect(io.log.indexOf("alive 11 → false")).toBeLessThan(resumed);
    expect(io.log.indexOf("alive 21 → false")).toBeGreaterThanOrEqual(0);
    expect(io.log.indexOf("alive 21 → false")).toBeLessThan(resumed);
    expect(acts[2]).toEqual({ name: "terminal.open", args: { place: "right", folder: "/r/wt", argv: resumeArgv({ session: "two-id", args: ["--effort", "high"], note: NOTE }) } });
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
      trees: { tb1: { type: "row", children: [block("p1", "t1"), block("b2", "t2")] } },
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

  test("refuses a Claude that is another agent's sub-agent", async () => {
    const { io, notice, result } = await move(world({ infos: { t1: { ...claudeInfo(), parent: "t4" } } }));
    expect(io.log).toEqual([]);
    expect(notice).toEqual({ title: "Can't move this tab", body: "Claude in this tab is another agent's sub-agent.", level: "warning" });
    expect(result).toEqual({ moved: false });
    expect((await move(world({ infos: { t1: { ...claudeInfo(), parent: null } } }))).result).toEqual({ moved: true });
  });

  test("checks each Claude again right before ending it", async () => {
    const working = await move(world({ infos: { t1: [claudeInfo(), claudeInfo("working")] } }));
    expect(working.io.log).toEqual([]);
    expect(working.notice).toEqual({ title: "Can't move this tab", body: "Claude is working in this tab. Move it when the turn ends.", level: "warning" });
    const restarted = claudeInfo();
    restarted.foreground.pid = 12;
    const w = world({ infos: { t1: [claudeInfo(), restarted] } });
    w.sessions[12] = { session: "new-id", cwd: "/r/main" };
    const changed = await move(w);
    expect(changed.io.log).toEqual([]);
    expect(changed.notice.body).toBe("Couldn't find Claude's conversation in this tab.");
  });

  test("a Claude that gets busy while another ends offers only the ended one", async () => {
    const { io, notice, result } = await move(twoClaudes({ infos: { t1: claudeInfo(), t2: [secondInfo(), secondInfo("blocked")] } }));
    expect(io.log).toContain("alive 11 → false");
    expect(io.log).not.toContain("signal 21");
    expect(actsOf(io.log)).toEqual([]);
    expect(notice).toEqual({ title: "Couldn't move the tab", body: `Claude is waiting for you in pane 2. To resume Claude by hand: ${RESUME}`, level: "error", action: FIRST_ACTION });
    expect(result).toEqual({ moved: false });
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
    const { io, result, notice } = await move(world({ stubborn: [11] }));
    expect(io.log[0]).toBe("signal 11");
    expect(io.log.slice(1).every((line) => line === "alive 11 → true")).toBe(true);
    expect(notice).toEqual({ title: "Couldn't move the tab", body: "Claude in this tab didn't exit, so nothing moved.", level: "error" });
    expect(io.now()).toBeGreaterThanOrEqual(10000);
    expect(result).toEqual({ moved: false });
  });

  test("a second Claude that won't exit offers only the first one's conversation", async () => {
    const { io, notice, result } = await move(twoClaudes({ stubborn: [21] }));
    expect(io.log).toContain("alive 11 → false");
    expect(io.log).toContain("signal 21");
    expect(actsOf(io.log)).toEqual([]);
    expect(notice).toEqual({ title: "Couldn't move the tab", body: `Claude in pane 2 didn't exit, so nothing moved. To resume Claude by hand: ${RESUME}`, level: "error", action: FIRST_ACTION });
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

  test("only lands in spaces on this machine", async () => {
    const w = world();
    w.spaces[1].machine = "vps";
    const { acts } = await move(w);
    expect(acts[0]).toEqual({ name: "space.new", args: { folder: "/r/wt" } });
  });

  test("a move inside one checkout resumes Claude without a moved note", async () => {
    const w = world();
    w.spaces.push({ id: "s4", name: "main 2", named: false, folder: "/r/main", machine: null, tabs: [tabInfo("tb4", 1)] });
    w.panes.push(pane("p4", "t4", "tb4", "/r/main", "Shell"));
    const { acts, result } = await move(w, { to: "/r/main", toSpace: "s4" });
    expect(acts[0]).toEqual({ name: "tab.new", args: { space: "s4", folder: "/r/main", argv: ["claude", "--resume", "new-id", "--model", "opus"] } });
    expect(result).toEqual({ moved: true });
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

  test("gives the old space a shell before ending a Claude that would close its only tab", async () => {
    const w = world({ infos: { t1: ownInfo() }, onSignal: (current: any) => (current.spaces[0].tabs = [tabInfo("tb10", 2)]) });
    w.spaces[0].tabs = [tabInfo("tb1", 1)];
    const { io, acts, result } = await move(w);
    expect(acts).toEqual([
      { name: "tab.new", args: { space: "s1", folder: "/r/main" } },
      { name: "tab.new", args: { space: "s2", folder: "/r/wt", argv: ARGV } },
      { name: "space.select", args: { id: "s2" } },
      { name: "tab.select", args: { id: "tb11" } },
    ]);
    expect(io.log.findIndex((line) => line.startsWith("act tab.new"))).toBeLessThan(io.log.indexOf("signal 11"));
    expect(result).toEqual({ moved: true });
  });

  test("a shell made before the signal is the old space's only new shell", async () => {
    const w = world({ infos: { t1: ownInfo() } });
    w.spaces[0].tabs = [tabInfo("tb1", 1)];
    const { acts } = await move(w);
    expect(acts).toEqual([
      { name: "tab.new", args: { space: "s1", folder: "/r/main" } },
      { name: "tab.new", args: { space: "s2", folder: "/r/wt", argv: ARGV } },
      { name: "tab.close", args: { id: "tb1", confirmed: true } },
      { name: "space.select", args: { id: "s2" } },
      { name: "tab.select", args: { id: "tb11" } },
    ]);
  });

  test("a Claude that is its terminal's own process in a space with other tabs gets no early shell", async () => {
    const { io, acts } = await move(world({ infos: { t1: ownInfo() } }));
    expect(io.log[0]).toBe("signal 11");
    expect(acts.map((act) => act.name)).toEqual(["tab.new", "tab.close", "space.select", "tab.select"]);
    expect(acts[0].args.space).toBe("s2");
  });

  test("skips closing an old tab that left with its Claude", async () => {
    const w = world({ onSignal: (current: any) => (current.spaces[0].tabs = [tabInfo("tb2", 2)]) });
    const { acts, result, notice } = await move(w);
    expect(acts.map((act) => act.name)).toEqual(["tab.new", "space.select", "tab.select"]);
    expect(result).toEqual({ moved: true });
    expect(notice.level).toBe("success");
  });

  test("the success notice names the target and says background work ended", async () => {
    const w = world();
    w.spaces[0].tabs[0] = tabInfo("tb1", 1, "fix login", true);
    const { notice } = await move(w);
    expect(notice).toEqual({ title: "Moved to feat/x", body: "Anything Claude ran in the background ended.", level: "success", timeout: 4000 });
    const detached = await move(world({ worktrees: "worktree /r/main\nbranch refs/heads/main\n\nworktree /r/wt\ndetached\n" }));
    expect(detached.notice.title).toBe("Moved to wt");
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
    expect(matched.notice).toEqual({ title: "Moved to feat/x", level: "success", timeout: 4000 });
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
    const w = world({ fail: { "space.new": "boom" } });
    w.spaces = w.spaces.slice(0, 1);
    w.panes = w.panes.slice(0, 1);
    const { io, result, notice, acts } = await move(w, { toSpace: null });
    expect(io.log).toContain("signal 11");
    expect(acts.map((act) => act.name)).toEqual(["space.new"]);
    expect(notice).toEqual({ title: "Couldn't move the tab", body: `boom. To resume Claude by hand: ${RESUME}`, level: "error", action: FIRST_ACTION });
    expect(result).toEqual({ moved: false });
  });

  test("a build that fails after one Claude started offers only the other", async () => {
    const { result, notice, acts } = await move(twoClaudes({ fail: { "pane.focus": "boom" } }));
    expect(acts.map((act) => act.name)).toEqual(["tab.new", "pane.focus"]);
    expect(notice.body).toBe(`boom. To resume Claude by hand: ${SECOND}`);
    expect(notice.body).not.toContain("new-id");
    expect(notice.action).toEqual(SECOND_ACTION);
    expect(result).toEqual({ moved: false });
  });

  test("a Claude whose launch failed may be running, so it is never offered", async () => {
    const thrown = await move(world({ fail: { "tab.new": "boom" } }));
    expect(thrown.notice).toEqual({ title: "Couldn't move the tab", body: "boom. Claude from this tab may already be running in feat/x.", level: "error" });
    expect(thrown.result).toEqual({ moved: false });

    const made = await move(world({ failAfter: { "tab.new": "herdr-app do tab.new printed something unexpected" } }));
    expect(made.io.panes().some((candidate: any) => candidate.tab === "tb10" && candidate.terminal === "t10")).toBe(true);
    expect(made.notice).toEqual({ title: "Couldn't move the tab", body: "herdr-app do tab.new printed something unexpected. Claude from this tab may already be running in feat/x.", level: "error" });

    const own = world({ fail: { "tab.new": "boom" }, terminals: [{ address: "t1", state: "live", argv: ["claude", "--resume", "new-id"] }] });
    expect((await move(own)).notice.body).toBe("boom. Claude from this tab may already be running in feat/x.");

    const split = await move(twoClaudes({ failAfter: { "terminal.open": "boom" } }));
    expect(actsOf(split.io.log).map((act) => act.name)).toEqual(["tab.new", "pane.focus", "terminal.open"]);
    expect(split.notice).toEqual({ title: "Couldn't move the tab", body: "boom. Claude from pane 2 may already be running in feat/x.", level: "error" });
  });

  test("a Claude seen running after its launch failed counts as started", async () => {
    const { notice, result } = await move(world({ failAfter: { "tab.new": "boom" }, listed: true }));
    expect(notice).toEqual({ title: "Couldn't move the tab", body: "boom.", level: "error" });
    expect(result).toEqual({ moved: false });
  });

  test("a failure after the new tab is built still reports the move", async () => {
    const { result, notice } = await move(world({ fail: { "tab.close": "no such tab" } }));
    expect(result).toEqual({ moved: true });
    expect(notice).toEqual({ title: "Moved the tab", body: "The tab is now in feat/x, but no such tab.", level: "warning" });
  });

  test("no error escapes the move", async () => {
    const raw = await move(world({ fail: { "tab.new": "boom" }, throwRaw: true }));
    expect(raw.notice.body.startsWith("boom.")).toBe(true);
    const io = fakeIo(world({ notifyThrows: true }));
    expect(await moveTab(REQUEST, io)).toEqual({ moved: true });
    expect(io.notices).toHaveLength(1);
  });
});
