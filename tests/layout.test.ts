import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
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
    expect(readdirSync(join(home, "mods")).filter((name) => name.startsWith("vjr-"))).toHaveLength(30);
    expect(existsSync(join(home, "mods/git-graph/LICENSE"))).toBe(true);
    for (const file of ["vjr-desk.json", "vjr-desk-square.json", "vjr-desk.svg", "vjr-desk-square.svg"]) {
      expect(existsSync(join(home, "layouts", file))).toBe(true);
    }
  });

  test("apply installs the kit's icons in both layouts", () => {
    const { home, apply } = setup();

    apply();

    for (const name of ["vjr-kit", "vjr-square-kit"]) {
      expect(existsSync(join(home, "mods", name, "icons/eye.svg"))).toBe(true);
      expect(existsSync(join(home, "mods", name, "kit.js"))).toBe(true);
    }
    expect(existsSync(join(home, "mods/vjr-markdown/icons"))).toBe(false);
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

    expect(log().filter((line) => line.startsWith("check "))).toHaveLength(31);
  });

  test("records what it created", () => {
    const { apply, record } = setup();

    apply();

    expect(record().version).toBe("0.1.10");
    expect(record().mods).toHaveLength(31);
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
    const path = join(home, "mods/agents/main.js");
    writeFileSync(path, `${readFileSync(path, "utf8")}\nexport const fixed = true;\n`);

    apply();

    expect(readFileSync(join(home, "mods/vjr-square-agents/main.js"), "utf8")).toContain("fixed = true");
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
    expect(result.stderr).not.toContain("mods/spaces ");
  });

  test("stops when the theme is not installed", () => {
    const { home, apply } = setup();
    rmSync(join(home, "themes/vjr.json"));

    const result = apply();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("install-theme");
  });
});

