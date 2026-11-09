import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { herdr, type Node } from "./app-mocks";

const app = {
  spaces: [] as Record<string, unknown>[],
  shared: {} as Record<string, unknown>,
  runs: [] as [string, unknown][],
  execs: [] as { args: string[]; cwd: unknown }[],
  agents: [] as { space: string; status: string }[],
  overlays: [] as Record<string, any>[],
  closed: [] as unknown[],
  props: null as Record<string, unknown> | null,
  sidebar: 268,
};

beforeEach(() => {
  app.shared = {};
  app.runs = [];
  app.execs = [];
  app.agents = [];
  app.overlays = [];
  app.closed = [];
  app.props = null;
  app.sidebar = 268;
  Object.assign(herdr, {
    spaces: () => app.spaces,
    agents: () => app.agents,
    props: () => app.props,
    closeOverlay: (id: unknown) => {
      app.closed.push(id);
      return null;
    },
    panes: () => [],
    run: (name: string, args: unknown) => {
      app.runs.push([name, args]);
      return null;
    },
    openOverlay: (spec: Record<string, any>) => {
      app.overlays.push(spec);
      return "overlay";
    },
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
    layout: () => ({ id: "root", children: [{ id: "sidebar", size: { px: app.sidebar } }] }),
  });
});

