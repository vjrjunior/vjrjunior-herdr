import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeNote, encodeNote } from "../mods/comeback/logic.js";
import { herdr } from "./app-mocks";
import { removeTempDirs, tempDir } from "./helpers";

const { default: Comeback } = await import("../mods/comeback/main.js");

const BOOT = "{ sec = 1793622627, usec = 216801 } Mon Nov  2 09:30:27 2026";
const START = "Mon Nov  2 10:16:51 2026";
const cx = { timer: { every() {}, after() {} }, spawn() {}, notify() {}, sleep: async () => {} };

let home = "";
let agentsNow: Record<string, unknown>[] = [];
let terminal: Record<string, Record<string, any>> = {};
let calls: string[][] = [];
let notices: Record<string, unknown>[] = [];
let stuck: Record<string, string> = {};
let frontAt: Record<string, { at: number; foreground: Record<string, unknown> }> = {};
const gets: Record<string, number> = {};
let folder = "";
let sharedState: Record<string, unknown> = {};
let screens: Record<string, string[]> = {};
let ages: Record<string, string> = {};
let down = false;
let labelFails = false;
let startOf: Record<string, string> = {};
let dead = new Set<string>();

function session(pid: number, data: Record<string, unknown>) {
  mkdirSync(join(home, ".claude/sessions"), { recursive: true });
  writeFileSync(join(home, ".claude/sessions", `${pid}.json`), JSON.stringify({ pid, ...data }));
}

function respond(command: string, args: string[]) {
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
  if (command === "hc" && args[0] === "get" && down) return { code: 1, stdout: "", stderr: "core unavailable" };
  if (command === "hc" && args[0] === "get") {
    const address = args[1] as string;
    gets[address] = (gets[address] ?? 0) + 1;
    const swap = frontAt[address];
    if (swap && gets[address] >= swap.at && terminal[address]) terminal[address].foreground = swap.foreground;
    const found = terminal[address];
    return found ? ok(JSON.stringify({ address: args[1], state: "live", labels: {}, ...found })) : { code: 1, stdout: "", stderr: "no such terminal" };
  }
  if (command === "hc" && args[0] === "ls") return ok(JSON.stringify({ terminals: Object.keys(terminal).map((address) => ({ address, state: "live" })) }));
  if (command === "hc" && args[0] === "label" && labelFails) return { code: 1, stdout: "", stderr: "label failed" };
  if (command === "hc" && args[0] === "label") {
    const [, address, pair] = args as [string, string, string];
    const key = pair.slice(0, pair.indexOf("="));
    const value = pair.slice(pair.indexOf("=") + 1);
    const found = terminal[address];
    if (found) {
      found.labels = { ...(found.labels ?? {}) };
      if (value) found.labels[key] = value;
      else delete found.labels[key];
    }
    return ok("{}");
  }
  if (command === "hc" && args[0] === "send") {
    const address = args[1] as string;
    if (!(address in stuck) && terminal[address]) terminal[address].foreground = { pid: 900, argv: ["claude", "--resume", "abc-1"] };
    return ok("{}");
  }
  if (command === "hc" && args[0] === "read") {
    const address = args[1] as string;
    const queued = screens[address];
    const text = queued && queued.length > 1 ? (queued.shift() as string) : (queued?.[0] ?? stuck[address] ?? "");
    return ok(JSON.stringify({ text, complete: true }));
  }
  if (command === "env" && args[1] === "ps") {
    const pids = (args[5] ?? "").split(",").filter((pid) => !dead.has(pid));
    return ok(pids.map((pid) => `${pid} ${startOf[pid] ?? START}`).join("\n"));
  }
  if (command === "test") return { code: existsSync(args[1] as string) ? 0 : 1, stdout: "", stderr: "" };
  if (command === "ps" && args[1] === "pid=") return ok(`${(args[3] ?? "").split(",").join("\n")}\n`);
  if (command === "ps") {
    const owner = Object.keys(terminal).find((address) => String(terminal[address]?.pid) === args.at(-1));
    return ok(args[1] === "lstart=" ? `${START}\n` : `${(owner && ages[owner]) || "00:30"}\n`);
  }
  if (command === "sysctl") return ok(BOOT);
  return ok("");
}

beforeEach(() => {
  home = tempDir();
  agentsNow = [];
  terminal = {};
  calls = [];
  notices = [];
  stuck = {};
  frontAt = {};
  for (const key of Object.keys(gets)) delete gets[key];
  folder = tempDir();
  sharedState = {};
  screens = {};
  ages = {};
  down = false;
  labelFails = false;
  startOf = {};
  dead = new Set();
  Object.assign(herdr, {
    shared: (key: string) => sharedState[key],
    setShared: (key: string, value: unknown) => {
      sharedState[key] = value;
      return null;
    },
    terminals: () => Object.entries(terminal).map(([address, found]) => ({ address, state: "live", labels: found.labels ?? {} })),
    home: () => home,
    agents: () => agentsNow,
    notify: (notice: Record<string, unknown>) => {
      notices.push(notice);
      return "n1";
    },
    readTextFile: async (path: string) => {
      try {
        return readFileSync(path, "utf8");
      } catch {
        return null;
      }
    },
    exec: async (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return respond(command, args);
    },
    nextCommand: () => new Promise(() => {}),
  });
});

