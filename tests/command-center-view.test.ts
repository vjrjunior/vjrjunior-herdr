import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { herdr, type Node } from "./app-mocks";
import { removeTempDirs, tempDir } from "./helpers";

const { default: CommandCenter } = await import("../mods/command-center/main.js");
const { ppChip, ppNext, ppSignals, ppSummary } = await import("../mods/command-center/flow-pp.js");
const { factsOf } = await import("../mods/command-center/lane-status.js");

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
let statusPr: Record<string, unknown> | null = null;
let statusError: string | null = null;
let statusText: string | null = null;
let leftOut = new Set<string>();
let reportOther = false;
let shellEditor = "";
let binsMissing = false;
let evidence: Record<string, unknown> = {};
let agentsNow: Record<string, unknown>[] = [];
let ttyOf: Record<string, string> = {};
let focusedCwd: string | null = null;
let propsNow: Record<string, unknown> = { role: "watch" };

const jsonPr = (over: Record<string, unknown> = {}) => ({
  number: 42,
  url: "https://github.com/acme/app/pull/42",
  title: "fix: draft reload",
  state: "OPEN",
  isDraft: false,
  base: "main",
  reviewDecision: null,
  mergedAt: null,
  checks: { passed: 0, failed: [], pending: 0, items: [] },
  preview: { match: "preview", name: "Deploy to Preview", job: "Deploy to Preview", state: "SUCCESS", link: "https://preview.example/42" },
  ...over,
});
const prReturns = (pr: Record<string, unknown> | null) => {
  statusPr = pr;
};
const failedCheck = (name: string) => ({ passed: 0, failed: [name], pending: 0, items: [{ name, state: "bad", detail: "failure", link: null }] });
const runningCheck = (name: string) => ({ passed: 0, failed: [], pending: 1, items: [{ name, state: "run", detail: "running", link: null }] });

function laneJson(path: string, branch: string, pr: Record<string, unknown> | null) {
  return {
    path,
    branch,
    head: HEAD,
    base: "main",
    baseSource: "default",
    task: { id: null, name: branch, url: null, source: "branch-name" },
    commitsAhead: 1,
    skill: null,
    ship: { state: "none", count: 0, commitsSince: 0, coversSha: null, reason: null },
    evidence,
    pr,
    steps: [],
    next: { label: "Run /pp-ship", command: "/pp-ship", url: null, where: "worktree", kind: "skill" },
    waitsOnYou: true,
    why: "not shipped yet",
    error: null,
  };
}

function statusFor(args: string[]) {
  const at = args.indexOf("--path");
  if (at >= 0) {
    const path = args[at + 1];
    return { version: 1, repo: { main, name: "app" }, network: false, error: null, lanes: [laneJson(path, path === lane ? BRANCH : "chore/other", null)] };
  }
  const lanes = [...(leftOut.has(lane) ? [] : [laneJson(lane, BRANCH, statusPr)]), ...(reportOther ? [laneJson(other, "chore/other", null)] : [])];
  return { version: 1, repo: { main, name: "app" }, network: true, error: statusError, lanes };
}

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
    return ok("", 2);
  }
  if (command.endsWith("/pp-lane-status")) {
    if (binsMissing) throw new Error("ENOENT");
    if (statusText != null) return ok(statusText);
    return ok(JSON.stringify(statusFor(args)));
  }
  if (command === "hc" && args[0] === "get") {
    const found = agentsNow.find((agent) => agent.address === args[1]) as Record<string, any> | undefined;
    return found ? ok(JSON.stringify({ address: args[1], pid: 100, foreground: found.foreground })) : ok("", 1);
  }
  if (command === "ps") return ok(`${ttyOf[args.at(-1) as string] ?? "??"}\n`);
  if (command === "sh") return ok(`noise from the profile\n${shellEditor}`);
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
  mkdirSync(join(root, "home", ".claude", "skills", "pp-stack", "bin"), { recursive: true });
  writeFileSync(join(root, "home", ".claude", "skills", "pp-stack", "bin", "pp-lane-status"), "");
  app = { shared: {}, runs: [], execs: [], notes: [], overlays: [], setCount: 0 };
  prReturns(null);
  statusError = null;
  statusText = null;
  leftOut = new Set();
  reportOther = false;
  shellEditor = "";
  binsMissing = false;
  evidence = { ready: false, dir: join(lane, ".pp-stack/updates/fix-cup-1234-draft-reload"), files: {}, reasons: {} };
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
const statusCalls = () => app.execs.filter((call) => call.command.endsWith("/pp-lane-status"));
const noLaneStatus = () => {
  binsMissing = true;
  rmSync(join(root, "home", ".claude", "skills", "pp-stack", "bin", "pp-lane-status"));
};

