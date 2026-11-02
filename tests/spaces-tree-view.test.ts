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
