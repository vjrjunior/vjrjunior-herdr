import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { copyRepo, makeHomes, removeTempDirs, repo, run, tempDir } from "./helpers";
import { makeHerdrHome } from "./herdr-home";

afterEach(removeTempDirs);

const OURS = /^(mods\/vjr-|mods\/git-graph|layouts\/vjr-desk|keys\.json)/;

function allFiles(folder: string): string[] {
  return readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
    const path = join(folder, entry.name);
    return entry.isDirectory() ? allFiles(path) : [path];
  });
}

function snapshot(home: string): Record<string, string> {
  return Object.fromEntries(allFiles(home).map((path) => [relative(home, path), readFileSync(path, "utf8")]));
}

function mtimes(home: string): Record<string, number> {
  return Object.fromEntries(allFiles(home).map((path) => [relative(home, path), statSync(path).mtimeMs]));
}

function setup(root = copyRepo(), homes = makeHomes()) {
  const home = homes.herdrApp;
  makeHerdrHome(home);
  const fakeLog = join(homes.base, "fake-herdr-app.log");
  const env = { ...homes.env, PATH: `${join(repo, "tests/fixtures/fake-herdr-app")}:${homes.env.PATH}`, FAKE_HERDR_LOG: fakeLog };
  return {
    root,
    home,
    state: homes.state,
    apply: (args: string[] = [], extra: Record<string, string> = {}) => run(root, "layout.ts", ["apply", ...args], { ...env, ...extra }),
    uninstall: (extra: Record<string, string> = {}) => run(root, "layout.ts", ["uninstall"], { ...env, ...extra }),
    log: () => (existsSync(fakeLog) ? readFileSync(fakeLog, "utf8").trim().split("\n") : []),
    keys: () => JSON.parse(readFileSync(join(home, "keys.json"), "utf8")),
    record: () => JSON.parse(readFileSync(join(homes.state, "layout.json"), "utf8")),
    writeRecord: (record: unknown) => writeFileSync(join(homes.state, "layout.json"), JSON.stringify(record)),
    layout: (name: string) => JSON.parse(readFileSync(join(home, "layouts", `${name}.json`), "utf8")),
    syncProps(name: string) {
      return JSON.parse(readFileSync(join(home, "layouts", `${name}.json`), "utf8")).floating.at(-1).content.props;
    },
    modMeta: (name: string) => JSON.parse(readFileSync(join(home, "mods", name, "mod.json"), "utf8")),
    simulateAppFiles() {
      for (const name of readdirSync(join(home, "mods")).filter((entry) => /^(vjr-|git-graph)/.test(entry))) {
        writeFileSync(join(home, "mods", name, "gpui-kit.d.ts"), "declare const kit: unknown;\n");
        writeFileSync(join(home, "mods", name, "jsconfig.json"), "{}\n");
      }
    },
    installGitGraph(overrides: Record<string, string> = {}) {
      cpSync(join(root, "mods/git-graph"), join(home, "mods/git-graph"), { recursive: true });
      rmSync(join(home, "mods/git-graph/LICENSE"));
      for (const [file, text] of Object.entries(overrides)) writeFileSync(join(home, "mods/git-graph", file), text);
    },
  };
}