const { default: SpacesTree } = await import("../mods/spaces-tree/main.js");
const { DRAG_GRACE } = await import("../mods/spaces-tree/tree.js");

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

  test("a head row with a branch is 48 px tall", () => {
    expect(style(headOf(setup(onBranch)), "h")).toEqual([48]);
  });

  test("the branch gets its own line under the name and ends with an ellipsis", () => {
    const row = headOf(setup(onBranch));
    const sub = find(row, (node) => node.texts.includes(BRANCH));
    expect(sub?.texts).toEqual([BRANCH]);
    expect(sub?.calls.map(([name]) => name)).toContain("truncate");
    expect(row.kids).toContain(sub as Node);
    expect(style(sub as Node, "pl")).toEqual([30]);
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
    for (const [checkouts, top, height] of [[onMain, 29, 7], [onBranch, 27.5, 20.5]] as const) {
      const rail = find(headOf(setup([...checkouts])), (node) => style(node, "w")?.[0] === 1.5) as Node;
      expect([style(rail, "top"), style(rail, "h")]).toEqual([[top], [height]]);
    }
  });

  test("in blocks the status bar is as tall as the row", () => {
    const view = setup(onBranch);
    app.spaces = [space("m", { status: "working" }), space("x", { active: true })];
    app.shared["spaces.style"] = "blocks";
    const bar = find(headOf(view), (node) => style(node, "w")?.[0] === 3) as Node;
    expect(style(bar, "h")).toEqual([48]);
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
    expect(node.calls).toContainEqual(["h", [48]]);
    expect(texts(node)).toContain("AC 3/5");
    expect(texts(node)).toContain("· vjr-ac asks M4");
    expect(colorOf(find(node, "AC 3/5") as Node)).toBe("#blocked");
    expect(colorOf(find(node, "· vjr-ac asks M4") as Node)).toBe("#muted");
  });

  test("a row without a lane stays one 34 px line", () => {
    const node = row(setup());
    expect(node.calls).toContainEqual(["h", [34]]);
    expect(node.calls).not.toContainEqual(["h", [48]]);
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
    expect(node.calls).toContainEqual(["h", [48]]);
  });

  test("the rail runs past a two-line row", () => {
    const view = withLane({ chip: "AC 3/5", tone: "blocked", why: "x" });
    app.spaces = [space("m"), space("x", { active: true })];
    view.repos[common].checkouts.push({ path: "/w/app/two", branch: "two", main: false });
    const node = row(view);
    const rail = node.kids.find((kid) => kid.calls.some(([call, args]) => call === "top" && args[0] === 17) && kid.calls.some(([call, args]) => call === "h" && args[0] === 31));
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

  function dropSetup(extra = false) {
    app.spaces = [space("m"), space("x", { active: true }), space("w"), ...(extra ? [space("e")] : [])];
    const view = new SpacesTree();
    view.init({}, cx);
    view.lastPlaces = { m: "/r/app", x: "/x", w: "/w/app/two", ...(extra ? { e: "/r/app" } : {}) };
    view.looks = { "/r/app": { top: "/r/app", common }, "/x": null, "/w/app/two": { top: "/w/app/two", common } };
    view.repos = { [common]: { common, name: "app", checkouts: three, refs: {} } };
    return view;
  }

  function at(view: { render(): Node }, key: string): Node[] {
    const path = pathTo(view.render(), key);
    if (!path) throw new Error(`no element ${key}`);
    return path;
  }

  function enter(view: { render(): Node }, key: string): void {
    for (const handler of (at(view, key).at(-1) as Node).handlers.hover ?? []) handler(true, cx);
  }

  test("releasing a drag on a worktree row asks for the move", () => {
    const view = dropSetup();
    app.shared[DRAG] = drag();
    enter(view, "kid-/w/app/one");
    fire(at(view, "kid-/w/app/one"), "up:left");
    const request = app.shared[REQUEST] as Record<string, unknown>;
    expect(request).toMatchObject({ tab: "t1", space: "m", to: "/w/app/one", toSpace: null });
    expect(typeof request.id).toBe("string");
    expect(Number.isFinite(request.at)).toBe(true);
    expect(app.shared[DRAG]).toBeNull();

    app.shared[DRAG] = drag();
    enter(view, "kid-w");
    fire(at(view, "kid-w"), "up:left");
    expect(app.shared[REQUEST]).toMatchObject({ tab: "t1", space: "m", to: "/w/app/two", toSpace: "w" });

    delete app.shared[REQUEST];
    app.shared[DRAG] = drag("w");
    enter(view, `head-${common}`);
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
    const root = view.render();
    fire([root, root.kids[0] as Node], "down:left");
    expect(app.shared[DRAG]).toBeNull();
  });

  test("a drop on an extra space of the main checkout asks for the move into that space", () => {
    const view = dropSetup(true);
    app.shared[DRAG] = drag("w");
    enter(view, "head-e");
    fire(at(view, "head-e"), "up:left");
    expect(app.shared[REQUEST]).toMatchObject({ tab: "t1", space: "w", to: "/r/app", toSpace: "e" });
    expect(app.shared[DRAG]).toBeNull();
  });

  test("a release on a row that never lit, as after a drag of the list's scrollbar, asks nothing and ends the drag", () => {
    const view = dropSetup();
    app.shared[DRAG] = { ...drag(), at: Date.now() - 5000 };
    fire(at(view, "kid-/w/app/one"), "up:left");
    expect(app.shared[REQUEST]).toBeUndefined();
    expect(app.shared[DRAG]).toBeNull();
    expect(app.runs).toEqual([]);
  });

  test("a press on a row's chevron that slides off onto the row asks nothing", () => {
    const view = dropSetup();
    app.shared[DRAG] = { ...drag("w"), at: Date.now() - 5000 };
    fire(at(view, `fold-${common}`), "down:left");
    fire(at(view, `head-${common}`), "up:left");
    expect(app.shared[REQUEST]).toBeUndefined();
  });

  test("a press outside the header, the list's scrollbar included, forgets a drag older than 300 ms and keeps a younger one", () => {
    const view = dropSetup();
    const root = view.render();
    const [header, list] = root.kids as Node[];
    expect(list.calls.some(([name]) => name === "overflow_y_scrollbar")).toBe(true);
    expect(header.calls.some(([name]) => name === "overflow_y_scrollbar")).toBe(false);
    expect(header.handlers.down_out).toHaveLength(1);
    expect(root.handlers.down_out).toBeUndefined();
    const out = () => {
      for (const handler of (view.render().kids[0] as Node).handlers.down_out ?? []) handler({}, cx);
    };
    expect(DRAG_GRACE).toBe(300);
    app.shared[DRAG] = { ...drag(), at: Date.now() - DRAG_GRACE - 50 };
    out();
    expect(app.shared[DRAG]).toBeNull();
    const fresh = drag();
    app.shared[DRAG] = fresh;
    out();
    expect(app.shared[DRAG]).toEqual(fresh);
    app.shared[DRAG] = { tab: "t1", space: "m" };
    out();
    expect(app.shared[DRAG]).toBeNull();
  });

  test("the narrow rail's header forgets a stale drag and keeps a fresh one", () => {
    herdr.layout = () => ({ id: "root", children: [{ id: "sidebar", size: { px: 60 } }] });
    const view = dropSetup();
    const out = () => {
      for (const handler of (view.render().kids[0] as Node).handlers.down_out ?? []) handler({}, cx);
    };
    app.shared[DRAG] = { ...drag(), at: Date.now() - DRAG_GRACE - 50 };
    out();
    expect(app.shared[DRAG]).toBeNull();
    const fresh = drag();
    app.shared[DRAG] = fresh;
    out();
    expect(app.shared[DRAG]).toEqual(fresh);
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
    const accent = (node: Node) => node.calls.some(([name]) => name === "border_1") && node.calls.some(([name, args]) => name === "border_color" && args[0] === "#accent");
    const dashed = (node: Node) => node.calls.some(([name]) => name === "border_dashed");
    const lit = (node: Node) => accent(node) && !dashed(node);
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

    test("while a tab is being dragged, every row that would take it is dashed and the row under the pointer is solid", () => {
      const view = dropSetup();
      const dashedRows = () => rows.filter((key) => {
        const node = at(view, key).at(-1) as Node;
        return accent(node) && dashed(node);
      });
      app.shared[DRAG] = drag();
      expect(dashedRows()).toEqual([]);
      app.shared[DRAG] = { ...drag(), moving: true };
      expect(dashedRows()).toEqual(["kid-w", "kid-/w/app/one"]);
      expect(litRows(view)).toEqual([]);
      for (const handler of (at(view, "kid-w").at(-1) as Node).handlers.hover ?? []) handler(true, cx);
      expect(litRows(view)).toEqual(["kid-w"]);
      expect(dashedRows()).toEqual(["kid-/w/app/one"]);
      app.shared[DRAG] = null;
      expect(dashedRows()).toEqual([]);
      expect(litRows(view)).toEqual([]);
    });

    test("the tree shows the grabbing cursor only while a tab is being dragged", () => {
      const view = dropSetup();
      const grabbing = () => view.render().calls.some(([name]) => name === "cursor_grabbing");
      expect(grabbing()).toBe(false);
      app.shared[DRAG] = drag();
      expect(grabbing()).toBe(false);
      app.shared[DRAG] = { ...drag(), moving: true };
      expect(grabbing()).toBe(true);
      app.shared[DRAG] = null;
      expect(grabbing()).toBe(false);
    });
  });
});