afterEach(removeTempDirs);

const labelOf = (address: string) => terminal[address]?.labels?.comeback as string | undefined;
const labelCalls = () => calls.filter((call) => call[0] === "hc" && call[1] === "label").map((call) => call.slice(1));
const getCalls = () => calls.filter((call) => call[0] === "hc" && call[1] === "get").map((call) => call[2]);

function newView() {
  const view = new Comeback();
  view.init({}, cx);
  return view;
}

function runningClaude() {
  agentsNow = [{ address: "t4", app: "claude-code", seq: 1 }];
  terminal.t4 = { pid: 100, foreground: { pid: 200, argv: ["claude", "--dangerously-skip-permissions", "fix it"] }, status: { app: "claude-code" }, labels: { where: "app / 1" } };
  session(200, { sessionId: "abc-1", cwd: "/w/app" });
}

describe("noting", () => {
  test("records the conversation of a running Claude", async () => {
    runningClaude();
    await newView().check(cx);
    expect(decodeNote(labelOf("t4"))).toMatchObject({
      session: "abc-1",
      cwd: "/w/app",
      args: ["--dangerously-skip-permissions"],
      boot: "1793622627",
      shell: { pid: 100, start: START },
    });
  });

  test("records a Claude started through a wrapper", async () => {
    runningClaude();
    terminal.t4 = { ...terminal.t4, foreground: { pid: 200, argv: ["node", "/x/cli.js"] } };
    await newView().check(cx);
    expect(decodeNote(labelOf("t4"))?.session).toBe("abc-1");
  });

  test("follows a new conversation in the same Claude", async () => {
    runningClaude();
    const view = newView();
    await view.check(cx);
    session(200, { sessionId: "abc-2", cwd: "/w/app" });
    agentsNow = [{ address: "t4", app: "claude-code", seq: 2 }];
    await view.check(cx);
    expect(decodeNote(labelOf("t4"))?.session).toBe("abc-2");
  });

  test("writes nothing when nothing changed", async () => {
    runningClaude();
    const view = newView();
    await view.check(cx);
    const writes = labelCalls().length;
    await view.check(cx);
    expect(labelCalls()).toHaveLength(writes);
  });

  test("forgets a Claude the person quit", async () => {
    runningClaude();
    const view = newView();
    await view.check(cx);
    terminal.t4 = { ...terminal.t4, foreground: { pid: 100, argv: ["/bin/zsh", "-l"] }, status: null };
    agentsNow = [];
    await view.check(cx);
    expect(labelCalls().at(-1)).toEqual(["label", "t4", "comeback="]);
    expect(labelOf("t4")).toBeUndefined();
  });

  test("leaves remote terminals alone", async () => {
    agentsNow = [{ address: "box/t2", app: "claude-code", seq: 1 }];
    await newView().check(cx);
    expect(getCalls()).not.toContain("box/t2");
  });
});

const OLD_BOOT = "1700000000";

function lostTerminal(address: string, session = "abc-1") {
  const note = { v: 1, agent: "claude", session, cwd: folder, args: ["--dangerously-skip-permissions"], boot: OLD_BOOT, shell: { pid: 100, start: START }, at: 1 };
  terminal[address] = { pid: 300, foreground: { pid: 300, argv: ["/bin/zsh", "-l"] }, status: null, labels: { where: "app / 1", comeback: encodeNote(note) } };
  mkdirSync(join(home, ".claude/projects/-w-app"), { recursive: true });
  writeFileSync(join(home, ".claude/projects/-w-app", `${session}.jsonl`), "{}\n");
}

const sendCalls = () => calls.filter((call) => call[0] === "hc" && call[1] === "send").map((call) => call.slice(1));

