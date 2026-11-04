import { beforeEach, describe, expect, test } from "bun:test";
import { herdr, type Node } from "./app-mocks";

const { default: MoveTab } = await import("../mods/move-tab/main.js");
const { appIo } = await import("../mods/move-tab/io.js");

const KEY = "move-tab.request";
const PORCELAIN = [
  "worktree /r/main\nHEAD a1\nbranch refs/heads/main\n",
  "worktree /r/wt/live\nHEAD b2\nbranch refs/heads/feat/live\n",
  "worktree /r/wt/zeta\nHEAD c3\nbranch refs/heads/zeta\n",
  "worktree /r/wt/alpha\nHEAD d4\nbranch refs/heads/alpha\n",
].join("\n");
const DOC = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "doc.get", params: { name: "herdr-app" } });

type Exec = { code: number; stdout: string; stderr: string };
type Call = { command: string; args: string[]; cwd?: string };

let app: { shared: Record<string, unknown>; sets: number; closed: unknown[]; execs: Call[]; notes: Record<string, any>[] };
let given: Record<string, unknown>;
let answer: (call: Call) => Exec | Promise<Exec>;

const ok = (stdout = ""): Exec => ({ code: 0, stdout, stderr: "" });

beforeEach(() => {
  app = { shared: {}, sets: 0, closed: [], execs: [], notes: [] };
  given = { tab: "tb1", space: "s1", overlay: "o7" };
  answer = (call) => (call.command === "git" ? ok(PORCELAIN) : { code: 1, stdout: "", stderr: "" });
  Object.assign(herdr, {
    props: () => given,
    theme: () => new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? `t.${prop}` : undefined) }),
    spaces: () => [
      { id: "s1", name: "main", folder: "/r/main", machine: null, tabs: [{ id: "tb1", name: "1", named: false }] },
      { id: "s2", name: "live", folder: "/r/wt/live", machine: null, tabs: [{ id: "tb2", name: "1", named: false }] },
    ],
    panes: () => [
      { pane: "p1", tab: "tb1", terminal: "t1", cwd: "/r/main/src" },
      { pane: "p2", tab: "tb2", terminal: "t2", cwd: "/r/wt/live" },
    ],
    terminals: () => [],
    shared: (key: string) => app.shared[key],
    setShared: (key: string, value: unknown) => {
      app.shared[key] = value;
      app.sets += 1;
      return null;
    },
    closeOverlay: (id: unknown) => {
      app.closed.push(id);
      return null;
    },
    notify: (note: Record<string, any>) => {
      app.notes.push(note);
      return "n1";
    },
    home: () => "/Users/me",
    readTextFile: async () => null,
    exec: async (command: string, args: string[], options?: { cwd?: string }) => {
      const call = { command, args, cwd: options?.cwd };
      app.execs.push(call);
      return answer(call);
    },
  });
});

function makeCx() {
  const cx: Record<string, any> = {
    spawned: 0,
    focused: 0,
    spawn(work: (cx: unknown) => unknown) {
      cx.spawned += 1;
      return Promise.resolve().then(() => work(cx));
    },
    notify() {},
    sleep: async () => {},
    focus_handle() {
      return {
        focus() {
          cx.focused += 1;
        },
      };
    },
  };
  return cx;
}