describe("watcher", () => {
  test("a worktree is a lane when it has VJR-TASK.md, the report lists it or it has the focus", async () => {
    const view = watcher();
    await view.read(cx);
    expect(state().lanes.map((item) => item.key)).toEqual([lane]);
    expect(state().lanes[0]).toMatchObject({ branch: BRANCH, repo: { name: "app", main }, flow: "vjr" });
  });

  test("a worktree the report lists without VJR-TASK.md is a Work - PP lane", async () => {
    reportOther = true;
    await watcher().read(cx);
    const published = state().lanes.find((item) => item.key === other);
    expect(published).toMatchObject({ flow: "pp", task: { title: "chore/other", id: null } });
    expect(published.steps).toHaveLength(6);
    expect(published.next).toMatchObject({ kind: "space", text: "/pp-ship", name: "ship · other", folder: other });
    expect(app.shared["command-center.lanes"]).toMatchObject({ [other]: published.chip });
  });

  test("a worktree with VJR-TASK.md stays Work - VJR, with its facts from the report", async () => {
    prReturns(jsonPr());
    await watcher().read(cx);
    const published = state().lanes.find((item) => item.key === lane);
    expect(published).toMatchObject({ flow: "vjr", pr: { number: 42 } });
    expect(published.steps).toHaveLength(7);
  });

  test("the focused worktree the report left out is read alone and shows as Work - PP", async () => {
    focusedCwd = other;
    await watcher().read(cx);
    expect(statusCalls().map((call) => call.args)).toContainEqual(["--json", "--no-network", "--path", other]);
    expect(state().lanes.find((item) => item.key === other)).toMatchObject({ flow: "pp" });
  });

  test("the focused worktree already in the report is not read again or listed twice", async () => {
    focusedCwd = other;
    reportOther = true;
    await watcher().read(cx);
    expect(statusCalls().map((call) => call.args)).not.toContainEqual(["--json", "--no-network", "--path", other]);
    expect(state().lanes.filter((item) => item.key === other)).toHaveLength(1);
  });

  test("deleting VJR-TASK.md makes the lane Work - PP at the next read, with nothing left from the task", async () => {
    let now = 1_000_000;
    const view = watcher();
    view.clock = () => now;
    await view.read(cx);
    expect(state().lanes[0]).toMatchObject({ flow: "vjr", task: { id: "CUP-1234" } });
    rmSync(join(lane, "VJR-TASK.md"));
    now += 61_000;
    await view.read(cx);
    const published = state().lanes.find((item) => item.key === lane);
    expect(published.flow).toBe("pp");
    expect(published.task).toEqual({ id: null, title: BRANCH, url: null, source: "branch-name", base: "main", branch: BRANCH });
    expect(published.session).toBeUndefined();
    expect(published.steps).toHaveLength(6);
  });

  test("state says whether this machine has /vjr-task and which editor it uses", async () => {
    await watcher().read(cx);
    expect(app.shared["command-center.state"]).toMatchObject({ vjrTask: false, editor: "cursor" });
    mkdirSync(join(root, "home", ".claude", "skills", "vjr-task"), { recursive: true });
    writeFileSync(join(root, "home", ".claude", "skills", "vjr-task", "SKILL.md"), "---\nname: vjr-task\n---\n");
    shellEditor = "zed";
    await watcher().close();
    app.shared["command-center.watch"] = null;
    await watcher().read(cx);
    expect(app.shared["command-center.state"]).toMatchObject({ vjrTask: true, editor: "zed" });
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
    prReturns(jsonPr({ reviewDecision: "APPROVED" }));
    await view.read(cx);
    expect(app.notes).toEqual([]);
    prReturns(jsonPr({ state: "MERGED", mergedAt: "2026-11-02T22:00:00Z" }));
    now += 61_000;
    await view.read(cx);
    expect(app.notes.map((note) => note.title)).toEqual(["PR #42 merged"]);
    expect(app.notes[0].action).toEqual({ name: "command-center.show" });
    now += 61_000;
    await view.read(cx);
    expect(app.notes).toHaveLength(1);
  });

  test("a failing gh shows GitHub unavailable and posts nothing", async () => {
    statusError = "gh: To get started with GitHub CLI, please run: gh auth login";
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0].pr).toEqual({ error: "GitHub unavailable · gh: To get started with GitHub CLI, please run: gh auth login" });
    expect(app.notes).toEqual([]);
  });

  test("a missing pp-lane-status says which pp-stack is needed", async () => {
    noLaneStatus();
    const view = watcher();
    await view.read(cx);
    expect(state().repos[0].error).toBe("Command Center needs pp-stack 0.94.0 or later");
    expect(state().lanes[0].evidence).toEqual({ error: "Command Center needs pp-stack 0.94.0 or later" });
  });

  test("pp-lane-status output that is not JSON shows on its repo and the watcher keeps going", async () => {
    statusText = "bun: command not found";
    const view = watcher();
    let now = 1_000_000;
    view.clock = () => now;
    await view.read(cx);
    now += 31_000;
    await view.read(cx);
    expect(statusCalls()).toHaveLength(2);
    expect(state().repos[0].error).toBe("pp-lane-status gave no JSON");
  });

  test("the watcher never calls gh, the preview check or evidence status", async () => {
    prReturns(jsonPr());
    await watcher().read(cx);
    expect(app.execs.filter((call) => call.command === "gh" || call.command.endsWith("/pp-pr-preview-check") || (call.command.endsWith("/pp-pr-evidence") && call.args[0] === "status"))).toEqual([]);
    expect(state().lanes[0]).toMatchObject({ pr: { number: 42 }, preview: { link: "https://preview.example/42" } });
  });

  test("pp-lane-status runs once per repo, every 5 s for the focused repo and 30 s for the others", async () => {
    let now = 1_000_000;
    focusedCwd = lane;
    const view = watcher();
    view.clock = () => now;
    await view.read(cx);
    now += 2000;
    await view.read(cx);
    expect(statusCalls()).toHaveLength(1);
    now += 4000;
    await view.read(cx);
    expect(statusCalls()).toHaveLength(2);
    expect(statusCalls()[0]).toMatchObject({ args: ["--json"], cwd: main });
    focusedCwd = null;
    now += 6000;
    await view.read(cx);
    expect(statusCalls()).toHaveLength(2);
    now += 30_000;
    await view.read(cx);
    expect(statusCalls()).toHaveLength(3);
  });

  test("a VJR lane the report left out is read alone and offline", async () => {
    leftOut = new Set([lane]);
    await watcher().read(cx);
    expect(statusCalls().map((call) => call.args)).toContainEqual(["--json", "--no-network", "--path", lane]);
    expect(state().lanes[0].evidence).toMatchObject({ ready: false });
  });

  test("a claude leaving working re-reads its repo at once", async () => {
    let now = 1_000_000;
    agentsNow = [{ address: "t12", app: "claude-code", status: "working", foreground: { pid: 512, cwd: lane, argv: ["claude"] } }];
    const view = watcher();
    view.clock = () => now;
    await view.read(cx);
    agentsNow = [{ address: "t12", app: "claude-code", status: "idle", foreground: { pid: 512, cwd: lane, argv: ["claude"] } }];
    now += 2000;
    await view.read(cx);
    expect(statusCalls()).toHaveLength(2);
  });

  test("a second watcher stays idle while the first holds the lease", async () => {
    await watcher().read(cx);
    const before = app.execs.length;
    await watcher().read(cx);
    expect(app.execs.length).toBe(before);
  });

  test("closing the watcher frees the lease for the next one at once", async () => {
    const first = watcher();
    await first.read(cx);
    await first.close();
    const before = app.execs.length;
    await watcher().read(cx);
    expect(app.execs.length).toBeGreaterThan(before);
  });

  test("image folders of tasks that are gone are swept, live ones stay", async () => {
    const data = join(root, "app-home", "data", "command-center", "shots");
    mkdirSync(join(data, "fix-cup-1234-draft-reload"), { recursive: true });
    mkdirSync(join(data, "fix-old-task"), { recursive: true });
    await watcher().read(cx);
    const removed = app.execs.filter((call) => call.command === "rm").map((call) => call.args.at(-1));
    expect(removed).toEqual([join(data, "fix-old-task")]);
  });

  test("a screenshot copy that went missing is copied again", async () => {
    const dir = join(lane, ".pp-stack/updates/fix-cup-1234-draft-reload");
    mkdirSync(dir, { recursive: true });
    for (const name of ["message.txt", "meta.json", "screenshots.md"]) copyFileSync(join(FIXTURES, name), join(dir, name));
    evidence = { ready: false, dir, files: {}, reasons: {} };
    const view = watcher();
    await view.read(cx);
    const copies = () => app.execs.filter((call) => call.command === "cp").length;
    const first = copies();
    expect(first).toBe(3);
    view.cache[lane].taskAt = 0;
    await view.read(cx);
    expect(copies()).toBe(first + 3);
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

  test("a gh failure after a PR was seen keeps the PR and adds the error", async () => {
    const view = watcher();
    let now = 1_000_000;
    view.clock = () => now;
    prReturns(jsonPr());
    await view.read(cx);
    prReturns(null);
    statusError = "gh: auth required";
    now += 61_000;
    await view.read(cx);
    expect(state().lanes[0].pr).toMatchObject({ number: 42 });
    expect(state().lanes[0].prError).toBe("GitHub unavailable · gh: auth required");
  });

  test("a space opened on the task beats one whose shell only wandered into it", async () => {
    herdr.panes = () => [{ pane: "p1", tab: "tb-main", terminal: "t1", cwd: lane }];
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0]).toMatchObject({ space: "sp-1234", mainSpace: "sp-main" });
  });

  test("show goes to the last alerted task and opens the column", async () => {
    const view = watcher();
    let now = 1_000_000;
    view.clock = () => now;
    prReturns(jsonPr({ checks: runningCheck("test") }));
    await view.read(cx);
    prReturns(jsonPr({ checks: failedCheck("test") }));
    now += 61_000;
    await view.read(cx);
    expect(app.notes[0].title).toBe("PR #42 needs attention");
    await view.command("show");
    expect(app.runs).toContainEqual(["space.select", { id: "sp-1234" }]);
    expect(app.runs).toContainEqual(["layout.show", { id: "command-center" }]);
  });
});