describe("the active space", () => {
  const shared = herdr.theme;
  beforeEach(() => {
    herdr.theme = () => new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? `#${prop}` : undefined) });
  });
  afterEach(() => {
    herdr.theme = shared;
  });

  const checkouts = [
    { path: "/r/app", branch: "main", main: true },
    { path: "/w/app/one", branch: "one", main: false },
    { path: "/w/app/two", branch: "two", main: false },
    { path: "/w/app/three", branch: "three", main: false },
  ];

  function treeWith(active: string) {
    app.spaces = [space("m", { active: active === "m" }), space("k", { active: active === "k" }), space("o", { active: active === "o" }), space("x", { active: active === "x" })];
    const view = new SpacesTree();
    view.init({}, cx);
    view.lastPlaces = { m: "/r/app", k: "/w/app/one", o: "/w/app/two", x: "/x" };
    view.looks = { "/r/app": { top: "/r/app", common }, "/w/app/one": { top: "/w/app/one", common }, "/w/app/two": { top: "/w/app/two", common }, "/x": null };
    view.repos = { [common]: { common, name: "app", checkouts, refs: {} } };
    return view;
  }

  const rowOf = (view: { render(): Node }, key: string) => pathTo(view.render(), key)?.at(-1) as Node;
  const colorOf = (row: Node) => style(find(row, (node) => style(node, "size")?.[0] === 22) as Node, "bg")?.[0] as string;
  const marks = (row: Node) => row.kids.filter((kid) => kid.calls.some(([name]) => name === "absolute") && style(kid, "right")?.[0] !== undefined);
  const has = (node: Node, name: string, value?: unknown) => node.calls.some(([called, args]) => called === name && (value === undefined || args[0] === value));
  const rail = (row: Node) => row.kids.find((kid) => style(kid, "w")?.[0] === 1.5) as Node;
  const elbow = (row: Node) => row.kids.find((kid) => has(kid, "border_l")) as Node;

  const groupOf = (view: { render(): Node }, key: string) => pathTo(view.render(), `group-${key}`)?.at(-1) as Node;

  test("only the group holding the active space is raised, padded below when it shows worktrees", () => {
    for (const [active, raised, padded] of [["x", "x", false], ["o", common, true], ["m", common, true], ["k", common, true]] as const) {
      const view = treeWith(active);
      const group = groupOf(view, raised);
      expect([style(group, "bg"), style(group, "pb")]).toEqual([["#raised"], padded ? [6] : undefined]);
      expect(group.calls.some(([name]) => name === "border_1")).toBe(false);
      const other = groupOf(view, raised === "x" ? common : "x");
      expect(style(other, "bg")).toBeUndefined();
    }
    const view = treeWith("o");
    app.shared["spaces.folded"] = [common];
    expect([style(groupOf(view, common), "bg"), style(groupOf(view, common), "pb")]).toEqual([["#raised"], undefined]);
  });

  const frameOf = (group: Node) => group.kids.find((kid) => kid.calls.some(([name]) => name === "absolute") && kid.calls.some(([name]) => name === "border_1"));

  test("a dim border wraps the whole group holding the active space, painted over it", () => {
    for (const [active, key, folded] of [["x", "x", false], ["m", common, false], ["o", common, false], ["k", common, false], ["o", common, true]] as const) {
      const view = treeWith(active);
      if (folded) app.shared["spaces.folded"] = [common];
      const group = groupOf(view, key);
      const frame = frameOf(group) as Node;
      expect([style(frame, "left"), style(frame, "right"), style(frame, "top"), style(frame, "bottom"), style(frame, "border_color"), style(frame, "bg")]).toEqual([[0], [0], [0], [0], ["#dim"], undefined]);
      expect(group.kids.at(-1)).toBe(frame);
      expect(has(group, "relative")).toBe(true);
      expect(has(group, "border_1")).toBe(false);
      const head = rowOf(view, `head-${key}`);
      expect(marks(head)).toEqual([]);
      expect(has(head, "bg")).toBe(false);
      expect(frameOf(groupOf(view, key === "x" ? common : "x"))).toBeUndefined();
      delete app.shared["spaces.folded"];
    }
  });

  test("an active worktree's name is white, the other open ones muted, closed ones as before", () => {
    const view = treeWith("o");
    const nameColor = (key: string, text: string) => style(find(rowOf(view, key), (node) => node.texts.includes(text)) as Node, "text_color");
    expect(nameColor("kid-o", "two")).toEqual(["#foreground"]);
    expect(nameColor("kid-k", "one")).toEqual(["#muted"]);
    expect(nameColor("kid-/w/app/three", "three")).toEqual(["#unknown"]);
    expect(nameColor(`head-${common}`, "app")).toEqual(["#foreground"]);
  });

  test("the rail is in full color down to the active worktree and faded after it", () => {
    const view = treeWith("o");
    const color = colorOf(rowOf(view, `head-${common}`));
    expect(style(rail(rowOf(view, `head-${common}`)), "bg")).toEqual([color]);
    const above = rowOf(view, "kid-k");
    expect([style(rail(above), "top"), style(rail(above), "bg")]).toEqual([[0], [color]]);
    expect(style(elbow(above), "border_color")).toEqual([`${color}B3`]);
    const active = rowOf(view, "kid-o");
    expect(style(elbow(active), "border_color")).toEqual([color]);
    expect([style(rail(active), "top"), style(rail(active), "bg")]).toEqual([[17], [`${color}B3`]]);

    const idle = treeWith("x");
    expect(style(rail(rowOf(idle, `head-${common}`)), "bg")).toEqual([`${color}B3`]);
    expect(style(rail(rowOf(idle, "kid-k")), "top")).toEqual([17]);
  });

  test("the active worktree gets no box, only a ring around its node", () => {
    const view = treeWith("o");
    const color = colorOf(rowOf(view, `head-${common}`));
    const row = rowOf(view, "kid-o");
    expect(has(row, "bg")).toBe(false);
    expect(marks(row)).toEqual([]);
    expect(row.kids.some((kid) => kid.calls.some(([name]) => name === "border_1"))).toBe(false);
    for (const handler of row.handlers.hover ?? []) handler(true, cx);
    expect(marks(rowOf(view, "kid-o"))).toEqual([]);
    const ring = row.kids.find((kid) => style(kid, "size")?.[0] === 14) as Node;
    expect([style(ring, "left"), style(ring, "top"), style(ring, "border"), style(ring, "border_color"), style(ring, "bg")]).toEqual([[29], [10], [1.5], [color], ["#raised"]]);
    expect(ring.kids).toEqual([]);
    const dot = row.kids.find((kid) => style(kid, "size")?.[0] === 6) as Node;
    expect([style(dot, "left"), style(dot, "top")]).toEqual([[33], [14]]);
    expect(row.kids.indexOf(dot)).toBe(row.kids.indexOf(ring) + 1);
    expect(style(rowOf(view, "kid-k"), "pl")).toEqual([52]);
    expect(marks(rowOf(view, "kid-k"))).toEqual([]);
    expect(rowOf(view, "kid-k").kids.some((kid) => style(kid, "size")?.[0] === 10 && style(kid, "left")?.[0] === 31 && style(kid, "top")?.[0] === 12)).toBe(true);
  });

  test("the ring's center takes the space's color while idle and the status color otherwise", () => {
    const view = treeWith("o");
    const color = colorOf(rowOf(view, `head-${common}`));
    const center = () => rowOf(view, "kid-o").kids.find((kid) => style(kid, "size")?.[0] === 6) as Node;
    expect(style(center(), "bg")).toEqual([color]);
    for (const status of ["idle", "working", "blocked", "done"]) {
      app.spaces = app.spaces.map((one) => (one.id === "o" ? { ...one, status } : one));
      expect(style(center(), "bg")).toEqual([status === "idle" ? color : `#${status}`]);
    }
  });

  test("hovering a worktree shows the box in the same gray as a head row's hover, with no border", () => {
    const view = treeWith("x");
    const hover = (on: boolean) => {
      for (const handler of rowOf(view, "kid-k").handlers.hover ?? []) handler(on, cx);
    };
    hover(true);
    const [box] = marks(rowOf(view, "kid-k"));
    expect([style(box as Node, "left"), style(box as Node, "bg")]).toEqual([[36], ["#hover"]]);
    expect(has(box as Node, "border_1")).toBe(false);
    expect(has(rowOf(view, "kid-k"), "hover")).toBe(false);
    hover(false);
    expect(marks(rowOf(view, "kid-k"))).toEqual([]);
  });

  describe("blocks", () => {
    const card = (view: { render(): Node }, key: string) => pathTo(view.render(), key)?.find((node) => node.key?.startsWith("block-")) as Node;

    test("the card holding the active space is raised with a dim border; the others keep surface and border", () => {
      for (const [active, key] of [["x", "head-x"], ["m", `head-${common}`], ["o", `head-${common}`]] as const) {
        const view = treeWith(active);
        app.shared["spaces.style"] = "blocks";
        expect([style(card(view, key), "bg"), style(card(view, key), "border_color")]).toEqual([["#raised"], ["#dim"]]);
        const other = key === "head-x" ? `head-${common}` : "head-x";
        expect([style(card(view, other), "bg"), style(card(view, other), "border_color")]).toEqual([["#surface"], ["#border"]]);
        const row = rowOf(view, key);
        expect(has(row, "bg")).toBe(false);
        expect(marks(row)).toEqual([]);
      }
    });

    test("the active worktree gets no box, and a hovered one the hover gray without a border", () => {
      const view = treeWith("o");
      app.shared["spaces.style"] = "blocks";
      expect(marks(rowOf(view, "kid-o"))).toEqual([]);
      expect(style(rowOf(view, "kid-k"), "pl")).toEqual([40]);
      for (const handler of rowOf(view, "kid-k").handlers.hover ?? []) handler(true, cx);
      const [hovered] = marks(rowOf(view, "kid-k"));
      expect([style(hovered as Node, "left"), style(hovered as Node, "bg")]).toEqual([[30], ["#hover"]]);
      expect(hovered?.calls.some(([name]) => name === "border_1")).toBe(false);
    });
  });
});

