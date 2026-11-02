import type { LayoutNode, Recipe } from "./recipe";

export const comeback: Recipe = {
  name: "comeback",
  mods: [{ name: "comeback", from: "repo" }],
  apply({ layout }) {
    layout.floating = [...((layout.floating as LayoutNode[] | undefined) ?? []), { id: "comeback", content: { mod: "comeback" }, edge: "left", align: "end" }];
  },
};
