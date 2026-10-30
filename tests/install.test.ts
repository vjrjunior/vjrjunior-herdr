import { afterEach, describe, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { copyRepo, editFile, makeHomes, removeTempDirs, run, tempDir } from "./helpers";

afterEach(removeTempDirs);

function setup() {
  const root = copyRepo();
  const homes = makeHomes();
  const backupOf = (app: string, file: string) => join(homes.state, "backups", app, file);
  return {
    root,
    homes,
    ghosttyBackup: backupOf("ghostty", "VJR"),
    herdrAppBackup: backupOf("herdr-app", "vjr.json"),
    herdrAppSource: readFileSync(join(root, "themes/vjr.json"), "utf8"),
    ghosttySource: readFileSync(join(root, "targets/ghostty/VJR"), "utf8"),
    install: () => run(root, "install.ts", [], homes.env),
    uninstall: () => run(root, "install.ts", ["--uninstall"], homes.env),
    record: () => JSON.parse(readFileSync(join(homes.state, "install.json"), "utf8")),
  };
}

describe("install", () => {
  test("copies both themes and leaves nothing temporary behind", () => {
    const { homes, install, herdrAppSource, ghosttySource } = setup();

    expect(install().code).toBe(0);

    expect(readFileSync(homes.herdrAppTheme, "utf8")).toBe(herdrAppSource);
    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe(ghosttySource);
    expect(lstatSync(homes.herdrAppTheme).isFile()).toBe(true);
    expect(readdirSync(homes.herdrApp)).toEqual(["themes"]);
    expect(readdirSync(homes.ghostty)).toEqual(["themes"]);
  });

  test("records what it installed and the mode", () => {
    const { homes, install, record } = setup();

    install();

    expect(record().targets["herdr-app"].path).toBe(homes.herdrAppTheme);
    expect(record().targets["herdr-app"].mode).toBe("copy");
    expect(record().targets.ghostty.path).toBe(homes.ghosttyTheme);
    expect(record().targets.ghostty.backup).toBeNull();
  });

  test("backs up a foreign file in the state folder before replacing it", () => {
    const { homes, install, record, ghosttyBackup, ghosttySource } = setup();
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");

    expect(install().code).toBe(0);

    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe(ghosttySource);
    expect(readFileSync(ghosttyBackup, "utf8")).toBe("# hand-written\n");
    expect(record().targets.ghostty.backup).toBe(ghosttyBackup);
    expect(readdirSync(join(homes.ghostty, "themes"))).toEqual(["VJR"]);
  });

  test("backs up a foreign symlink as a symlink and leaves its destination alone", () => {
    const { homes, install, herdrAppBackup, herdrAppSource } = setup();
    const dotfile = join(tempDir(), "dotfiles-vjr.json");
    writeFileSync(dotfile, "from dotfiles\n");
    symlinkSync(dotfile, homes.herdrAppTheme);

    expect(install().code).toBe(0);

    expect(lstatSync(herdrAppBackup).isSymbolicLink()).toBe(true);
    expect(readlinkSync(herdrAppBackup)).toBe(dotfile);
    expect(readFileSync(dotfile, "utf8")).toBe("from dotfiles\n");
    expect(lstatSync(homes.herdrAppTheme).isFile()).toBe(true);
    expect(readFileSync(homes.herdrAppTheme, "utf8")).toBe(herdrAppSource);
  });

  test("treats a symlink to this repo's theme as its own", () => {
    const { root, homes, install, record, herdrAppBackup, herdrAppSource } = setup();
    symlinkSync(join(root, "themes/vjr.json"), homes.herdrAppTheme);

    expect(install().code).toBe(0);

    expect(record().targets["herdr-app"].backup).toBeNull();
    expect(existsSync(herdrAppBackup)).toBe(false);
    expect(lstatSync(homes.herdrAppTheme).isFile()).toBe(true);
    expect(readFileSync(homes.herdrAppTheme, "utf8")).toBe(herdrAppSource);
  });

  test("refuses when a foreign file meets a backup already on record", () => {
    const { homes, install, ghosttyBackup } = setup();
    writeFileSync(homes.ghosttyTheme, "# first original\n");
    install();
    writeFileSync(homes.ghosttyTheme, "# edited after install\n");

    const result = install();

    expect(result.code).toBe(1);
    expect(result.stderr).toContain(homes.ghosttyTheme);
    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("# edited after install\n");
    expect(readFileSync(ghosttyBackup, "utf8")).toBe("# first original\n");
  });

  test("never overwrites a backup that lost its record", () => {
    const { homes, install, ghosttyBackup } = setup();
    writeFileSync(homes.ghosttyTheme, "# first original\n");
    install();
    rmSync(join(homes.state, "install.json"));
    writeFileSync(homes.ghosttyTheme, "# something else\n");

    expect(install().code).toBe(1);

    expect(readFileSync(ghosttyBackup, "utf8")).toBe("# first original\n");
    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("# something else\n");
  });

  test("a failure before the rename leaves the target whole, and a rerun finishes", () => {
    const { homes, install, record, ghosttyBackup, ghosttySource } = setup();
    const themes = join(homes.ghostty, "themes");
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");
    chmodSync(themes, 0o555);

    const failed = install();
    chmodSync(themes, 0o755);

    expect(failed.code).toBe(1);
    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("# hand-written\n");
    expect(readdirSync(homes.ghostty)).toEqual(["themes"]);
    expect(readFileSync(ghosttyBackup, "utf8")).toBe("# hand-written\n");
    expect(record().targets.ghostty.backup).toBe(ghosttyBackup);

    expect(install().code).toBe(0);
    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe(ghosttySource);
    expect(readFileSync(ghosttyBackup, "utf8")).toBe("# hand-written\n");
  });

  test("removes a temp left by an interrupted run", () => {
    const { homes, install } = setup();
    install();
    writeFileSync(join(homes.ghostty, ".vjr-herdr.tmp-99999"), "partial");

    expect(install().code).toBe(0);

    expect(readdirSync(homes.ghostty)).toEqual(["themes"]);
  });

  test("skips a missing app folder with a warning and installs the rest", () => {
    const { homes, install, record, herdrAppSource } = setup();
    rmSync(homes.ghostty, { recursive: true });

    const result = install();

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("ghostty");
    expect(existsSync(homes.ghostty)).toBe(false);
    expect(readFileSync(homes.herdrAppTheme, "utf8")).toBe(herdrAppSource);
    expect(Object.keys(record().targets)).toEqual(["herdr-app"]);
  });

  test("creates themes/ inside an existing app folder", () => {
    const { homes, install, ghosttySource } = setup();
    rmSync(join(homes.ghostty, "themes"), { recursive: true });

    expect(install().code).toBe(0);

    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe(ghosttySource);
  });

  test("changes nothing when rerun with the same content", () => {
    const { homes, install, record } = setup();
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");
    install();
    const before = statSync(homes.ghosttyTheme);
    const recordBefore = record();

    expect(install().code).toBe(0);

    const after = statSync(homes.ghosttyTheme);
    expect(after.ino).toBe(before.ino);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(record()).toEqual(recordBefore);
  });

  test("updates its own file without touching the original backup", () => {
    const { root, homes, install, ghosttyBackup } = setup();
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");
    install();
    writeFileSync(join(root, "targets/ghostty/VJR"), "background = #000000\n");

    expect(install().code).toBe(0);

    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("background = #000000\n");
    expect(readFileSync(ghosttyBackup, "utf8")).toBe("# hand-written\n");
  });
});

describe("uninstall", () => {
  test("restores the original bytes and removes what install created", () => {
    const { homes, install, uninstall, ghosttyBackup } = setup();
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");
    install();

    expect(uninstall().code).toBe(0);

    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("# hand-written\n");
    expect(existsSync(homes.herdrAppTheme)).toBe(false);
    expect(existsSync(ghosttyBackup)).toBe(false);
    expect(existsSync(join(homes.state, "install.json"))).toBe(false);
  });

  test("restores the first original after the theme changed", () => {
    const { root, homes, install, uninstall } = setup();
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");
    install();
    writeFileSync(join(root, "targets/ghostty/VJR"), "background = #000000\n");
    install();

    expect(uninstall().code).toBe(0);

    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("# hand-written\n");
  });

  test("restores a foreign symlink as a symlink", () => {
    const { homes, install, uninstall } = setup();
    const dotfile = join(tempDir(), "dotfiles-vjr.json");
    writeFileSync(dotfile, "from dotfiles\n");
    symlinkSync(dotfile, homes.herdrAppTheme);
    install();

    expect(uninstall().code).toBe(0);

    expect(readlinkSync(homes.herdrAppTheme)).toBe(dotfile);
  });

  test("removes the theme when install took over a repo symlink", () => {
    const { root, homes, install, uninstall } = setup();
    symlinkSync(join(root, "themes/vjr.json"), homes.herdrAppTheme);
    install();

    expect(uninstall().code).toBe(0);

    expect(existsSync(homes.herdrAppTheme)).toBe(false);
  });

  test("leaves a target changed after install and warns", () => {
    const { homes, install, uninstall } = setup();
    install();
    writeFileSync(homes.ghosttyTheme, "# my own edit\n");

    const result = uninstall();

    expect(result.code).toBe(0);
    expect(result.stderr).toContain(homes.ghosttyTheme);
    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("# my own edit\n");
  });

  test("keeps a backup on record when it leaves a changed target", () => {
    const { homes, install, uninstall, record, ghosttyBackup } = setup();
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");
    install();
    writeFileSync(homes.ghosttyTheme, "# my own edit\n");

    uninstall();

    expect(readFileSync(ghosttyBackup, "utf8")).toBe("# hand-written\n");
    expect(record().targets.ghostty.backup).toBe(ghosttyBackup);
  });

  test("removes a themes/ folder that install created", () => {
    const { homes, install, uninstall } = setup();
    rmSync(join(homes.ghostty, "themes"), { recursive: true });
    install();

    uninstall();

    expect(existsSync(join(homes.ghostty, "themes"))).toBe(false);
  });

  test("keeps a themes/ folder that holds other themes", () => {
    const { homes, install, uninstall } = setup();
    rmSync(join(homes.ghostty, "themes"), { recursive: true });
    install();
    writeFileSync(join(homes.ghostty, "themes", "Other"), "background = #000000\n");

    uninstall();

    expect(readdirSync(join(homes.ghostty, "themes"))).toEqual(["Other"]);
  });

  test("warns that herdr-app may still have vjr selected once its theme is gone", () => {
    const { install, uninstall } = setup();
    install();

    expect(uninstall().stderr).toContain("selected");
  });

  test("does not warn about the selection when the herdr-app theme stays", () => {
    const { homes, install, uninstall } = setup();
    install();
    writeFileSync(homes.herdrAppTheme, "{}\n");

    expect(uninstall().stderr).not.toContain("selected");
  });

  test("does nothing when nothing is installed", () => {
    const { homes, uninstall } = setup();
    writeFileSync(homes.ghosttyTheme, "# hand-written\n");

    expect(uninstall().code).toBe(0);

    expect(readFileSync(homes.ghosttyTheme, "utf8")).toBe("# hand-written\n");
  });
});

describe("watch", () => {
  const CHANGED_ACCENT = "#FF0000";

  function fakeHerdrApp(exitCode: number) {
    const bin = tempDir();
    const log = join(bin, "calls.log");
    const script = join(bin, "herdr-app");
    writeFileSync(script, `#!/bin/sh\necho "$@" >> "${log}"\nexit ${exitCode}\n`);
    chmodSync(script, 0o755);
    return { bin, calls: () => (existsSync(log) ? readFileSync(log, "utf8") : "") };
  }

  async function until(check: () => boolean): Promise<void> {
    const deadline = Date.now() + 5000;
    while (!check()) {
      if (Date.now() > deadline) throw new Error("timed out waiting for the watcher");
      await Bun.sleep(50);
    }
  }

  function setupWatch(exitCode = 0) {
    const context = setup();
    const herdrApp = fakeHerdrApp(exitCode);
    const env = { ...context.homes.env, PATH: herdrApp.bin };
    return {
      ...context,
      env,
      calls: herdrApp.calls,
      watch: () => run(context.root, "watch.ts", [], env),
      editAccent: (to: string) => editFile(join(context.root, "palette/vjr.toml"), 'base = "#FFC799"', `base = "${to}"`),
    };
  }

  test("a good save installs the new colors and makes herdr-app re-read them", () => {
    const { homes, watch, editAccent, calls } = setupWatch();
    editAccent(CHANGED_ACCENT);

    expect(watch().code).toBe(0);

    expect(JSON.parse(readFileSync(homes.herdrAppTheme, "utf8")).colors.accent).toBe(CHANGED_ACCENT);
    expect(readFileSync(homes.ghosttyTheme, "utf8")).toContain(`cursor-color = ${CHANGED_ACCENT}\n`);
    expect(calls()).toBe('do app.theme {"name":"graphite"}\ndo app.theme {"name":"vjr"}\n');
  });

  test("a bad save keeps the last good theme and touches nothing else", () => {
    const { homes, install, watch, editAccent, calls, herdrAppSource } = setupWatch();
    install();
    editAccent("#FFC79");

    expect(watch().code).toBe(1);

    expect(readFileSync(homes.herdrAppTheme, "utf8")).toBe(herdrAppSource);
    expect(calls()).toBe("");
  });

  test("keeps running after a bad save and picks up the next good one", async () => {
    const { root, homes, env, editAccent } = setupWatch();
    const accent = () => JSON.parse(readFileSync(homes.herdrAppTheme, "utf8")).colors.accent;
    const watcher = Bun.spawn([process.execPath, "--watch", "scripts/watch.ts"], {
      cwd: root,
      env,
      stdout: "ignore",
      stderr: "ignore",
    });

    try {
      await until(() => existsSync(homes.herdrAppTheme));
      editAccent("#FFC79");
      await Bun.sleep(300);
      editFile(join(root, "palette/vjr.toml"), 'base = "#FFC79"', `base = "${CHANGED_ACCENT}"`);

      await until(() => accent() === CHANGED_ACCENT);
    } finally {
      watcher.kill();
      await watcher.exited;
    }
  }, 10000);

  test("leaves the selected theme alone when nothing changed", () => {
    const { install, watch, calls } = setupWatch();
    install();

    expect(watch().code).toBe(0);

    expect(calls()).toBe("");
  });

  test("does not switch themes when only Ghostty was installed", () => {
    const { homes, watch, editAccent, calls } = setupWatch();
    rmSync(homes.herdrApp, { recursive: true });
    editAccent(CHANGED_ACCENT);

    expect(watch().code).toBe(0);

    expect(calls()).toBe("");
  });

  test("warns and keeps going when the app is closed", () => {
    const { homes, watch, editAccent, calls } = setupWatch(2);
    editAccent(CHANGED_ACCENT);

    const result = watch();

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("herdr-app");
    expect(calls()).toBe('do app.theme {"name":"graphite"}\n');
    expect(JSON.parse(readFileSync(homes.herdrAppTheme, "utf8")).colors.accent).toBe(CHANGED_ACCENT);
  });

  test("warns and keeps going when herdr-app is not on PATH", () => {
    const context = setup();
    editFile(join(context.root, "palette/vjr.toml"), 'base = "#FFC799"', `base = "${CHANGED_ACCENT}"`);

    const result = run(context.root, "watch.ts", [], { ...context.homes.env, PATH: tempDir() });

    expect(result.code).toBe(0);
    expect(result.stderr).toContain("herdr-app");
    expect(readFileSync(context.homes.ghosttyTheme, "utf8")).toContain(`cursor-color = ${CHANGED_ACCENT}\n`);
  });
});

describe("default paths", () => {
  test("uses ~/.config and ~/.local/state when the variables are unset", () => {
    const root = copyRepo();
    const home = tempDir();
    mkdirSync(join(home, ".config/ghostty/themes"), { recursive: true });
    mkdirSync(join(home, ".config/herdr-app/themes"), { recursive: true });

    const result = run(root, "install.ts", [], { HOME: home, PATH: process.env.PATH ?? "" });

    expect(result.code).toBe(0);
    expect(existsSync(join(home, ".config/ghostty/themes/VJR"))).toBe(true);
    expect(existsSync(join(home, ".config/herdr-app/themes/vjr.json"))).toBe(true);
    expect(existsSync(join(home, ".local/state/vjr-herdr/install.json"))).toBe(true);
  });
});