describe("failures", () => {
  const ours = (home: string) => Object.fromEntries(Object.entries(snapshot(home)).filter(([path]) => OURS.test(path)));

  test("a recipe that no longer fits changes nothing", () => {
    const { home, apply } = setup();
    apply();
    const before = ours(home);
    writeFileSync(join(home, "frame/palette/main.js"), "changed");

    const result = apply(["--herdr-version", "0.1.11"]);

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("recipe list-vjr-theme:");
    expect(ours(home)).toEqual(before);
  });

  test("a failed check changes nothing and names the mod", () => {
    const { home, apply, syncProps } = setup();
    apply();
    const before = ours(home);

    const result = apply(["--herdr-version", "0.1.11"], { FAKE_HERDR_CHECK_FAIL: "vjr-square-tabs" });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("vjr-square-tabs");
    expect(ours(home)).toEqual(before);
    expect(syncProps("vjr-desk").built).toBe("0.1.10");
  });

  test("new errors after the swap restore the previous copies", () => {
    const { home, apply, modMeta, syncProps } = setup();
    apply();
    const before = ours(home);

    const result = apply(["--herdr-version", "0.1.11"], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_ERROR: "boom" });

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("boom");
    expect(modMeta("vjr-square-tabs").cloned_from.version).toBe("0.1.10");
    expect(syncProps("vjr-desk").built).toBe("0.1.10");
    expect(ours(home)).toEqual(before);
  });

  test("a copy the shown layout still uses goes only after the new layouts", () => {
    const { home, apply, record, writeRecord } = setup();
    apply();
    cpSync(join(home, "mods/vjr-square-tabs"), join(home, "mods/vjr-square-old"), { recursive: true });
    writeRecord({ ...record(), mods: [...record().mods, "vjr-square-old"] });
    const shown = join(home, "layouts/vjr-desk-square.json");
    writeFileSync(shown, readFileSync(shown, "utf8").replace('"mod": "vjr-square-agents"', '"mod": "vjr-square-old"'));
    writeFileSync(join(home, "mods/vjr-square-tabs/main.js"), "export default class Old {}\n");

    const result = apply([], { FAKE_HERDR_WINDOW: "vjr-desk-square" });

    expect(result.code).toBe(0);
    expect(existsSync(join(home, "mods/vjr-square-old"))).toBe(false);
    expect(record().mods).not.toContain("vjr-square-old");
  });

  test("errors that were already there do not block", () => {
    const { apply, syncProps } = setup();

    expect(apply([], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_ERROR_ALWAYS: "old" }).code).toBe(0);

    expect(syncProps("vjr-desk").built).toBe("0.1.10");
  });

  test("invalid keys.json stops before any write", () => {
    const { home, apply } = setup();
    writeFileSync(join(home, "keys.json"), "{");

    const result = apply();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("keys.json");
    expect(existsSync(join(home, "mods/vjr-sync"))).toBe(false);
  });

  test("a folder that is not ours is never overwritten", () => {
    const { home, apply } = setup();
    mkdirSync(join(home, "mods/vjr-square-tabs"));
    writeFileSync(join(home, "mods/vjr-square-tabs/mine.js"), "");

    const result = apply();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain("not created by this repo");
    expect(existsSync(join(home, "mods/vjr-square-tabs/mine.js"))).toBe(true);
    expect(existsSync(join(home, "mods/vjr-sync"))).toBe(false);
  });

  test("a layout that is not ours is never overwritten", () => {
    const { home, apply } = setup();
    writeFileSync(join(home, "layouts/vjr-desk.json"), "mine");

    expect(apply().stderr).toContain("not created by this repo");

    expect(readFileSync(join(home, "layouts/vjr-desk.json"), "utf8")).toBe("mine");
  });

  test("files the app wrote into the repo's mods stay out of the install", () => {
    const { root, home, apply } = setup();
    writeFileSync(join(root, "mods/vjr-sync/gpui-kit.d.ts"), "declare const kit: unknown;\n");
    writeFileSync(join(root, "mods/vjr-sync/jsconfig.json"), "{}\n");

    apply();

    expect(readdirSync(join(home, "mods/vjr-sync")).sort()).toEqual(["main.js", "mod.json"]);
  });

  test("a status it cannot read does not block the update", () => {
    const { apply, syncProps } = setup();

    const result = apply([], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_TEXT: "not json" });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("status");
    expect(syncProps("vjr-desk").built).toBe("0.1.10");
  });

  test("a status with unexpected errors does not block the update", () => {
    const { apply } = setup();

    expect(apply([], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_TEXT: '{"errors":"none"}' }).code).toBe(0);
  });

  test(
    "a status that hangs does not hold the update",
    () => {
      const { apply } = setup();

      expect(apply([], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_HANG: "1" }).code).toBe(0);
    },
    { timeout: 12000 },
  );

  test("a run killed after the swap does not refuse its own mods", () => {
    const { home, apply, syncProps } = setup();

    const killed = apply([], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_KILL: "1" });

    expect(killed.code).not.toBe(0);
    expect(existsSync(join(home, "mods/vjr-sync"))).toBe(true);
    expect(existsSync(join(home, "layouts/vjr-desk.json"))).toBe(false);

    expect(apply().code).toBe(0);
    expect(syncProps("vjr-desk").built).toBe("0.1.10");
  });

  test("a copy moved aside by a killed run comes back", () => {
    const { home, state, apply, modMeta } = setup();
    apply();
    mkdirSync(join(state, "previous-999"));
    renameSync(join(home, "mods/vjr-tabs"), join(state, "previous-999/vjr-tabs"));

    expect(apply(["--herdr-version", "0.1.11"], { FAKE_HERDR_CHECK_FAIL: "vjr-square-tabs" }).code).toBe(1);

    expect(modMeta("vjr-tabs").cloned_from.version).toBe("0.1.10");
    expect(existsSync(join(state, "previous-999"))).toBe(false);
  });

  test("a failed first install leaves no mods and no record", () => {
    const { home, state, apply } = setup();

    expect(apply([], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_ERROR: "boom" }).code).toBe(1);

    expect(readdirSync(join(home, "mods")).filter((name) => name.startsWith("vjr-"))).toEqual([]);
    expect(existsSync(join(state, "layout.json"))).toBe(false);
  });

  test("a rollback keeps the record it found", () => {
    const { apply, record } = setup();
    apply();
    const before = record();

    apply(["--herdr-version", "0.1.11"], { FAKE_HERDR_WINDOW: "vjr-desk", FAKE_HERDR_STATUS_ERROR: "boom" });

    expect(record()).toEqual(before);
  });

  test("the log records how long each run took", () => {
    const { state, apply } = setup();

    apply();

    expect(readFileSync(join(state, "layout.log"), "utf8")).toMatch(/applied \d+ms/);
  });

  test("a running apply makes the second one exit quietly", () => {
    const { home, state, apply } = setup();
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "layout.lock"), String(process.pid));

    const result = apply();

    expect(result.code).toBe(0);
    expect(result.stdout).toContain("busy");
    expect(existsSync(join(home, "mods/vjr-sync"))).toBe(false);
    expect(existsSync(join(state, "layout.lock"))).toBe(true);
  });

  test("a lock left by a dead process does not block", () => {
    const { home, state, apply } = setup();
    mkdirSync(state, { recursive: true });
    writeFileSync(join(state, "layout.lock"), "999999");

    expect(apply().code).toBe(0);

    expect(existsSync(join(home, "mods/vjr-sync"))).toBe(true);
    expect(existsSync(join(state, "layout.lock"))).toBe(false);
  });

  test("the lock goes away after a failure", () => {
    const { state, apply } = setup();

    apply([], { FAKE_HERDR_CHECK_FAIL: "vjr-sync" });

    expect(existsSync(join(state, "layout.lock"))).toBe(false);
  });

  test("leftovers from a killed run are removed", () => {
    const { state, apply } = setup();
    mkdirSync(join(state, "build-999"), { recursive: true });
    mkdirSync(join(state, "previous-999"), { recursive: true });

    apply();

    expect(readdirSync(state).filter((name) => /^(build|previous)-/.test(name))).toEqual([]);
  });

  test("failures are logged", () => {
    const { state, apply } = setup();

    apply([], { FAKE_HERDR_CHECK_FAIL: "vjr-sync" });

    expect(readFileSync(join(state, "layout.log"), "utf8")).toContain("failed");
  });
});

