import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { herdr, type Node } from "./app-mocks";
import { removeTempDirs, tempDir } from "./helpers";

const { default: CommandCenter } = await import("../mods/command-center/main.js");

const FIXTURES = join(import.meta.dir, "fixtures/command-center");
const BRANCH = "fix/cup-1234-draft-reload";
const HEAD = "58197b4f001122334455";
const cx = { timer: { every() {} }, spawn() {}, notify() {}, sleep: async () => {} };

let root = "";
let main = "";
let lane = "";
let other = "";
let app: {
  shared: Record<string, unknown>;
  runs: [string, unknown][];
  execs: { command: string; args: string[]; cwd?: string }[];
  notes: Record<string, any>[];
  overlays: Record<string, any>[];
  setCount: number;
};
let gh: { code: number; stdout: string; stderr: string } = { code: 0, stdout: "[]", stderr: "" };
let binsMissing = false;
let evidence: Record<string, unknown> = {};
let agentsNow: Record<string, unknown>[] = [];
let ttyOf: Record<string, string> = {};
let focusedCwd: string | null = null;
let propsNow: Record<string, unknown> = { role: "watch" };

const ghPr = (over: Record<string, unknown> = {}) => ({
  number: 42,
  url: "https://github.com/acme/app/pull/42",
  state: "OPEN",
  isDraft: false,
  reviewDecision: "",
  mergedAt: null,
  baseRefName: "main",
  headRefName: BRANCH,
  statusCheckRollup: [],
  ...over,
});
const ghReturns = (pr: Record<string, unknown> | null) => {
  gh = { code: 0, stdout: JSON.stringify(pr ? [pr] : []), stderr: "" };
};

function respond(command: string, args: string[], options: { cwd?: string } = {}) {
  const ok = (stdout: string, code = 0) => ({ code, stdout, stderr: "" });
  if (command === "git" && args.includes("--git-common-dir")) return ok(`${join(main, ".git")}\n`);
  if (command === "git" && args[0] === "worktree") {
    return ok([main, lane, other].map((path, index) => `worktree ${path}\nHEAD ${HEAD}\nbranch refs/heads/${index === 0 ? "main" : index === 1 ? BRANCH : "chore/other"}\n`).join("\n"));
  }
  if (command === "git" && args[0] === "rev-parse") return ok(`${HEAD}\n`);
  if (command === "git" && args[0] === "rev-list") return ok("0\n");
  if (command.endsWith("/pp-pr-evidence")) {
    if (binsMissing) throw new Error("ENOENT");
    if (args[0] === "last-code-sha") return ok(`${HEAD}\n`);
    return ok(JSON.stringify(evidence), (evidence as { ready?: boolean }).ready ? 0 : 1);
  }
  if (command.endsWith("/pp-pr-preview-check")) {
    if (binsMissing) throw new Error("ENOENT");
    return ok(JSON.stringify({ match: "preview", name: "Deploy to Preview", state: "SUCCESS", link: "https://preview.example/42" }));
  }
  if (command === "gh") return gh;
  if (command === "hc" && args[0] === "get") {
    const found = agentsNow.find((agent) => agent.address === args[1]) as Record<string, any> | undefined;
    return found ? ok(JSON.stringify({ address: args[1], pid: 100, foreground: found.foreground })) : ok("", 1);
  }
  if (command === "ps") return ok(`${ttyOf[args.at(-1) as string] ?? "??"}\n`);
  return ok("");
}

beforeEach(() => {
  root = tempDir();
  main = join(root, "app");
  lane = join(root, "app-worktrees", "cup-1234 draft");
  other = join(root, "app-worktrees", "other");
  for (const dir of [main, lane, other]) mkdirSync(dir, { recursive: true });
  copyFileSync(join(FIXTURES, "vjr-task-verified.md"), join(lane, "VJR-TASK.md"));
  mkdirSync(join(root, "home", ".pp-stack", "session"), { recursive: true });
  app = { shared: {}, runs: [], execs: [], notes: [], overlays: [], setCount: 0 };
  ghReturns(null);
  binsMissing = false;
  evidence = { ready: false, slug: "fix-cup-1234-draft-reload", dir: join(lane, ".pp-stack/updates/fix-cup-1234-draft-reload"), files: [] };
  agentsNow = [];
  ttyOf = {};
  focusedCwd = null;
  propsNow = { role: "watch" };
  Object.assign(herdr, {
    spaces: () => [
      { id: "sp-main", name: "app", folder: main, machine: null, active: false, tabs: [{ id: "tb-main" }] },
      { id: "sp-1234", name: "cup-1234", folder: lane, machine: null, active: true, tabs: [{ id: "tb-1234" }] },
    ],
    panes: () => [],
    agents: () => agentsNow,
    focused: () => (focusedCwd ? { space: "sp-1234", tab: "tb-1234", pane: null, terminal: null, shown: null, agent: null, cwd: focusedCwd } : null),
    exec: async (command: string, args: string[], options: { cwd?: string } = {}) => {
      app.execs.push({ command, args, cwd: options?.cwd });
      return respond(command, args, options);
    },
    readTextFile: async (path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    home: () => join(root, "home"),
    appHome: () => join(root, "app-home"),
    shared: (key: string) => app.shared[key],
    setShared: (key: string, value: unknown) => {
      app.shared[key] = value;
      app.setCount += 1;
      return null;
    },
    notify: (note: Record<string, any>) => {
      app.notes.push(note);
      return "n1";
    },
    run: (name: string, args: unknown) => {
      app.runs.push([name, args]);
      return null;
    },
    openOverlay: (spec: Record<string, any>) => {
      app.overlays.push(spec);
      return "o1";
    },
    closeOverlay: () => null,
    nextCommand: () => new Promise(() => {}),
    watchFolder: () => new Promise(() => {}),
    props: () => propsNow,
    theme: () => new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? "#505050" : undefined) }),
    layout: () => ({ id: "root", children: [] }),
    window: () => ({ active: true }),
  });
});