describe("watcher per checkout", () => {
  const SESSION = "sess-1234";
  const taskWithSession = (dir: string) =>
    writeFileSync(join(dir, "VJR-TASK.md"), readFileSync(join(FIXTURES, "vjr-task-1234.md"), "utf8").replace("**Worktree:**", `**Session:** ${SESSION}\n**Worktree:**`));
  const sessionRecord = (over: Record<string, unknown> = {}) =>
    writeFileSync(
      join(root, "home", ".pp-stack", "session", `skill-${SESSION}.json`),
      JSON.stringify({ session_id: SESSION, skill: "vjr-ac", tty: "ttys003", cwd: main, started_at: new Date().toISOString(), ended_at: new Date().toISOString(), ...over }),
    );
  const conversation = (pid: number, sessionId: string) => {
    mkdirSync(join(root, "home", ".claude", "sessions"), { recursive: true });
    writeFileSync(join(root, "home", ".claude", "sessions", `${pid}.json`), JSON.stringify({ pid, sessionId, cwd: main }));
  };
  const mainClaude = (sessionId = SESSION) => {
    agentsNow = [{ address: "t3", app: "claude-code", status: "idle", foreground: { pid: 503, cwd: main, argv: ["claude"] } }];
    ttyOf = { "503": "ttys003" };
    conversation(503, sessionId);
  };

  test("every repo in a space is published with its checkouts", async () => {
    const view = watcher();
    await view.read(cx);
    expect((app.shared["command-center.state"] as any).repos).toEqual([{ name: "app", main, trees: [main, lane, other], error: null }]);
  });

  test("a repo switched off is not read and alerts nothing", async () => {
    app.shared["command-center.profiles"] = { [main]: "off" };
    const view = watcher();
    await view.read(cx);
    expect(state().lanes).toEqual([]);
    expect(statusCalls()).toEqual([]);
    expect(app.shared["command-center.lanes"]).toEqual({});
    expect(app.shared["command-center.badge"]).toEqual({ count: 0, level: null });
  });

  test("the task's session counts for it even when it runs in the main checkout", async () => {
    taskWithSession(lane);
    mainClaude();
    sessionRecord();
    const view = watcher();
    await view.read(cx);
    const published = state().lanes[0];
    expect(published.session).toEqual({ terminal: "t3", status: "idle", count: 1, ambiguous: false });
    expect(published.skill).toMatchObject({ family: "ac", skill: "vjr-ac", active: true, from: "session" });
    expect(published.claude.terminal).toBeNull();
    expect(published.next).toMatchObject({ kind: "focus", terminal: "t3" });
  });

  test("a Claude now running another conversation on the session's tty is not the session", async () => {
    taskWithSession(lane);
    mainClaude("someone-else");
    sessionRecord();
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0].session).toBeNull();
    expect(state().lanes[0].next).not.toMatchObject({ terminal: "t3" });
  });

  test("the session's claude is found by its conversation even with no skill record", async () => {
    taskWithSession(lane);
    mainClaude();
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0].session).toMatchObject({ terminal: "t3" });
  });

  test("an old session record still finds the session's claude", async () => {
    taskWithSession(lane);
    mainClaude();
    sessionRecord({ skill: "vjr-task", started_at: "2026-10-01T10:00:00Z", ended_at: "2026-10-01T10:05:00Z" });
    const view = watcher();
    await view.read(cx);
    expect(state().lanes[0].session).toMatchObject({ terminal: "t3" });
    expect(state().lanes[0].skill).toBeNull();
    expect(state().lanes[0].next).toMatchObject({ kind: "send", terminal: "t3", text: "/vjr-ac" });
  });

  test("a session two tasks claim counts for neither", async () => {
    taskWithSession(lane);
    taskWithSession(other);
    mainClaude();
    sessionRecord();
    const view = watcher();
    await view.read(cx);
    for (const published of state().lanes) {
      expect(published.skill).toBeNull();
      expect(published.session).toBeNull();
      expect(published.sessionShared).toBe(true);
    }
  });

  test("show selects the alerted task's space before opening the column", async () => {
    const view = watcher();
    let now = 1_000_000;
    view.clock = () => now;
    prReturns(jsonPr({ checks: runningCheck("test") }));
    await view.read(cx);
    prReturns(jsonPr({ checks: failedCheck("test") }));
    now += 61_000;
    await view.read(cx);
    await view.command("show", cx);
    const names = app.runs.map(([name]) => name);
    expect(app.runs).toContainEqual(["space.select", { id: "sp-1234" }]);
    expect(names.indexOf("space.select")).toBeLessThan(names.indexOf("layout.show"));
  });
});

const walk = (node: Node): Node[] => [node, ...node.kids.flatMap(walk)];
const called = (node: Node, name: string) => walk(node).flatMap((n) => n.calls.filter(([c]) => c === name).map(([, args]) => args));
const svgs = (node: Node) => called(node, "svg").map(([path]) => path as string);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const typing = { notify() {}, sleep: () => new Promise(() => {}) };
const submitCx = { notify() {}, spawn: (run: (cx: typeof typing) => unknown) => run(typing) };

function pathTo(node: Node, key: string): Node[] | null {
  if (node.key === key) return [node];
  for (const kid of node.kids) {
    const found = pathTo(kid, key);
    if (found) return [node, ...found];
  }
  return null;
}

function texts(node: Node): string[] {
  return [...node.texts, ...node.kids.flatMap(texts)];
}

const clicks = { notified: 0, spawned: 0, stale: 0 };

function press(view: { render(): Node }, key: string) {
  const path = pathTo(view.render(), key);
  if (!path) throw new Error(`no element ${key}`);
  let done = false;
  const guard = (use: () => unknown) => {
    if (done) clicks.stale += 1;
    else return use();
  };
  const task = { notify() {}, sleep: () => new Promise(() => {}) };
  const context = {
    stop_propagation() {},
    notify: () => guard(() => (clicks.notified += 1)),
    spawn: (run: (cx: typeof task) => unknown) => guard(() => {
      clicks.spawned += 1;
      return run(task);
    }),
  };
  for (const node of [...path].reverse()) for (const handler of node.handlers.click ?? []) handler({}, context);
  done = true;
}

const BASE_LANE = {
  key: "/w/cup-1234",
  path: "/w/cup-1234",
  repo: { name: "app", main: "/r/app" },
  branch: BRANCH,
  space: "sp-1234",
  mainSpace: "sp-main",
  task: { id: "CUP-1234", title: "A saved draft disappears", kind: "bug", url: "https://app.clickup.com/t/86abc1234", base: "main", branch: BRANCH, done: [{ id: "D01", item: "The draft stays" }], verification: null },
  lastCode: HEAD,
  sinceVerified: 0,
  skill: null,
  claude: { terminal: "t12", status: "idle", count: 1, ambiguous: false },
  evidence: null,
  preview: null,
  pr: null,
  release: null,
  steps: ["done", "next", "todo", "todo", "todo", "todo", "todo"],
  chip: { chip: "Task", tone: "idle" },
  next: { label: "Run /vjr-ac", kind: "send", terminal: "t12", text: "/vjr-ac", target: "claude · t12 in this worktree", space: "sp-1234", folder: "/w/cup-1234" },
  note: null,
};