const flush = async () => {
  for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function popup() {
  const cx = makeCx();
  const view = new MoveTab();
  view.init(given, cx);
  await flush();
  return { view, cx };
}

function worker() {
  given = { role: "worker" };
  const cx = makeCx();
  const view = new MoveTab();
  view.init(given, cx);
  return { view, cx };
}

function texts(node: Node): string[] {
  return [...node.texts, ...node.kids.flatMap(texts)];
}

function find(node: Node, match: (node: Node) => boolean): Node | null {
  if (match(node)) return node;
  for (const kid of node.kids) {
    const found = find(kid, match);
    if (found) return found;
  }
  return null;
}

const byKey = (root: Node, key: string) => find(root, (node) => node.key === key);
const own = (node: Node | null, name: string) => (node?.calls ?? []).filter(([call]) => call === name).map(([, args]) => args);

function press(view: { render(cx: unknown): Node }, cx: unknown, key: string) {
  const handler = own(view.render(cx), "on_key_down")[0]?.[0] as (event: unknown, cx: unknown) => void;
  handler({ key, keystroke: key, modifiers: {} }, cx);
}

function click(view: { render(cx: unknown): Node }, cx: unknown, key: string) {
  const node = byKey(view.render(cx), key);
  if (!node) throw new Error(`no element ${key}`);
  for (const handler of node.handlers.click ?? []) handler({}, cx);
}

describe("move-tab popup", () => {
  test("the popup lists the tab's targets in order", async () => {
    const { view, cx } = await popup();
    const root = view.render(cx);
    expect(root.key).toBe("move-tab");
    expect(own(root, "bg")).toEqual([["t.popover"]]);
    expect(texts(root)[0]).toBe("MOVE TO");
    expect([0, 1, 2].map((i) => texts(byKey(root, `target-${i}`) as Node)[0])).toEqual(["live", "alpha", "zeta"]);
    expect(byKey(root, "target-3")).toBeNull();
    expect(app.execs).toEqual([{ command: "git", args: ["worktree", "list", "--porcelain"], cwd: "/r/main/src" }]);
    expect(cx.focused).toBe(1);

    const first = byKey(root, "target-0") as Node;
    expect(own(first, "bg")).toEqual([["t.selected"]]);
    expect(own(byKey(root, "target-1"), "bg")).toEqual([]);
    expect(find(first, (node) => own(node, "svg").some(([path]) => path === "mods/kit/icons/git-branch.svg"))).not.toBeNull();
    const detail = find(first, (node) => node.texts.includes("feat/live · open"));
    expect(own(detail, "text_color")).toEqual([["t.muted"]]);
  });

  test("a closed worktree whose label is its branch shows it once", async () => {
    const { view, cx } = await popup();
    const root = view.render(cx);
    expect(texts(byKey(root, "target-0") as Node)).toEqual(["live", "feat/live · open"]);
    expect(texts(byKey(root, "target-1") as Node)).toEqual(["alpha"]);
    expect(texts(byKey(root, "target-2") as Node)).toEqual(["zeta"]);
  });

  test("picking a row asks the worker and closes the popup", async () => {
    const { view, cx } = await popup();
    click(view, cx, "target-0");
    const request = app.shared[KEY] as Record<string, unknown>;
    expect(request).toMatchObject({ tab: "tb1", space: "s1", to: "/r/wt/live", toSpace: "s2" });
    expect(typeof request.id).toBe("string");
    expect(Math.abs(Date.now() - (request.at as number))).toBeLessThan(1000);
    expect(app.closed).toEqual(["o7"]);

    click(view, cx, "target-1");
    expect(app.sets).toBe(1);
    expect(app.closed).toEqual(["o7"]);
  });

  test("enter picks the selected row and escape closes", async () => {
    const { view, cx } = await popup();
    press(view, cx, "down");
    press(view, cx, "down");
    press(view, cx, "up");
    expect(own(byKey(view.render(cx), "target-1"), "bg")).toEqual([["t.selected"]]);
    press(view, cx, "enter");
    expect(app.shared[KEY]).toMatchObject({ tab: "tb1", space: "s1", to: "/r/wt/alpha", toSpace: null });
    expect(app.closed).toEqual(["o7"]);

    const other = await popup();
    press(other.view, other.cx, "up");
    expect(own(byKey(other.view.render(other.cx), "target-2"), "bg")).toEqual([["t.selected"]]);
    press(other.view, other.cx, "escape");
    expect(app.closed).toEqual(["o7", "o7"]);
    expect(app.sets).toBe(1);
  });

  test("an empty repo says so", async () => {
    let release: (value: Exec) => void = () => {};
    answer = () => new Promise((resolve) => (release = resolve));
    const { view, cx } = await popup();
    expect(texts(view.render(cx))).toContain("Looking for checkouts…");
    release(ok("worktree /r/main\nHEAD a1\nbranch refs/heads/main\n"));
    await flush();
    const shown = texts(view.render(cx));
    expect(shown).toContain("No other checkout of this repo.");
    expect(shown).not.toContain("Looking for checkouts…");
    press(view, cx, "enter");
    expect(app.sets).toBe(0);
  });

  test("a failed load says there is no other checkout", async () => {
    answer = () => Promise.reject(new Error("no such folder"));
    const rejected = await popup();
    expect(texts(rejected.view.render(rejected.cx))).toContain("No other checkout of this repo.");

    herdr.spaces = () => {
      throw new Error("not ready");
    };
    const thrown = await popup();
    const shown = texts(thrown.view.render(thrown.cx));
    expect(shown).toContain("No other checkout of this repo.");
    expect(shown).not.toContain("Looking for checkouts…");
  });

  test("without props the popup draws nothing and asks nothing", async () => {
    given = {};
    herdr.props = () => undefined;
    const { view, cx } = await popup();
    const root = view.render(cx);
    expect(texts(root)).toEqual([]);
    expect(root.kids).toEqual([]);
    expect(app.execs).toEqual([]);
    expect(cx.focused).toBe(0);
  });
});

describe("move-tab worker", () => {
  test("the worker starts one move per request", async () => {
    const { view, cx } = worker();
    app.shared[KEY] = { id: "r1", tab: "tb1", space: "s1", to: "/r/wt/live", toSpace: "s2", at: Date.now() };
    const root = view.render(cx);
    expect(root.kids).toEqual([]);
    expect(texts(root)).toEqual([]);
    expect(cx.spawned).toBe(1);
    expect(app.shared[KEY]).toBeNull();
    view.render(cx);
    expect(cx.spawned).toBe(1);
    await flush();
    expect(app.execs).toContainEqual({ command: "sh", args: ["-c", 'printf "%s\\n" "$1" | hc connect', "sh", DOC], cwd: undefined });
    expect(app.notes.map((note) => note.body)).toEqual(["The tab is gone."]);
    view.render(cx);
    expect(cx.spawned).toBe(1);
    expect(cx.focused).toBe(0);
  });

  test("a fresh worker never runs a request a move already took", async () => {
    let release: (value: Exec) => void = () => {};
    answer = (call) => (call.command === "sh" ? new Promise((resolve) => (release = resolve)) : { code: 1, stdout: "", stderr: "" });
    const first = worker();
    app.shared[KEY] = { id: "r1", tab: "tb1", space: "s1", to: "/r/wt/live", toSpace: "s2", at: Date.now() };
    first.view.render(first.cx);
    expect(first.cx.spawned).toBe(1);
    await flush();
    const fresh = worker();
    fresh.view.render(fresh.cx);
    expect(fresh.cx.spawned).toBe(0);
    release({ code: 1, stdout: "", stderr: "" });
    await flush();
    fresh.view.render(fresh.cx);
    expect(fresh.cx.spawned).toBe(0);
    expect(app.notes.map((note) => note.body)).toEqual(["The tab is gone."]);
  });

  test("the worker drops a stale request", () => {
    const { view, cx } = worker();
    app.shared[KEY] = { id: "r1", tab: "tb1", space: "s1", to: "/r/wt/live", toSpace: "s2", at: Date.now() - 11000 };
    view.render(cx);
    expect(app.shared[KEY]).toBeNull();
    expect(cx.spawned).toBe(0);
    expect(app.notes).toEqual([]);
  });

  test("a second request while a move runs says another move is running", async () => {
    let release: (value: Exec) => void = () => {};
    answer = (call) => (call.command === "sh" ? new Promise((resolve) => (release = resolve)) : { code: 1, stdout: "", stderr: "" });
    const { view, cx } = worker();
    app.shared[KEY] = { id: "r1", tab: "tb1", space: "s1", to: "/r/wt/live", toSpace: "s2", at: Date.now() };
    view.render(cx);
    await flush();
    app.shared[KEY] = { id: "r2", tab: "tb1", space: "s1", to: "/r/wt/alpha", toSpace: null, at: Date.now() };
    view.render(cx);
    expect(app.shared[KEY]).toBeNull();
    view.render(cx);
    expect(cx.spawned).toBe(1);
    expect(app.notes.map((note) => note.body)).toEqual(["Another move is running."]);
    release({ code: 1, stdout: "", stderr: "" });
    await flush();
    expect(app.notes.map((note) => note.body)).toEqual(["Another move is running.", "The tab is gone."]);
    expect(app.shared[KEY]).toBeNull();
  });
});

describe("move-tab io", () => {
  test("act runs herdr-app do and throws its error", async () => {
    answer = () => ({ code: 1, stdout: '{"error":"no such tab"}' }) as Exec;
    await expect(appIo(makeCx()).act("tab.close", { id: "x" })).rejects.toThrow("no such tab");
    expect(app.execs).toEqual([{ command: "herdr-app", args: ["do", "tab.close", '{"id":"x"}'], cwd: undefined }]);
    answer = () => ok('{"space":"s9","tab":"tb9"}');
    expect(await appIo(makeCx()).act("space.new", { folder: "/r/wt/alpha" })).toEqual({ space: "s9", tab: "tb9" });
  });

  test("act refuses output that isn't JSON and takes empty output as nothing made", async () => {
    answer = () => ok("Opened a new tab\n");
    await expect(appIo(makeCx()).act("tab.new", { space: "s1" })).rejects.toThrow("herdr-app do tab.new printed something unexpected");
    answer = () => ok("");
    expect(await appIo(makeCx()).act("tab.select", { id: "tb1" })).toEqual({});
  });

  test("the io reads and signals through the programs the move needs", async () => {
    herdr.readTextFile = (async (path: string) => (path === "/Users/me/.claude/sessions/42.json" ? '{"sessionId":"abc-1","cwd":"/r/main"}' : null)) as never;
    answer = (call) => {
      if (call.command === "hc") return ok('{"address":"t1","pid":7}');
      if (call.command === "git") return ok(PORCELAIN);
      if (call.command === "test") return { code: call.args[1] === "/r/wt/alpha" ? 0 : 1, stdout: "", stderr: "" };
      if (call.command === "ps") return { code: call.args[1] === "42" ? 0 : 1, stdout: "", stderr: "" };
      return { code: 1, stdout: "", stderr: "No such process" };
    };
    const io = appIo(makeCx());
    expect(await io.get("t1")).toEqual({ address: "t1", pid: 7 });
    expect(await io.session(42)).toMatchObject({ session: "abc-1", cwd: "/r/main" });
    expect(await io.session(43)).toBeNull();
    expect(await io.worktrees("/r/main")).toBe(PORCELAIN);
    expect(await io.exists("/r/wt/alpha")).toBe(true);
    expect(await io.exists("/r/wt/gone")).toBe(false);
    expect(await io.alive(42)).toBe(true);
    expect(await io.alive(43)).toBe(false);
    await io.signal(43);
    expect(app.execs.map((call) => [call.command, ...call.args])).toEqual([
      ["hc", "get", "t1", "--json"],
      ["git", "worktree", "list", "--porcelain"],
      ["test", "-d", "/r/wt/alpha"],
      ["test", "-d", "/r/wt/gone"],
      ["ps", "-p", "42"],
      ["ps", "-p", "43"],
      ["kill", "-TERM", "43"],
    ]);
    answer = () => ({ code: 1, stdout: "", stderr: "" });
    expect(await io.get("t9")).toBeNull();
    expect(await io.worktrees("/nowhere")).toBeNull();
  });
});