describe("folders", () => {
  const FOLDERS = "spaces.folders";
  const folders = (members: Record<string, string>, folded = false) => ({
    folders: [
      { id: "f1", name: "Clients", color: "ansi4", folded },
      { id: "f2", name: "Empty", color: "ansi2", folded: false },
    ],
    members,
  });
  const state = () => app.shared[FOLDERS] as ReturnType<typeof folders>;
  const listKeys = (view: { render(): Node }) => (view.render().kids[1] as Node).kids.map((kid) => kid.key);
  const node = (view: { render(): Node }, key: string) => pathTo(view.render(), key) as Node[];
  const drag = (view: { render(): Node }, from: string, to: string) => {
    fire(node(view, from), "down:left");
    fire(node(view, to), "move");
    fire(node(view, to), "up:left");
  };

  function placed(spaces: Record<string, unknown>[], looks: Record<string, unknown>) {
    app.spaces = spaces;
    const view = new SpacesTree();
    view.init({}, cx);
    view.lastPlaces = Object.fromEntries(spaces.map((one) => [one.id, one.folder]));
    view.looks = looks;
    view.repos = { [common]: { common, name: "app", checkouts: onMain, refs: {} } };
    return view;
  }

  test("folders come first in their order, then the loose repos and spaces", () => {
    app.shared[FOLDERS] = folders({ x: "f1" });
    expect(listKeys(setup())).toEqual(["folder-f1", "folder-body-f1", "folder-f2", `group-${common}`]);
  });

  test("blocks draw the same folders around their cards", () => {
    app.shared[FOLDERS] = folders({ [common]: "f1" });
    app.shared["spaces.style"] = "blocks";
    const keys = listKeys(setup());
    expect(keys).toEqual(["folder-f1", "folder-body-f1", "folder-f2", "block-x"]);
    expect(pathTo(setup().render(), `block-${common}`)?.map((one) => one.key)).toContain("folder-body-f1");
  });

  test("a click folds a folder and hides what is in it", () => {
    app.shared[FOLDERS] = folders({ [common]: "f1" });
    const view = setup();
    click(view, "folder-f1");
    expect(state().folders[0].folded).toBe(true);
    expect(listKeys(view)).toEqual(["folder-f1", "folder-f2", "group-x"]);
    expect(app.runs.filter(([name]) => name === "space.select")).toEqual([]);
    click(view, "folder-f1");
    expect(state().folders[0].folded).toBe(false);
  });

  test("a folded folder says how many agents need you, counting blocked and done", () => {
    app.shared[FOLDERS] = folders({ x: "f1" }, true);
    const view = setup();
    app.spaces = [space("m"), space("x", { active: true, status: "blocked" })];
    app.agents = [
      { space: "x", status: "blocked" },
      { space: "x", status: "done" },
      { space: "x", status: "working" },
      { space: "m", status: "blocked" },
    ];
    const row = node(view, "folder-f1").at(-1) as Node;
    expect(texts(row)).toContain("2 need you");
    app.agents = [{ space: "x", status: "done" }];
    expect(texts(node(view, "folder-f1").at(-1) as Node)).toContain("1 needs you");
    app.agents = [{ space: "x", status: "working" }];
    expect(texts(node(view, "folder-f1").at(-1) as Node).join(" ")).not.toContain("need");
  });

  test("an open folder shows no count", () => {
    app.shared[FOLDERS] = folders({ x: "f1" });
    app.agents = [{ space: "x", status: "blocked" }];
    expect(texts(node(setup(), "folder-f1").at(-1) as Node).join(" ")).not.toContain("need");
  });

  test("dragging a repository's row onto a folder files it there", () => {
    app.shared[FOLDERS] = folders({});
    const view = setup();
    drag(view, `head-${common}`, "folder-f1");
    expect(state().members).toEqual({ [common]: "f1" });
    expect(app.runs.filter(([name]) => name === "space.move")).toEqual([]);
  });

  test("a folder lights up only while a row is held over it", () => {
    app.shared[FOLDERS] = folders({});
    const view = setup();
    fire(node(view, "folder-f1"), "move");
    expect(style(node(view, "folder-f1").at(-1) as Node, "border_1")).toBeUndefined();
    fire(node(view, `head-${common}`), "down:left");
    fire(node(view, "folder-f1"), "move");
    expect(style(node(view, "folder-f1").at(-1) as Node, "border_1")).toEqual([]);
    fire(node(view, "folder-f1"), "up:left");
    expect(style(node(view, "folder-f1").at(-1) as Node, "border_1")).toBeUndefined();
  });

  test("a click on a row, then hovering a folder, files nothing", () => {
    app.shared[FOLDERS] = folders({});
    const view = setup();
    click(view, `head-${common}`);
    fire(node(view, "folder-f1"), "move");
    fire(node(view, "folder-f1"), "up:left");
    expect(state().members).toEqual({});
  });

  test("a press outside the list forgets a row drag", () => {
    app.shared[FOLDERS] = folders({});
    const view = setup();
    fire(node(view, `head-${common}`), "down:left");
    for (const handler of (view.render().kids[1] as Node).handlers.down_out ?? []) handler({}, cx);
    fire(node(view, "folder-f1"), "move");
    fire(node(view, "folder-f1"), "up:left");
    expect(state().members).toEqual({});
  });

  test("a row let go on a row outside its folder leaves the folder and still reorders", () => {
    app.shared[FOLDERS] = folders({ x: "f1" });
    const view = setup();
    drag(view, "head-x", `head-${common}`);
    expect(state().members).toEqual({});
    expect(app.runs).toContainEqual(["space.move", { id: "x", index: 1 }]);
  });

  test("a row let go on a row in a folder joins that folder", () => {
    app.shared[FOLDERS] = folders({ [common]: "f1" });
    const view = setup();
    drag(view, "head-x", `head-${common}`);
    expect(state().members).toEqual({ [common]: "f1", x: "f1" });
  });

  test("a repository whose main checkout is closed drags into a folder too", () => {
    app.shared[FOLDERS] = folders({});
    const view = placed([space("o", { folder: "/w/app/one" }), space("x", { active: true, folder: "/x" })], { "/w/app/one": { top: "/w/app/one", common }, "/x": null });
    drag(view, `head-${common}`, "folder-f1");
    expect(state().members).toEqual({ [common]: "f1" });
  });

  test("going to a space in a folded folder opens the folder, and folding it again sticks", () => {
    app.shared[FOLDERS] = folders({ [common]: "f1" }, true);
    const looks = { "/r/app": { top: "/r/app", common }, "/x": null };
    const view = placed([space("m", { folder: "/r/app" }), space("x", { active: true, folder: "/x" })], looks);
    view.tick(cx);
    expect(state().folders[0].folded).toBe(true);
    app.spaces = [space("m", { active: true, folder: "/r/app" }), space("x", { folder: "/x" })];
    view.tick(cx);
    expect(state().folders[0].folded).toBe(false);
    click(view, "folder-f1");
    view.tick(cx);
    expect(state().folders[0].folded).toBe(true);
  });

  test("going to a loose space leaves the folders as they are", () => {
    app.shared[FOLDERS] = folders({ [common]: "f1" }, true);
    const before = app.shared[FOLDERS];
    const looks = { "/r/app": { top: "/r/app", common }, "/x": null };
    const view = placed([space("m", { active: true, folder: "/r/app" }), space("x", { folder: "/x" })], looks);
    app.spaces = [space("m", { folder: "/r/app" }), space("x", { active: true, folder: "/x" })];
    view.tick(cx);
    expect(app.shared[FOLDERS]).toBe(before);
  });

  test("a folded folder holding the active space is drawn as the active group", () => {
    app.shared[FOLDERS] = folders({ x: "f1" }, true);
    const row = node(setup(), "folder-f1").at(-1) as Node;
    expect(style(row, "bg")).toEqual(["#505050"]);
    expect(row.kids.some((kid) => kid.calls.some(([name]) => name === "border_1"))).toBe(true);
  });

  test("the space menu learns the row's repository and its name", () => {
    app.shared[FOLDERS] = folders({ [common]: "f1" });
    fire(node(setup(), `head-${common}`), "down:right");
    const menu = app.overlays.at(-1) as Record<string, any>;
    expect(menu.mod).toBe("menu");
    expect(menu.props.target).toEqual({ id: "m" });
    expect(menu.props.folder.unit).toBe(common);
    expect(menu.props.folder.name).toBe("app");
    expect(menu.props.folder.height).toBeGreaterThan(100);
  });

  test("a worktree's menu files its whole repository", () => {
    app.shared[FOLDERS] = folders({});
    const view = placed([space("m", { folder: "/r/app" }), space("o", { folder: "/w/app/one" })], { "/r/app": { top: "/r/app", common }, "/w/app/one": { top: "/w/app/one", common } });
    fire(node(view, "kid-o"), "down:right");
    expect(app.overlays.at(-1)?.props.folder.unit).toBe(common);
  });

  test("a folder's right-click opens its own popup", () => {
    app.shared[FOLDERS] = folders({});
    fire(node(setup(), "folder-f1"), "down:right");
    expect(app.overlays.at(-1)).toMatchObject({ mod: "spaces-tree", kind: "popup", props: { role: "folder", folder: "f1" } });
  });

  test("the folder button left of + opens the name dialog for an empty folder", () => {
    const header = setup().render().kids[0] as Node;
    expect(header.kids.at(-1)?.kids.map((kid) => kid.key)).toEqual(["space-style", "space-folder", "space-new"]);
    click(setup(), "space-folder");
    expect(app.overlays.at(-1)).toMatchObject({ mod: "spaces-tree", kind: "dialog", props: { role: "name" } });
    expect(app.overlays.at(-1)?.props.unit).toBeUndefined();
  });

  test("a folder made with no space in it shows empty at the top", () => {
    app.props = { role: "name", overlay: "o1" };
    const dialog = new SpacesTree();
    dialog.init({}, { ...cx, focus_handle: () => null, timer: { every() {}, after() {} } });
    dialog.input.set_value("Later");
    dialog.input.emit("submit", cx);
    app.props = null;
    expect((app.shared[FOLDERS] as ReturnType<typeof folders>).members).toEqual({});
    expect(listKeys(setup())[0]).toMatch(/^folder-f/);
  });

  test("the narrow rail draws a folder as its tile and folds it on a click", () => {
    app.shared[FOLDERS] = folders({ x: "f1" });
    app.sidebar = 100;
    const view = setup();
    expect(listKeys(view)).toEqual(["compact-folder-f1", "compact-x", "compact-folder-f2", "compact-m"]);
    click(view, "compact-folder-f1");
    expect(listKeys(view)).toEqual(["compact-folder-f1", "compact-folder-f2", "compact-m"]);
  });
});