describe("resuming", () => {
  test("types the resume command once into a lost terminal", async () => {
    lostTerminal("t8");
    await newView().pass(cx, false);
    expect(sendCalls()).toEqual([["send", "t8", `cd ${folder} && claude --resume abc-1 --dangerously-skip-permissions`]]);
    expect(decodeNote(labelOf("t8"))?.tried).toBeDefined();
  });

  test("a second copy does not type again", async () => {
    lostTerminal("t8");
    stuck.t8 = "vjr@mac app % ";
    await newView().pass(cx, false);
    await newView().pass(cx, false);
    expect(sendCalls()).toHaveLength(1);
  });

  test("never types when the shell is no longer in front", async () => {
    lostTerminal("t8");
    frontAt.t8 = { at: 2, foreground: { pid: 900, argv: ["claude"] } };
    await newView().pass(cx, false);
    expect(sendCalls()).toEqual([]);
  });

  test("the manual command tries a tried terminal again", async () => {
    lostTerminal("t8");
    stuck.t8 = "vjr@mac app % ";
    const view = newView();
    await view.pass(cx, false);
    await view.pass(cx, true);
    expect(sendCalls()).toHaveLength(2);
  });

  test("notifies what came back", async () => {
    lostTerminal("t8");
    await newView().pass(cx, false);
    expect(notices.at(-1)).toMatchObject({ title: "Resumed 1 Claude conversation", body: "app / 1", level: "success" });
  });

  test("notifies what failed, with the last line", async () => {
    lostTerminal("t8");
    stuck.t8 = "Error: no conversation found\nvjr@mac app % ";
    await newView().pass(cx, false);
    expect(notices.at(-1)).toMatchObject({ title: "Couldn't resume 1 Claude conversation", level: "warning" });
    expect(String(notices.at(-1)?.body)).toContain("exited right away: Error: no conversation found");
  });

  test("a conversation open in another terminal is left alone", async () => {
    lostTerminal("t8");
    session(4242, { sessionId: "abc-1", cwd: folder, procStart: START });
    await newView().pass(cx, true);
    expect(sendCalls()).toEqual([]);
    expect(String(notices.at(-1)?.body)).toContain("open in another terminal");
  });

  test("the manual command says when there is nothing to resume", async () => {
    await newView().pass(cx, true);
    expect(notices.at(-1)).toMatchObject({ title: "No Claude conversation to resume", level: "info" });
  });

  test("the automatic pass stays quiet with nothing to resume", async () => {
    await newView().pass(cx, false);
    expect(notices).toEqual([]);
  });
});

describe("review fixes", () => {
  test("never types into a shell that had something else in front first", async () => {
    lostTerminal("t8");
    terminal.t8.foreground = { pid: 500, argv: ["npm", "run", "dev"] };
    const view = newView();
    await view.pass(cx, false);
    expect(decodeNote(labelOf("t8"))?.tried?.reason).toBe("something else is running there");
    terminal.t8.foreground = { pid: 300, argv: ["/bin/zsh", "-l"] };
    await view.check(cx);
    expect(sendCalls()).toEqual([]);
  });

  test("a shell that changes before the send is left alone", async () => {
    lostTerminal("t8");
    screens.t8 = ["➜ ", "➜ rm -rf "];
    await newView().pass(cx, false);
    expect(sendCalls()).toEqual([]);
    expect(decodeNote(labelOf("t8"))?.tried?.reason).toBe("the shell was in use");
  });

  test("two copies passing at once type once per terminal", async () => {
    lostTerminal("t1", "s1");
    lostTerminal("t2", "s2");
    lostTerminal("t3", "s3");
    await Promise.all([newView().pass(cx, false), newView().pass(cx, false)]);
    expect(sendCalls().map((call) => call[1]).sort()).toEqual(["t1", "t2", "t3"]);
  });

  test("a failed read does not forget a noted terminal", async () => {
    runningClaude();
    const view = newView();
    await view.check(cx);
    agentsNow = [];
    down = true;
    await view.check(cx);
    down = false;
    dead.add("200");
    terminal.t4 = { ...terminal.t4, pid: 300, foreground: { pid: 300, argv: ["/bin/zsh", "-l"] }, status: null };
    mkdirSync(join(home, ".claude/projects/-w-app"), { recursive: true });
    writeFileSync(join(home, ".claude/projects/-w-app/abc-1.jsonl"), "{}\n");
    const note = decodeNote(labelOf("t4"));
    terminal.t4.labels.comeback = encodeNote({ ...(note as NonNullable<typeof note>), boot: OLD_BOOT, cwd: folder });
    await view.check(cx);
    expect(sendCalls().map((call) => call[1])).toEqual(["t4"]);
  });

  test("an old lost shell does not start a pass on every check", async () => {
    lostTerminal("t8");
    ages.t8 = "05:00";
    const view = newView();
    let passes = 0;
    const pass = view.pass.bind(view);
    view.pass = async (...args: unknown[]) => {
      passes++;
      return pass(...args);
    };
    await view.check(cx);
    await view.check(cx);
    expect(passes).toBe(0);
  });

  test("a dead Claude's file with a reused pid does not block a resume", async () => {
    lostTerminal("t8");
    session(4242, { sessionId: "abc-1", cwd: folder, procStart: "Mon Nov  2 01:00:00 2026" });
    await newView().pass(cx, false);
    expect(sendCalls().map((call) => call[1])).toEqual(["t8"]);
  });

  test("nothing is typed when the tried mark can't be written", async () => {
    lostTerminal("t8");
    labelFails = true;
    await newView().pass(cx, false);
    expect(sendCalls()).toEqual([]);
  });
});
