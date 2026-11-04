import { describe, expect, test } from "bun:test";
import {
  accepts,
  assignColors,
  base,
  branchLabel,
  buildTree,
  canOpen,
  checkoutOf,
  counts,
  DRAG_TTL,
  dropTarget,
  duePlaces,
  foldedTail,
  holdsActive,
  isFolded,
  liveFolds,
  mostUrgent,
  parseRefs,
  parseWorktrees,
  place,
  readLook,
  repoName,
} from "../mods/spaces-tree/tree.js";

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

describe("duePlaces", () => {
  const quiet = {
    places: { s: "/r/app" },
    lastPlaces: { s: "/r/app" },
    busy: { p: false },
    lastBusy: { p: false },
    paneSpace: { p: "s" },
    looks: { "/r/app": { top: "/r/app", common } } as Record<string, { top: string; common: string } | null>,
    unsure: new Set<string>(),
    checked: { "/r/app": 1000 } as Record<string, number>,
    time: 2000,
    active: true,
    folded: new Set<string>(),
  };

  test("nothing is due while nothing changes", () => {
    expect(duePlaces(quiet).size).toBe(0);
  });

  test("a new place is due", () => {
    expect([...duePlaces({ ...quiet, places: { s: "/r/app", n: "/new" } })]).toEqual(["/new"]);
  });

  test("a space that moved to a known place is due", () => {
    const moved = { ...quiet, places: { s: "/r/other" }, looks: { ...quiet.looks, "/r/other": null }, checked: { "/r/other": 1000 } };
    expect([...duePlaces(moved)]).toEqual(["/r/other"]);
  });

  test("a pane that stopped working makes its repo's places due", () => {
    const twin = {
      ...quiet,
      places: { s: "/r/app", t: "/w/app/one" },
      lastPlaces: { s: "/r/app", t: "/w/app/one" },
      looks: { ...quiet.looks, "/w/app/one": { top: "/w/app/one", common } },
      checked: { "/r/app": 1000, "/w/app/one": 1000 },
      lastBusy: { p: true },
    };
    expect([...duePlaces(twin)].sort()).toEqual(["/r/app", "/w/app/one"]);
  });

  test("the fallback waits sixty seconds and needs the window in front", () => {
    expect([...duePlaces({ ...quiet, time: 61001 })]).toEqual(["/r/app"]);
    expect(duePlaces({ ...quiet, time: 61001, active: false }).size).toBe(0);
    expect(duePlaces({ ...quiet, time: 60999 }).size).toBe(0);
  });

  test("a folded repo skips the fallback", () => {
    expect(duePlaces({ ...quiet, time: 61001, folded: new Set([common]) }).size).toBe(0);
  });

  test("a place git could not answer for comes back at the fallback", () => {
    const lost = { ...quiet, looks: {}, unsure: new Set(["/r/app"]), time: 61001 };
    expect([...duePlaces(lost)]).toEqual(["/r/app"]);
  });

  test("a place outside git is not asked again by the fallback", () => {
    expect(duePlaces({ ...quiet, looks: { "/r/app": null }, time: 61001 }).size).toBe(0);
  });
});

describe("assignColors", () => {
  test("keeps what is stored and drops dead ids", () => {
    expect(assignColors([space("a")], { a: "ansi3", dead: "ansi4" })).toEqual({ colors: { a: "ansi3" }, changed: true });
  });

  test("gives a new space the least used color", () => {
    expect(assignColors([space("a"), space("b")], { a: "ansi6" }).colors.b).toBe("ansi3");
  });

  test("leaves the home space without a color", () => {
    expect(assignColors([space("h", { name: "~" })], {}).colors).toEqual({});
  });

  test("reports no change when there is none", () => {
    expect(assignColors([space("a")], { a: "ansi6" }).changed).toBe(false);
  });
});

