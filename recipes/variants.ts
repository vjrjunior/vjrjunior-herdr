import { comeback } from "./comeback";
import { commandCenter } from "./command-center";
import { gitGraphPanel } from "./git-graph-panel";
import { listVjrTheme } from "./list-vjr-theme";
import type { Variant } from "./recipe";
import { spacesTree } from "./spaces-tree";
import { square } from "./square";

export const VARIANTS: Variant[] = [
  { layout: "vjr-desk", prefix: "vjr-", preview: "layouts/vjr-desk.svg", recipes: [listVjrTheme, gitGraphPanel, spacesTree, comeback, commandCenter] },
  { layout: "vjr-desk-square", prefix: "vjr-square-", preview: "layouts/vjr-desk-square.svg", recipes: [listVjrTheme, gitGraphPanel, spacesTree, comeback, commandCenter, square] },
];

export const LEFT_ROUNDED = ["prompt", "confirm", "toast", "peek", "win98", "terminals-bar", "terminals-pane"];

export const REPLACED = ["spaces"];