describe("uninstall", () => {
  test("removes everything recorded and keeps the rest", () => {
    const { home, state, apply, uninstall, keys } = setup();
    const global = keys().global;
    apply();

    expect(uninstall().code).toBe(0);

    expect(readdirSync(join(home, "mods")).filter((name) => name.startsWith("vjr-"))).toEqual([]);
    expect(existsSync(join(home, "mods/git-graph"))).toBe(false);
    expect(existsSync(join(home, "layouts/vjr-desk.json"))).toBe(false);
    expect(existsSync(join(home, "layouts/vjr-desk-square.svg"))).toBe(false);
    expect(keys()["layout:vjr-desk"]).toBeUndefined();
    expect(keys()["layout:vjr-desk-square"]).toBeUndefined();
    expect(keys().global).toEqual(global);
    expect(existsSync(join(home, "themes/vjr.json"))).toBe(true);
    expect(existsSync(join(home, "mods/tabs/main.js"))).toBe(true);
    expect(existsSync(join(state, "layout.json"))).toBe(false);
  });

  test("keeps an adopted git-graph", () => {
    const { home, apply, uninstall, installGitGraph } = setup();
    installGitGraph();
    apply();

    uninstall();

    expect(existsSync(join(home, "mods/git-graph/main.js"))).toBe(true);
  });

  test("leaves our layout first when the window shows it", () => {
    const { apply, uninstall, log } = setup();
    apply();

    uninstall({ FAKE_HERDR_WINDOW: "vjr-desk-square" });

    expect(log()).toContain('do layout.switch {"name":"main"}');
  });

  test("stays on another layout when the window shows one", () => {
    const { apply, uninstall, log } = setup();
    apply();

    uninstall({ FAKE_HERDR_WINDOW: "terminals" });

    expect(log().filter((line) => line.startsWith("do "))).toEqual([]);
  });

  test("does nothing without a record", () => {
    const { home, uninstall } = setup();
    const before = snapshot(home);

    expect(uninstall().code).toBe(0);

    expect(snapshot(home)).toEqual(before);
  });
});
