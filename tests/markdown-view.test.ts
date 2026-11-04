import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { herdr, type Node } from "./app-mocks";

const { default: Markdown } = await import("../mods/markdown/main.js");

const HOME = "/Users/me";
const DIR = "/Users/me/w/app/cup-1234";
const FILE = `${DIR}/VJR-TASK.md`;

let files: Record<string, string>;
let reads: string[];
let execs: [string, string[]][];
let watches: { dir: string; resolve: (paths: string[]) => void }[];
let given: Record<string, unknown>;
let slow: ((value: string | null) => void)[] | null;

const originalTheme = herdr.theme;

afterEach(() => {
  herdr.theme = originalTheme;
});

beforeEach(() => {
  files = { [FILE]: "# Draft autosave\n\nBody text" };
  reads = [];
  execs = [];
  watches = [];
  given = { file: FILE };
  slow = null;
  Object.assign(herdr, {
    props: () => given,
    home: () => HOME,
    theme: () => new Proxy({}, { get: (_target, prop) => (typeof prop === "string" ? "#505050" : undefined) }),
    readTextFile: (path: string) => {
      reads.push(path);
      if (slow) return new Promise((resolve) => slow?.push(resolve));
      return Promise.resolve(path in files ? files[path] : null);
    },
    watchFolder: (dir: string) => new Promise((resolve) => watches.push({ dir, resolve })),
    exec: async (command: string, args: string[]) => {
      execs.push([command, args]);
      return { code: 0, stdout: "", stderr: "" };
    },
  });
});

function makeCx() {
  const cx: Record<string, any> = {
    notified: 0,
    timer: { every() {} },
    spawn(work: (cx: unknown) => unknown) {
      Promise.resolve().then(() => work(cx));
    },
    notify() {
      cx.notified += 1;
    },
  };
  return cx;
}

