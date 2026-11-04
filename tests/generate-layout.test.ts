import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { type Copy, exact, pattern, type Recipe, RecipeError, type Variant } from "../recipes/recipe";
import { generateVariant } from "../scripts/generate-layout";
import { removeTempDirs, tempDir } from "./helpers";
import { makeHerdrHome } from "./herdr-home";

afterEach(removeTempDirs);

const recipe: Recipe = {
  name: "sample",
  mods: [
    { name: "tabs", from: "mods" },
    { name: "menu", from: "mods" },
    { name: "new-menu", from: "mods" },
    { name: "picker", from: "mods" },
    { name: "pane", from: "mods" },
    { name: "workspace-chrome", from: "mods" },
    { name: "palette", from: "frame" },
    { name: "git-graph", from: "repo" },
  ],
  apply(context) {
    context.replacements["app.palette"] = "palette";
  },
};

const withKit: Recipe = { name: "kit", mods: [{ name: "kit", from: "repo" }], apply() {} };
const userRecipe: Recipe = { name: "user", mods: [{ name: "user", from: "repo" }], apply() {} };

const broken: Recipe = {
  name: "broken",
  mods: [{ name: "tabs", from: "mods" }],
  apply(context) {
    exact(context.copies.tabs as Copy, "missing", "x");
  },
};

const variantWith = (...recipes: Recipe[]): Variant => ({ layout: "test-desk", prefix: "test-", preview: "layouts/test-desk.svg", recipes });

function setup(overrides: Record<string, string> = {}) {
  const home = tempDir();
  const repo = tempDir();
  makeHerdrHome(home, overrides);
  mkdirSync(join(repo, "mods/git-graph"), { recursive: true });
  writeFileSync(join(repo, "mods/git-graph/main.js"), "export default class Graph {}\n");
  writeFileSync(join(repo, "mods/git-graph/graph.js"), "export const graph = 1;\n");
  writeFileSync(join(repo, "mods/git-graph/mod.json"), '{ "place": "none" }\n');
  const kitImport = 'import { KIT } from "../../kit/kit.js";\n';
  mkdirSync(join(repo, "kit/icons"), { recursive: true });
  writeFileSync(join(repo, "kit/kit.js"), 'export const KIT = { name: "kit" };\n');
  writeFileSync(join(repo, "kit/icons/eye.svg"), '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n');
  for (const name of ["kit", "user"]) {
    mkdirSync(join(repo, "mods", name), { recursive: true });
    writeFileSync(join(repo, "mods", name, "main.js"), `${kitImport}export default class Mod {}\n`);
    writeFileSync(join(repo, "mods", name, "mod.json"), '{ "place": "none" }\n');
  }
  const generate = (variant = variantWith(recipe)) => generateVariant(variant, { home, version: "0.1.10", repo, bun: "/bin/bun" });
  return { home, repo, generate };
}

function modsIn(node: unknown): string[] {
  if (Array.isArray(node)) return node.flatMap(modsIn);
  if (node === null || typeof node !== "object") return [];
  return Object.entries(node).flatMap(([key, value]) => (key === "mod" && typeof value === "string" ? [value] : modsIn(value)));
}

const sample = (): Copy => ({ name: "sample", files: { "main.js": "alpha beta alpha" }, meta: {} });

describe("copies", () => {
  test("copies only js files and mod.json", () => {
    const generated = setup().generate();
    expect(Object.keys(generated.mods["test-tabs"] ?? {}).sort()).toEqual(["main.js", "mod.json"]);
  });

  test("reads frame screens from the frame folder", () => {
    const generated = setup().generate();
    expect(generated.mods["test-palette"]?.["main.js"]).toContain("Type a command");
  });

  test("reads repo sources from the repo's mods folder", () => {
    const generated = setup().generate();
    expect(generated.mods["test-git-graph"]?.["graph.js"]).toBeDefined();
  });

  test("records where each copy came from", () => {
    const generated = setup().generate();
    expect(JSON.parse(generated.mods["test-tabs"]?.["mod.json"] ?? "{}").cloned_from).toEqual({ name: "tabs", version: "0.1.10" });
  });

  test("names the mod when a source is missing", () => {
    const { home, generate } = setup();
    rmSync(join(home, "mods/tabs"), { recursive: true });
    expect(() => generate()).toThrow(/tabs/);
  });
});

describe("the kit", () => {
  const modsOf = (...recipes: Recipe[]) => setup().generate(variantWith(...recipes)).mods;

  test("a repo mod that imports the kit gets its own copy of it", () => {
    const mods = modsOf(withKit, userRecipe);
    expect(mods["test-user"]?.["main.js"]).toContain('from "./kit.js"');
    expect(mods["test-user"]?.["main.js"]).not.toContain("../../kit/kit.js");
    expect(mods["test-user"]?.["kit.js"]).toContain('{ name: "test-kit" }');
  });

  test("the kit mod carries the icons", () => {
    expect(modsOf(withKit, userRecipe)["test-kit"]?.["icons/eye.svg"]).toContain("<svg");
  });

  test("a mod without the kit import gets no kit", () => {
    expect(modsOf(withKit, userRecipe, recipe)["test-git-graph"]?.["kit.js"]).toBeUndefined();
  });

  test("a mod that uses the kit in a layout without the kit refuses", () => {
    expect(() => setup().generate(variantWith(userRecipe))).toThrow("user uses the kit, but test-desk has no kit");
  });

  test("a single-quoted kit import is rewritten too", () => {
    const { repo, generate } = setup();
    writeFileSync(join(repo, "mods/user/main.js"), "import { KIT } from '../../kit/kit.js';\nexport default class Mod {}\n");
    const mods = generate(variantWith(withKit, userRecipe)).mods;
    expect(mods["test-user"]?.["main.js"]).toContain("from './kit.js'");
    expect(mods["test-user"]?.["main.js"]).not.toContain("kit/kit.js");
    expect(mods["test-user"]?.["kit.js"]).toContain("test-kit");
  });

  test("a kit import by another path refuses", () => {
    const { repo, generate } = setup();
    writeFileSync(join(repo, "mods/user/main.js"), 'import { KIT } from "../kit/kit.js";\nexport default class Mod {}\n');
    expect(() => generate(variantWith(withKit, userRecipe))).toThrow('import the kit as "../../kit/kit.js"');
  });
});