const RELEASE = {
  slug: "fix-cup-1234-draft-reload",
  dir: "/w/cup-1234/.pp-stack/updates/fix-cup-1234-draft-reload",
  messagePath: "/w/cup-1234/.pp-stack/updates/fix-cup-1234-draft-reload/message.txt",
  release: "2.3.0",
  title: "Drafts Survive a Reload 💾✨",
  items: [{ parts: [{ text: "Replies stay after a reload" }] }],
  channel: "general",
  links: "local",
  shots: [
    { file: "02-a.png", caption: "The reply is still there", featured: true, image: "data/command-center/fix-cup-1234-draft-reload/02-a.png" },
    { file: "01-b.png", caption: "Saving", featured: false, image: "data/command-center/fix-cup-1234-draft-reload/01-b.png" },
  ],
};

const REPOS = [{ name: "app", main: "/r/app", trees: ["/r/app", "/w/cup-1234", "/w/cup-9", "/w/bare"] }];
const MERGED_PR = { number: 42, url: "https://github.com/acme/app/pull/42", state: "MERGED", isDraft: false, reviewDecision: "", checks: { passed: 0, failed: [], pending: 0, items: [] } };
const SHIPPED = {
  ...BASE_LANE,
  release: RELEASE,
  pr: MERGED_PR,
  steps: ["done", "done", "done", "done", "done", "done", "next"],
  next: { label: "Run /pp-clear", kind: "tab", target: "new tab in app", text: "/pp-clear 42", space: "sp-main", folder: "/r/app" },
};

function column(lanes: Record<string, unknown>[] = [BASE_LANE], repos: Record<string, unknown>[] = REPOS, extra: Record<string, unknown> = {}) {
  app.shared["command-center.state"] = { lanes, repos, ...extra };
  propsNow = {};
  const view = new CommandCenter();
  view.init({}, cx);
  return view;
}

const sends = () => app.execs.filter((call) => call.command === "hc" && call.args[0] === "send");

beforeEach(() => {
  clicks.notified = 0;
  clicks.spawned = 0;
  clicks.stale = 0;
});

