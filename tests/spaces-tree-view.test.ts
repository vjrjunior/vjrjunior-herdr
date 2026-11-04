import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { herdr, type Node } from "./app-mocks";

const app = {
  spaces: [] as Record<string, unknown>[],
  shared: {} as Record<string, unknown>,
  runs: [] as [string, unknown][],
  execs: [] as { args: string[]; cwd: unknown }[],
};

beforeEach(() => {
  app.shared = {};
  app.runs = [];
  app.execs = [];
  Object.assign(herdr, {
    spaces: () => app.spaces,
    panes: () => [],
    run: (name: string, args: unknown) => {
      app.runs.push([name, args]);
      return null;
    },
    openOverlay: () => null,
    exec: async (_command: string, args: string[], options: { cwd?: unknown }) => {
      app.execs.push({ args, cwd: options?.cwd });
      return { code: 0, stdout: "", stderr: "" };
    },
    theme: () => new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? "#505050" : undefined) }),
    shared: (key: string) => app.shared[key],
    setShared: (key: string, value: unknown) => {
      app.shared[key] = value;
      return null;
    },
    watchFolder: () => new Promise(() => {}),
    window: () => ({ active: true }),
    nextCommand: () => new Promise(() => {}),
    layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: 268 } }] }),
  });
});

const { default: SpacesTree } = await import("../mods/spaces-tree/main.js");

const common = "/r/app/.git";
const cx = { timer: { every() {} }, spawn() {}, notify() {} };
const space = (id: string, over = {}) => ({ id, index: 1, name: id, named: false, folder: "", machine: null, branch: null, active: false, status: null, tabs: [], ...over });

function setup(checkouts = [{ path: "/r/app", branch: "main", main: true }, { path: "/w/app/one", branch: "one", main: false }]) {
  app.spaces = [space("m"), space("x", { active: true })];
  const view = new SpacesTree();
  view.init({}, cx);
  view.lastPlaces = { m: "/r/app", x: "/x" };
  view.looks = { "/r/app": { top: "/r/app", common }, "/x": null };
  view.repos = { [common]: { common, name: "app", checkouts, refs: {} } };
  return view;
}

function pathTo(node: Node, key: string): Node[] | null {
  if (node.key === key) return [node];
  for (const kid of node.kids) {
    const path = pathTo(kid, key);
    if (path) return [node, ...path];
  }
  return null;
}

function fire(path: Node[], kind: string) {
  let stopped = false;
  const context = {
    stop_propagation() {
      stopped = true;
    },
    notify() {},
  };
  for (const node of [...path].reverse()) {
    for (const handler of node.handlers[kind] ?? []) handler({}, context);
    if (stopped) return;
  }
}

function click(view: { render(): Node }, key: string) {
  const path = pathTo(view.render(), key);
  if (!path) throw new Error(`no element ${key}`);
  fire(path, "down:left");
  fire(path, "up:left");
  fire(path, "click");
}

function texts(node: Node): string[] {
  return [...node.texts, ...node.kids.flatMap(texts)];
}

describe("clicks", () => {
  for (const button of ["space-new", "space-style"]) {
    test(`a row click works right after ${button}`, () => {
      const view = setup();
      click(view, button);
      click(view, `head-${common}`);
      expect(app.runs).toContainEqual(["space.select", { id: "m" }]);
    });
  }

  test("folding a repository does not switch to it", () => {
    const view = setup();
    click(view, `fold-${common}`);
    expect(app.runs.filter(([name]) => name === "space.select")).toEqual([]);
    expect(app.shared["spaces.folded"]).toEqual([common]);
  });

  test("a closed worktree opens one space on this computer", () => {
    const view = setup();
    click(view, "kid-/w/app/one");
    click(view, "kid-/w/app/one");
    expect(app.runs).toEqual([["space.new", { folder: "/w/app/one", machine: "" }]]);
  });
});

describe("git", () => {
  test("a repository is read from its git folder", async () => {
    const view = setup();
    await view.readRepo(common, cx);
    expect(app.execs.map((call) => call.cwd)).toEqual([common, common]);
  });
});

describe("folding", () => {
  test("a folded repository without worktrees keeps its branch and shows no count", () => {
    const view = setup([{ path: "/r/app", branch: "vjr", main: true }]);
    app.shared["spaces.folded"] = [common];
    const head = pathTo(view.render(), `head-${common}`)?.at(-1) as Node;
    expect(texts(head)).toContain("vjr");
    expect(texts(head)).not.toContain("0");
  });
});

