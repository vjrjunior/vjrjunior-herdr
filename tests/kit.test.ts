import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Node } from "./app-mocks";
import "./app-mocks";

const { BRAND, ICONS, button, chip, iconButton, iconPath, stepNode } = await import("../kit/kit.js");

const repo = join(import.meta.dir, "..");
const t = new Proxy({}, { get: (_x, p) => (typeof p === "string" ? `t.${p}` : undefined) }) as any;

const walk = (node: Node): Node[] => [node, ...node.kids.flatMap(walk)];
const calls = (node: Node, name: string) => walk(node).flatMap((n) => n.calls.filter(([c]) => c === name).map(([, args]) => args));
const svgs = (node: Node) => calls(node, "svg").map(([path]) => path);
const own = (node: Node, name: string) => node.calls.filter(([c]) => c === name).map(([, args]) => args);

test("every icon name has a file and every file is named", () => {
  const files = readdirSync(join(repo, "kit/icons")).filter((f) => f.endsWith(".svg")).map((f) => f.slice(0, -4)).sort();
  expect(files).toEqual([...ICONS]);
});

test("every icon is a 24 px currentColor svg", () => {
  for (const name of ICONS) {
    const source = readFileSync(join(repo, "kit/icons", `${name}.svg`), "utf8");
    expect(source).toContain('viewBox="0 0 24 24"');
    expect(source).toContain("currentColor");
    expect(source).not.toContain("<title>");
  }
});

test("iconPath points into the kit mod", () => expect(iconPath("eye")).toBe("mods/kit/icons/eye.svg"));

test("a done step is a filled node with a heavy check", () => {
  const node = stepNode("done", t);
  expect(calls(node, "bg")).toContainEqual(["t.done"]);
  expect(svgs(node)).toEqual(["mods/kit/icons/check-heavy.svg"]);
});

test("the current step is an accent ring with a dot", () => {
  const node = stepNode("current", t);
  expect(own(node, "border_color")).toContainEqual(["t.accent"]);
  expect(node.kids).toHaveLength(1);
  expect(own(node.kids[0], "bg")).toContainEqual(["t.accent"]);
  expect(svgs(node)).toEqual([]);
});

test("a bad step is a blocked ring with an exclamation", () => {
  const node = stepNode("bad", t);
  expect(own(node, "border_color")).toContainEqual(["t.blocked"]);
  expect(svgs(node)).toEqual(["mods/kit/icons/exclamation.svg"]);
});

test("a todo step is an empty input ring", () => {
  const node = stepNode("todo", t);
  expect(own(node, "border_color")).toContainEqual(["t.input"]);
  expect(node.kids).toHaveLength(0);
});

test("an icon button has its tooltip and a colored icon", () => {
  const node = iconButton("b", { icon: "zed", tooltip: "Zed", color: BRAND.zed, onClick() {} }, t);
  expect(calls(node, "tooltip")).toContainEqual(["Zed"]);
  expect(svgs(node)).toEqual(["mods/kit/icons/zed.svg"]);
  expect(calls(node, "text_color")).toContainEqual([BRAND.zed]);
});

test("a solid button uses the accent, an outline button the input border", () => {
  const solid = button("s", { label: "Go", variant: "solid", onClick() {} }, t);
  expect(own(solid, "bg")).toContainEqual(["t.accent"]);
  const outline = button("o", { label: "Go", onClick() {} }, t);
  expect(own(outline, "border_color")).toContainEqual(["t.input"]);
});

test("a disabled button still reports its click", () => {
  let clicks = 0;
  const node = button("d", { label: "Next", disabled: true, onClick: () => clicks++ }, t);
  expect(own(node, "bg")).toContainEqual(["t.raised"]);
  node.handlers.click[0]({}, {});
  expect(clicks).toBe(1);
});

test("a chip draws its mark before the text", () => {
  const node = chip("passed", { mark: "check", color: "t.done" }, t);
  expect(svgs(node)).toEqual(["mods/kit/icons/check.svg"]);
  expect(node.texts).toEqual(["passed"]);
  expect(node.kids).toHaveLength(1);
});

test("kit.js has no hex color outside BRAND", () => {
  const source = readFileSync(join(repo, "kit/kit.js"), "utf8");
  expect([...source.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]).sort()).toEqual(["#4A9EFF", "#7B68EE"]);
});

const ADOPTERS = [
  "kit/kit.js",
  "mods/kit/main.js",
  "mods/command-center/column.js",
  "mods/command-center/logic.js",
  "mods/spaces-tree/main.js",
  "mods/markdown/main.js",
];

for (const file of ADOPTERS) {
  test(`${file} draws no glyphs`, () => {
    const source = readFileSync(join(repo, file), "utf8");
    expect(source).not.toMatch(/[\u2713\u25cf\u25cb\u2197\u25b8\u25be\u21bb\u2190\u2715\u25a0\u25a1]/);
    expect(source).not.toMatch(/["'`]!["'`]/);
  });
}

test("a button's text size follows its height", () => {
  const size = (height?: number) => own(button("b", { label: "Go", height, onClick() {} }, t), "text_size");
  expect(size(32)).toEqual([[12]]);
  expect(size(28)).toEqual([[11.5]]);
  expect(size()).toEqual([[11]]);
});

test("an icon button without a tooltip makes no tooltip call", () => {
  const node = iconButton("i", { icon: "x", onClick() {} }, t);
  expect(own(node, "tooltip")).toEqual([]);
  expect(own(iconButton("i", { icon: "x", tooltip: "Close", onClick() {} }, t), "tooltip")).toEqual([["Close"]]);
});

test("a button without a label adds no text child", () => {
  const node = button("b", { icon: "plus", onClick() {} }, t);
  expect(node.texts).toEqual([]);
  expect(svgs(node)).toEqual(["mods/kit/icons/plus.svg"]);
});