describe("column", () => {
  test("the next step types only into the task's claude", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column();
    press(view, "next");
    await flush();
    expect(sends().map((call) => call.args)).toEqual([["send", "--if", "idle", "t12", "/vjr-ac"]]);
    expect(texts(view.render())).toContain("Sent to claude · t12");
  });

  test("a disabled next step sends nothing", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column([{ ...BASE_LANE, next: { label: "Waiting for /review", kind: "wait", disabled: true, target: "the skill is still working" } }]);
    press(view, "next");
    await flush();
    expect(sends()).toEqual([]);
    expect(app.runs).toEqual([]);
  });

  test("New tab instead opens claude with the step as its first message", () => {
    focusedCwd = "/w/cup-1234";
    press(column(), "new-tab");
    expect(app.runs).toContainEqual(["tab.new", { space: "sp-1234", folder: "/w/cup-1234", argv: ["claude"], task: "/vjr-ac" }]);
  });

  test("a task without a space opens a new space in its folder", () => {
    focusedCwd = "/w/cup-1234";
    press(column([{ ...BASE_LANE, space: null }]), "new-tab");
    expect(app.runs).toContainEqual(["space.new", { folder: "/w/cup-1234", argv: ["claude"], task: "/vjr-ac", machine: "" }]);
  });

  test("every next step says what it did", async () => {
    focusedCwd = "/w/cup-1234";
    const cases: [Record<string, unknown>, string][] = [
      [{ label: "Run /vjr-ac in a new tab", kind: "tab", text: "/vjr-ac", space: "sp-1234", folder: "/w/cup-1234" }, "New tab: /vjr-ac"],
      [{ label: "Run /pp-clear", kind: "space", text: "/pp-clear 42", space: null, folder: "/r/app" }, "New space: /pp-clear"],
      [{ label: "Go to claude", kind: "focus", terminal: "t41", target: "review is waiting on you" }, "Went to claude · t41"],
      [{ label: "Open PR #42", kind: "open", url: "https://github.com/acme/app/pull/42", target: "github.com" }, "Opened https://github.com/acme/app/pull/42"],
    ];
    for (const [next, said] of cases) {
      const view = column([{ ...BASE_LANE, next }]);
      press(view, "next");
      await flush();
      expect(texts(view.render())).toContain(said);
    }
  });

  test("New tab instead says it opened the tab", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column();
    press(view, "new-tab");
    await flush();
    expect(texts(view.render())).toContain("New tab: /vjr-ac");
  });

  test("the column follows the focused checkout and never keeps the last task", () => {
    const second = { ...BASE_LANE, key: "/w/cup-9", path: "/w/cup-9", task: { ...BASE_LANE.task, id: "CUP-9", title: "Another task" } };
    const view = column([BASE_LANE, second]);
    focusedCwd = "/w/cup-9/src";
    expect(texts(view.render())).toContain("Another task");
    focusedCwd = "/x/not-a-task";
    expect(texts(view.render())).not.toContain("Another task");
    expect(texts(view.render())).toContain("Not in a repository");
  });

  test("a task published after the focus moved into it is still picked", () => {
    const view = column([], []);
    focusedCwd = "/w/cup-1234/src";
    expect(texts(view.render())).toContain("Not in a repository");
    app.shared["command-center.state"] = { lanes: [BASE_LANE], repos: REPOS };
    expect(texts(view.render())).toContain("A saved draft disappears");
  });

  test("outside a repo the column says so", () => {
    focusedCwd = "/x/not-a-task";
    expect(texts(column().render())).toContain("Not in a repository");
  });

  test("the header names the checkout and the repo's profile", () => {
    focusedCwd = "/w/cup-1234";
    const shown = texts(column().render());
    expect(shown).toContain("app");
    expect(shown).toContain("cup-1234");
    expect(shown).toContain("Work - VJR");
  });

  test("the timeline names every step with what it did or will do", () => {
    focusedCwd = "/w/cup-1234";
    const shown = texts(column().render());
    for (const label of ["Task", "AC", "Ship", "Evidence", "PR", "Merge", "Clear"]) expect(shown).toContain(label);
    for (const note of ["1 done item", "next: /vjr-ac", "/pp-ship in a new tab", "no PR yet", "/pp-clear from main"]) expect(shown).toContain(note);
  });

  test("a done Task opens its done items and closes again", () => {
    focusedCwd = "/w/cup-1234";
    const view = column();
    expect(texts(view.render())).not.toContain("D01  The draft stays");
    press(view, "step-Task");
    expect(texts(view.render())).toContain("D01  The draft stays");
    expect(svgs(pathTo(view.render(), "step-Task")?.at(-1) as Node)).toContain("mods/kit/icons/chevron-down.svg");
    press(view, "step-Task");
    expect(texts(view.render())).not.toContain("D01  The draft stays");
  });

  test("VJR-TASK.md opens in the markdown pane", () => {
    focusedCwd = "/w/cup-1234";
    press(column(), "link-file");
    expect(app.runs).toContainEqual(["pane.split", { direction: "right", mod: "markdown", props: { file: "/w/cup-1234/VJR-TASK.md" } }]);
    expect(app.execs.filter((call) => call.command === "open")).toEqual([]);
  });

  test("pp-ship's new tab is named for the task", () => {
    focusedCwd = "/w/cup-1234";
    const shipping = { ...BASE_LANE, steps: ["done", "done", "next", "todo", "todo", "todo", "todo"], next: { label: "Run /pp-ship in a new tab", kind: "tab", space: "sp-1234", folder: "/w/cup-1234", text: "/pp-ship --base main", name: "ship · CUP-1234", target: "new tab in this worktree" } };
    press(column([shipping]), "next");
    expect(app.runs).toContainEqual(["tab.new", { space: "sp-1234", folder: "/w/cup-1234", name: "ship · CUP-1234", argv: ["claude"], task: "/pp-ship --base main" }]);
  });

  test("the profile button opens a popup for this repo", () => {
    focusedCwd = "/w/cup-1234";
    press(column(), "profile");
    expect(app.overlays[0]).toMatchObject({ mod: "command-center", kind: "popup", at: "pointer", props: { role: "profile", repo: "/r/app", name: "app" } });
  });

  test("a repo switched off says so and turns back on", () => {
    focusedCwd = "/w/cup-1234";
    app.shared["command-center.profiles"] = { "/r/app": "off" };
    const view = column();
    expect(texts(view.render())).toContain("Command Center is off in app");
    expect(texts(view.render())).toContain("Off");
    expect(texts(view.render())).not.toContain("A saved draft disappears");
    press(view, "profile-on");
    expect(app.shared["command-center.profiles"]).toEqual({});
  });

  test("a worktree not read yet says it is being read, with no word of VJR-TASK.md", () => {
    focusedCwd = "/w/bare";
    const shown = texts(column().render());
    expect(shown).toContain("Reading this worktree…");
    expect(shown.join(" ")).not.toContain("VJR-TASK.md");
  });

  test("the main checkout lists the repo's tasks", () => {
    focusedCwd = "/r/app";
    const view = column([BASE_LANE, { ...SHIPPED, key: "/w/cup-9", path: "/w/cup-9", task: { ...BASE_LANE.task, id: "CUP-9", title: "Shipped task" } }]);
    const shown = texts(view.render());
    expect(shown).toContain("TASKS IN APP");
    expect(shown).toContain("A saved draft disappears");
    expect(shown).toContain("merged · clean up");
  });

  test("with /vjr-task, Enter sends the text to /vjr-task in a new tab", async () => {
    focusedCwd = "/r/app";
    const view = column([BASE_LANE], REPOS, { vjrTask: true });
    expect(texts(view.render())).toContain("Enter runs /vjr-task in a new tab");
    view.startInput.set_value("CUP-5555");
    view.startInput.emit("submit", submitCx);
    await flush();
    expect(app.runs).toContainEqual(["tab.new", { space: "sp-1234", folder: "/r/app", name: "start · CUP-5555", argv: ["claude"], task: "/vjr-task CUP-5555" }]);
    expect(view.startInput.value()).toBe("");
    expect(texts(view.render())).toContain("Started: start · CUP-5555");
  });

  test("Team flow instead claims with /work and starts the worktree with Herdr as the editor", () => {
    focusedCwd = "/r/app";
    const view = column([BASE_LANE], REPOS, { vjrTask: true });
    view.startInput.set_value("CUP-5555");
    press(view, "start-team");
    expect(app.runs).toContainEqual(["tab.new", { space: "sp-1234", folder: "/r/app", name: "start · CUP-5555", argv: ["env", "PP_EDITOR=herdr", "claude"], task: "/work start CUP-5555, then /pp-worktree-start for it" }]);
  });

  test("without /vjr-task, Enter runs the team flow and nothing mentions vjr", async () => {
    focusedCwd = "/r/app";
    const view = column([], REPOS, { vjrTask: false });
    const shown = texts(view.render());
    expect(shown).toContain("Enter claims with /work and runs /pp-worktree-start");
    expect(shown.join(" ")).not.toMatch(/vjr/i);
    expect(pathTo(view.render(), "start-team")).toBeNull();
    view.startInput.set_value("faster search");
    view.startInput.emit("submit", submitCx);
    await flush();
    expect(app.runs).toContainEqual(["tab.new", { space: "sp-1234", folder: "/r/app", name: "start · faster search", argv: ["env", "PP_EDITOR=herdr", "claude"], task: "/pp-worktree-start faster search" }]);
  });

  test("an id that already has a lane goes to its space and starts nothing", async () => {
    focusedCwd = "/r/app";
    const view = column([BASE_LANE], REPOS, { vjrTask: true });
    view.startInput.set_value("cup-1234");
    view.startInput.emit("submit", submitCx);
    await flush();
    expect(app.runs).toEqual([["space.select", { id: "sp-1234" }]]);
  });

  test("an empty field starts nothing", async () => {
    focusedCwd = "/r/app";
    const view = column([], REPOS, { vjrTask: true });
    view.startInput.set_value("  ");
    view.startInput.emit("submit", submitCx);
    await flush();
    expect(app.runs).toEqual([]);
  });

  test("a row's own action runs without picking the row", () => {
    focusedCwd = "/r/app";
    const shipped = { ...SHIPPED, key: "/w/cup-9", path: "/w/cup-9", space: "sp-9", task: { ...BASE_LANE.task, id: "CUP-9", title: "Shipped task" } };
    press(column([shipped]), "lane-act-/w/cup-9");
    expect(app.runs).toContainEqual(["tab.new", { space: "sp-main", folder: "/r/app", argv: ["claude"], task: "/pp-clear 42" }]);
    expect(app.runs.filter(([name]) => name === "space.select")).toEqual([]);
  });

  test("Copy message uses pp-stack-rich-copy on message.txt", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column([SHIPPED]);
    expect(texts(pathTo(view.render(), "copy")?.at(-1) as Node)).toEqual(["Copy message"]);
    press(view, "copy");
    await flush();
    const copy = app.execs.find((call) => call.command.endsWith("/pp-stack-rich-copy"));
    expect(copy?.args).toEqual([RELEASE.messagePath]);
    expect(texts(view.render())).toContain("Copied the message");
  });

  test("a merged task with local links offers to regenerate", () => {
    focusedCwd = "/w/cup-1234";
    const shown = texts(column([SHIPPED]).render());
    expect(shown).toContain("Links still point to local.");
    expect(shown).toContain("Regenerate with production links");
  });

  test("a screenshot opens the shot window from the opened Evidence step", () => {
    focusedCwd = "/w/cup-1234";
    const view = column([{ ...BASE_LANE, release: RELEASE, steps: ["done", "done", "done", "done", "run", "todo", "todo"] }]);
    expect(pathTo(view.render(), "shot-0")).toBeNull();
    press(view, "step-Evidence");
    press(view, "shot-0");
    expect(app.overlays[0]).toMatchObject({ kind: "window", key: "command-center-shot", mod: "command-center", props: { role: "shot", lane: "/w/cup-1234", index: 0 } });
  });

  test("picking a task in the main checkout selects its space", () => {
    focusedCwd = "/r/app";
    press(column(), "lane-/w/cup-1234");
    expect(app.runs).toContainEqual(["space.select", { id: "sp-1234" }]);
  });
});

