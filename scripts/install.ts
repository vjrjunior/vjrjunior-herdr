import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  renameSync,
  rmdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { configHome, herdrAppHome, stateDir } from "./paths";

type Target = { app: string; home: string; file: string; source: string };
type Entry = { path: string; mode: "copy"; fingerprint: string; backup: string | null; createdThemes: boolean };
type InstallRecord = { targets: Record<string, Entry> };

const root = join(import.meta.dir, "..");
const state = stateDir();
const recordPath = join(state, "install.json");
const TEMP_PREFIX = ".vjr-herdr.tmp-";

const TARGETS: Target[] = [
  {
    app: "herdr-app",
    home: herdrAppHome(),
    file: "vjr.json",
    source: join(root, "themes/vjr.json"),
  },
  {
    app: "ghostty",
    home: join(configHome(), "ghostty"),
    file: "VJR",
    source: join(root, "targets/ghostty/VJR"),
  },
];

function lexists(path: string): boolean {
  return lstatSync(path, { throwIfNoEntry: false }) !== undefined;
}

function fingerprint(path: string): string {
  if (lstatSync(path).isSymbolicLink()) return `link:${readlinkSync(path)}`;
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function isLinkTo(path: string, source: string): boolean {
  if (!lstatSync(path).isSymbolicLink()) return false;
  try {
    return realpathSync(path) === realpathSync(source);
  } catch {
    return false;
  }
}

function isOurs(path: string, target: Target, entry: Entry | undefined): boolean {
  if (!lexists(path)) return true;
  return isLinkTo(path, target.source) || fingerprint(path) === entry?.fingerprint;
}

function copyEntry(from: string, to: string): void {
  if (lstatSync(from).isSymbolicLink()) symlinkSync(readlinkSync(from), to);
  else copyFileSync(from, to);
}

function swapIn(temp: string, path: string): void {
  try {
    renameSync(temp, path);
  } finally {
    rmSync(temp, { force: true });
  }
}

function readRecord(): InstallRecord {
  return existsSync(recordPath) ? JSON.parse(readFileSync(recordPath, "utf8")) : { targets: {} };
}

function writeRecord(record: InstallRecord): void {
  mkdirSync(state, { recursive: true });
  const temp = `${recordPath}.tmp-${process.pid}`;
  writeFileSync(temp, `${JSON.stringify(record, null, 2)}\n`);
  renameSync(temp, recordPath);
}

function removeLeftovers(home: string): void {
  for (const name of readdirSync(home)) {
    if (name.startsWith(TEMP_PREFIX)) rmSync(join(home, name), { force: true });
  }
}

function backUp(target: Target, path: string, entry: Entry | undefined): string {
  const backup = entry?.backup ?? join(state, "backups", target.app, target.file);
  if (lexists(backup)) {
    if (fingerprint(backup) === fingerprint(path)) return backup;
    throw new Error(`${path} is not the installed theme and ${backup} already holds a backup; move one of them first`);
  }
  mkdirSync(dirname(backup), { recursive: true });
  copyEntry(path, backup);
  return backup;
}

function installTarget(target: Target, record: InstallRecord): boolean {
  const themes = join(target.home, "themes");
  const path = join(themes, target.file);
  const entry = record.targets[target.app];
  const wanted = fingerprint(target.source);
  if (entry?.fingerprint === wanted && lexists(path) && fingerprint(path) === wanted) return false;

  const backup = isOurs(path, target, entry) ? (entry?.backup ?? null) : backUp(target, path, entry);
  const createdThemes = entry?.createdThemes ?? !existsSync(themes);
  const temp = join(target.home, `${TEMP_PREFIX}${process.pid}`);
  copyFileSync(target.source, temp);
  mkdirSync(themes, { recursive: true });
  record.targets[target.app] = { path, mode: "copy", fingerprint: wanted, backup, createdThemes };
  writeRecord(record);
  swapIn(temp, path);
  return true;
}

export function install(): string[] {
  const record = readRecord();
  const changed: string[] = [];
  for (const target of TARGETS) {
    if (!existsSync(target.home)) {
      console.warn(`skipped ${target.app}: ${target.home} does not exist`);
      continue;
    }
    removeLeftovers(target.home);
    if (installTarget(target, record)) {
      console.log(`installed ${target.app}: ${join(target.home, "themes", target.file)}`);
      changed.push(target.app);
    }
  }
  return changed;
}

function removeInstalled(entry: Entry): void {
  const themes = dirname(entry.path);
  if (entry.backup) {
    const temp = join(dirname(themes), `${TEMP_PREFIX}${process.pid}`);
    copyEntry(entry.backup, temp);
    swapIn(temp, entry.path);
    rmSync(entry.backup);
  } else {
    rmSync(entry.path, { force: true });
  }
  if (entry.createdThemes && existsSync(themes) && readdirSync(themes).length === 0) rmdirSync(themes);
}

export function uninstall(): void {
  const record = readRecord();
  for (const target of TARGETS) {
    const entry = record.targets[target.app];
    if (!entry) continue;
    if (!isOurs(entry.path, target, entry)) {
      const original = entry.backup ? `; the original is at ${entry.backup}` : "";
      console.warn(`left ${entry.path}: it changed after install${original}`);
      if (!entry.backup) delete record.targets[target.app];
      continue;
    }
    removeInstalled(entry);
    delete record.targets[target.app];
    console.log(`removed ${target.app}: ${entry.path}`);
    if (target.app === "herdr-app") console.warn("if vjr is still selected in herdr-app, pick another theme in Settings");
  }
  if (Object.keys(record.targets).length > 0) writeRecord(record);
  else rmSync(recordPath, { force: true });
}

if (import.meta.main) {
  try {
    if (process.argv.includes("--uninstall")) uninstall();
    else install();
  } catch (error) {
    console.error(`error: ${(error as Error).message}`);
    process.exit(1);
  }
}
