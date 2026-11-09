import { beforeEach, expect, test } from "bun:test";
import { herdr, type Node } from "./app-mocks";

const { ICONS } = await import("../kit/kit.js");
const { default: Kit } = await import("../mods/kit/main.js");

const walk = (node: Node): Node[] => [node, ...node.kids.flatMap(walk)];
const find = (node: Node, key: string) => walk(node).find((n) => n.key === key) as Node;
const texts = (node: Node) => walk(node).flatMap((n) => n.texts);
const svgs = (node: Node) => walk(node).flatMap((n) => n.calls.filter(([c]) => c === "svg").map(([, args]) => args[0]));

beforeEach(() => {
  herdr.theme = () => new Proxy({}, { get: (_x, p) => (typeof p === "string" ? `t.${p}` : undefined) });
});

function render() {
  return new Kit().render({ notify() {} }) as Node;
}

test("the gallery shows every section", () => {
  const root = render();
  for (const id of ["buttons", "icon-buttons", "links", "chips", "pill", "lines", "popup-rows", "dots", "steps", "icons"]) {
    expect(find(root, `kit-${id}`)).toBeDefined();
  }
});

test("the gallery draws every icon with its name", () => {
  const section = find(render(), "kit-icons");
  const drawn = svgs(section);
  for (const name of ICONS) {
    expect(drawn).toContain(`mods/kit/icons/${name}.svg`);
    expect(texts(section)).toContain(name);
  }
  expect(drawn).toHaveLength(ICONS.length);
});

test("the gallery shows each step state", () => {
  const section = find(render(), "kit-steps");
  const borders = walk(section).flatMap((n) => n.calls.filter(([c]) => c === "border_color").map(([, args]) => args[0]));
  expect(borders).toEqual(["t.accent", "t.blocked", "t.input"]);
  expect(svgs(section)).toEqual(["mods/kit/icons/check-heavy.svg", "mods/kit/icons/exclamation.svg"]);
});

test("the gallery shows the buttons and chips the mods use", () => {
  const root = render();
  const colorOf = (id: string) => walk(find(root, id)).flatMap((n) => n.calls.filter(([c]) => c === "text_color").map(([, args]) => args[0]));
  expect(texts(find(root, "kit-b-named"))).toContain("ClickUp");
  expect(colorOf("kit-b-named")).toContain("t.muted");
  expect(svgs(find(root, "kit-b-pass"))).toEqual(["mods/kit/icons/check.svg"]);
  expect(colorOf("kit-b-pass")).toContain("t.done");
  expect(svgs(find(root, "kit-b-fail"))).toEqual(["mods/kit/icons/x.svg"]);
  expect(colorOf("kit-b-fail")).toContain("t.blocked");
  const chips = svgs(find(root, "kit-chips"));
  expect(chips).toContain("mods/kit/icons/exclamation.svg");
  expect(chips).not.toContain("mods/kit/icons/x.svg");
});

test("the gallery shows popup rows with an icon, a color dot, a check and a selected one", () => {
  const section = find(render(), "kit-popup-rows");
  expect(texts(section)).toEqual(expect.arrayContaining(["New folder…", "Clients", "Remove from folder", "Selected"]));
  expect(svgs(section)).toEqual(expect.arrayContaining(["mods/kit/icons/plus.svg", "mods/kit/icons/check.svg"]));
});