describe("review fixes in the column", () => {
  test("sending runs in a task and never touches the click after it returns", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column();
    press(view, "next");
    await flush();
    expect(clicks.spawned).toBeGreaterThan(0);
    expect(clicks.stale).toBe(0);
    expect(texts(view.render())).toContain("Sent to claude · t12");
  });

  test("copying runs in a task and never touches the click after it returns", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column([SHIPPED]);
    press(view, "copy");
    await flush();
    expect(clicks.stale).toBe(0);
    expect(texts(view.render())).toContain("Copied the message");
  });

  test("a new tab always starts in the task's own folder", () => {
    focusedCwd = "/w/cup-1234";
    press(column([{ ...BASE_LANE, next: { label: "Run /vjr-ac in a new tab", kind: "tab", space: "sp-main", folder: "/w/cup-1234", text: "/vjr-ac", target: "new tab in app" } }]), "next");
    expect(app.runs).toContainEqual(["tab.new", { space: "sp-main", folder: "/w/cup-1234", argv: ["claude"], task: "/vjr-ac" }]);
  });

  test("opening a step and picking a task redraw at once", () => {
    focusedCwd = "/w/cup-1234";
    const view = column();
    press(view, "step-Task");
    expect(clicks.notified).toBe(1);
    focusedCwd = "/r/app";
    press(view, "lane-/w/cup-1234");
    expect(clicks.notified).toBe(2);
  });

  test("regenerate never types into a claude that needs you", () => {
    focusedCwd = "/w/cup-1234";
    const merged = { ...SHIPPED, claude: { terminal: "t12", status: "blocked", count: 1, ambiguous: false } };
    press(column([merged]), "regenerate");
    expect(sends()).toEqual([]);
    expect(app.runs).toEqual([]);
  });

  test("a gh failure after a PR was seen still says GitHub unavailable", () => {
    focusedCwd = "/w/cup-1234";
    const seen = { ...BASE_LANE, steps: ["done", "done", "done", "done", "run", "todo", "todo"], pr: { number: 42, url: "u", state: "OPEN", isDraft: false, reviewDecision: "", checks: { passed: 0, failed: [], pending: 0, items: [] } }, prError: "GitHub unavailable · gh: auth required" };
    expect(texts(column([seen]).render())).toContain("GitHub unavailable · gh: auth required");
  });
});

describe("manual checks in the column", () => {
  const MANUAL = [
    { id: "D01", url: "http://app.localhost/inbox", steps: "Type a reply, then reload.", expected: "The reply stays.", state: "passed", note: null },
    { id: "D02", url: "http://app.localhost/inbox", steps: "Watch the label.", expected: "Saving… then Saved.", state: "asking", note: null },
    { id: "D03", url: null, steps: "Send, then reload.", expected: "No draft.", state: "pending", note: null },
  ];
  const AC_LANE = {
    ...BASE_LANE,
    task: { ...BASE_LANE.task, manual: MANUAL },
    skill: { family: "ac", skill: "vjr-ac", waiting: true, active: true },
    steps: ["done", "run", "todo", "todo", "todo", "todo", "todo"],
    next: { label: "Go to claude", kind: "focus", terminal: "t12", target: "vjr-ac is waiting on you" },
  };
  const task = { notify() {}, sleep: () => new Promise(() => {}) };
  const enterCx = { notify() {}, spawn: (run: (cx: typeof task) => unknown) => run(task) };

  test("the asking check answers Passed in the task's claude", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column([AC_LANE]);
    const shown = texts(view.render());
    expect(shown).toContain("Watch the label.");
    expect(shown).toContain("→ Saving… then Saved.");
    press(view, "check-pass-D02");
    await flush();
    expect(sends().map((call) => call.args)).toEqual([["send", "--if", "idle", "t12", "D02 passed"]]);
    expect(texts(view.render())).toContain("Sent");
    expect(pathTo(view.render(), "check-pass-D02")).toBeNull();
  });

  test("Failed asks what you saw, Enter sends it, an empty note sends nothing", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column([AC_LANE]);
    press(view, "check-fail-D02");
    expect(pathTo(view.render(), "check-note")).not.toBeNull();
    view.failInput.set_value("   ");
    view.failInput.emit("submit", enterCx);
    await flush();
    expect(sends()).toEqual([]);
    view.failInput.set_value("Saved never showed");
    view.failInput.emit("submit", enterCx);
    await flush();
    expect(sends().map((call) => call.args)).toEqual([["send", "--if", "idle", "t12", "D02 failed: Saved never showed"]]);
    expect(pathTo(view.render(), "check-note")).toBeNull();
  });

  test("Esc closes the note without sending", () => {
    focusedCwd = "/w/cup-1234";
    const view = column([AC_LANE]);
    press(view, "check-fail-D02");
    view.noteKey("escape", enterCx);
    expect(pathTo(view.render(), "check-note")).toBeNull();
    expect(sends()).toEqual([]);
  });

  test("only the asked check has buttons, and Open opens its link", () => {
    focusedCwd = "/w/cup-1234";
    const view = column([AC_LANE]);
    expect(pathTo(view.render(), "check-pass-D03")).toBeNull();
    expect(pathTo(view.render(), "check-pass-D01")).toBeNull();
    press(view, "check-open-D02");
    expect(app.execs.find((call) => call.command === "open")?.args).toEqual(["http://app.localhost/inbox"]);
  });

  test("an asking check shows its state as a chip and its answers with icons", () => {
    focusedCwd = "/w/cup-1234";
    const root = column([AC_LANE]).render();
    expect(svgs(pathTo(root, "check-pass-D02")?.at(-1) as Node)).toContain("mods/kit/icons/check.svg");
    expect(svgs(pathTo(root, "check-fail-D02")?.at(-1) as Node)).toContain("mods/kit/icons/x.svg");
    expect(texts(root)).toContain("asking");
    const asking = walk(root).find((n) => n.texts.includes("asking")) as Node;
    expect(asking.kids.some((kid) => kid.calls.some(([c, a]) => c === "size" && a[0] === 7) && kid.calls.some(([c]) => c === "bg"))).toBe(true);
    expect(texts(root)).toContain("passed");
    expect(texts(root)).toContain("pending");
    expect(texts(root).join("")).not.toMatch(/[\u2713\u25cf\u25cb\u2197]/);
  });

  test("a working claude shows the checks without buttons and says why", () => {
    focusedCwd = "/w/cup-1234";
    const view = column([{ ...AC_LANE, claude: { terminal: "t12", status: "working", count: 1, ambiguous: false } }]);
    expect(pathTo(view.render(), "check-pass-D02")).toBeNull();
    expect(texts(view.render())).toContain("claude is working");
  });

  test("checks asked in the task's session link to its claude and answer there", async () => {
    focusedCwd = "/w/cup-1234";
    const view = column([{ ...AC_LANE, claude: { terminal: null, status: null, count: 0, ambiguous: false }, session: { terminal: "t30", status: "idle", count: 1, ambiguous: false }, skill: { ...AC_LANE.skill, from: "session" } }]);
    expect(texts(view.render())).toContain("claude · t30");
    press(view, "check-pass-D02");
    await flush();
    expect(sends().map((call) => call.args)).toEqual([["send", "--if", "idle", "t30", "D02 passed"]]);
    press(view, "go-claude");
    expect(app.runs).toContainEqual(["pane.focus", { terminal: "t30" }]);
  });

  test("a step sent to the task's session keeps the idle check", async () => {
    focusedCwd = "/w/cup-1234";
    const lane = { ...BASE_LANE, claude: { terminal: null, status: null, count: 0, ambiguous: false }, session: { terminal: "t30", status: "idle", count: 1, ambiguous: false }, next: { label: "Run /vjr-ac", kind: "send", terminal: "t30", text: "/vjr-ac", target: "the task's claude · t30" } };
    press(column([lane]), "next");
    await flush();
    expect(sends().map((call) => call.args)).toEqual([["send", "--if", "idle", "t30", "/vjr-ac"]]);
  });

  test("the column stays on the task while the markdown pane has the focus", () => {
    focusedCwd = null;
    herdr.focused = () => ({ space: "sp-1234", tab: "tb-1234", pane: "p-md", terminal: null, shown: null, agent: null, cwd: null }) as never;
    herdr.panes = () => [{ pane: "p-sh", tab: "tb-1234", terminal: "t1", cwd: "/w/cup-1234" }, { pane: "p-md", tab: "tb-1234", terminal: null, cwd: null }] as never;
    expect(texts(column().render())).toContain("A saved draft disappears");
  });

  test("the checks leave once AC is done", () => {
    focusedCwd = "/w/cup-1234";
    const view = column([{ ...AC_LANE, skill: null, steps: ["done", "done", "next", "todo", "todo", "todo", "todo"] }]);
    expect(texts(view.render())).not.toContain("Watch the label.");
  });
});

