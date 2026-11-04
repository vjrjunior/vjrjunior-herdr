import { type Copy, exact, type LayoutNode, type Recipe } from "./recipe";

const CLOSE = '        ["Close", "tab.close", { id: tg.id }],';
const CHOOSE = 'if (it[1] === "worktree")';
const ICON = 'command === "worktree" ? "git-branch"';
const MENU_ICON = "function menuIcon(command) {";
const SHORTCUT = "function shortcut(name, args) {";
const TABS_IMPORT = 'import { spaces, panes, run, openOverlay, theme, window, shared, layout, settings } from "herdr";';
const TAB_PRESS = '.on_mouse_down("left", (e, cx) => { cx.stop_propagation(); this.pressed = i;';
const BAR_RELEASE = '.on_mouse_up("left", () => { this.pressed = null; })';
const TAB_RELEASE = "const from = this.pressed; this.pressed = null;";
const LIFT_PX = 4;
const LIFTED_OPACITY = 0.45;
const DRAG = 'shared("move-tab.drag")';
const TAB_LOOK =
  `.when(${DRAG}?.moving === true && ${DRAG}?.tab === c.id, (el) => el.opacity(${LIFTED_OPACITY}))` +
  `.when(${DRAG}?.moving === true && ${DRAG}?.tab !== c.id && this.target === i, (el) => el.border_color(t.accent))` +
  `.on_hover((on, cx) => { if (on) this.target = i; else if (this.target === i) this.target = null; if (${DRAG}?.moving) cx.notify(); })`;
const BAR_MOVE =
  `.on_mouse_move((e) => { const drag = ${DRAG}; if (this.pressed === null || !drag || drag.moving || !this.from) return; ` +
  `if (Math.hypot(e.position.x - this.from.x, e.position.y - this.from.y) > ${LIFT_PX}) setShared("move-tab.drag", { ...drag, moving: true }); })`;

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
    exact(tabs, TAB_PRESS, `${TAB_LOOK}${TAB_PRESS} this.from = e.position; setShared("move-tab.drag", { tab: c.id, space: space.id, at: Date.now() });`);
    exact(tabs, BAR_RELEASE, `.on_mouse_up("left", () => { this.pressed = null; if (${DRAG}) setShared("move-tab.drag", null); })${BAR_MOVE}`);
    exact(tabs, TAB_RELEASE, 'const from = shared("move-tab.drag") ? this.pressed : null; this.pressed = null;');
    layout.floating = [...((layout.floating as LayoutNode[] | undefined) ?? []), { id: "move-tab", content: { mod: "move-tab", props: { role: "worker" } }, edge: "left", align: "end" }];
    keys["cmd-shift-m"] = "move-tab";
  },
};
