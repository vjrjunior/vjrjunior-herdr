import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { copyRepo, editFile, makeHomes, removeTempDirs, repo, run } from "./helpers";

afterEach(removeTempDirs);

function build(root: string) {
  return run(root, "build.ts", [], makeHomes().env);
}

function seedOutputs(root: string): void {
  mkdirSync(join(root, "themes"), { recursive: true });
  mkdirSync(join(root, "targets/ghostty"), { recursive: true });
  writeFileSync(join(root, "themes/vjr.json"), "previous herdr-app theme\n");
  writeFileSync(join(root, "targets/ghostty/VJR"), "previous ghostty theme\n");
}

function expectOutputsUntouched(root: string): void {
  expect(readFileSync(join(root, "themes/vjr.json"), "utf8")).toBe("previous herdr-app theme\n");
  expect(readFileSync(join(root, "targets/ghostty/VJR"), "utf8")).toBe("previous ghostty theme\n");
}

describe("herdr-app theme", () => {
  test("maps every palette role to its herdr-app color", () => {
    const root = copyRepo();

    expect(build(root).code).toBe(0);

    expect(JSON.parse(readFileSync(join(root, "themes/vjr.json"), "utf8"))).toEqual({
      background: "#101010",
      foreground: "#DBDBDB",
      selection: "#332B24",
      cursor: "#FFC799",
      ansi: [
        "#101010", "#FF8080", "#99FFE4", "#FFC799", "#A0A0A0", "#FFCFA8", "#99FFE4", "#FFFFFF",
        "#505050", "#FF9D9D", "#B3FFEC", "#FFCFA8", "#C0C0C0", "#FFDCC0", "#B3FFEC", "#FFFFFF",
      ],
      colors: {
        background: "#101010",
        canvas: "#101010",
        chrome: "#101010",
        surface: "#161616",
        popover: "#161616",
        raised: "#1C1C1C",
        hover: "#282828",
        selected: "#232323",
        border: "#232323",
        input: "#343434",
        foreground: "#FFFFFF",
        muted: "#A0A0A0",
        dim: "#505050",
        accent: "#FFC799",
        accent_foreground: "#101010",
        solid: "#FFC799",
        solid_foreground: "#101010",
        selection: "#332B24",
        working: "#FFC799",
        blocked: "#FF8080",
        done: "#99FFE4",
        idle: "#505050",
        unknown: "#707070",
      },
    });
  });
});

describe("derived tones", () => {
  test("selection and search follow the accent in both outputs", () => {
    const root = copyRepo();
    editFile(join(root, "palette/vjr.toml"), 'base = "#FFC799"', 'base = "#FF0000"');

    expect(build(root).code).toBe(0);

    const theme = JSON.parse(readFileSync(join(root, "themes/vjr.json"), "utf8"));
    const ghostty = readFileSync(join(root, "targets/ghostty/VJR"), "utf8");
    expect(theme.selection).toBe("#330E0E");
    expect(theme.colors.selection).toBe("#330E0E");
    expect(ghostty).toContain("selection-background = #330E0E\n");
    expect(ghostty).toContain("search-background = #4C0C0C\n");
    expect(ghostty).toContain("search-selected-background = #FF0000\n");
  });
});

describe("palette validation", () => {
  test("a missing role exits 1, names the role and writes nothing", () => {
    const root = copyRepo();
    seedOutputs(root);
    editFile(join(root, "palette/vjr.toml"), 'bright = "#C0C0C0"\n', "");

    const result = build(root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("gray.bright");
    expectOutputsUntouched(root);
  });

  test("a malformed hex exits 1, names the role and the value, and writes nothing", () => {
    const root = copyRepo();
    seedOutputs(root);
    editFile(join(root, "palette/vjr.toml"), 'base = "#FFC799"', 'base = "#FFC79"');

    const result = build(root);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("peach.base");
    expect(result.stderr).toContain("#FFC79");
    expectOutputsUntouched(root);
  });

  test("broken TOML fails without writing", () => {
    const root = copyRepo();
    seedOutputs(root);
    editFile(join(root, "palette/vjr.toml"), 'base = "#FFC799"', 'base = "#FFC799');

    expect(build(root).code).not.toBe(0);
    expectOutputsUntouched(root);
  });
});

describe("repeat runs", () => {
  test("building twice gives the same bytes and writes nothing outside the repo", () => {
    const root = copyRepo();
    const homes = makeHomes();

    run(root, "build.ts", [], homes.env);
    const first = [readFileSync(join(root, "themes/vjr.json")), readFileSync(join(root, "targets/ghostty/VJR"))];
    run(root, "build.ts", [], homes.env);
    const second = [readFileSync(join(root, "themes/vjr.json")), readFileSync(join(root, "targets/ghostty/VJR"))];

    expect(second).toEqual(first);
    expect(readdirSync(join(homes.herdrApp, "themes"))).toEqual([]);
    expect(readdirSync(join(homes.ghostty, "themes"))).toEqual([]);
    expect(readdirSync(homes.base).sort()).toEqual(["config", "custom-herdr-app-home"]);
  });

  test("committed outputs are in sync with the palette", () => {
    const root = copyRepo();

    expect(build(root).code).toBe(0);

    expect(readFileSync(join(root, "themes/vjr.json"), "utf8")).toBe(readFileSync(join(repo, "themes/vjr.json"), "utf8"));
    expect(readFileSync(join(root, "targets/ghostty/VJR"), "utf8")).toBe(
      readFileSync(join(repo, "targets/ghostty/VJR"), "utf8"),
    );
  });
});