const BRANCH = "feat/enrollment-delete-charge-waiver";
const onMain = [{ path: "/r/app", branch: "main", main: true }, { path: "/w/app/one", branch: "one", main: false }];
const onBranch = [{ path: "/r/app", branch: BRANCH, main: true }, { path: "/w/app/one", branch: "one", main: false }];

function style(node: Node, name: string): unknown[] | undefined {
  return node.calls.findLast(([called]) => called === name)?.[1];
}

function find(node: Node, match: (node: Node) => boolean): Node | null {
  if (match(node)) return node;
  for (const kid of node.kids) {
    const found = find(kid, match);
    if (found) return found;
  }
  return null;
}

function headOf(view: { render(): Node }): Node {
  return pathTo(view.render(), `head-${common}`)?.at(-1) as Node;
}

describe("head rows", () => {
  test("a head row without a branch is 36 px tall", () => {
    expect(style(headOf(setup(onMain)), "h")).toEqual([36]);
  });

  test("a head row with a branch is 44 px tall", () => {
    expect(style(headOf(setup(onBranch)), "h")).toEqual([44]);
  });

  test("the branch gets its own line under the name and ends with an ellipsis", () => {
    const row = headOf(setup(onBranch));
    const sub = find(row, (node) => node.texts.includes(BRANCH));
    expect(sub?.texts).toEqual([BRANCH]);
    expect(sub?.calls.map(([name]) => name)).toContain("truncate");
    expect(row.kids).toContain(sub as Node);
    expect(style(sub as Node, "pl")).toEqual([26]);
    expect(style(sub as Node, "line_height")).toEqual(["14px"]);
  });

  test("the avatar, the status dot and the buttons sit on the name's line", () => {
    const view = setup(onBranch);
    app.spaces = [space("m", { status: "working" }), space("x", { active: true })];
    const row = headOf(view);
    const name = find(row, (node) => node.texts.includes("app")) as Node;
    const line = find(row, (node) => node.kids.includes(name)) as Node;
    expect(line).not.toBe(row);
    expect(row.kids).toContain(line);
    expect(line.kids.some((node) => node.texts.includes("A"))).toBe(true);
    expect(find(line, (node) => style(node, "size")?.[0] === 7)).not.toBeNull();
    expect(find(line, (node) => node.key === `fold-${common}`)).not.toBeNull();
  });

  test("ahead and behind stay on the row, outside the branch cut", () => {
    const view = setup(onBranch);
    view.repos[common].refs = { [BRANCH]: { ahead: 2, behind: 1 } };
    const row = headOf(view);
    expect(find(row, (node) => node.texts.includes(BRANCH))?.texts).toEqual([BRANCH]);
    expect(texts(row)).toContain("↑2 ↓1");
  });

  test("the rail under a head row starts at the bottom of its avatar", () => {
    for (const [checkouts, top, height] of [[onMain, 27, 9], [onBranch, 23.5, 20.5]] as const) {
      const rail = find(headOf(setup([...checkouts])), (node) => style(node, "w")?.[0] === 1.5) as Node;
      expect([style(rail, "top"), style(rail, "h")]).toEqual([[top], [height]]);
    }
  });

  test("in blocks the status bar is as tall as the row", () => {
    const view = setup(onBranch);
    app.spaces = [space("m", { status: "working" }), space("x", { active: true })];
    app.shared["spaces.style"] = "blocks";
    const bar = find(headOf(view), (node) => style(node, "w")?.[0] === 3) as Node;
    expect(style(bar, "h")).toEqual([44]);
  });

  test("a folded repository shows its count on one 36 px line", () => {
    const view = setup(onBranch);
    app.shared["spaces.folded"] = [common];
    const row = headOf(view);
    expect(style(row, "h")).toEqual([36]);
    expect(texts(row)).not.toContain(BRANCH);
    expect(texts(row)).toContain("1");
  });
});

