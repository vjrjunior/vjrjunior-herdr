import { findNode, type LayoutNode, type Recipe } from "./recipe";

export const spacesTree: Recipe = {
  name: "spaces-tree",
  mods: [{ name: "spaces-tree", from: "repo" }],
  apply({ layout }) {
    (findNode(layout, "spaces").content as LayoutNode).mod = "spaces-tree";
  },
};
