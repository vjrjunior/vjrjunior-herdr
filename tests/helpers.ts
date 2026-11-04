import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const repo = join(import.meta.dir, "..");

const tempDirs: string[] = [];

export function tempDir(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), "vjr-herdr-test-")));
  tempDirs.push(dir);
  return dir;
}

export function removeTempDirs(): void {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function copyRepo(): string {
  const root = tempDir();
  for (const part of ["palette", "scripts", "themes", "targets", "recipes", "mods", "layouts", "kit"]) {
    if (existsSync(join(repo, part))) cpSync(join(repo, part), join(root, part), { recursive: true });
  }
  return root;
}

export function editFile(path: string, from: string, to: string): void {
  const before = readFileSync(path, "utf8");
  if (!before.includes(from)) throw new Error(`${from} not found in ${path}`);
  writeFileSync(path, before.replace(from, to));
}

export function makeHomes() {
  const base = tempDir();
  const config = join(base, "config");
  const state = join(base, "state");
  const herdrApp = join(base, "custom-herdr-app-home");
  const ghostty = join(config, "ghostty");
  mkdirSync(join(herdrApp, "themes"), { recursive: true });
  mkdirSync(join(ghostty, "themes"), { recursive: true });
  return {
    base,
    herdrApp,
    ghostty,
    state: join(state, "vjr-herdr"),
    herdrAppTheme: join(herdrApp, "themes", "vjr.json"),
    ghosttyTheme: join(ghostty, "themes", "VJR"),
    env: {
      HOME: base,
      PATH: process.env.PATH ?? "",
      XDG_CONFIG_HOME: config,
      XDG_STATE_HOME: state,
      HERDR_APP_HOME: herdrApp,
    } as Record<string, string>,
  };
}

export function run(root: string, script: string, args: string[], env: Record<string, string>) {
  const result = Bun.spawnSync([process.execPath, join(root, "scripts", script), ...args], {
    cwd: root,
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  return { code: result.exitCode, stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}
