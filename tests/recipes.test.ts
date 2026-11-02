import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Variant } from "../recipes/recipe";
import { LEFT_ROUNDED, VARIANTS } from "../recipes/variants";
import { generateVariant } from "../scripts/generate-layout";
import { removeTempDirs, repo, tempDir } from "./helpers";
import { makeHerdrHome, SHIPPED_MODS } from "./herdr-home";

afterEach(removeTempDirs);

function generate(layout: string, overrides: Record<string, string> = {}) {
  const home = tempDir();
  makeHerdrHome(home, overrides);
  const variant = VARIANTS.find((candidate) => candidate.layout === layout);
  if (!variant) throw new Error(`no variant ${layout}`);
  return generateVariant(variant, { home, version: "0.1.10", repo, bun: "/bin/bun" });
}

const generateDesk = (overrides?: Record<string, string>) => generate("vjr-desk", overrides);
const generateSquare = (overrides?: Record<string, string>) => generate("vjr-desk-square", overrides);
const allJs = (generated: ReturnType<typeof generate>) =>
  Object.values(generated.mods)
    .flatMap((files) => Object.entries(files).filter(([name]) => name.endsWith(".js")).map(([, text]) => text))
    .join("\n");
const meta = (generated: ReturnType<typeof generate>, mod: string) => JSON.parse(generated.mods[`vjr-square-${mod}`]?.["mod.json"] ?? "{}");

