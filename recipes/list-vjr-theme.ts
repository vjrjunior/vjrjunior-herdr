import { type Copy, exact, type Recipe } from "./recipe";

export const listVjrTheme: Recipe = {
  name: "list-vjr-theme",
  mods: [
    { name: "palette", from: "frame" },
    { name: "workspace-status", from: "mods" },
  ],
  apply({ copies, replacements, variant }) {
    const palette = copies.palette as Copy;
    exact(palette, '...["graphite", "ink", "moss", "atom-one-dark"]', '...["vjr", "graphite", "ink", "moss", "atom-one-dark"]');
    exact(
      palette,
      'b.section === "global" && b.action === want',
      `(b.section === "global" || b.section === "layout:${variant.layout}") && b.action === want`,
    );
    exact(copies["workspace-status"] as Copy, 'run("app.palette")', 'run("mod.open", { name: "palette" })');
    palette.meta.overlay = { kind: "popup", at: "top", offset: 60, width: 620, height: 410 };
    replacements["app.palette"] = "palette";
  },
};
