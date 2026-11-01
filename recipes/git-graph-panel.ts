import { type Copy, exact, findNode, type LayoutNode, type Recipe } from "./recipe";

const CHANGES_BUTTON = '.when(enabled.includes("changes"), el => el.child(panelButton("changes", "Changes", "mods/changes/changes.svg")))';

export const gitGraphPanel: Recipe = {
  name: "git-graph-panel",
  mods: [{ name: "tabs", from: "mods" }],
  apply({ copies, layout }) {
    const tabs = copies.tabs as Copy;
    exact(
      tabs,
      'const enabled = shared("workspace.panels") ?? ["files", "changes"];',
      'const enabled = [...(shared("workspace.panels") ?? ["files", "changes"]), "graph"];',
    );
    exact(tabs, CHANGES_BUTTON, `${CHANGES_BUTTON}\n      .child(panelButton("graph", "Graph", "mods/git-graph/icons/graph.svg"))`);
    const panel = findNode(layout, "panel-body");
    (panel.children as LayoutNode[]).push({ id: "graph", type: "block", content: { mod: "git-graph" } });
  },
};