describe("exact and pattern", () => {
  test("exact replaces the expected occurrences", () => {
    const copy = sample();
    exact(copy, "alpha", "gamma", 2);
    expect(copy.files["main.js"]).toBe("gamma beta gamma");
  });

  test("exact keeps dollar signs in the replacement", () => {
    const copy = sample();
    exact(copy, "beta", "$&", 1);
    expect(copy.files["main.js"]).toBe("alpha $& alpha");
  });

  test("exact throws when the count differs", () => {
    expect(() => exact(sample(), "missing", "x")).toThrow(RecipeError);
  });

  test("pattern returns how many matches it replaced", () => {
    const copy = sample();
    expect(pattern([copy], /alpha/g, "x")).toBe(2);
    expect(copy.files["main.js"]).toBe("x beta x");
  });

  test("pattern throws below the minimum", () => {
    expect(() => pattern([sample()], /missing/g, "x", 1)).toThrow(RecipeError);
  });

  test("pattern without a minimum accepts no matches", () => {
    expect(pattern([sample()], /missing/g, "x")).toBe(0);
  });
});

describe("references", () => {
  test("rewires mod and name references to the copies", () => {
    const generated = setup().generate();
    expect(generated.mods["test-tabs"]?.["main.js"]).toContain('mod: "test-menu"');
    expect(generated.mods["test-workspace-chrome"]?.["main.js"]).toContain('{ name: "test-picker" }');
  });

  test("keeps references to mods without a copy", () => {
    const generated = setup().generate();
    expect(generated.mods["test-palette"]?.["main.js"]).toContain('mod: "prompt"');
    expect(generated.mods["test-workspace-chrome"]?.["main.js"]).toContain('{ name: "machine-add" }');
  });

  test("ignores names inherited from Object", () => {
    const { generate } = setup({ "mods/tabs/main.js": 'run({ name: "constructor" })' });
    expect(generate().mods["test-tabs"]?.["main.js"]).toContain('{ name: "constructor" }');
  });

  test("fails on a reference written in another quote style", () => {
    const { generate } = setup({ "mods/tabs/main.js": "openOverlay({ mod: 'menu' })" });
    expect(() => generate()).toThrow(/menu/);
  });

  test("names the recipe in a failure", () => {
    expect(() => setup().generate(variantWith(broken))).toThrow(/recipe broken:/);
  });

  test("translates replacements to the copy names", () => {
    expect(setup().generate().replacements).toEqual({ "app.palette": "mod.open:test-palette" });
  });
});

describe("layout", () => {
  test("adds the theme, preview, source version and sync block to the layout", () => {
    const { repo, generate } = setup();
    const layout = JSON.parse(generate().layoutText);
    expect(layout.theme).toEqual({ light: "paper", dark: "vjr" });
    expect(layout.preview).toBe("layouts/test-desk.svg");
    expect(layout.cloned_from).toEqual({ name: "main", version: "0.1.10" });
    expect(layout.floating).toEqual([
      {
        id: "vjr-sync",
        content: { mod: "vjr-sync", props: { built: "0.1.10", repo, bun: "/bin/bun" } },
        edge: "right",
        align: "end",
      },
    ]);
  });

  test("points the layout at the copies, including the pane header", () => {
    const mods = modsIn(JSON.parse(setup().generate().layoutText));
    expect(mods).toContain("test-tabs");
    expect(mods).toContain("test-pane");
    expect(mods).not.toContain("tabs");
  });

  test("keeps shipped mods that have no copy", () => {
    expect(modsIn(JSON.parse(setup().generate().layoutText))).toContain("files");
  });

  test("rewires a terminal menu set by a recipe", () => {
    const withMenu: Recipe = {
      name: "terminal-menu",
      mods: [{ name: "menu", from: "mods" }],
      apply(context) {
        context.layout.terminal_menu = "menu";
      },
    };
    expect(JSON.parse(setup().generate(variantWith(withMenu)).layoutText).terminal_menu).toBe("test-menu");
  });

  test("leaves the installed main layout untouched", () => {
    const { home, generate } = setup();
    const before = readFileSync(join(home, "layouts/main.json"), "utf8");
    generate();
    expect(readFileSync(join(home, "layouts/main.json"), "utf8")).toBe(before);
  });

  test("a source read twice by two recipes is copied once", () => {
    const other: Recipe = { name: "other", mods: [{ name: "tabs", from: "mods" }], apply() {} };
    const generated = setup().generate(variantWith(recipe, other));
    expect(Object.keys(generated.mods).filter((name) => name === "test-tabs")).toHaveLength(1);
  });
});
