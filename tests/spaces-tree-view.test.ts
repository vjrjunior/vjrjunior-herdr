import { beforeEach, describe, expect, test } from "bun:test";
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