afterEach(() => removeTempDirs());

function watcher() {
  const view = new CommandCenter();
  view.init({ role: "watch" }, cx);
  return view;
}

const state = () => app.shared["command-center.state"] as { lanes: Record<string, any>[] };
const ghCalls = () => app.execs.filter((call) => call.command === "gh").length;

describe("watcher", () => {
  test("only a non-main worktree with VJR-TASK.md becomes a task", async () => {
    const view = watcher();
    await view.discover();
    expect(view.lanes.map((item: { key: string }) => item.key)).toEqual([lane]);
    expect(view.lanes[0]).toMatchObject({ branch: BRANCH, repo: { name: "app", main } });
  });

  test("a read publishes the lane with its task, steps and next step", async () => {
    const view = watcher();
    await view.read(cx);
    const published = state().lanes[0];
    expect(published).toMatchObject({ key: lane, space: "sp-1234", mainSpace: "sp-main", task: { id: "CUP-1234" }, lastCode: HEAD });
    expect(published.steps).toHaveLength(7);
    expect(published.next.label).toBeTruthy();
    expect(app.shared["command-center.lanes"]).toEqual({ [lane]: published.chip });
  });

  test("the first full read posts no alert, a later change does", async () => {
    const view = watcher();
    let now = 1_000_000;
    view.clock = () => now;
    ghReturns(ghPr({ reviewDecision: "APPROVED" }));
    await view.read(cx);
    expect(app.notes).toEqual([]);
    ghReturns(ghPr({ state: "MERGED", mergedAt: "2026-11-02T22:00:00Z" }));
    now += 61_000;
    await view.read(cx);
    expect(app.notes.map((note) => note.title)).toEqual(["PR #42 merged"]);
    expect(app.notes[0].action).toEqual({ name: "command-center.show" });
    now += 61_000;
    await view.read(cx);
    expect(app.notes).toHaveLength(1);
  });

  test("a failing gh shows GitHub unavailable and posts nothing", async () => {
    gh = { code: 1, stdout: "", stderr: "gh: To get started with GitHub CLI, please run: gh auth login\nmore" };
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0].pr).toEqual({ error: "GitHub unavailable · gh: To get started with GitHub CLI, please run: gh auth login" });
    expect(app.notes).toEqual([]);
  });

  test("missing pp-stack scripts leave the evidence block saying so", async () => {
    binsMissing = true;
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0].evidence).toEqual({ error: "pp-stack not found" });
  });

  test("a second watcher stays idle while the first holds the lease", async () => {
    await watcher().read(cx);
    const before = app.execs.length;
    await watcher().read(cx);
    expect(app.execs.length).toBe(before);
  });

  test("gh runs at most once a minute for an open PR", async () => {
    ghReturns(ghPr());
    const view = watcher();
    let now = 1_000_000;
    view.clock = () => now;
    await view.read(cx);
    await view.read(cx);
    expect(ghCalls()).toBe(1);
    now += 61_000;
    await view.read(cx);
    expect(ghCalls()).toBe(2);
  });

  test("an unchanged read does not touch shared state again", async () => {
    const view = watcher();
    await view.read(cx);
    const count = app.setCount;
    await view.read(cx);
    expect(app.setCount).toBe(count);
  });

  test("the task's claude is the one whose tty ran the latest skill here", async () => {
    agentsNow = [
      { address: "t1", app: "claude-code", status: "idle", foreground: { pid: 501, cwd: lane, argv: ["claude"] } },
      { address: "t2", app: "claude-code", status: "idle", foreground: { pid: 502, cwd: lane, argv: ["claude"] } },
      { address: "t3", app: "claude-code", status: "idle", foreground: { pid: 503, cwd: main, argv: ["claude"] } },
    ];
    ttyOf = { "501": "ttys001", "502": "ttys002", "503": "ttys003" };
    writeFileSync(
      join(root, "home", ".pp-stack", "session", "skill-abc.json"),
      JSON.stringify({ session_id: "abc", skill: "vjr-ac", tty: "ttys002", cwd: lane, started_at: new Date().toISOString(), ended_at: new Date().toISOString() }),
    );
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0].claude).toEqual({ terminal: "t2", status: "idle", count: 2, ambiguous: false });
  });

  test("show focuses the last alerted task and opens the column", async () => {
    const view = watcher();
    let now = 1_000_000;
    view.clock = () => now;
    ghReturns(ghPr({ statusCheckRollup: [{ __typename: "CheckRun", name: "test", status: "IN_PROGRESS", conclusion: null }] }));
    await view.read(cx);
    ghReturns(ghPr({ statusCheckRollup: [{ __typename: "CheckRun", name: "test", status: "COMPLETED", conclusion: "FAILURE" }] }));
    now += 61_000;
    await view.read(cx);
    expect(app.notes[0].title).toBe("PR #42 needs attention");
    await view.command("show");
    expect(app.shared["command-center.focus"]).toBe(lane);
    expect(app.runs).toContainEqual(["layout.show", { id: "command-center" }]);
  });
});

export type { Node };