function findNode(node: unknown, id: string): Record<string, any> | null {
  if (node === null || typeof node !== "object") return null;
  const fields = node as Record<string, any>;
  if (fields.id === id) return fields;
  for (const child of fields.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

function modsIn(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(modsIn);
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => (key === "mod" && typeof value === "string" ? [value] : modsIn(value)));
}

const graphChild = (generated: ReturnType<typeof generate>) => findNode(JSON.parse(generated.layoutText), "panel-body")?.children.at(-1);

describe("variants", () => {
  test("vjr-desk copies the palette, the status bar, the tab bar and the spaces tree", () => {
    expect(Object.keys(generateDesk().mods).sort()).toEqual(["vjr-palette", "vjr-spaces-tree", "vjr-tabs", "vjr-workspace-status"]);
  });

  test("vjr-desk-square copies seventeen mods", () => {
    expect(Object.keys(generateSquare().mods)).toHaveLength(17);
  });

  test("vjr-desk keeps the shipped mods elsewhere", () => {
    const mods = modsIn(JSON.parse(generateDesk().layoutText));
    expect(mods).toContain("vjr-spaces-tree");
    expect(mods).not.toContain("spaces");
    expect(mods).toContain("agents");
    expect(mods).toContain("vjr-tabs");
  });

  test("the prompt, confirm, toast and peek stay on the shipped mods", () => {
    expect(LEFT_ROUNDED).toEqual(["prompt", "confirm", "toast", "peek", "win98", "terminals-bar", "terminals-pane"]);
  });
});

describe("list-vjr-theme", () => {
  test("the palette lists the vjr theme", () => {
    expect(generateDesk().mods["vjr-palette"]?.["main.js"]).toContain('["vjr", "graphite", "ink", "moss", "atom-one-dark"]');
  });

  test("the palette shows keys from its own layout section", () => {
    expect(generateDesk().mods["vjr-palette"]?.["main.js"]).toContain('b.section === "layout:vjr-desk"');
    expect(generateSquare().mods["vjr-square-palette"]?.["main.js"]).toContain('b.section === "layout:vjr-desk-square"');
  });

  test("the status bar opens the copied palette", () => {
    expect(generateDesk().mods["vjr-workspace-status"]?.["main.js"]).toContain('run("mod.open", { name: "vjr-palette" })');
  });

  test("the copied palette opens where the original does", () => {
    expect(JSON.parse(generateDesk().mods["vjr-palette"]?.["mod.json"] ?? "{}").overlay).toEqual({
      kind: "popup",
      at: "top",
      offset: 60,
      width: 620,
      height: 410,
    });
  });

  test("the palette key opens the copy", () => {
    expect(generateDesk().replacements).toEqual({ "app.palette": "mod.open:vjr-palette" });
  });

  test("a palette that changed fails the recipe", () => {
    expect(() => generateDesk({ "frame/palette/main.js": "changed" })).toThrow(/recipe list-vjr-theme:/);
  });
});

describe("git-graph-panel", () => {
  test("both layouts show a Graph button", () => {
    for (const [generated, tabs] of [
      [generateDesk(), "vjr-tabs"],
      [generateSquare(), "vjr-square-tabs"],
    ] as const) {
      expect(generated.mods[tabs]?.["main.js"]).toContain('panelButton("graph", "Graph", "mods/git-graph/icons/graph.svg")');
      expect(generated.mods[tabs]?.["main.js"]).toContain('[...(shared("workspace.panels") ?? ["files", "changes"]), "graph"]');
    }
  });

  test("the Graph button comes right after Changes", () => {
    expect(generateDesk().mods["vjr-tabs"]?.["main.js"]).toContain(
      'panelButton("changes", "Changes", "mods/changes/changes.svg")))\n      .child(panelButton("graph"',
    );
  });

  test("vjr-desk opens the original git-graph in the panel", () => {
    expect(graphChild(generateDesk())).toEqual({ id: "graph", type: "block", content: { mod: "git-graph" } });
  });

  test("vjr-desk-square opens its square git-graph in the panel", () => {
    expect(graphChild(generateSquare()).content.mod).toBe("vjr-square-git-graph");
  });

  test("a layout without panel-body fails the recipe", () => {
    expect(() => generateDesk({ "layouts/main.json": '{ "id": "root", "children": [] }' })).toThrow(/recipe git-graph-panel:/);
  });

  test("a tab bar that changed fails the recipe", () => {
    expect(() => generateDesk({ "mods/tabs/main.js": "changed" })).toThrow(/recipe git-graph-panel:/);
  });
});

describe("square", () => {
  test("leaves no rounded corner", () => {
    expect(allJs(generateSquare())).not.toMatch(/\.rounded(_[a-z]+)?\((?!0\))/);
  });

  test("turns rounded_full into rounded(0)", () => {
    expect(allJs(generateSquare())).not.toContain("rounded_full");
  });

  test("keeps the side of a one-sided corner", () => {
    expect(generateSquare().mods["vjr-square-agents"]?.["main.js"]).toContain(".rounded_bl(0)");
  });

  test("swaps the round status glyphs", () => {
    const text = allJs(generateSquare());
    expect(text).not.toMatch(/[●○]/);
    expect(text).toContain("■");
    expect(text).toContain("□");
  });

  test("drops the frame of popups with a copy", () => {
    expect(generateSquare().mods["vjr-square-tabs"]?.["main.js"]).toContain('mod: "vjr-square-menu", kind: "popup", frame: "none"');
  });

  test("keeps the frame of the shipped prompt", () => {
    expect(generateSquare().mods["vjr-square-palette"]?.["main.js"]).toContain('openOverlay({ mod: "prompt", kind: "dialog", width: 380');
  });

  test("borders every popup root", () => {
    const square = generateSquare();
    for (const mod of ["menu", "new-menu", "picker", "machine-add", "help", "palette", "agents"]) {
      expect(square.mods[`vjr-square-${mod}`]?.["main.js"]).toContain(".bg(t.popover).border_1().border_color(t.border)");
    }
    expect(square.mods["vjr-square-git-graph"]?.["menu.js"]).toContain(".bg(t.popover).border_1().border_color(t.border)");
    expect(square.mods["vjr-square-git-graph"]?.["dialog.js"]).toContain(".bg(t.popover).border_1().border_color(t.border)");
    expect(square.mods["vjr-square-settings"]?.["main.js"]).toContain('.id("settings").border_1().border_color(t.border)');
  });

  test("the square git-graph keeps its icons at the original path", () => {
    expect(generateSquare().mods["vjr-square-git-graph"]?.["menu.js"]).toContain("mods/git-graph/icons/");
  });

  test("the square git-graph opens its own menu and dialogs", () => {
    const square = generateSquare();
    expect(square.mods["vjr-square-git-graph"]?.["graph.js"]).toContain('mod: "vjr-square-git-graph", kind: "popup", frame: "none"');
    expect(square.mods["vjr-square-git-graph"]?.["act.js"]).toContain('mod: "vjr-square-git-graph", kind: "dialog", frame: "none"');
  });

  test("sizes the copied dialogs", () => {
    const square = generateSquare();
    expect(meta(square, "settings").overlay).toEqual({ kind: "dialog", width: 880, height: 620, frame: "none" });
    expect(meta(square, "help").overlay).toEqual({ kind: "dialog", width: 520, height: 0.7, frame: "none" });
    expect(meta(square, "palette").overlay).toEqual({ kind: "popup", at: "top", offset: 60, width: 620, height: 410, frame: "none" });
  });

  test("keeps what the picker, machine-add and menu overlays already had", () => {
    const square = generateSquare();
    expect(meta(square, "picker").overlay).toEqual({ kind: "popup", at: "top", offset: 40, width: 640, height: 0.8, frame: "none" });
    expect(meta(square, "machine-add").overlay).toEqual({ kind: "dialog", width: 560, frame: "none" });
    expect(meta(square, "menu").overlay).toEqual({ frame: "none" });
  });

  test("hides app.help from the generic commands", () => {
    expect(generateSquare().mods["vjr-square-palette"]?.["main.js"]).toContain('"app.palette", "app.help", "app.hide",');
  });

  test("the palette opens the copied settings, help and picker", () => {
    const palette = generateSquare().mods["vjr-square-palette"]?.["main.js"];
    expect(palette).toContain('["mod.open", { name: "vjr-square-settings" }, "App", "Settings"');
    expect(palette).toContain('["mod.open", { name: "vjr-square-help" }, "App", "Keys"');
    expect(palette).toContain('["mod.open", { name: "vjr-square-picker" }, "Tab"');
  });

  test("the context menu opens the copied help", () => {
    expect(generateSquare().mods["vjr-square-menu"]?.["main.js"]).toContain('if (it[1] === "app.help") run("mod.open", { name: "vjr-square-help" });');
  });

  test("a context menu that changed still generates", () => {
    const menu = 'export default class Mod { render() { return v_flex().bg(t.popover).rounded(7); } }';
    expect(() => generateSquare({ "mods/menu/main.js": menu })).not.toThrow();
  });

  test("opens the copied settings from the sidebar", () => {
    expect(generateSquare().mods["vjr-square-workspace-chrome"]?.["main.js"]).toContain('run("mod.open", { name: "vjr-square-settings" })');
  });

  test("settings opens the copied Add machine", () => {
    expect(generateSquare().mods["vjr-square-settings"]?.["main.js"]).toContain('{ name: "vjr-square-machine-add" }');
  });

  test("zeroes the pane radius and sets the terminal menu", () => {
    const layout = JSON.parse(generateSquare().layoutText);
    expect(findNode(layout, "main")?.content.pane.radius).toBe(0);
    expect(layout.terminal_menu).toBe("vjr-square-menu");
  });

  test("keeps the pane radius in vjr-desk", () => {
    expect(findNode(JSON.parse(generateDesk().layoutText), "main")?.content.pane.radius).toBe(10);
  });

  test("replaces the four key actions", () => {
    expect(generateSquare().replacements).toEqual({
      "app.palette": "mod.open:vjr-square-palette",
      "app.settings": "mod.open:vjr-square-settings",
      "app.help": "mod.open:vjr-square-help",
      "mod.open:picker": "mod.open:vjr-square-picker",
    });
  });

  test("a home with no rounded corners fails the recipe, whatever git-graph has", () => {
    const home = tempDir();
    makeHerdrHome(home);
    for (const folder of [...SHIPPED_MODS.map((mod) => `mods/${mod}`), "frame/palette", "frame/settings"]) {
      for (const file of readdirSync(join(home, folder)).filter((name) => name.endsWith(".js"))) {
        const path = join(home, folder, file);
        writeFileSync(path, readFileSync(path, "utf8").replace(/\.rounded(_[a-z]+)?\([^()]*\)/g, ""));
      }
    }
    const variant = VARIANTS[1] as Variant;
    expect(() => generateVariant(variant, { home, version: "0.1.10", repo, bun: "/bin/bun" })).toThrow(/recipe square:/);
  });

  test("a home without status glyphs still generates", () => {
    expect(() =>
      generateSquare({
        "mods/picker/main.js": 'export default class Mod { render() { return v_flex().bg(t.popover).rounded(9).child("·"); } }',
      }),
    ).not.toThrow();
  });
});

describe("spaces-tree", () => {
  test("both layouts show the tree in the spaces block", () => {
    expect(findNode(JSON.parse(generateDesk().layoutText), "spaces")?.content.mod).toBe("vjr-spaces-tree");
    expect(findNode(JSON.parse(generateSquare().layoutText), "spaces")?.content.mod).toBe("vjr-square-spaces-tree");
  });

  test("the copy brings its pure logic along", () => {
    expect(generateDesk().mods["vjr-spaces-tree"]?.["tree.js"]).toContain("export function buildTree");
  });

  test("no shipped spaces copy is left in the square layout", () => {
    expect(generateSquare().mods["vjr-square-spaces"]).toBeUndefined();
  });

  test("the square copy has no rounded corner left", () => {
    const main = generateSquare().mods["vjr-square-spaces-tree"]?.["main.js"] ?? "";
    expect(main).not.toMatch(/\.rounded(_[a-z]+)?\((?!0\))/);
  });

  test("the rounded copy keeps its corners", () => {
    expect(generateDesk().mods["vjr-spaces-tree"]?.["main.js"]).toMatch(/\.rounded\(8\)/);
  });
});