describe("profile popup", () => {
  test("it marks the repo's profile and switches it off and on", () => {
    const closed: unknown[] = [];
    herdr.closeOverlay = (id: never) => {
      closed.push(id);
      return null;
    };
    propsNow = { role: "profile", repo: "/r/app", name: "app", overlay: "o7" };
    const view = new CommandCenter();
    view.init({}, cx);
    const shown = texts(view.render());
    expect(shown).toContain("PROFILE · APP");
    expect(shown).toContain("Work");
    expect(shown).toContain("Off");
    press(view, "profile-off");
    expect(app.shared["command-center.profiles"]).toEqual({ "/r/app": "off" });
    press(view, "profile-work");
    expect(app.shared["command-center.profiles"]).toEqual({});
    expect(closed).toEqual(["o7", "o7"]);
  });
});

describe("shot window", () => {
  test("it shows the picked screenshot with its caption and moves with the arrows", () => {
    app.shared["command-center.state"] = { lanes: [{ ...BASE_LANE, release: RELEASE }] };
    propsNow = { role: "shot", lane: "/w/cup-1234", index: 0, overlay: "o9" };
    const view = new CommandCenter();
    view.init(propsNow, cx);
    expect(texts(view.render())).toContain("The reply is still there");
    let notified = 0;
    view.key("right", { notify: () => (notified += 1) });
    expect(notified).toBe(1);
    expect(texts(view.render())).toContain("Saving");
    view.key("escape");
  });

  test("the screenshot viewer closes with an x icon", () => {
    app.shared["command-center.state"] = { lanes: [{ ...BASE_LANE, release: RELEASE }] };
    propsNow = { role: "shot", lane: "/w/cup-1234", index: 0, overlay: "o9" };
    const view = new CommandCenter();
    view.init(propsNow, cx);
    expect(svgs(pathTo(view.render(), "close")?.at(-1) as Node)).toEqual(["mods/kit/icons/x.svg"]);
    expect(called(pathTo(view.render(), "close")?.at(-1) as Node, "tooltip")).toEqual([["Close"]]);
    expect(texts(view.render()).join("")).not.toMatch(/[\u2715\u2190]/);
  });
});

describe("timeline and identity", () => {
  const named = new Proxy({}, { get: (_x, p) => (typeof p === "string" ? `t.${p}` : undefined) });

  beforeEach(() => {
    focusedCwd = "/w/cup-1234";
    Object.assign(herdr, { theme: () => named });
  });

  test("done steps show a heavy check node and the current one an accent ring", () => {
    const view = column([SHIPPED]);
    const root = view.render();
    expect(svgs(root).filter((path) => path === "mods/kit/icons/check-heavy.svg")).toHaveLength(6);
    const nodes = walk(root).filter((n) => n.calls.some(([c, a]) => c === "rounded" && a[0] === 9));
    expect(nodes.length).toBeGreaterThan(0);
    for (const node of nodes) expect(node.texts).toEqual([]);
  });

  test("an expandable step shows a chevron that turns when opened", () => {
    const view = column([{ ...BASE_LANE, steps: ["done", "next", "todo", "todo", "todo", "todo", "todo"] }]);
    const head = () => pathTo(view.render(), "step-Task")?.at(-1) as Node;
    expect(svgs(head())).toContain("mods/kit/icons/chevron-right.svg");
    expect(texts(head()).join("")).not.toContain("▸");
    press(view, "step-Task");
    expect(svgs(head())).toContain("mods/kit/icons/chevron-down.svg");
    expect(texts(head()).join("")).not.toContain("▾");
  });

  test("Start a task is a field with a plus and its placeholder", () => {
    focusedCwd = "/r/app";
    const view = column([]);
    const start = pathTo(view.render(), "start-task")?.at(-1) as Node;
    expect(svgs(start)).toEqual(["mods/kit/icons/plus.svg"]);
    expect(called(start, "border_dashed")).toHaveLength(1);
    expect(view.startInput.placeholder).toBe("CUP-1234 or what you'll work on");
  });

  test("the profile button shows a chevron", () => {
    focusedCwd = "/w/cup-1234";
    const profile = pathTo(column().render(), "profile")?.at(-1) as Node;
    expect(svgs(profile)).toEqual(["mods/kit/icons/chevron-down.svg"]);
    expect(texts(profile).join("")).not.toContain("\u25be");
  });

  test("the step gutter is as wide as the node", () => {
    const head = pathTo(column().render(), "step-Task");
    const row = head?.at(-3) as Node;
    const gutter = row.kids[0];
    expect(gutter.calls).toContainEqual(["w", [18]]);
  });

  test("the task links are named buttons with gray icons", () => {
    const root = column([{ ...BASE_LANE, pr: { number: 42, url: "https://github.com/acme/app/pull/42", state: "OPEN" } }]).render();
    const rows = [
      ["link-task", "ClickUp", "clickup"],
      ["link-pr", "PR #42", "github"],
      ["link-file", "VJR-TASK.md", "eye"],
      ["link-zed", "Zed", "zed"],
    ];
    for (const [id, label, name] of rows) {
      const node = pathTo(root, id)?.at(-1) as Node;
      expect(texts(node)).toContain(label);
      expect(svgs(node)).toEqual([`mods/kit/icons/${name}.svg`]);
      const iconNode = walk(node).find((n) => n.calls.some(([c, a]) => c === "svg" && a[0] === `mods/kit/icons/${name}.svg`)) as Node;
      expect(iconNode.calls).toContainEqual(["text_color", ["t.muted"]]);
      expect(called(node, "tooltip")).toEqual([]);
    }
    const row = pathTo(root, "link-task")?.at(-2) as Node;
    expect(row.calls).toContainEqual(["pt", [8]]);
  });

  test("the PR and ClickUp buttons show only when the task has them", () => {
    const bare = pathTo(column([{ ...BASE_LANE, task: { ...BASE_LANE.task, url: null } }]).render(), "link-task");
    expect(bare).toBeNull();
    expect(pathTo(column().render(), "link-pr")).toBeNull();
    expect(pathTo(column().render(), "link-task")).not.toBeNull();
  });
});

const LANE_REPORT = JSON.parse(readFileSync(join(FIXTURES, "lane-status.json"), "utf8"));
const PP_REPOS = [{ name: "app", main: "/r/app", trees: ["/r/app", "/w/cup-1234", "/w/app-lincoln", "/w/app-cup-7001", "/w/app-gabriel", "/w/app-cup-7003"], error: null }];