const flush = async () => {
  for (let i = 0; i < 4; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

async function open(props: Record<string, unknown> = given) {
  const cx = makeCx();
  const view = new Markdown();
  view.init(props, cx);
  await flush();
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

function click(view: { render(): Node }, key: string, cx: unknown) {
  const node = find(view.render(), (item) => item.key === key);
  if (!node) throw new Error(`no element ${key}`);
  for (const handler of node.handlers.click ?? []) handler({}, cx);
}

function linkHandler(view: { render(): Node }) {
  const node = find(view.render(), (item) => item.calls.some(([name]) => name === "on_link_click"));
  return node?.calls.find(([name]) => name === "on_link_click")?.[1][0] as (url: string, cx: unknown) => void;
}

describe("reading", () => {
  test("the pane shows the file, its name and its folder from home", async () => {
    const { view } = await open();
    const shown = texts(view.render());
    expect(shown).toContain("# Draft autosave\n\nBody text");
    expect(shown).toContain("VJR-TASK.md");
    expect(shown).toContain("~/w/app/cup-1234");
  });

  test("the text view scrolls and its text can be selected", async () => {
    const { view } = await open();
    const node = find(view.render(), (item) => item.texts.includes("# Draft autosave\n\nBody text")) as Node;
    expect(node.calls).toContainEqual(["scrollable", [true]]);
    expect(node.calls).toContainEqual(["selectable", [true]]);
  });

  test("front matter is hidden", async () => {
    files[FILE] = "---\ntitle: x\n---\n# Plan";
    const { view } = await open();
    expect(texts(view.render())).toContain("# Plan");
    expect(texts(view.render()).join("\n")).not.toContain("title: x");
  });

  test("a missing file says so and comes back when it appears", async () => {
    delete files[FILE];
    const { view } = await open();
    expect(texts(view.render())).toContain("VJR-TASK.md is gone");
    files[FILE] = "# Back";
    watches.at(-1)?.resolve([DIR]);
    await flush();
    expect(texts(view.render())).toContain("# Back");
  });

  test("without a file the pane says there is nothing to show", async () => {
    const { view } = await open({});
    expect(texts(view.render())).toContain("No file to show");
    expect(reads).toEqual([]);
  });
});

describe("watching", () => {
  test("the folder of the file is watched", async () => {
    await open();
    expect(watches.map((watch) => watch.dir)).toEqual([DIR]);
  });

  test("a change to the file reads it again", async () => {
    const { view } = await open();
    files[FILE] = "# Changed";
    watches.at(-1)?.resolve([FILE]);
    await flush();
    expect(texts(view.render())).toContain("# Changed");
    expect(watches).toHaveLength(2);
  });

  test("a change to another file does not read it again", async () => {
    await open();
    watches.at(-1)?.resolve([`${DIR}/other.ts`]);
    await flush();
    expect(reads).toEqual([FILE]);
  });

  test("only the newest read is shown", async () => {
    slow = [];
    const { view, cx } = await open();
    click(view, "md-reload", cx);
    await flush();
    const [first, second] = slow;
    second?.("# Second");
    first?.("# First");
    await flush();
    expect(texts(view.render())).toContain("# Second");
    expect(texts(view.render())).not.toContain("# First");
  });
});

describe("watching, after review", () => {
  test("a failed watch starts again on reload", async () => {
    let fail = true;
    herdr.watchFolder = ((dir: string) => {
      if (fail) {
        fail = false;
        return Promise.reject(new Error("too many folders"));
      }
      return new Promise((resolve) => watches.push({ dir, resolve }));
    }) as never;
    const { view, cx } = await open();
    expect(watches).toEqual([]);
    click(view, "md-reload", cx);
    await flush();
    expect(watches.map((watch) => watch.dir)).toEqual([DIR]);
  });

  test("going back to a folder keeps a single watcher on it", async () => {
    files["/Users/me/w/app/docs/plan.md"] = "# The plan";
    const { view, cx } = await open();
    linkHandler(view)("../docs/plan.md", cx);
    await flush();
    click(view, "md-back", cx);
    await flush();
    const before = reads.length;
    files[FILE] = "# Changed";
    for (const watch of watches.filter((item) => item.dir === DIR)) watch.resolve([FILE]);
    await flush();
    expect(reads.length - before).toBe(1);
  });

  test("a change that leaves the text the same does not redraw", async () => {
    const { cx } = await open();
    const before = cx.notified;
    watches.at(-1)?.resolve([DIR]);
    await flush();
    expect(reads).toEqual([FILE, FILE]);
    expect(cx.notified).toBe(before);
  });
});

describe("links and buttons", () => {
  test("a web link opens in the browser", async () => {
    const { view, cx } = await open();
    linkHandler(view)("https://example.com/a", cx);
    expect(execs).toContainEqual(["open", ["https://example.com/a"]]);
  });

  test("a link to another file opens in its own app", async () => {
    const { view, cx } = await open();
    linkHandler(view)("shots/01.png", cx);
    expect(execs).toContainEqual(["open", [`${DIR}/shots/01.png`]]);
  });

  test("a markdown link opens in the pane and Back returns", async () => {
    files["/Users/me/w/app/docs/plan.md"] = "# The plan";
    const { view, cx } = await open();
    linkHandler(view)("../docs/plan.md", cx);
    await flush();
    expect(texts(view.render())).toContain("# The plan");
    expect(texts(view.render())).toContain("plan.md");
    expect(watches.at(-1)?.dir).toBe("/Users/me/w/app/docs");
    click(view, "md-back", cx);
    await flush();
    expect(texts(view.render())).toContain("# Draft autosave\n\nBody text");
    expect(find(view.render(), (item) => item.key === "md-back")).toBeNull();
  });

  test("the old folder's watch stops after moving to another folder", async () => {
    files["/Users/me/w/app/docs/plan.md"] = "# The plan";
    const { view, cx } = await open();
    const old = watches[0];
    linkHandler(view)("../docs/plan.md", cx);
    await flush();
    const before = reads.length;
    old?.resolve([FILE]);
    await flush();
    expect(reads.length).toBe(before);
    expect(texts(view.render())).toContain("# The plan");
  });

  test("an anchor on the same page does nothing", async () => {
    const { view, cx } = await open();
    linkHandler(view)("#plan", cx);
    await flush();
    expect(execs).toEqual([]);
    expect(reads).toEqual([FILE]);
  });

  test("Zed opens the shown file", async () => {
    const { view, cx } = await open();
    click(view, "md-zed", cx);
    expect(execs).toContainEqual(["zed", [FILE]]);
  });

  test("the header's Zed is a named button with a gray icon and Reload an icon with a tooltip", async () => {
    herdr.theme = () => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? `t.${p}` : undefined) });
    files["/Users/me/w/app/docs/plan.md"] = "# The plan";
    const { view, cx } = await open();
    linkHandler(view)("../docs/plan.md", cx);
    await flush();
    const root = view.render();
    const svgs = (node: Node): string[] => [...node.calls.filter(([n]) => n === "svg").map(([, a]) => a[0] as string), ...node.kids.flatMap(svgs)];
    const at = (id: string) => find(root, (item) => item.key === id) as Node;
    const zed = at("md-zed");
    expect(texts(zed)).toContain("Zed");
    expect(svgs(zed)).toEqual(["mods/kit/icons/zed.svg"]);
    const zedIcon = find(zed, (item) => item.calls.some(([n, a]) => n === "svg" && a[0] === "mods/kit/icons/zed.svg")) as Node;
    expect(zedIcon.calls).toContainEqual(["text_color", ["t.muted"]]);
    const reload = at("md-reload");
    expect(reload.calls).toContainEqual(["tooltip", ["Reload"]]);
    expect(svgs(reload)).toEqual(["mods/kit/icons/rotate-cw.svg"]);
    const back = at("md-back");
    expect(svgs(back)).toEqual(["mods/kit/icons/arrow-left.svg"]);
    expect(texts(back)).toEqual(["Back"]);
    for (const node of [zed, reload, back]) {
      for (const glyph of ["\u2197", "\u21bb", "\u2190"]) expect(texts(node).join("")).not.toContain(glyph);
    }
  });

  test("reload reads the file again", async () => {
    const { view, cx } = await open();
    click(view, "md-reload", cx);
    await flush();
    expect(reads).toEqual([FILE, FILE]);
  });
});
