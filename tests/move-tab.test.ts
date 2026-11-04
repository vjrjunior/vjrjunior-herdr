import { describe, expect, test } from "bun:test";
import { atShell, checkoutOf, isClaude, keepArgs, matchingFolder, movedNote, parseWorktrees, resumeArgv } from "../mods/move-tab/logic.js";

describe("move-tab logic", () => {
  test("keeps the allowed flags and their values", () => {
    expect(keepArgs(["claude", "--resume", "old", "--model", "opus", "--effort", "high", "--mcp-config", "a.json", "b.json", "--plugin-dir", "p", "--plugin-dir", "q", "--append-system-prompt", "x", "--strict-mcp-config"]))
      .toEqual(["--model", "opus", "--effort", "high", "--mcp-config", "a.json", "b.json", "--plugin-dir", "p", "--plugin-dir", "q", "--strict-mcp-config"]);
  });
  test("drops a flag whose value can't be typed", () => {
    expect(keepArgs(["claude", "--model", "it's"])).toEqual([]);
  });
  test("resumes the session with the moved note last", () => {
    expect(resumeArgv({ session: "abc-1", args: ["--model", "opus"], note: "N" })).toEqual(["claude", "--resume", "abc-1", "--model", "opus", "--append-system-prompt", "N"]);
    expect(resumeArgv({ session: "../x", args: [], note: "N" })).toBeNull();
  });
  test("maps a folder into the other checkout", () => {
    expect(matchingFolder("/r/main/src/app", "/r/main", "/r/wt")).toBe("/r/wt/src/app");
    expect(matchingFolder("/r/main", "/r/main", "/r/wt")).toBe("/r/wt");
    expect(matchingFolder("/elsewhere", "/r/main", "/r/wt")).toBe("/r/wt");
    expect(matchingFolder("/r/main-old/x", "/r/main", "/r/wt")).toBe("/r/wt");
    expect(matchingFolder("/r/máin dir/a b", "/r/máin dir", "/r/wt ç")).toBe("/r/wt ç/a b");
  });
  test("finds the deepest checkout of a folder", () => {
    const checkouts = parseWorktrees("worktree /r/main\nbranch refs/heads/main\n\nworktree /r/main/.wt/x\nbranch refs/heads/feat/x\n");
    expect(checkoutOf("/r/main/.wt/x/src", checkouts)?.branch).toBe("feat/x");
    expect(checkoutOf("/r/main/src", checkouts)?.main).toBe(true);
    expect(checkoutOf("/other", checkouts)).toBeNull();
  });
  test("tells a Claude from an idle shell and a busy program", () => {
    const shell = { pid: 10, foreground: { pid: 10, argv: ["-zsh"] } };
    const claude = { pid: 10, foreground: { pid: 11, argv: ["claude", "--resume", "x"], name: "2.1.318" }, status: { app: "claude-code", state: "idle" } };
    const vite = { pid: 10, foreground: { pid: 12, argv: ["node", "vite"] } };
    expect([atShell(shell), isClaude(shell)]).toEqual([true, false]);
    expect([atShell(claude), isClaude(claude)]).toEqual([false, true]);
    expect([atShell(vite), isClaude(vite)]).toEqual([false, false]);
  });
  test("writes the moved note", () => {
    expect(movedNote({ from: "/r/main", fromBranch: "main", to: "/r/wt", toBranch: null }))
      .toBe("This session moved from /r/main (branch main) to /r/wt (detached HEAD). Work in /r/wt from now on; files under /r/main belong to another checkout.");
  });
});