describe("command center lane line", () => {
  const row = (view: { render(): Node }) => pathTo(view.render(), "kid-/w/app/one")?.at(-1) as Node;
  const find = (node: Node, text: string): Node | null => {
    if (node.texts.includes(text)) return node;
    for (const kid of node.kids) {
      const found = find(kid, text);
      if (found) return found;
    }
    return null;
  };
  const shared = herdr.theme;
  beforeEach(() => {
    herdr.theme = () => new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? `#${prop}` : undefined) });
  });
  afterEach(() => {
    herdr.theme = shared;
  });
  const colorOf = (node: Node) => node.calls.find(([call]) => call === "text_color")?.[1][0];
  const withLane = (lane: Record<string, unknown>) => {
    const view = setup();
    app.shared["command-center.lanes"] = { "/w/app/one": lane };
    return view;
  };

  test("a worktree row with a lane shows its step and why under its name", () => {
    const node = row(withLane({ chip: "AC 3/5", tone: "blocked", why: "vjr-ac asks M4" }));
    expect(node.calls).toContainEqual(["h", [42]]);
    expect(texts(node)).toContain("AC 3/5");
    expect(texts(node)).toContain("· vjr-ac asks M4");
    expect(colorOf(find(node, "AC 3/5") as Node)).toBe("#blocked");
    expect(colorOf(find(node, "· vjr-ac asks M4") as Node)).toBe("#muted");
  });

  test("a row without a lane stays one 28 px line", () => {
    const node = row(setup());
    expect(node.calls).toContainEqual(["h", [28]]);
    expect(node.calls).not.toContainEqual(["h", [42]]);
  });

  test("the narrow rail shows no lane line", () => {
    const view = withLane({ chip: "AC 3/5", tone: "blocked", why: "vjr-ac asks M4" });
    herdr.layout = () => ({ id: "root", children: [{ id: "sidebar", size: { px: 100 } }] });
    const root = view.render();
    expect(texts(root)).not.toContain("AC 3/5");
    expect(texts(root)).not.toContain("· vjr-ac asks M4");
    expect(pathTo(root, "kid-/w/app/one")).toBeNull();
  });

  test("a lane without a why shows only its step", () => {
    const node = row(withLane({ chip: "PR open", tone: "work" }));
    expect(texts(node)).toContain("PR open");
    expect(texts(node).filter((text) => text.startsWith("·"))).toEqual([]);
    expect(colorOf(find(node, "PR open") as Node)).toBe("#unknown");
  });

  test("both lines of a lane row truncate", () => {
    const node = row(withLane({ chip: "AC 3/5", tone: "blocked", why: "vjr-ac asks M4" }));
    const name = find(node, "one") as Node;
    expect(name.calls.some(([call]) => call === "truncate")).toBe(true);
    const sub = node.kids.flatMap((kid) => [kid, ...kid.kids]).find((kid) => kid.calls.some(([call, args]) => call === "h" && args[0] === 14) && kid.calls.some(([call]) => call === "text_size")) as Node;
    expect(sub.calls.some(([call]) => call === "truncate")).toBe(true);
    const why = find(node, "· vjr-ac asks M4") as Node;
    const names = why.calls.map(([call]) => call);
    expect(names).toContain("flex_1");
    expect(names).toContain("truncate");
    expect(why.calls).toContainEqual(["min_w", [0]]);
  });

  test("the lane line shows in the blocks style too", () => {
    const view = withLane({ chip: "Ready", tone: "done", why: "ready to merge" });
    app.shared["spaces.style"] = "blocks";
    const node = row(view);
    expect(texts(node)).toContain("Ready");
    expect(texts(node)).toContain("· ready to merge");
    expect(node.calls).toContainEqual(["h", [42]]);
  });

  test("the rail runs past a two-line row", () => {
    const view = withLane({ chip: "AC 3/5", tone: "blocked", why: "x" });
    app.spaces = [space("m"), space("x", { active: true })];
    view.repos[common].checkouts.push({ path: "/w/app/two", branch: "two", main: false });
    const node = row(view);
    const rail = node.kids.find((kid) => kid.calls.some(([call, args]) => call === "top" && args[0] === 14) && kid.calls.some(([call, args]) => call === "h" && args[0] === 28));
    expect(rail).toBeDefined();
  });
});