function ppLane(index: number, over: Record<string, unknown> = {}) {
  const json = LANE_REPORT.lanes[index];
  const lane = { ...ppSignals(json, factsOf(json, LANE_REPORT), { repo: { name: "app", main: "/r/app" }, space: "sp-pp", mainSpace: "sp-main", claudes: [] }), ...over };
  const shown = { ...lane, next: ppNext(lane) };
  return { ...shown, chip: ppChip(shown), summary: ppSummary(shown) };
}

function profilePopup(state: Record<string, unknown>) {
  app.shared["command-center.state"] = state;
  propsNow = { role: "profile", repo: "/r/app", name: "app", overlay: "o7" };
  const view = new CommandCenter();
  view.init({}, cx);
  return view;
}

describe("Work - PP column", () => {
  test("the header says Work in main, the flow in a worktree, Off when off", () => {
    const lanes = [BASE_LANE, ppLane(0)];
    focusedCwd = "/w/app-lincoln";
    expect(texts(column(lanes, PP_REPOS).render())).toContain("Work - PP");
    focusedCwd = "/w/cup-1234";
    expect(texts(column(lanes, PP_REPOS).render())).toContain("Work - VJR");
    focusedCwd = "/r/app";
    const main = texts(column(lanes, PP_REPOS).render());
    expect(main).toContain("Work");
    expect(main).not.toContain("Work - PP");
    app.shared["command-center.profiles"] = { "/r/app": "off" };
    expect(texts(column(lanes, PP_REPOS).render())).toContain("Off");
  });

  test("a Work - PP worktree shows six steps with the report's notes", () => {
    focusedCwd = "/w/app-lincoln";
    const shown = texts(column([ppLane(0)], PP_REPOS).render());
    for (const label of ["Build", "Ship", "Evidence", "PR", "Merge", "Clear"]) expect(shown).toContain(label);
    for (const note of ["40 commits ahead of main", "3 commits since ship", "3 of 4 current", "/pp-clear from main"]) expect(shown).toContain(note);
    expect(shown).not.toContain("Task");
    expect(shown).not.toContain("AC");
  });

  test("its identity shows the task, where it came from and no VJR-TASK.md", () => {
    focusedCwd = "/w/app-cup-7001";
    const shown = texts(column([ppLane(1)], PP_REPOS).render());
    expect(shown).toContain("CUP-7001");
    expect(shown).toContain("claimed with /work");
    expect(shown).toContain("Child of the umbrella");
    expect(shown).toContain("feat/CUP-7000--cup-7001-umbrella-child → feat/CUP-7000");
    expect(shown).not.toContain("VJR-TASK.md");
    focusedCwd = "/w/app-lincoln";
    const bare = texts(column([ppLane(0)], PP_REPOS).render());
    expect(bare).toContain("\u2014");
    expect(bare).not.toContain("from the branch");
  });

  test("the open Ship step shows the ships, what the last covers and the commits since", () => {
    focusedCwd = "/w/app-lincoln";
    const shown = texts(column([ppLane(0)], PP_REPOS).render());
    for (const text of ["12 ships", "covers aaaaaaa", "3 code commits since"]) expect(shown).toContain(text);
  });

  test("the open Evidence step says why each receipt is stale", () => {
    focusedCwd = "/w/app-lincoln";
    const shown = texts(column([ppLane(0, { steps: ["done", "done", "bad", "run", "todo", "todo"] })], PP_REPOS).render());
    expect(shown).toContain("ship.json");
    expect(shown).toContain("3 code commits since covers_sha");
  });

  test("a check with a link opens it", () => {
    focusedCwd = "/w/app-cup-7001";
    const view = column([ppLane(1, { steps: ["done", "done", "done", "run", "todo", "todo"] })], PP_REPOS);
    expect(texts(view.render())).toContain("CI / test");
    press(view, "pr-check-0");
    expect(app.execs).toContainEqual({ command: "open", args: ["https://github.com/acme/app/actions/runs/2"], cwd: undefined });
  });

  test("the editor button follows PP_EDITOR", () => {
    focusedCwd = "/w/app-lincoln";
    let view = column([ppLane(0)], PP_REPOS, { editor: "zed" });
    let node = pathTo(view.render(), "link-editor")?.at(-1) as Node;
    expect(texts(node)).toContain("Zed");
    expect(svgs(node)).toEqual(["mods/kit/icons/zed.svg"]);
    press(view, "link-editor");
    expect(app.execs.at(-1)).toMatchObject({ command: "zed", args: ["/w/app-lincoln"] });
    view = column([ppLane(0)], PP_REPOS, { editor: "cursor" });
    node = pathTo(view.render(), "link-editor")?.at(-1) as Node;
    expect(texts(node)).toContain("Cursor");
    expect(svgs(node)).toEqual(["mods/kit/icons/cursor.svg"]);
    press(view, "link-editor");
    expect(app.execs.at(-1)).toMatchObject({ command: "open", args: ["-na", "Cursor", "--args", "/w/app-lincoln"] });
  });

  test("on a machine without /vjr-task nothing in a Work - PP column or the profile popup says vjr", () => {
    for (const [index, path] of [[0, "/w/app-lincoln"], [1, "/w/app-cup-7001"], [3, "/w/app-cup-7003"]] as const) {
      focusedCwd = path;
      expect(texts(column([ppLane(index)], PP_REPOS, { vjrTask: false }).render()).join(" ")).not.toMatch(/vjr/i);
    }
    expect(texts(profilePopup({ vjrTask: false }).render()).join(" ")).not.toMatch(/vjr/i);
  });

  test("the main list tags each row VJR or PP only where /vjr-task exists", () => {
    focusedCwd = "/r/app";
    const lanes = [BASE_LANE, ppLane(0)];
    const tagged = texts(column(lanes, PP_REPOS, { vjrTask: true }).render());
    expect(tagged).toContain("VJR");
    expect(tagged).toContain("PP");
    const row = texts(pathTo(column(lanes, PP_REPOS, { vjrTask: true }).render(), "lane-/w/app-lincoln")?.at(-1) as Node);
    expect(row).toContain("\u2014");
    expect(row).toContain("Ship");
    expect(row).toContain("3 commits since ship");
    const plain = texts(column(lanes, PP_REPOS, { vjrTask: false }).render());
    expect(plain).not.toContain("VJR");
    expect(plain).not.toContain("PP");
  });

  test("an old pp-stack says which version is needed and offers Off", () => {
    focusedCwd = "/w/app-lincoln";
    const view = column([ppLane(0)], [{ ...PP_REPOS[0], error: "Command Center needs pp-stack 0.94.0 or later" }]);
    const shown = texts(view.render());
    expect(shown).toContain("Command Center needs pp-stack 0.94.0 or later");
    expect(shown).toContain("Update pp-stack, or switch this repo off.");
    expect(shown).not.toContain("12 ships");
    press(view, "profile-off");
    expect(app.shared["command-center.profiles"]).toEqual({ "/r/app": "off" });
  });

  test("the profile popup offers Work and Off, each with its line", () => {
    const withVjr = texts(profilePopup({ vjrTask: true }).render());
    expect(withVjr).toContain("Work");
    expect(withVjr).toContain("Work - VJR with VJR-TASK.md, Work - PP without");
    expect(withVjr).toContain("Off");
    expect(withVjr).toContain("nothing is read in this repo");
    expect(texts(profilePopup({ vjrTask: false }).render())).toContain("the team's flow");
  });
});
