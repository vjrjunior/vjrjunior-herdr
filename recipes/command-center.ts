import { type Copy, exact, findNode, type LayoutNode, type Recipe } from "./recipe";

const FILES_BUTTON = '.when(enabled.includes("files"), el => el.child(panelButton("files", "Files", "mods/files/file.svg")))';

const TOGGLE = [
  '.child((() => { const cc = find(root, "command-center"), badge = shared("command-center.badge") ?? {}, on = Boolean(cc && !cc.hidden);',
  '        return h_flex().id("command-center-toggle").h(26).px(8).gap(5).flex_none().items_center()CORNERS',
  "          .text_size(12).bg(on ? t.selected : t.chrome).text_color(on ? t.foreground : t.muted)",
  '          .hover(s => s.bg(t.hover)).on_mouse_down("left", stop)',
  '          .on_click(() => run("layout.toggle", { id: "command-center" }))',
  '          .child(svg("mods/terminals-bar/command.svg").size(14)).child("Command Center")',
  "          .when(badge.count > 0, el => el.child(div().px(4).h(15).text_size(10).font_bold().text_color(t.chrome).bg(badge.level === \"bad\" ? t.blocked : t.working).child(String(badge.count)))); })())",
  "      .child(div().w(1).h(16).mx(4).bg(t.input))",
].join("\n");

const PANELS_MEMORY = '    this.panels = JSON.parse(localStorage.getItem("panels") ?? "{}");';
const RENDER = "  render() {\n    const t = theme();";
const PANEL_SYNC = "    this.syncPanel(space, panel, body, enabled);";

export const MEMORY = 'this.commandCenter = JSON.parse(localStorage.getItem("command-center") ?? "{}");';

export const SYNC = `syncCommandCenter(space, cc) {
    if (!space || !cc) return;
    const now = !cc.hidden;
    if (space.id !== this.ccSpace) {
      const first = this.ccSpace === undefined;
      this.ccSpace = space.id;
      this.ccPending = null;
      if (!(first && !(space.id in this.commandCenter))) {
        const want = this.commandCenter[space.id] === true;
        if (want !== now) {
          this.ccPending = { want, until: Date.now() + 1000 };
          run(want ? "layout.show" : "layout.hide", { id: "command-center" });
          return;
        }
      }
    }
    if (this.ccPending) {
      if (this.ccPending.want !== now && Date.now() < this.ccPending.until) return;
      this.ccPending = null;
    }
    if (this.commandCenter[space.id] === now) return;
    this.commandCenter[space.id] = now;
    localStorage.setItem("command-center", JSON.stringify(this.commandCenter));
  }`;

export const commandCenter: Recipe = {
  name: "command-center",
  mods: [
    { name: "command-center", from: "repo" },
    { name: "tabs", from: "mods" },
  ],
  apply({ copies, layout, variant }) {
    const corners = variant.recipes.some((recipe) => recipe.name === "square") ? "" : ".rounded(6)";
    exact(copies.tabs as Copy, FILES_BUTTON, `${TOGGLE.replace("CORNERS", corners)}\n      ${FILES_BUTTON}`);
    exact(copies.tabs as Copy, PANELS_MEMORY, `${PANELS_MEMORY}\n    ${MEMORY}`);
    exact(copies.tabs as Copy, RENDER, `  ${SYNC}\n\n${RENDER}`);
    exact(copies.tabs as Copy, PANEL_SYNC, `${PANEL_SYNC}\n    this.syncCommandCenter(space, find(root, "command-center"));`);
    (findNode(layout, "work-body").children as LayoutNode[]).push({ id: "command-center", type: "block", size: { px: 380 }, hidden: true, content: { mod: "command-center" } });
    layout.floating = [
      ...((layout.floating as LayoutNode[] | undefined) ?? []),
      { id: "command-center-watch", content: { mod: "command-center", props: { role: "watch" } }, edge: "left", align: "end" },
    ];
  },
};