describe("row rules", () => {
  const [entry] = buildTree([space("m"), space("o", { active: true, status: "blocked" })], { m: look("/r/app"), o: look("/w/app/one") }, repos);

  test("a repo holding the active space says so", () => {
    expect(holdsActive(entry as never)).toBe(true);
  });

  test("a folded repo shows its count and most urgent status", () => {
    expect(foldedTail(entry as never)).toEqual({ count: 3, status: "blocked" });
  });

  test("a second click on a closed row opens nothing", () => {
    expect(canOpen({}, "/w", 5000)).toBe(true);
    expect(canOpen({ "/w": 4000 }, "/w", 5000)).toBe(false);
    expect(canOpen({ "/w": 1000 }, "/w", 5000)).toBe(true);
  });

  test("counts and the branch label stay quiet when there is nothing to say", () => {
    expect(counts({ ahead: 1, behind: 2 } as never)).toBe("↑1 ↓2");
    expect(counts({ ahead: 0, behind: 0 } as never)).toBe("");
    expect(branchLabel({ branch: "main" } as never)).toBe("");
    expect(branchLabel({ branch: "vjr" } as never)).toBe("vjr");
  });
});

describe("place", () => {
  test("follows the first pane with a folder", () => {
    const panes = [
      { tab: "t", cwd: null },
      { tab: "t", cwd: "/live" },
    ];
    expect(place(space("s", { folder: "/old", tabs: [{ id: "t" }] }) as never, panes as never)).toBe("/live");
  });

  test("falls back to the space's folder", () => {
    expect(place(space("s", { folder: "/old" }) as never, [])).toBe("/old");
  });
});

describe("folds", () => {
  const solo = { common: "/r/solo/.git", name: "solo", checkouts: [{ path: "/r/solo", branch: "vjr", main: true }], refs: {} };

  test("only a repository with worktrees can be folded", () => {
    const entries = buildTree([space("m"), space("s")], { m: look("/r/app"), s: { top: "/r/solo", common: solo.common } }, { ...repos, [solo.common]: solo });
    const folded = new Set([common, solo.common]);
    expect(entries.map((entry) => isFolded(folded, entry as never))).toEqual([true, false]);
  });

  test("a fold on a repository without worktrees does not hold back its refresh", () => {
    expect([...liveFolds(new Set([common, solo.common, "/gone/.git"]), { ...repos, [solo.common]: solo })]).toEqual([common]);
  });
});

describe("drops", () => {
  const drag = { tab: "t1", space: "m", at: 1000 };
  const [entry] = buildTree([space("m"), space("o"), space("x")], { m: look("/r/app"), o: look("/w/app/one") }, repos);
  const repoEntry = entry as never as { kind: string; key: string; main: Record<string, any>; kids: Record<string, any>[] };
  const kid = (path: string) => repoEntry.kids.find((row) => row.path === path) as Record<string, any>;

  test("accepts a fresh drag over another checkout of the same repo", () => {
    const open = kid("/w/app/one");
    const closed = kid("/w/app/two");
    expect(dropTarget(repoEntry as never, open as never, undefined)).toEqual({ path: "/w/app/one", common });
    expect(accepts(drag, dropTarget(repoEntry as never, open as never, undefined), open, common, 1000)).toBe(true);
    expect(accepts(drag, dropTarget(repoEntry as never, closed as never, undefined), closed, common, 1000 + DRAG_TTL - 1)).toBe(true);
    const extra = { key: "e", path: null, space: space("e") };
    const target = dropTarget({ kind: "plain", key: "e" } as never, extra as never, look("/r/app"));
    expect(target).toEqual({ path: "/r/app", common });
    expect(accepts(drag, target, extra, common, 1000)).toBe(true);
    expect(DRAG_TTL).toBe(30000);
  });

  test("refuses its own space, another repo, a plain non-repo row and a 31-second-old drag", () => {
    const own = repoEntry.main;
    expect(own.space.id).toBe("m");
    expect(accepts(drag, dropTarget(repoEntry as never, own as never, undefined), own, common, 1000)).toBe(false);
    const open = kid("/w/app/one");
    const target = dropTarget(repoEntry as never, open as never, undefined);
    expect(accepts(drag, target, open, "/r/other/.git", 1000)).toBe(false);
    const plain = { key: "x", path: null, space: space("x") };
    expect(dropTarget({ kind: "plain", key: "x" } as never, plain as never, null)).toBeNull();
    expect(accepts(drag, null, plain, common, 1000)).toBe(false);
    expect(accepts(drag, target, open, common, 1000 + 31000)).toBe(false);
    expect(accepts(null, target, open, common, 1000)).toBe(false);
    expect(accepts(drag, target, open, null, 1000)).toBe(false);
  });
});
