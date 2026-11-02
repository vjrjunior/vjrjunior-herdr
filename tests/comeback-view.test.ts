import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { decodeNote } from "../mods/comeback/logic.js";
import { herdr } from "./app-mocks";
import { removeTempDirs, tempDir } from "./helpers";

const { default: Comeback } = await import("../mods/comeback/main.js");

const BOOT = "{ sec = 1793622627, usec = 216801 } Mon Nov  2 09:30:27 2026";
const START = "Mon Nov  2 10:16:51 2026";
const cx = { timer: { every() {}, after() {} }, spawn() {}, notify() {} };

let home = "";
let agentsNow: Record<string, unknown>[] = [];
let terminal: Record<string, Record<string, any>> = {};
let calls: string[][] = [];
let notices: Record<string, unknown>[] = [];

function session(pid: number, data: Record<string, unknown>) {
  mkdirSync(join(home, ".claude/sessions"), { recursive: true });
  writeFileSync(join(home, ".claude/sessions", `${pid}.json`), JSON.stringify({ pid, ...data }));
}

function respond(command: string, args: string[]) {
  const ok = (stdout: string) => ({ code: 0, stdout, stderr: "" });
  if (command === "hc" && args[0] === "get") {
    const found = terminal[args[1] as string];
    return found ? ok(JSON.stringify({ address: args[1], state: "live", labels: {}, ...found })) : { code: 1, stdout: "", stderr: "no such terminal" };
  }
  if (command === "hc" && args[0] === "ls") return ok(JSON.stringify({ terminals: Object.keys(terminal).map((address) => ({ address, state: "live" })) }));
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
  if (command === "ps") return ok(args[1] === "lstart=" ? `${START}\n` : "00:30\n");
  if (command === "sysctl") return ok(BOOT);
  return ok("");
}

beforeEach(() => {
  home = tempDir();
  agentsNow = [];
  terminal = {};
  calls = [];
  notices = [];
  Object.assign(herdr, {
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