describe("folder popups", () => {
  const FOLDERS = "spaces.folders";
  const saved = () => app.shared[FOLDERS] as { folders: Record<string, unknown>[]; members: Record<string, string> };
  const open = (role: string, given: Record<string, unknown>) => {
    app.props = { ...given, role, overlay: "o1" };
    const view = new SpacesTree();
    view.init({}, { ...cx, focus_handle: () => ({ focus() {} }), timer: { every() {}, after() {} } });
    return view;
  };
  const press = (view: { render(): Node }, key: string) => fire(pathTo(view.render(), key) as Node[], "click");

  beforeEach(() => {
    app.shared[FOLDERS] = { folders: [{ id: "f1", name: "Clients", color: "ansi4", folded: false }], members: {} };
  });

  test("Move to folder lists the folders and files the repository in the one picked", () => {
    const view = open("folders", { unit: common, name: "app" });
    const root = view.render();
    expect(texts(root)).toEqual(expect.arrayContaining(["MOVE TO FOLDER · APP", "Clients", "New folder…"]));
    expect(texts(root)).not.toContain("Remove from folder");
    press(view, "move-f1");
    expect(saved().members).toEqual({ [common]: "f1" });
    expect(app.closed).toEqual(["o1"]);
  });

  test("Move to folder takes a filed repository out, and checks its folder", () => {
    app.shared[FOLDERS] = { folders: [{ id: "f1", name: "Clients", color: "ansi4", folded: false }], members: { [common]: "f1" } };
    const view = open("folders", { unit: common, name: "app" });
    expect(texts(view.render())).toContain("Remove from folder");
    press(view, "move-out");
    expect(saved().members).toEqual({});
  });

  test("New folder… opens the name dialog for the repository", () => {
    const view = open("folders", { unit: common, name: "app" });
    press(view, "move-new");
    expect(app.closed).toEqual(["o1"]);
    expect(app.overlays.at(-1)).toMatchObject({ mod: "spaces-tree", kind: "dialog", props: { role: "name", unit: common } });
  });

  test("the name dialog creates nothing while the name is empty, and creates the folder with the repository in it", () => {
    const view = open("name", { unit: common });
    expect(texts(view.render())).toEqual(expect.arrayContaining(["New folder", "Create"]));
    press(view, "name-save");
    expect(saved().folders).toHaveLength(1);
    press(view, "name-color-ansi5");
    view.input.set_value("  Personal ");
    view.input.emit("submit", cx);
    expect(saved().folders.at(-1)).toMatchObject({ name: "Personal", color: "ansi5", folded: false });
    expect(saved().members[common]).toBe(saved().folders.at(-1)?.id as string);
    expect(app.closed).toEqual(["o1"]);
  });

  test("a new folder starts on the color the fewest folders use", () => {
    expect(open("name", { unit: common }).color).toBe("ansi6");
  });

  test("Cancel leaves no folder behind", () => {
    const view = open("name", { unit: common });
    view.input.set_value("Later");
    press(view, "name-cancel");
    expect(saved().folders).toHaveLength(1);
    expect(app.closed).toEqual(["o1"]);
  });

  test("renaming starts from the folder's name and color", () => {
    const view = open("name", { folder: "f1" });
    expect(view.input.value()).toBe("Clients");
    expect(view.color).toBe("ansi4");
    expect(texts(view.render())).toEqual(expect.arrayContaining(["Rename folder", "Save"]));
    view.input.set_value("Work");
    press(view, "name-color-ansi3");
    press(view, "name-save");
    expect(saved().folders).toEqual([{ id: "f1", name: "Work", color: "ansi3", folded: false }]);
  });

  test("the folder popup recolors at once, renames through the dialog and deletes", () => {
    app.shared[FOLDERS] = { folders: [{ id: "f1", name: "Clients", color: "ansi4", folded: false }], members: { [common]: "f1" } };
    const view = open("folder", { folder: "f1" });
    press(view, "folder-color-ansi1");
    expect(saved().folders[0]?.color).toBe("ansi1");
    press(view, "folder-rename");
    expect(app.overlays.at(-1)).toMatchObject({ mod: "spaces-tree", kind: "dialog", props: { role: "name", folder: "f1" } });
    press(view, "folder-delete");
    expect(saved()).toEqual({ folders: [], members: {} });
  });

  test("a popup copy starts no timer, no git and no command loop", () => {
    let timers = 0;
    let spawns = 0;
    app.props = { role: "folder", folder: "f1", overlay: "o1" };
    new SpacesTree().init({}, { notify() {}, focus_handle: () => null, timer: { every: () => timers++, after() {} }, spawn: () => spawns++ });
    expect([timers, spawns]).toEqual([0, 0]);
  });
});
