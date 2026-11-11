import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseSchedule } from "../mods/move-tab/logic.js";

const SCRIPT = join(import.meta.dir, "../mods/move-tab/schedule.sh");
const LABEL = "vjr.move-to";

let root: string;
let fake: string;
let main: string;
let worktree: string;
let home: string;

const git = (cwd: string, ...args: string[]) => {
  const run = Bun.spawnSync(["git", ...args], { cwd, env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" } });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
};

const tool = (name: string, body: string) => {
  const path = join(fake, "bin", name);
  writeFileSync(path, `#!/bin/sh\n${body}\n`);
  chmodSync(path, 0o755);
};

const info = (changes: Record<string, unknown> = {}) =>
  writeFileSync(
    join(fake, "info.json"),
    JSON.stringify({ address: "t1", pid: 10, parent: null, cwd: main, foreground: { pid: 11, argv: ["claude", "--model", "opus"], cwd: main }, status: { app: "claude-code", state: "working" }, ...changes }),
  );

const layout = (name: string) => writeFileSync(join(fake, "status.json"), JSON.stringify({ layout: name }));

function schedule(args: string[], env: Record<string, string> = {}) {
  const run = Bun.spawnSync(["sh", SCRIPT, ...args], {
    cwd: main,
    env: { PATH: `${join(fake, "bin")}:/usr/bin:/bin`, HOME: home, FAKE: fake, HC_TERMINAL_ID: "t1", ...env },
  });
  const labels = existsSync(join(fake, "labels")) ? readFileSync(join(fake, "labels"), "utf8").split("\n").filter(Boolean) : [];
  return { code: run.exitCode, out: run.stdout.toString().trim(), labels };
}

beforeAll(() => {
  root = join(realpathSync(mkdtempSync(join(tmpdir(), "move-tab-schedule-"))), "Local Sites");
  fake = join(root, "fake");
  main = join(root, "repo");
  worktree = join(root, "repo-worktrees", "cup-1-thing");
  home = join(root, "home");
  mkdirSync(join(fake, "bin"), { recursive: true });
  mkdirSync(join(home, ".claude/sessions"), { recursive: true });
  mkdirSync(main, { recursive: true });
  git(main, "init", "-q", "-b", "main");
  git(main, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "--allow-empty", "-m", "start");
  git(main, "worktree", "add", "-q", "-b", "fix/cup-1-thing", worktree);
  tool("hc", 'case $1 in get) cat "$FAKE/info.json" ;; label) shift 2; printf "%s\\n" "$@" >> "$FAKE/labels" ;; esac');
  tool("herdr-app", 'cat "$FAKE/status.json"');
});

afterAll(() => {
  rmSync(join(root, ".."), { recursive: true, force: true });
});

beforeEach(() => {
  rmSync(join(fake, "labels"), { force: true });
  writeFileSync(join(home, ".claude/sessions/11.json"), JSON.stringify({ sessionId: "sess-1", cwd: main }));
  info();
  layout("vjr-desk");
});

describe("move-tab schedule.sh", () => {
  test("labels this terminal with the move the worker reads", () => {
    const { code, out, labels } = schedule(["--to", worktree, "--prompt", "Implement the plan"]);
    expect(code).toBe(0);
    expect(out).toBe(`This session moves to fix/cup-1-thing when the current turn ends. Cancel with: sh ${SCRIPT} --cancel`);
    expect(labels).toHaveLength(1);
    const [key, ...rest] = (labels[0] as string).split("=");
    expect(key).toBe(LABEL);
    const read = parseSchedule(rest.join("="));
    expect(read).toMatchObject({ to: worktree, session: "sess-1", prompt: "Implement the plan" });
    expect(Math.abs((read?.at ?? 0) - Date.now())).toBeLessThan(60_000);
  });

  test("leaves the prompt out when none is given, in the square layout too", () => {
    layout("vjr-desk-square");
    const { code, labels } = schedule(["--to", `${worktree}/`]);
    expect(code).toBe(0);
    expect(parseSchedule((labels[0] as string).slice(LABEL.length + 1))).toMatchObject({ to: worktree, prompt: null });
  });

  test("falls back to Claude's own session id when the session file is missing", () => {
    rmSync(join(home, ".claude/sessions/11.json"));
    const { code, labels } = schedule(["--to", worktree], { CLAUDE_CODE_SESSION_ID: "env-2" });
    expect(code).toBe(0);
    expect(parseSchedule((labels[0] as string).slice(LABEL.length + 1))?.session).toBe("env-2");
  });

  test("cancel clears the label", () => {
    const { code, out, labels } = schedule(["--cancel"]);
    expect([code, out, labels]).toEqual([0, "No move is scheduled for this session now.", [`${LABEL}=`]]);
  });

  test("refuses, without a label, whatever would leave the session where it is", () => {
    const refusals: [() => void, string[], Record<string, string>, string][] = [
      [() => layout("main"), ["--to", worktree], {}, "herdr-app shows main, not vjr-desk or vjr-desk-square, so nothing would move this session."],
      [() => {}, ["--to", worktree], { HC_TERMINAL_ID: "" }, "Not in a herdr-app terminal, so nothing would move this session."],
      [() => info({ foreground: { pid: 11, argv: ["-zsh"], cwd: main } }), ["--to", worktree], {}, "Claude Code is not in front in this terminal."],
      [() => info({ parent: "t0" }), ["--to", worktree], {}, "This terminal is another agent's sub-agent, so it has no tab to move."],
      [() => info({ status: null }), ["--to", worktree], {}, "Claude reports no status in this terminal, so nothing can tell when its turn ends."],
      [() => {}, ["--to", main], {}, `The session is already in ${main}.`],
      [() => {}, ["--to", fake], {}, `${fake} is not a worktree of this repo.`],
      [() => {}, ["--to", join(root, "nowhere")], {}, `${join(root, "nowhere")} doesn't exist.`],
      [() => {}, ["--to", worktree, "--prompt", "--help"], {}, "The prompt can't start with -."],
    ];
    for (const [arrange, args, env, message] of refusals) {
      info();
      layout("vjr-desk");
      arrange();
      const { code, out, labels } = schedule(args, env);
      expect([code, out, labels]).toEqual([1, message, []]);
    }
  });

  test("a call without a destination is a usage error", () => {
    expect(schedule([]).code).toBe(2);
    expect(schedule(["--to"]).code).toBe(2);
  });
});
