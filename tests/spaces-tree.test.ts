import { describe, expect, test } from "bun:test";
import { base, mostUrgent, parseRefs, parseWorktrees, readLook, repoName } from "../mods/spaces-tree/tree.js";

describe("parseWorktrees", () => {
  const list = [
    "worktree /r/app",
    "HEAD 111",
    "branch refs/heads/main",
    "",
    "worktree /w/app/one",
    "HEAD 222",
    "branch refs/heads/feature/one",
    "",
    "worktree /w/app/gone",
    "HEAD 333",
    "branch refs/heads/gone",
    "prunable gitdir file points to non-existent location",
    "",
    "worktree /w/My Projects/ação",
    "HEAD 444",
    "detached",
    "",
  ].join("\n");

  test("the main checkout comes first", () => {
    expect(parseWorktrees(list)[0]).toEqual({ path: "/r/app", branch: "main", main: true });
  });

  test("strips refs/heads/ and keeps slashes in branch names", () => {
    expect(parseWorktrees(list)[1]).toEqual({ path: "/w/app/one", branch: "feature/one", main: false });
  });

  test("skips prunable and bare entries", () => {
    expect(parseWorktrees(list).map((c) => c.path)).not.toContain("/w/app/gone");
    expect(parseWorktrees("worktree /r/bare.git\nbare\n\nworktree /w/one\nHEAD 1\nbranch refs/heads/one\n")).toEqual([
      { path: "/w/one", branch: "one", main: true },
    ]);
  });

  test("keeps spaces and accents, and a detached head has no branch", () => {
    expect(parseWorktrees(list).at(-1)).toEqual({ path: "/w/My Projects/ação", branch: null, main: false });
  });
});

describe("parseRefs", () => {
  const refs = parseRefs(["main\t\t30", "one\t[ahead 3]\t20", "two\t[behind 1]\t10", "three\t[ahead 2, behind 4]\t5", "old\t[gone]\t1"].join("\n"));

  test("reads ahead, behind and the commit date", () => {
    expect(refs.three).toEqual({ ahead: 2, behind: 4, at: 5 });
  });

  test("a branch with no upstream or a gone one counts zero", () => {
    expect(refs.main).toEqual({ ahead: 0, behind: 0, at: 30 });
    expect(refs.old).toEqual({ ahead: 0, behind: 0, at: 1 });
  });

  test("reads one side alone", () => {
    expect(refs.one?.ahead).toBe(3);
    expect(refs.two?.behind).toBe(1);
  });
});

describe("readLook", () => {
  test("reads the top and the common dir", () => {
    expect(readLook({ code: 0, stdout: "/r/app\n/r/app/.git\n", stderr: "" })).toEqual({ top: "/r/app", common: "/r/app/.git" });
  });

  test("git's own no means outside git", () => {
    expect(readLook({ code: 128, stdout: "", stderr: "fatal: not a git repository (or any of the parent directories): .git" })).toBeNull();
  });

  test("any other failure stays unknown", () => {
    expect(readLook({ code: 1, stdout: "", stderr: "something else" })).toBeUndefined();
  });
});

describe("names", () => {
  test("names a repo from its common dir", () => {
    expect(repoName("/r/app/.git")).toBe("app");
    expect(repoName("/r/app.git")).toBe("app");
  });

  test("base ignores a trailing slash", () => {
    expect(base("/w/app/one/")).toBe("one");
  });
});

describe("mostUrgent", () => {
  test("follows Herdr's order", () => {
    expect(mostUrgent(["idle", "working", "done"])).toBe("done");
    expect(mostUrgent(["working", "blocked"])).toBe("blocked");
  });

  test("no status gives null", () => {
    expect(mostUrgent([null, null])).toBeNull();
  });
});
