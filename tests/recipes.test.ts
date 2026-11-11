import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Variant } from "../recipes/recipe";
import { LEFT_ROUNDED, VARIANTS } from "../recipes/variants";
import { generateVariant } from "../scripts/generate-layout";
import { MEMORY, SYNC } from "../recipes/command-center";
import { removeTempDirs, repo, tempDir } from "./helpers";
import { makeHerdrHome, SHIPPED_MODS } from "./herdr-home";

afterEach(removeTempDirs);

function generate(layout: string, overrides: Record<string, string> = {}, extra: { ppStack?: string } = {}) {
  const home = tempDir();
  makeHerdrHome(home, overrides);
  const variant = VARIANTS.find((candidate) => candidate.layout === layout);
  if (!variant) throw new Error(`no variant ${layout}`);
  return generateVariant(variant, { home, version: "0.1.10", repo, bun: "/bin/bun", ...extra });
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
  test("vjr-desk copies the palette, the status bar, the tab bar, the spaces tree, comeback, the command center, the kit and the markdown viewer, the menu and the move-tab popup", () => {
    expect(Object.keys(generateDesk().mods).sort()).toEqual(["vjr-comeback", "vjr-command-center", "vjr-kit", "vjr-markdown", "vjr-menu", "vjr-move-tab", "vjr-palette", "vjr-spaces-tree", "vjr-tabs", "vjr-workspace-status"]);
  });

  test("vjr-desk-square copies twenty-two mods", () => {
    expect(Object.keys(generateSquare().mods)).toHaveLength(22);
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

describe("kit", () => {
  test("both layouts install the kit", () => {
    expect(Object.keys(generateDesk().mods)).toContain("vjr-kit");
    expect(Object.keys(generateSquare().mods)).toContain("vjr-square-kit");
  });

  test("the square layout's kit has only square corners", () => {
    const mods = generateSquare().mods;
    const files = [mods["vjr-square-kit"]?.["main.js"] ?? "", ...Object.entries(mods).filter(([name]) => name.startsWith("vjr-square-")).map(([, f]) => f["kit.js"] ?? "")];
    const rounded = files.flatMap((text) => text.match(/\.rounded(_[a-z]+)?\([^()]*\)/g) ?? []);
    expect(rounded.length).toBeGreaterThan(0);
    for (const call of rounded) expect(call).toMatch(/\.rounded(_[a-z]+)?\(0\)/);
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
    expect(square.mods["vjr-square-settings"]?.["main.js"]).toContain('.id("settings").bg(t.popover).border_1().border_color(t.border)');
  });

  test("the frameless settings paints its own background, which Herdr's frame drew", () => {
    const settings = generateSquare().mods["vjr-square-settings"]?.["main.js"] ?? "";
    expect(meta(generateSquare(), "settings").overlay.frame).toBe("none");
    expect(settings).toMatch(/\.id\("settings"\)\.bg\(t\.popover\)/);
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
    const menu = [
      'export default class Mod { render() {',
      '        ["Close", "tab.close", { id: tg.id }],',
      '    const icon = command === "worktree" ? "git-branch" : "terminal";',
      'function menuIcon(command) {',
      'function shortcut(name, args) {',
      '        ["Close", "space.close", { id: tg.id }],',
      "    closeOverlay(props()?.overlay);",
      '  const name = command.endsWith(".close") ? "x" : "terminal";',
      '    if (it[1] === "worktree") tree();',
      '    return v_flex().bg(t.popover).rounded(7); } }',
    ].join("\n");
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

  test("both layouts put Move to folder… in the space menu, before Close", () => {
    for (const [generated, copy] of [
      [generateDesk(), "vjr-menu"],
      [generateSquare(), "vjr-square-menu"],
    ] as const) {
      const menu = generated.mods[copy]?.["main.js"] ?? "";
      expect(menu).toContain('        ...(p.folder ? [["Move to folder…", "spaces-folder", p.folder]] : []),\n        ["Close", "space.close", { id: tg.id }],');
      expect(menu).toContain('  if (command === "spaces-folder") return "mods/workspace-chrome/folder.svg";\n  const name = command.endsWith(".close")');
    }
  });

  test("the menu opens each layout's own folders popup, frameless in the square layout", () => {
    expect(generateDesk().mods["vjr-menu"]?.["main.js"]).toContain(
      '    closeOverlay(props()?.overlay);\n    if (it[1] === "spaces-folder") return openOverlay({ mod: "vjr-spaces-tree", kind: "popup", width: 240, height: it[2].height, props: { ...it[2], role: "folders" } });',
    );
    expect(generateSquare().mods["vjr-square-menu"]?.["main.js"]).toContain('openOverlay({ mod: "vjr-square-spaces-tree", kind: "popup", frame: "none", width: 240,');
  });

  test("the tree opens its own folder popups, frameless and bordered in the square layout", () => {
    const desk = generateDesk().mods["vjr-spaces-tree"] ?? {};
    expect(desk["main.js"]).toContain('openOverlay({ mod: "vjr-spaces-tree", kind: "popup", width: FOLDER_MENU.width');
    expect(desk["popups.js"]).toContain('openOverlay({ mod: "vjr-spaces-tree", kind: "dialog", width: NAME_DIALOG.width');
    const square = generateSquare().mods["vjr-square-spaces-tree"] ?? {};
    expect(square["main.js"]).toContain('openOverlay({ mod: "vjr-square-spaces-tree", kind: "popup", frame: "none",');
    expect(square["popups.js"]).toContain('openOverlay({ mod: "vjr-square-spaces-tree", kind: "dialog", frame: "none",');
    expect(square["popups.js"]?.split(".bg(t.popover).border_1().border_color(t.border)")).toHaveLength(4);
    expect(square["popups.js"]).not.toMatch(/\.rounded(_[a-z]+)?\((?!0\))/);
  });

  test("a menu without the space case fails the recipe", () => {
    expect(() => generateDesk({ "mods/menu/main.js": "export default class Mod { render() { return div(); } }" })).toThrow(/recipe spaces-tree/);
  });
});

describe("comeback", () => {
  test("both layouts float the comeback copy", () => {
    for (const [generated, copy] of [
      [generateDesk(), "vjr-comeback"],
      [generateSquare(), "vjr-square-comeback"],
    ] as const) {
      const floating = JSON.parse(generated.layoutText).floating;
      expect(floating).toContainEqual({ id: "comeback", content: { mod: copy }, edge: "left", align: "end" });
      expect(floating.at(-1).id).toBe("vjr-sync");
      expect(generated.mods[copy]?.["logic.js"]).toContain("export function planPass");
    }
  });
});

describe("markdown viewer", () => {
  test("both layouts install the viewer without placing it", () => {
    for (const [generated, copy] of [
      [generateDesk(), "vjr-markdown"],
      [generateSquare(), "vjr-square-markdown"],
    ] as const) {
      expect(Object.keys(generated.mods[copy] ?? {}).sort()).toEqual(["kit.js", "logic.js", "main.js", "mod.json"]);
      expect(modsIn(JSON.parse(generated.layoutText))).not.toContain(copy);
    }
  });

  test("the square copy squares the viewer's buttons", () => {
    expect(generateDesk().mods["vjr-markdown"]?.["kit.js"]).toContain(".rounded(RADIUS.control)");
    const squared = generateSquare().mods["vjr-square-markdown"]?.["kit.js"] ?? "";
    expect(squared).toContain(".rounded(0)");
    expect(squared).not.toContain(".rounded(RADIUS");
  });
});

describe("move-tab", () => {
  test("both layouts put Move to… in the tab menu", () => {
    for (const [generated, copy] of [
      [generateDesk(), "vjr-menu"],
      [generateSquare(), "vjr-square-menu"],
    ] as const) {
      const menu = generated.mods[copy]?.["main.js"] ?? "";
      expect(menu).toContain('["Move to…", "move-tab", { tab: tg.id, space: tg.space }],\n        ["Close", "tab.close", { id: tg.id }],');
      expect(menu).toContain('command === "worktree" || command === "move-tab" ? "git-branch"');
    }
  });

  test("the menu opens the layout's own popup", () => {
    expect(generateDesk().mods["vjr-menu"]?.["main.js"]).toContain('if (it[1] === "move-tab") openOverlay({ mod: "vjr-move-tab", kind: "popup", width: 300, height: 320, props: it[2] });\n    else if (it[1] === "worktree")');
    expect(generateSquare().mods["vjr-square-menu"]?.["main.js"]).toContain('if (it[1] === "move-tab") openOverlay({ mod: "vjr-square-move-tab", kind: "popup", frame: "none", width: 300, height: 320, props: it[2] });');
  });

  test("both layouts float the worker", () => {
    for (const [generated, copy] of [
      [generateDesk(), "vjr-move-tab"],
      [generateSquare(), "vjr-square-move-tab"],
    ] as const) {
      expect(JSON.parse(generated.layoutText).floating).toContainEqual({ id: "move-tab", content: { mod: copy, props: { role: "worker" } }, edge: "left", align: "end" });
    }
  });

  test("both layouts install the script that schedules a move", () => {
    const script = readFileSync(join(import.meta.dir, "../mods/move-tab/schedule.sh"), "utf8");
    expect(generateDesk().mods["vjr-move-tab"]?.["schedule.sh"]).toBe(script);
    expect(generateSquare().mods["vjr-square-move-tab"]?.["schedule.sh"]).toBe(script);
  });

  test("the square popup has a border", () => {
    expect(generateSquare().mods["vjr-square-move-tab"]?.["main.js"]).toContain(".bg(t.popover).border_1().border_color(t.border)");
  });

  test("cmd-shift-m opens each layout's own popup", () => {
    expect(generateDesk().keys).toEqual({ "cmd-shift-m": "mod.open:vjr-move-tab" });
    expect(generateSquare().keys).toEqual({ "cmd-shift-m": "mod.open:vjr-square-move-tab" });
  });

  test("the menu shows the key bound to the layout's own popup", () => {
    for (const [generated, menu, popup] of [
      [generateDesk(), "vjr-menu", "vjr-move-tab"],
      [generateSquare(), "vjr-square-menu", "vjr-square-move-tab"],
    ] as const) {
      const text = generated.mods[menu]?.["main.js"] ?? "";
      expect(text).toContain(`const MOVE_TAB = { name: "${popup}" };\n\nfunction menuIcon(command) {`);
      expect(text).toContain('function shortcut(name, args) {\n  if (name === "move-tab") return keys().find((b) => b.action === `mod.open:${MOVE_TAB.name}`)?.keys ?? "";\n');
    }
  });

  test("the key opens the popup at the menu's size, frameless in the square layout", () => {
    expect(JSON.parse(generateDesk().mods["vjr-move-tab"]?.["mod.json"] ?? "{}").overlay).toEqual({ kind: "popup", width: 300, height: 320 });
    expect(meta(generateSquare(), "move-tab").overlay).toEqual({ kind: "popup", width: 300, height: 320, frame: "none" });
  });

  test("a menu that changed fails the recipe", () => {
    const onlyFolders = ['        ["Close", "space.close", { id: tg.id }],', "    closeOverlay(props()?.overlay);", '  const name = command.endsWith(".close") ? "x" : "terminal";', ""].join("\n");
    expect(() => generateDesk({ "mods/menu/main.js": onlyFolders })).toThrow(/recipe move-tab/);
  });

  test("the tab bar starts a drag in both layouts", () => {
    for (const [generated, tabs] of [
      [generateDesk(), "vjr-tabs"],
      [generateSquare(), "vjr-square-tabs"],
    ] as const) {
      const text = generated.mods[tabs]?.["main.js"] ?? "";
      expect(text).toContain('import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings, setShared } from "herdr";');
      expect(text).toContain(
        '.on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i; this.from = e.position; setShared("move-tab.drag", { tab: c.id, space: space.id, at: Date.now() });',
      );
      expect(text).toContain('.on_mouse_up("left", () => { this.pressed = null; if (shared("move-tab.drag")) setShared("move-tab.drag", null); })');
    }
  });

  test("the tab bar marks a drag once the pointer moves 4 px, fades the dragged tab and outlines the tab it would land on", () => {
    for (const [generated, tabs] of [
      [generateDesk(), "vjr-tabs"],
      [generateSquare(), "vjr-square-tabs"],
    ] as const) {
      const text = generated.mods[tabs]?.["main.js"] ?? "";
      expect(text).toContain(
        '.on_mouse_move((e) => { const drag = shared("move-tab.drag"); if (this.pressed === null || !drag || drag.moving || !this.from) return; ' +
          'if (Math.hypot(e.position.x - this.from.x, e.position.y - this.from.y) > 4) setShared("move-tab.drag", { ...drag, moving: true }); })',
      );
      expect(text).toContain('.when(shared("move-tab.drag")?.moving === true && shared("move-tab.drag")?.tab === c.id, (el) => el.opacity(0.45))');
      expect(text).toContain('.when(shared("move-tab.drag")?.moving === true && shared("move-tab.drag")?.tab !== c.id && this.target === i, (el) => el.border_color(t.accent))');
      expect(text).toContain('.on_hover((on, cx) => { if (on) this.target = i; else if (this.target === i) this.target = null; if (shared("move-tab.drag")?.moving) cx.notify(); })');
      expect(text).toContain('.when(shared("move-tab.drag")?.tab != null && this.pressed !== null, (el) => el.cursor_grabbing())');
      const look = text.indexOf(".when(shared(\"move-tab.drag\")?.moving === true && shared(\"move-tab.drag\")?.tab === c.id");
      expect(look).toBeGreaterThan(-1);
      expect(look).toBeLessThan(text.indexOf("this.pressed = i; this.from = e.position;"));
    }
  });

  test("a tab reorders only while the bar's own drag is set", () => {
    for (const [generated, tabs] of [
      [generateDesk(), "vjr-tabs"],
      [generateSquare(), "vjr-square-tabs"],
    ] as const) {
      const text = generated.mods[tabs]?.["main.js"] ?? "";
      expect(text).toContain('const from = shared("move-tab.drag") ? this.pressed : null; this.pressed = null;');
      expect(text).not.toContain("const from = this.pressed;");
    }
  });

  test("a tab bar that changed fails the move-tab recipe", () => {
    const home = tempDir();
    makeHerdrHome(home);
    const tabs = readFileSync(join(home, "mods/tabs/main.js"), "utf8");
    for (const anchor of [
      'import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";',
      '.on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i;',
      '.on_mouse_up("left", () => { this.pressed = null; })',
      "const from = this.pressed; this.pressed = null;",
    ]) {
      expect(tabs).toContain(anchor);
      expect(() => generateDesk({ "mods/tabs/main.js": tabs.replace(anchor, "") })).toThrow(/recipe move-tab:/);
    }
  });
});

describe("command center", () => {
  test("both layouts add the hidden column after the panel and float the watcher", () => {
    for (const [generated, copy] of [
      [generateDesk(), "vjr-command-center"],
      [generateSquare(), "vjr-square-command-center"],
    ] as const) {
      const layout = JSON.parse(generated.layoutText);
      const body = findNode(layout, "work-body");
      expect(body?.children.map((node: { id: string }) => node.id)).toEqual(["main", "panel", "command-center"]);
      expect(body?.children[2]).toEqual({ id: "command-center", type: "block", size: { px: 380 }, hidden: true, content: { mod: copy } });
      expect(layout.floating).toContainEqual({ id: "command-center-watch", content: { mod: copy, props: { role: "watch", bun: "/bin/bun" } }, edge: "left", align: "end" });
      expect(layout.floating.at(-1).id).toBe("vjr-sync");
      expect(Object.keys(generated.mods[copy] ?? {}).sort()).toEqual(["column.js", "flow-pp.js", "kit.js", "lane-status.js", "logic.js", "main.js", "mod.json", "route.js", "start.js"]);
    }
  });

  test("a pp-stack folder goes to the watcher's props in both layouts", () => {
    for (const [generated, copy] of [
      [generate("vjr-desk", {}, { ppStack: "/dev/pp-stack" }), "vjr-command-center"],
      [generate("vjr-desk-square", {}, { ppStack: "/dev/pp-stack" }), "vjr-square-command-center"],
    ] as const) {
      const layout = JSON.parse(generated.layoutText);
      expect(layout.floating).toContainEqual({ id: "command-center-watch", content: { mod: copy, props: { role: "watch", bun: "/bin/bun", ppStack: "/dev/pp-stack" } }, edge: "left", align: "end" });
    }
  });

  test("the column opens VJR-TASK.md in each layout's own markdown viewer", () => {
    expect(generateDesk().mods["vjr-command-center"]?.["main.js"]).toContain('mod: "vjr-markdown", props: { file:');
    expect(generateSquare().mods["vjr-square-command-center"]?.["main.js"]).toContain('mod: "vjr-square-markdown", props: { file:');
  });

  test("the profile popup keeps Herdr's frame in vjr-desk and draws a square one in vjr-desk-square", () => {
    const desk = generateDesk().mods["vjr-command-center"] ?? {};
    const square = generateSquare().mods["vjr-square-command-center"] ?? {};
    expect(desk["main.js"]).toContain('openOverlay({ mod: "vjr-command-center", kind: "popup", at: "pointer"');
    expect(desk["column.js"]).not.toContain(".bg(t.popover).border_1()");
    expect(square["main.js"]).toContain('openOverlay({ mod: "vjr-square-command-center", kind: "popup", frame: "none", at: "pointer"');
    expect(square["column.js"]).toContain(".bg(t.popover).border_1().border_color(t.border)");
  });

  test("the tab bar toggles the column right after the + button", () => {
    for (const [generated, tabs] of [
      [generateDesk(), "vjr-tabs"],
      [generateSquare(), "vjr-square-tabs"],
    ] as const) {
      const text = generated.mods[tabs]?.["main.js"] ?? "";
      expect(text).toContain('run("layout.toggle", { id: "command-center" })');
      expect(text).toContain('.child("Command Center")');
      expect(text).toContain('shared("command-center.badge")');
      expect(text.indexOf('button("tab-new"')).toBeLessThan(text.indexOf('.child("Command Center")'));
      expect(text.indexOf('.child("Command Center")')).toBeLessThan(text.indexOf('panelButton("files"'));
    }
  });

  test("the square tab bar button has square corners", () => {
    const text = generateSquare().mods["vjr-square-tabs"]?.["main.js"] ?? "";
    const button = text.slice(text.indexOf('id("command-center-toggle")'), text.indexOf('.child("Command Center")'));
    expect(button).toContain("items_center()");
    expect(button).not.toMatch(/\.rounded\([1-9]/);
    expect(generateDesk().mods["vjr-tabs"]?.["main.js"]).toContain('id("command-center-toggle").h(26).px(8).gap(5).flex_none().items_center().rounded(6)');
  });

  test("the watcher's own name and its overlays are rewired to the copy", () => {
    const main = generateSquare().mods["vjr-square-command-center"]?.["main.js"] ?? "";
    expect(main).toContain('const SELF = { name: "vjr-square-command-center" };');
    expect(main).toContain('mod: "vjr-square-command-center"');
  });
});

function tabBar(store: Record<string, string> = {}) {
  const runs: [string, unknown][] = [];
  const storage = new Map(Object.entries(store));
  const localStorage = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) };
  const make = new Function("run", "localStorage", `return class { constructor() { ${MEMORY} } ${SYNC} }`);
  const Bar = make((name: string, args: unknown) => runs.push([name, args]), localStorage);
  return { bar: new Bar(), runs, storage };
}

describe("command center per space", () => {
  test("each space reopens the column the way it left it", () => {
    const { bar, runs } = tabBar();
    bar.syncCommandCenter({ id: "a" }, { hidden: true });
    bar.syncCommandCenter({ id: "a" }, { hidden: false });
    bar.syncCommandCenter({ id: "b" }, { hidden: false });
    expect(runs).toEqual([["layout.hide", { id: "command-center" }]]);
    bar.syncCommandCenter({ id: "b" }, { hidden: true });
    bar.syncCommandCenter({ id: "a" }, { hidden: true });
    expect(runs.at(-1)).toEqual(["layout.show", { id: "command-center" }]);
  });

  test("the first render keeps the column as it is and remembers it", () => {
    const { bar, runs, storage } = tabBar();
    bar.syncCommandCenter({ id: "a" }, { hidden: false });
    expect(runs).toEqual([]);
    expect(JSON.parse(storage.get("command-center") as string)).toEqual({ a: true });
  });

  test("a restore still landing is not taken as a choice", () => {
    const { bar, storage } = tabBar({ "command-center": JSON.stringify({ a: true, b: false }) });
    bar.syncCommandCenter({ id: "a" }, { hidden: false });
    bar.syncCommandCenter({ id: "b" }, { hidden: false });
    bar.syncCommandCenter({ id: "b" }, { hidden: false });
    expect(JSON.parse(storage.get("command-center") as string)).toEqual({ a: true, b: false });
  });

  test("the choice survives a restart", () => {
    const { bar, runs } = tabBar({ "command-center": JSON.stringify({ a: true }) });
    bar.syncCommandCenter({ id: "b" }, { hidden: true });
    bar.syncCommandCenter({ id: "a" }, { hidden: true });
    expect(runs).toEqual([["layout.show", { id: "command-center" }]]);
  });

  test("both tab bars load the memory, define the sync and call it on every render", () => {
    for (const [generated, tabs] of [
      [generateDesk(), "vjr-tabs"],
      [generateSquare(), "vjr-square-tabs"],
    ] as const) {
      const text = generated.mods[tabs]?.["main.js"] ?? "";
      expect(text).toContain(MEMORY);
      expect(text).toContain("syncCommandCenter(space, cc) {");
      expect(text).toContain('this.syncCommandCenter(space, find(root, "command-center"));');
    }
  });
});