describe("apply", () => {
  test("installs the copies, the sync mod, Git Graph, the layouts and the previews", () => {
    const { home, apply } = setup();

    const result = apply();

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("applied");
    expect(readdirSync(join(home, "mods")).filter((name) => name.startsWith("vjr-"))).toHaveLength(21);
    expect(existsSync(join(home, "mods/git-graph/LICENSE"))).toBe(true);
    for (const file of ["vjr-desk.json", "vjr-desk-square.json", "vjr-desk.svg", "vjr-desk-square.svg"]) {
      expect(existsSync(join(home, "layouts", file))).toBe(true);
    }
  });

  test("stores absolute paths for the sync mod", () => {
    const { root, apply, syncProps } = setup();

    apply();

    expect(syncProps("vjr-desk")).toEqual({ built: "0.1.10", repo: root, bun: process.execPath });
  });

  test("writes the key sections", () => {
    const { apply, keys } = setup();

    apply();

    expect(keys()["layout:vjr-desk"]).toEqual({ "cmd-shift-p": "mod.open:vjr-palette" });
    expect(keys()["layout:vjr-desk-square"]["cmd-,"]).toBe("mod.open:vjr-square-settings");
    expect(keys()["layout:vjr-desk-square"]["cmd-/"]).toBe("mod.open:vjr-square-help");
    expect(keys()["layout:vjr-desk-square"]["cmd-p"]).toBe("mod.open:vjr-square-picker");
  });

  test("keeps the rest of keys.json", () => {
    const { apply, keys } = setup();
    const before = keys();

    apply();

    expect(keys().global).toEqual(before.global);
    expect(keys().terminal).toEqual(before.terminal);
  });

  test("creates only our sections on a home without keys.json", () => {
    const { home, apply, keys } = setup();
    rmSync(join(home, "keys.json"));

    expect(apply().code).toBe(0);

    expect(Object.keys(keys()).sort()).toEqual(["layout:vjr-desk", "layout:vjr-desk-square"]);
  });

  test("never touches shipped files or layout state", () => {
    const { home, apply } = setup();
    mkdirSync(join(home, "layouts/.state"));
    writeFileSync(join(home, "layouts/.state/main.json"), "{}\n");
    const shipped = (files: Record<string, string>) => Object.fromEntries(Object.entries(files).filter(([path]) => !OURS.test(path)));
    const before = shipped(snapshot(home));

    apply();

    expect(shipped(snapshot(home))).toEqual(before);
  });

  test("uses the version passed by the sync mod", () => {
    const { apply, syncProps } = setup();

    apply(["--herdr-version", "9.9.9"]);

    expect(syncProps("vjr-desk").built).toBe("9.9.9");
  });

  test("reads the version from the installed app otherwise", () => {
    const { apply, syncProps } = setup();

    apply([], { FAKE_HERDR_VERSION: "1.2.3" });

    expect(syncProps("vjr-desk-square").built).toBe("1.2.3");
  });

  test("checks every mod it installs", () => {
    const { apply, log } = setup();

    apply();

    expect(log().filter((line) => line.startsWith("check "))).toHaveLength(22);
  });

  test("records what it created", () => {
    const { apply, record } = setup();

    apply();

    expect(record().version).toBe("0.1.10");
    expect(record().mods).toHaveLength(22);
    expect(record().kept).toEqual([]);
    expect(record().files.sort()).toEqual(["layouts/vjr-desk-square.json", "layouts/vjr-desk-square.svg", "layouts/vjr-desk.json", "layouts/vjr-desk.svg"]);
    expect(record().sections).toEqual(["layout:vjr-desk", "layout:vjr-desk-square"]);
  });

  test("a second run with nothing changed writes nothing", () => {
    const { home, apply, log, simulateAppFiles } = setup();
    apply();
    simulateAppFiles();
    const before = mtimes(home);
    const checks = log().filter((line) => line.startsWith("check ")).length;

    const result = apply();

    expect(result.stdout).toContain("unchanged");
    expect(mtimes(home)).toEqual(before);
    expect(log().filter((line) => line.startsWith("check "))).toHaveLength(checks);
  });

  test("a new app version regenerates the copies", () => {
    const { apply, modMeta, syncProps } = setup();
    apply();

    expect(apply(["--herdr-version", "0.1.11"]).stdout).toContain("applied");

    expect(modMeta("vjr-square-tabs").cloned_from.version).toBe("0.1.11");
    expect(syncProps("vjr-desk-square").built).toBe("0.1.11");
  });

  test("a change in a shipped mod reaches its copy", () => {
    const { home, apply } = setup();
    apply();
    const path = join(home, "mods/spaces/main.js");
    writeFileSync(path, `${readFileSync(path, "utf8")}\nexport const fixed = true;\n`);

    apply();

    expect(readFileSync(join(home, "mods/vjr-square-spaces/main.js"), "utf8")).toContain("fixed = true");
  });

  test("replaced copies lose the files the old version had", () => {
    const { home, apply, simulateAppFiles } = setup();
    apply();
    simulateAppFiles();
    writeFileSync(join(home, "mods/vjr-tabs/stale.js"), "export {};\n");

    apply();

    expect(existsSync(join(home, "mods/vjr-tabs/stale.js"))).toBe(false);
  });

  test("a mod no recipe generates anymore disappears on the next run", () => {
    const { home, apply, record, writeRecord } = setup();
    apply();
    mkdirSync(join(home, "mods/vjr-old"));
    writeRecord({ ...record(), mods: [...record().mods, "vjr-old"] });

    apply();

    expect(existsSync(join(home, "mods/vjr-old"))).toBe(false);
    expect(record().mods).not.toContain("vjr-old");
  });

  test("adopts an identical git-graph without writing to it", () => {
    const { home, apply, record, installGitGraph } = setup();
    installGitGraph();
    const before = mtimes(join(home, "mods/git-graph"));

    expect(apply().code).toBe(0);

    expect(mtimes(join(home, "mods/git-graph"))).toEqual(before);
    expect(record().kept).toEqual(["git-graph"]);
    expect(record().mods).not.toContain("git-graph");
  });

  test("stops on a different git-graph that is not ours", () => {
    const { home, apply, installGitGraph } = setup();
    installGitGraph({ "main.js": "changed" });

    const result = apply();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not created by this repo");
    expect(readFileSync(join(home, "mods/git-graph/main.js"), "utf8")).toBe("changed");
    expect(existsSync(join(home, "mods/vjr-sync"))).toBe(false);
  });

  test("works when the home and the repo have spaces in their paths", () => {
    const base = join(tempDir(), "with space");
    const root = join(base, "the repo");
    mkdirSync(base);
    cpSync(copyRepo(), root, { recursive: true });
    const homes = makeHomes();
    const home = join(base, "the home");
    mkdirSync(home);
    homes.herdrApp = home;
    homes.env.HERDR_APP_HOME = home;
    const { apply, syncProps } = setup(root, homes);

    expect(apply().code).toBe(0);

    expect(syncProps("vjr-desk").repo).toBe(root);
  });

  test("warns about shipped mods with corners that no recipe covers", () => {
    const { home, apply } = setup();
    const installed = JSON.parse(readFileSync(join(home, "installed.json"), "utf8"));
    makeHerdrHome(home, {
      "mods/brand-new/main.js": "x.rounded(4)\n",
      "mods/prompt/main.js": "x.rounded(4)\n",
      "installed.json": JSON.stringify({ ...installed, "brand-new": {}, prompt: {} }),
    });

    const result = apply();

    expect(result.stderr).toContain("brand-new");
    expect(result.stderr).not.toContain("prompt");
  });

  test("stops when the theme is not installed", () => {
    const { home, apply } = setup();
    rmSync(join(home, "themes/vjr.json"));

    const result = apply();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("install-theme");
  });
});
