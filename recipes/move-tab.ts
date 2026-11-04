import { type Copy, exact, type LayoutNode, type Recipe } from "./recipe";

const CLOSE = '        ["Close", "tab.close", { id: tg.id }],';
const CHOOSE = 'if (it[1] === "worktree")';
const ICON = 'command === "worktree" ? "git-branch"';
const MENU_ICON = "function menuIcon(command) {";
const SHORTCUT = "function shortcut(name, args) {";
const TABS_IMPORT = 'import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";';
const TAB_PRESS = '.on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i;';
const BAR_RELEASE = '.on_mouse_up("left", () => { this.pressed = null; })';

export const moveTab: Recipe = {
  name: "move-tab",
  mods: [
    { name: "move-tab", from: "repo" },
    { name: "menu", from: "mods" },
    { name: "tabs", from: "mods" },
  ],
  apply({ copies, layout, keys }) {
    const menu = copies.menu as Copy;
    const tabs = copies.tabs as Copy;
    exact(menu, CLOSE, `        ["Move to…", "move-tab", { tab: tg.id, space: tg.space }],\n${CLOSE}`);
    exact(menu, CHOOSE, `if (it[1] === "move-tab") openOverlay({ mod: "move-tab", kind: "popup", width: 300, height: 320, props: it[2] });\n    else if (it[1] === "worktree")`);
    exact(menu, ICON, 'command === "worktree" || command === "move-tab" ? "git-branch"');
    exact(menu, MENU_ICON, `const MOVE_TAB = { name: "move-tab" };\n\n${MENU_ICON}`);
    exact(menu, SHORTCUT, `${SHORTCUT}\n  if (name === "move-tab") return keys().find((b) => b.action === \`mod.open:\${MOVE_TAB.name}\`)?.keys ?? "";`);
    exact(tabs, TABS_IMPORT, TABS_IMPORT.replace("settings }", "settings, setShared }"));
    exact(tabs, TAB_PRESS, `${TAB_PRESS} setShared("move-tab.drag", { tab: c.id, space: space.id, at: Date.now() });`);
    exact(tabs, BAR_RELEASE, '.on_mouse_up("left", () => { this.pressed = null; if (shared("move-tab.drag")) setShared("move-tab.drag", null); })');
    layout.floating = [...((layout.floating as LayoutNode[] | undefined) ?? []), { id: "move-tab", content: { mod: "move-tab", props: { role: "worker" } }, edge: "left", align: "end" }];
    keys["cmd-shift-m"] = "move-tab";
  },
};
