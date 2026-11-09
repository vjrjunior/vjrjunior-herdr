import { type Copy, exact, findNode, type LayoutNode, type Recipe } from "./recipe";

const SPACE_CLOSE = '        ["Close", "space.close", { id: tg.id }],';
const CHOSEN = "    closeOverlay(props()?.overlay);\n";
const ICON_NAME = '  const name = command.endsWith(".close")';
const MOVE_POPUP_WIDTH = 240;

export const spacesTree: Recipe = {
  name: "spaces-tree",
  mods: [
    { name: "spaces-tree", from: "repo" },
    { name: "menu", from: "mods" },
  ],
  apply({ copies, layout }) {
    (findNode(layout, "spaces").content as LayoutNode).mod = "spaces-tree";
    const menu = copies.menu as Copy;
    exact(menu, SPACE_CLOSE, `        ...(p.folder ? [["Move to folder…", "spaces-folder", p.folder]] : []),\n${SPACE_CLOSE}`);
    exact(
      menu,
      CHOSEN,
      `${CHOSEN}    if (it[1] === "spaces-folder") return openOverlay({ mod: "spaces-tree", kind: "popup", width: ${MOVE_POPUP_WIDTH}, height: it[2].height, props: { ...it[2], role: "folders" } });\n`,
    );
    exact(menu, ICON_NAME, `  if (command === "spaces-folder") return "mods/workspace-chrome/folder.svg";\n${ICON_NAME}`);
  },
};
