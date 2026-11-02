import { describe, expect, test } from "bun:test";
import { base, buildTree, checkoutOf, mostUrgent, parseRefs, parseWorktrees, readLook, repoName } from "../mods/spaces-tree/tree.js";

const space = (id: string, over = {}) => ({ id, index: 1, name: id, named: false, folder: "", machine: null, branch: null, active: false, status: null, tabs: [], ...over });
const common = "/r/app/.git";
const appRepo = {
  common,
  name: "app",
  checkouts: [
    { path: "/r/app", branch: "main", main: true },
    { path: "/w/app/one", branch: "one", main: false },
    { path: "/w/app/two", branch: "two", main: false },
    { path: "/w/app/three", branch: "three", main: false },
  ],
  refs: { main: { ahead: 0, behind: 0, at: 40 }, one: { ahead: 3, behind: 0, at: 10 }, two: { ahead: 0, behind: 1, at: 30 }, three: { ahead: 0, behind: 0, at: 20 } },
};
const repos = { [common]: appRepo };
const look = (top: string) => ({ top, common });

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

describe("checkoutOf", () => {
  const checkouts = [
    { path: "/a/b", branch: "x", main: true },
    { path: "/a/b/nested", branch: "y", main: false },
  ];

  test("picks the deepest checkout", () => {
    expect(checkoutOf("/a/b/nested/src", checkouts)?.branch).toBe("y");
  });

  test("does not match a path that only shares a prefix", () => {
    expect(checkoutOf("/a/bc", checkouts)).toBeNull();
  });
});

describe("buildTree", () => {
  test("the main checkout heads its repo and every worktree sits under it", () => {
    const [entry] = buildTree([space("m"), space("o")], { m: look("/r/app"), o: look("/w/app/one") }, repos);
    expect(entry?.kind).toBe("repo");
    expect(entry?.key).toBe(common);
    expect(entry?.main.space?.id).toBe("m");
    expect(entry?.main.name).toBe("app");
    expect(entry?.kids.map((k) => [k.name, k.open])).toEqual([
      ["one", true],
      ["two", false],
      ["three", false],
    ]);
  });

  test("open worktrees follow the spaces, closed ones the latest commit", () => {
    const [entry] = buildTree([space("t"), space("m"), space("o")], { t: look("/w/app/three"), m: look("/r/app"), o: look("/w/app/one") }, repos);
    expect(entry?.kids.map((k) => k.name)).toEqual(["three", "one", "two"]);
  });

  test("a closed worktree carries its path, counts and no space", () => {
    const [entry] = buildTree([space("m")], { m: look("/r/app") }, repos);
    expect(entry?.kids.find((k) => k.name === "two")).toMatchObject({ path: "/w/app/two", space: null, behind: 1, open: false, status: null });
  });

  test("a worktree space keeps its status", () => {
    const [entry] = buildTree([space("m"), space("o", { status: "blocked" })], { m: look("/r/app"), o: look("/w/app/one") }, repos);
    expect(entry?.kids[0]?.status).toBe("blocked");
  });

  test("a repo with its main closed still heads the tree", () => {
    const [entry] = buildTree([space("o")], { o: look("/w/app/one") }, repos);
    expect(entry?.main).toMatchObject({ path: "/r/app", name: "app", space: null, open: false });
    expect(entry?.kids[0]?.space?.id).toBe("o");
  });

  test("a repo sits where its main is, else where its first space is", () => {
    const other = { common: "/r/b/.git", name: "b", checkouts: [{ path: "/r/b", branch: "main", main: true }], refs: {} };
    const entries = buildTree(
      [space("o"), space("x"), space("m")],
      { o: look("/w/app/one"), x: { top: "/r/b", common: "/r/b/.git" }, m: look("/r/app") },
      { ...repos, "/r/b/.git": other },
    );
    expect(entries.map((e) => e.key)).toEqual(["/r/b/.git", common]);
  });

  test("a second space in the main checkout stands alone", () => {
    const entries = buildTree([space("m"), space("n")], { m: look("/r/app"), n: look("/r/app") }, repos);
    expect(entries.map((e) => e.kind)).toEqual(["repo", "plain"]);
    expect(entries[0]?.kids.every((k) => !k.open)).toBe(true);
  });

  test("two spaces in one worktree get a row each", () => {
    const [entry] = buildTree([space("m"), space("a"), space("b")], { m: look("/r/app"), a: look("/w/app/one"), b: look("/w/app/one") }, repos);
    expect(entry?.kids.filter((k) => k.name === "one").map((k) => k.space?.id)).toEqual(["a", "b"]);
  });

  test("a space in a subfolder or behind a symlink uses git's top", () => {
    const [entry] = buildTree([space("m"), space("o", { folder: "/link/to/one/src" })], { m: look("/r/app"), o: look("/w/app/one") }, repos);
    expect(entry?.kids.filter((k) => k.name === "one")).toHaveLength(1);
    expect(entry?.kids[0]?.open).toBe(true);
  });

  test("a detached worktree takes its folder's name", () => {
    const detached = { ...appRepo, checkouts: [appRepo.checkouts[0], { path: "/w/app/ação nova", branch: null, main: false }] };
    const [entry] = buildTree([space("m")], { m: look("/r/app") }, { [common]: detached });
    expect(entry?.kids[0]?.name).toBe("ação nova");
  });

  test("a name given by the person wins", () => {
    const [entry] = buildTree(
      [space("m", { named: true, name: "Work" }), space("o", { named: true, name: "Fix" })],
      { m: look("/r/app"), o: look("/w/app/one") },
      repos,
    );
    expect(entry?.main.name).toBe("Work");
    expect(entry?.kids[0]?.name).toBe("Fix");
  });

  test("outside git, unknown, not read yet and remote spaces are plain rows", () => {
    const entries = buildTree(
      [space("a"), space("b"), space("c"), space("d", { machine: "box" })],
      { a: null, b: undefined, c: { top: "/x", common: "/x/.git" }, d: look("/r/app") },
      repos,
    );
    expect(entries.map((e) => e.kind)).toEqual(["plain", "plain", "plain", "plain"]);
    expect(entries[0]?.row).toMatchObject({ name: "a", open: true, status: null });
  });
});
