import { describe, expect, test } from "bun:test";
import { atShell, checkoutOf, isClaude, keepArgs, leaves, matchingFolder, movedNote, parseWorktrees, resumeArgv, runsSession, splitSteps, tabTree, targetsFor } from "../mods/move-tab/logic.js";

describe("move-tab logic", () => {
  test("keeps the allowed flags and their values", () => {
    expect(keepArgs(["claude", "--resume", "old", "--model", "opus", "--effort", "high", "--mcp-config", "a.json", "b.json", "--plugin-dir", "p", "--plugin-dir", "q", "--append-system-prompt", "x", "--strict-mcp-config"]))
      .toEqual(["--model", "opus", "--effort", "high", "--mcp-config", "a.json", "b.json", "--plugin-dir", "p", "--plugin-dir", "q", "--strict-mcp-config"]);
  });
  test("drops a flag whose value can't be typed", () => {
    expect(keepArgs(["claude", "--model", "it's"])).toEqual([]);
  });
  test("resolves kept paths against the old Claude's folder", () => {
    const cwd = "/r/main/api";
    expect(keepArgs(["claude", "--add-dir", "../shared", "./docs", "my dir", "/abs/x", "~/notes", "~"], cwd))
      .toEqual(["--add-dir", "/r/main/shared", "/r/main/api/docs", "/r/main/api/my dir", "/abs/x", "~/notes", "~"]);
    expect(keepArgs(["claude", "--plugin-dir=plugins/../tools/", "--plugin-dir", "/p"], cwd)).toEqual(["--plugin-dir", "/r/main/api/tools", "--plugin-dir", "/p"]);
    expect(keepArgs(["claude", "--mcp-config", "mcp.json", '{"mcpServers":{}}', "--settings", ' {"model": "opus"}'], cwd))
      .toEqual(["--mcp-config", "/r/main/api/mcp.json", '{"mcpServers":{}}', "--settings", ' {"model": "opus"}']);
    expect(keepArgs(["claude", "--settings=../s.json", "--model", "../opus"], cwd)).toEqual(["--settings", "/r/main/s.json", "--model", "../opus"]);
    expect(keepArgs(["claude", "--add-dir", "../../../x"], "/r")).toEqual(["--add-dir", "/x"]);
    expect(keepArgs(["claude", "--add-dir", "../shared"])).toEqual(["--add-dir", "../shared"]);
    expect(keepArgs(["claude", "--add-dir", "x"], "/r/it's")).toEqual([]);
  });
  test("resumes the session with the moved note last", () => {
    expect(resumeArgv({ session: "abc-1", args: ["--model", "opus"], note: "N" })).toEqual(["claude", "--resume", "abc-1", "--model", "opus", "--append-system-prompt", "N"]);
    expect(resumeArgv({ session: "../x", args: [], note: "N" })).toBeNull();
  });
  test("resumes without a note when there is none", () => {
    expect(resumeArgv({ session: "abc-1", args: ["--model", "opus"], note: null })).toEqual(["claude", "--resume", "abc-1", "--model", "opus"]);
    expect(resumeArgv({ session: "abc-1", args: [], note: "" })).toEqual(["claude", "--resume", "abc-1"]);
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
  test("finds a live terminal that resumes a session", () => {
    const live = (over: Record<string, unknown>) => ({ address: "t9", state: "live", ...over });
    expect(runsSession(live({ argv: ["claude", "--resume", "abc-1", "--model", "opus"] }), "abc-1")).toBe(true);
    expect(runsSession(live({ argv: ["/bin/zsh", "-l"], foreground: { argv: ["claude", "--resume", "abc-1"] } }), "abc-1")).toBe(true);
    expect(runsSession(live({ argv: ["zsh", "-i", "-c", "claude --resume abc-1 --model opus"] }), "abc-1")).toBe(true);
    expect(runsSession(live({ argv: ["claude", "--resume", "abc-12"] }), "abc-1")).toBe(false);
    expect(runsSession(live({ argv: ["claude", "abc-1"] }), "abc-1")).toBe(false);
    expect(runsSession({ address: "t9", state: "exited", argv: ["claude", "--resume", "abc-1"] }, "abc-1")).toBe(false);
    expect(runsSession(live({}), "abc-1")).toBe(false);
    expect(runsSession(live({ argv: ["claude", "--resume", ".*"] }), ".*")).toBe(false);
  });
  test("writes the moved note", () => {
    expect(movedNote({ from: "/r/main", fromBranch: "main", to: "/r/wt", toBranch: null }))
      .toBe("This session moved from /r/main (branch main) to /r/wt (detached HEAD). Work in /r/wt from now on; files under /r/main belong to another checkout.");
  });
  const block = (id: string) => ({ type: "block", id, content: { terminal: id } });
  test("splits a lone pane into one step", () => {
    expect(splitSteps({ type: "row", children: [block("a")] })).toEqual([{ leaf: 0, from: null, direction: null }]);
  });
  test("splits rows right and columns down, outer splits first", () => {
    const tree = { type: "row", children: [block("a"), { type: "column", children: [block("b"), block("c")] }, block("d")] };
    expect(leaves(tree).map((leaf) => leaf.id)).toEqual(["a", "b", "c", "d"]);
    expect(splitSteps(tree)).toEqual([
      { leaf: 0, from: null, direction: null },
      { leaf: 1, from: 0, direction: "right" },
      { leaf: 3, from: 1, direction: "right" },
      { leaf: 2, from: 1, direction: "down" },
    ]);
  });
  test("reads a tab's tree from doc.get", () => {
    const out = JSON.stringify({ id: 1, result: { value: { spaces: [{ id: "s1", tabs: [{ id: "tb1", root: { type: "row", children: [block("t1")] } }] }] } } });
    expect(leaves(tabTree(out, "tb1")!)[0].content).toEqual({ terminal: "t1" });
    expect(tabTree(out, "tb9")).toBeNull();
    expect(tabTree("not json", "tb1")).toBeNull();
  });
  test("lists open spaces first, then checkouts without one by branch", () => {
    const checkouts = parseWorktrees("worktree /r/main\nbranch refs/heads/main\n\nworktree /r/wt/zeta\nbranch refs/heads/zeta\n\nworktree /r/wt/alpha\nbranch refs/heads/alpha\n\nworktree /r/wt/live\nbranch refs/heads/feat/live\n");
    const spaces = [
      { id: "s1", name: "main", folder: "/r/main", tabs: [{ id: "tb1" }] },
      { id: "s2", name: "live", folder: "/r/wt/live", tabs: [{ id: "tb2" }] },
    ];
    const panes = [{ tab: "tb1", cwd: "/r/main/src" }, { tab: "tb2", cwd: "/r/wt/live" }];
    expect(targetsFor({ checkouts, spaces, panes, from: { space: "s1" } }).map((t) => [t.label, t.detail, t.space])).toEqual([
      ["live", "feat/live · open", "s2"],
      ["alpha", "alpha", null],
      ["zeta", "zeta", null],
    ]);
  });
  test("offers the main checkout when it has no space", () => {
    const checkouts = parseWorktrees("worktree /r/main\nbranch refs/heads/main\n\nworktree /r/wt/x\nbranch refs/heads/x\n");
    const spaces = [{ id: "s2", name: "x", folder: "/r/wt/x", tabs: [{ id: "tb2" }] }];
    expect(targetsFor({ checkouts, spaces, panes: [], from: { space: "s2" } }).map((t) => [t.label, t.detail, t.path])).toEqual([["main", "main checkout", "/r/main"]]);
  });
});
