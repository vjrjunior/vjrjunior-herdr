import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const script = (body: string) => `import { View } from "gpui-kit";\nexport default class Mod extends View {\n  render() {\n${body}\n  }\n}\n`;

const LAYOUT = {
  id: "root",
  type: "row",
  titlebar: "none",
  children: [
    {
      id: "sidebar",
      type: "column",
      children: [
        { id: "brand", type: "block", content: { mod: "workspace-chrome" } },
        { id: "spaces", type: "block", content: { mod: "spaces" } },
        { id: "agents", type: "block", content: { mod: "agents" } },
      ],
    },
    {
      id: "work",
      type: "column",
      children: [
        { id: "tabs", type: "block", content: { mod: "tabs" } },
        {
          id: "work-body",
          type: "row",
          children: [
            {
              id: "main",
              type: "block",
              content: { tab: "active", pane: { radius: 10, header: { content: { mod: "pane" }, height: 30 } } },
            },
            {
              id: "panel",
              type: "column",
              hidden: true,
              children: [
                {
                  id: "panel-body",
                  type: "stack",
                  active: "files",
                  children: [
                    { id: "files", type: "block", content: { mod: "files" } },
                    { id: "changes", type: "block", content: { mod: "changes" } },
                  ],
                },
              ],
            },
          ],
        },
        { id: "status", type: "block", content: { mod: "workspace-status" } },
      ],
    },
  ],
};

const SOURCES: Record<string, string> = {
  "mods/tabs/main.js": `import { View } from "gpui-kit";
export default class Tabs extends View {
  init() {
    this.pressed = null;
    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");
  }

  render() {
    const t = theme();
    this.syncPanel(space, panel, body, enabled);
    const enabled = shared("workspace.panels") ?? ["files", "changes"];
    const context = () => openOverlay({ mod: "menu", kind: "popup", width: 200, props: { tab: "tab" } });
    const add = () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 });
    return h_flex().rounded(7)
      .child(button("tab-new", "+", () => openOverlay({ mod: "new-menu", kind: "popup", width: 250, height: 512 })))
      .when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))
      .when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))
      .child(div().size(6).rounded(3));
  }
}
`,
  "mods/workspace-chrome/main.js": script(`    return div().rounded(6)
      .child(row("machine", () => run("mod.open", { name: "machine-add" })))
      .child(row("search", () => run("mod.open", { name: "picker" })))
      .child(row("settings", () => run("app.settings")))
      .child(div().size(6).rounded_full());`),
  "mods/spaces/main.js": script(`    const open = () => openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: {} });
    return div().rounded(8).child(status === "done" ? "●" : "·");`),
  "mods/agents/main.js": script(`    const sort = () => openOverlay({ mod: "agents", kind: "popup", width: 200, height: 140, props: { sortMenu: true } });
    return v_flex().bg(t.popover).rounded(8).child(div().rounded_bl(6));`),
  "mods/files/main.js": script("    return div().rounded(10);"),
  "mods/changes/main.js": script("    return div().rounded(10);"),
  "mods/workspace-status/main.js": script(`    return div().rounded(3).on_click(() => run("app.palette"));`),
  "mods/pane/main.js": script("    return div().rounded(4);"),
  "mods/menu/main.js": script(`    const tree = () => openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props: {} });
    if (it[1] === "worktree") tree();
    else run(it[1], it[2]);
    return v_flex().bg(t.popover).rounded(7);`),
  "mods/new-menu/main.js": script(`    const tree = () => openOverlay({ mod: "worktree", kind: "dialog", width: 460, height: 280, props: {} });
    return v_flex().bg(t.popover).rounded(7);`),
  "mods/picker/main.js": script(`    return v_flex().bg(t.popover).rounded(9).child(st === "idle" ? "○" : st ? "●" : "·");`),
  "mods/worktree/main.js": script(`    if (open) return v_flex().bg(t.popover).rounded(6);
    return v_flex().bg(t.popover).rounded(7);`),
  "mods/machine-add/main.js": script(`    return v_flex().bg(t.popover).rounded(8);`),
  "mods/help/main.js": script(`    return v_flex().bg(t.popover).rounded(9);`),
  "frame/palette/main.js": script(`    const placeholder = "Type a command…";
    const named = [
      ["mod.open", { name: "picker" }, "Tab", "Go to space or tab…", "switch"],
      ["app.settings", {}, "App", "Settings", "preferences"],
      ["app.help", {}, "App", "Keys", "keybindings"],
      ...["graphite", "ink", "moss", "atom-one-dark"].map((n) => ["app.theme", { name: n }]),
    ];
    const hidden = new Set([
      "app.palette", "app.hide", "app.show_all",
    ]);
    const bound = keys().find((b) => b.section === "global" && b.action === want);
    const clone = () => openOverlay({ mod: "prompt", kind: "dialog", width: 380, props: {} });
    return v_flex().bg(t.popover).rounded(9);`),
  "frame/settings/main.js": script(`    const add = () => run("mod.open", { name: "machine-add" });
    return h_flex().id("settings").rounded(8).bg(t.popover);`),
  "frame/settings/release-notes.js": "export const notes = () => div().rounded(4);\n",
};

const META: Record<string, Record<string, unknown>> = {
  picker: { place: "none", title: "Picker", overlay: { kind: "popup", at: "top", offset: 40, width: 640, height: 0.8 } },
  "machine-add": { place: "none", title: "Add a machine", overlay: { kind: "dialog", width: 560 } },
};

const FOLDERS = [...new Set(Object.keys(SOURCES).map(dirname))];

export const SHIPPED_MODS = FOLDERS.filter((folder) => folder.startsWith("mods/")).map((folder) => folder.slice("mods/".length));

function write(home: string, path: string, text: string): void {
  mkdirSync(dirname(join(home, path)), { recursive: true });
  writeFileSync(join(home, path), text);
}

export function makeHerdrHome(home: string, overrides: Record<string, string> = {}): void {
  write(home, "layouts/main.json", `${JSON.stringify(LAYOUT, null, 2)}\n`);
  for (const [path, text] of Object.entries(SOURCES)) write(home, path, text);
  for (const folder of FOLDERS) {
    const name = folder.split("/").at(-1) as string;
    write(home, `${folder}/mod.json`, `${JSON.stringify(META[name] ?? { place: "none" })}\n`);
    write(home, `${folder}/gpui-kit.d.ts`, "declare const kit: unknown;\n");
    write(home, `${folder}/jsconfig.json`, "{}\n");
  }
  write(home, "mods/tabs/win-close.svg", "<svg/>\n");
  write(home, "themes/vjr.json", "{}\n");
  write(
    home,
    "keys.json",
    `${JSON.stringify(
      {
        global: {
          "cmd-t": "tab.new",
          "cmd-p": "mod.open:picker",
          "cmd-shift-p": "app.palette",
          "cmd-,": "app.settings",
          "cmd-/": "app.help",
          "cmd-shift-/": "app.help",
        },
        terminal: { "alt-left": "send:\u001bb" },
      },
      null,
      2,
    )}\n`,
  );
  const installed = Object.fromEntries(SHIPPED_MODS.map((name) => [name, { "main.js": "hash" }]));
  write(home, "installed.json", `${JSON.stringify({ ...installed, "layout:main": { "main.json": "hash" } })}\n`);
  for (const [path, text] of Object.entries(overrides)) write(home, path, text);
}