describe("tab drops", () => {
  const three = [
    { path: "/r/app", branch: "main", main: true },
    { path: "/w/app/one", branch: "one", main: false },
    { path: "/w/app/two", branch: "two", main: false },
  ];
  const DRAG = "move-tab.drag";
  const REQUEST = "move-tab.request";
  const drag = (from = "m") => ({ tab: "t1", space: from, at: Date.now() });

  function dropSetup() {
    app.spaces = [space("m"), space("x", { active: true }), space("w")];
    const view = new SpacesTree();
    view.init({}, cx);
    view.lastPlaces = { m: "/r/app", x: "/x", w: "/w/app/two" };
    view.looks = { "/r/app": { top: "/r/app", common }, "/x": null, "/w/app/two": { top: "/w/app/two", common } };
    view.repos = { [common]: { common, name: "app", checkouts: three, refs: {} } };
    return view;
  }

  function at(view: { render(): Node }, key: string): Node[] {
    const path = pathTo(view.render(), key);
    if (!path) throw new Error(`no element ${key}`);
    return path;
  }

  test("releasing a drag on a worktree row asks for the move", () => {
    const view = dropSetup();
    app.shared[DRAG] = drag();
    fire(at(view, "kid-/w/app/one"), "up:left");
    const request = app.shared[REQUEST] as Record<string, unknown>;
    expect(request).toMatchObject({ tab: "t1", space: "m", to: "/w/app/one", toSpace: null });
    expect(typeof request.id).toBe("string");
    expect(Number.isFinite(request.at)).toBe(true);
    expect(app.shared[DRAG]).toBeNull();

    app.shared[DRAG] = drag();
    fire(at(view, "kid-w"), "up:left");
    expect(app.shared[REQUEST]).toMatchObject({ tab: "t1", space: "m", to: "/w/app/two", toSpace: "w" });

    delete app.shared[REQUEST];
    app.shared[DRAG] = drag("w");
    fire(at(view, `head-${common}`), "up:left");
    expect(app.shared[REQUEST]).toMatchObject({ tab: "t1", space: "w", to: "/r/app", toSpace: "m" });
    expect(app.runs).toEqual([]);
  });

  test("a drop on its own space or outside the repo asks nothing", () => {
    const view = dropSetup();
    for (const key of [`head-${common}`, "head-x"]) {
      app.shared[DRAG] = drag();
      fire(at(view, key), "up:left");
      expect(app.shared[REQUEST]).toBeUndefined();
      expect(app.shared[DRAG]).toBeNull();
    }
  });

  test("a click on a row after a stale drag opens the row and asks nothing", () => {
    const view = dropSetup();
    app.shared[DRAG] = drag();
    click(view, "kid-/w/app/one");
    expect(app.runs).toEqual([["space.new", { folder: "/w/app/one", machine: "" }]]);
    expect(app.shared[REQUEST]).toBeUndefined();

    app.shared[DRAG] = drag();
    click(view, "kid-w");
    expect(app.runs.at(-1)).toEqual(["space.select", { id: "w" }]);
    expect(app.shared[REQUEST]).toBeUndefined();

    app.shared[DRAG] = drag("w");
    click(view, `head-${common}`);
    expect(app.runs.at(-1)).toEqual(["space.select", { id: "m" }]);
    expect(app.shared[REQUEST]).toBeUndefined();

    app.shared[DRAG] = drag();
    const list = find(view.render(), (node) => node.calls.some(([name]) => name === "overflow_y_scrollbar")) as Node;
    fire([list], "down:left");
    expect(app.shared[DRAG]).toBeNull();
  });

  describe("highlight", () => {
    const shared = herdr.theme;
    beforeEach(() => {
      herdr.theme = () => new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? `#${prop}` : undefined) });
    });
    afterEach(() => {
      herdr.theme = shared;
    });
    const rows = [`head-${common}`, "kid-w", "kid-/w/app/one", "head-x"];
    const lit = (node: Node) => node.calls.some(([name]) => name === "border_1") && node.calls.some(([name, args]) => name === "border_color" && args[0] === "#accent");
    const litRows = (view: { render(): Node }) => rows.filter((key) => lit(at(view, key).at(-1) as Node));

    test("only accepting rows highlight", () => {
      const view = dropSetup();
      app.shared[DRAG] = drag();
      const seen: Record<string, string[]> = {};
      for (const key of rows) {
        for (const handler of (at(view, key).at(-1) as Node).handlers.hover ?? []) handler(true, cx);
        seen[key] = litRows(view);
        for (const handler of (at(view, key).at(-1) as Node).handlers.hover ?? []) handler(false, cx);
      }
      expect(seen).toEqual({ [`head-${common}`]: [], "kid-w": ["kid-w"], "kid-/w/app/one": ["kid-/w/app/one"], "head-x": [] });

      for (const handler of (at(view, "kid-w").at(-1) as Node).handlers.move ?? []) handler({}, cx);
      expect(litRows(view)).toEqual(["kid-w"]);
      app.shared[DRAG] = null;
      expect(litRows(view)).toEqual([]);

      for (const handler of (at(view, "kid-/w/app/one").at(-1) as Node).handlers.hover ?? []) handler(true, cx);
      expect(litRows(view)).toEqual([]);
    });
  });
});
