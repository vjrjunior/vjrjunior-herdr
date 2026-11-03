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

export const commandCenter: Recipe = {
  name: "command-center",
  mods: [
    { name: "command-center", from: "repo" },
    { name: "tabs", from: "mods" },
  ],
  apply({ copies, layout, variant }) {
    const corners = variant.recipes.some((recipe) => recipe.name === "square") ? "" : ".rounded(6)";
    exact(copies.tabs as Copy, FILES_BUTTON, `${TOGGLE.replace("CORNERS", corners)}\n      ${FILES_BUTTON}`);
    (findNode(layout, "work-body").children as LayoutNode[]).push({ id: "command-center", type: "block", size: { px: 380 }, hidden: true, content: { mod: "command-center" } });
    layout.floating = [
      ...((layout.floating as LayoutNode[] | undefined) ?? []),
      { id: "command-center-watch", content: { mod: "command-center", props: { role: "watch" } }, edge: "left", align: "end" },
    ];
  },
};
