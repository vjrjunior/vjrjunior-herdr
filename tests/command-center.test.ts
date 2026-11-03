import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  alertState,
  badge,
  captionsFor,
  chipOf,
  familyOf,
  nextStep,
  noteOf,
  parseMessage,
  parseScreenshots,
  parseTask,
  parseWorktrees,
  pickClaude,
  prStep,
  pushLine,
  rollup,
  scopeLine,
  skillState,
  stepsOf,
  transitions,
} from "../mods/command-center/logic.js";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/command-center", name), "utf8");

describe("task file", () => {
  test("a task reads its id, title, link, base and branch", () => {
    const task = parseTask(fixture("vjr-task-1234.md"));
    expect(task).toMatchObject({ id: "CUP-1234", kind: "bug", url: "https://app.clickup.com/t/86abc1234", base: "main", branch: "fix/cup-1234-draft-reload" });
    expect(task?.title).toBe("A saved draft disappears when the page reloads before the autosave lands");
  });

  test("done items come from the Done table only", () => {
    expect(parseTask(fixture("vjr-task-verified.md"))?.done.map((item) => item.id)).toEqual(["D01", "D02", "D03", "D04"]);
    expect(parseTask(fixture("vjr-task-1234.md"))?.done[0]).toEqual({ id: "D01", item: "O rascunho continua depois de recarregar a página" });
  });

  test("no verification until vjr-ac writes one", () => {
    expect(parseTask(fixture("vjr-task-1234.md"))?.verification).toBeNull();
  });

  test("the last verification gives its sha, gates and rows", () => {
    const verification = parseTask(fixture("vjr-task-verified.md"))?.verification;
    expect(verification?.sha).toBe("58197b4");
    expect(verification?.gates).toContain("tests 8140 passed");
    expect(verification?.review).toBe("3 in scope, fixed · 17 outside the task, dropped");
    expect(verification?.rows[0]).toEqual({ id: "D01", verdict: "Done", where: "lib/drafts/save.ts:41", manual: "—" });
    expect(verification?.limits).toBe("none");
  });

  test("a later verification wins over an earlier one", () => {
    const text = `${fixture("vjr-task-verified.md")}\n## Verification — 9f00aa1\n\nGates: tests 9000 passed\n`;
    expect(parseTask(text)?.verification).toMatchObject({ sha: "9f00aa1", gates: "tests 9000 passed", rows: [] });
  });

  test("a task without a Done table or header fields still reads", () => {
    expect(parseTask("# Fix the thing\n\nfree text")).toEqual({ id: null, title: "Fix the thing", kind: null, url: null, base: "main", branch: null, done: [], verification: null });
  });

  test("a file without a title is not a task", () => {
    expect(parseTask("no heading")).toBeNull();
    expect(parseTask("")).toBeNull();
  });
});

describe("worktrees", () => {
  test("worktrees list the main checkout first", () => {
    expect(parseWorktrees(fixture("worktrees.txt"))).toEqual([
      { path: "/Users/someone/code/app", branch: "main", main: true },
      { path: "/Users/someone/Local Sites/acme/app-worktrees/cup-1234-draft-reload", branch: "fix/cup-1234-draft-reload", main: false },
      { path: "/Users/someone/code/app-worktrees/detached", branch: null, main: false },
    ]);
  });
});

describe("release files", () => {
  test("the release message reads its version, title and linked items", () => {
    const message = parseMessage(fixture("message.txt"));
    expect(message.release).toBe("2.3.0");
    expect(message.title).toBe("Drafts Survive a Reload 💾✨");
    expect(message.items).toHaveLength(2);
    expect(message.items[0].parts).toEqual([
      { text: "Replies you were typing are still there after a reload, from the " },
      { text: "Inbox page", url: "http://app.fix-cup-1234-draft-reload.localhost/inbox" },
    ]);
    expect(message.items[1].parts).toEqual([{ text: "A sent reply never comes back as a draft" }]);
  });

  test("screenshots list their title, alt and file in order", () => {
    const parsed = parseScreenshots(fixture("screenshots.md"));
    expect(parsed.covers).toBe("58197b4b2aeb820e4ebd94758581fcb1180d3f23");
    expect(parsed.shots[0]).toEqual({ title: "Inbox — draft saving", alt: "The reply box with the saving indicator", file: "01-inbox-draft-saving.png" });
    expect(parsed.shots.map((shot) => shot.file.slice(0, 2))).toEqual(["01", "02", "03"]);
  });

  test("captioned screenshots come first, the rest keep their alt", () => {
    const list = captionsFor(JSON.parse(fixture("meta.json")), parseScreenshots(fixture("screenshots.md")).shots);
    expect(list.map((shot) => [shot.file.slice(0, 2), shot.featured])).toEqual([["02", true], ["03", true], ["01", false]]);
    expect(list[0].caption).toBe("The reply is still there after a reload");
    expect(list[2].caption).toBe("The reply box with the saving indicator");
  });

  test("a caption for a missing screenshot is dropped", () => {
    expect(captionsFor({ captions: { "09-gone.png": "Gone" } }, [])).toEqual([]);
  });
});

const task = (over: Record<string, unknown> = {}) => ({ ...(parseTask(fixture("vjr-task-1234.md")) as object), ...over }) as any;
const verification = (sha: string) => ({ sha, gates: null, review: null, rows: [], limits: null });
const FILES = ["ship.json", "screenshots.md", "message.txt", "meta.json"];
const evidence = (files: Record<string, string> = {}) => {
  const all = Object.fromEntries(FILES.map((file) => [file, files[file] ?? "missing"]));
  return { ready: FILES.every((file) => all[file] === "current"), files: all };
};
const current = () => evidence(Object.fromEntries(FILES.map((file) => [file, "current"])));
const pr = (over: Record<string, unknown> = {}) => ({ number: 42, url: "https://github.com/acme/app/pull/42", state: "OPEN", isDraft: false, reviewDecision: "", statusCheckRollup: [], ...over });
const check = (name: string, conclusion: string | null, status = "COMPLETED") => ({ __typename: "CheckRun", name, status, conclusion });

function lane(over: Record<string, any> = {}): any {
  const { verified, base, ...rest } = over;
  return {
    key: "/w/cup-1234",
    path: "/w/cup-1234",
    repo: { name: "app", main: "/r/app" },
    space: "sp-1234",
    mainSpace: "sp-main",
    branch: "fix/cup-1234-draft-reload",
    task: task({ base: base ?? "main", verification: verified ? verification(verified) : null }),
    lastCode: "58197b4f00",
    sinceVerified: 0,
    skill: null,
    claude: { terminal: "t12", status: "idle", count: 1, ambiguous: false },
    evidence: null,
    pr: null,
    ...rest,
  };
}

const waitingAc = { family: "ac", skill: "vjr-ac", waiting: true, active: true };

describe("next step", () => {
  test("a planned task runs vjr-ac in its own claude", () => {
    expect(nextStep(lane())).toMatchObject({ label: "Run /vjr-ac", kind: "send", terminal: "t12", text: "/vjr-ac", target: "claude · t12 in this worktree" });
  });

  test("a vjr-ac paused on a manual check waits on you", () => {
    const paused = lane({ skill: waitingAc });
    expect(stepsOf(paused)[1]).toBe("run");
    expect(nextStep(paused)).toMatchObject({ label: "Go to claude", kind: "focus", terminal: "t12" });
    expect(badge([paused]).count).toBe(1);
  });

  test("a blocked claude is the next step even without a skill record", () => {
    expect(nextStep(lane({ claude: { terminal: "t12", status: "blocked", count: 1, ambiguous: false } }))).toMatchObject({ kind: "focus", terminal: "t12" });
  });

  test("a working skill blocks every send", () => {
    expect(nextStep(lane({ skill: { family: "ship", skill: "review", waiting: false, active: true } }))).toMatchObject({ kind: "wait", label: "Waiting for /review", disabled: true });
  });

  test("a working claude disables the button", () => {
    expect(nextStep(lane({ claude: { terminal: "t12", status: "working", count: 1, ambiguous: false } }))).toMatchObject({ disabled: true, target: "claude is working", text: "/vjr-ac" });
  });

  test("two claudes without a matching tty send nothing", () => {
    const step = nextStep(lane({ claude: { terminal: null, status: null, count: 2, ambiguous: true } }));
    expect(step).toMatchObject({ disabled: true, target: "More than one claude here" });
    expect(step.terminal).toBeUndefined();
  });

  test("no claude opens a new tab in the task's space", () => {
    expect(nextStep(lane({ claude: { terminal: null, status: null, count: 0, ambiguous: false } }))).toMatchObject({ label: "Run /vjr-ac in a new tab", kind: "tab", space: "sp-1234", text: "/vjr-ac", target: "new tab in app" });
  });

  test("no claude and no space opens a new space in the worktree", () => {
    expect(nextStep(lane({ space: null, claude: { terminal: null, status: null, count: 0, ambiguous: false } }))).toMatchObject({ kind: "space", folder: "/w/cup-1234", text: "/vjr-ac" });
  });

  test("a verified task on main ships with its base and scope", () => {
    const step = nextStep(lane({ verified: "58197b4" }));
    expect(step).toMatchObject({ label: "Run /pp-ship", kind: "send", text: scopeLine(task()) });
    expect(step.text.startsWith("/pp-ship --base main Scope: CUP-1234's done items D01–D04 only. Step 8: no plan file")).toBe(true);
    expect(step.text).not.toContain("\n");
  });

  test("a stacked task pushes and opens a draft PR first, then ships", () => {
    const first = nextStep(lane({ base: "feat/parent", verified: "58197b4" }));
    expect(first).toMatchObject({ label: "Push and open draft PR", kind: "send" });
    expect(first.text).toContain("--base feat/parent");
    expect(first.text.startsWith("!git push -u origin HEAD && gh pr create --draft")).toBe(true);
    const second = nextStep(lane({ base: "feat/parent", verified: "58197b4", pr: pr({ isDraft: true }) }));
    expect(second.text.startsWith("/pp-ship --base feat/parent Scope:")).toBe(true);
  });

  test("a title with a quote stays one shell word", () => {
    expect(pushLine(task({ title: "Don't drop it", base: "feat/parent" }))).toContain("--title 'Don'\\''t drop it (CUP-1234)'");
  });

  test("stale evidence with nothing running refreshes it", () => {
    expect(nextStep(lane({ verified: "58197b4", evidence: evidence({ "ship.json": "current", "screenshots.md": "stale" }), pr: pr({ isDraft: true }) }))).toMatchObject({ label: "Run /pp-pr-ready", text: "/pp-pr-ready" });
  });

  test("an open PR opens in the browser, a ready one to merge", () => {
    expect(nextStep(lane({ evidence: current(), pr: pr({ statusCheckRollup: [check("test", null, "IN_PROGRESS")] }) }))).toMatchObject({ label: "Open PR #42", kind: "open", url: "https://github.com/acme/app/pull/42" });
    expect(nextStep(lane({ evidence: current(), pr: pr({ reviewDecision: "APPROVED", statusCheckRollup: [check("test", "SUCCESS")] }) }))).toMatchObject({ label: "Open PR #42 to merge", kind: "open" });
  });

  test("a merged PR runs pp-clear in the main checkout, never in the worktree", () => {
    expect(nextStep(lane({ evidence: current(), pr: pr({ state: "MERGED" }) }))).toMatchObject({ label: "Run /pp-clear", kind: "tab", space: "sp-main", text: "/pp-clear 42", target: "new tab in app" });
    expect(nextStep(lane({ mainSpace: null, evidence: current(), pr: pr({ state: "MERGED" }) }))).toMatchObject({ kind: "space", folder: "/r/app", text: "/pp-clear 42" });
  });
});

describe("steps", () => {
  test("a stale verification asks for vjr-ac only before shipping", () => {
    expect(stepsOf(lane({ verified: "aaaaaaa", lastCode: "bbbbbbb" }))[1]).toBe("bad");
    expect(stepsOf(lane({ verified: "aaaaaaa", lastCode: "bbbbbbb", evidence: evidence({ "ship.json": "stale" }) }))[1]).toBe("done");
    expect(stepsOf(lane({ verified: "aaaaaaa", lastCode: "bbbbbbb", pr: pr() }))[1]).toBe("done");
  });

  test("the whole track of a merged task", () => {
    expect(stepsOf(lane({ verified: "58197b4", evidence: current(), pr: pr({ state: "MERGED" }) }))).toEqual(["done", "done", "done", "done", "done", "done", "next"]);
  });

  test("a running ship shows on Ship, then on Evidence", () => {
    const ship = { family: "ship", skill: "ship", waiting: false, active: true };
    expect(stepsOf(lane({ verified: "58197b4", skill: ship }))[2]).toBe("run");
    const later = stepsOf(lane({ verified: "58197b4", skill: ship, evidence: evidence({ "ship.json": "current" }) }));
    expect([later[2], later[3]]).toEqual(["done", "run"]);
  });

  test("the note counts code commits since vjr-ac once shipped", () => {
    expect(noteOf(lane({ verified: "aaaaaaa", lastCode: "bbbbbbb", sinceVerified: 3, pr: pr() }))).toBe("3 code commits since vjr-ac");
    expect(noteOf(lane({ verified: "58197b4" }))).toBeNull();
  });
});

describe("pull request", () => {
  test("a failed check or requested changes is bad", () => {
    expect(prStep(pr({ statusCheckRollup: [check("test", "FAILURE")] }))).toBe("bad");
    expect(prStep(pr({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci", state: "ERROR" }] }))).toBe("bad");
    expect(prStep(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe("bad");
    expect(prStep(pr({ state: "CLOSED" }))).toBe("bad");
  });

  test("skipped and neutral checks count as passed", () => {
    expect(prStep(pr({ statusCheckRollup: [check("lint", "SKIPPED"), check("docs", "NEUTRAL")] }))).toBe("done");
  });

  test("a pending check, a draft or a required review keeps it running", () => {
    expect(prStep(pr({ statusCheckRollup: [check("test", null, "IN_PROGRESS")] }))).toBe("run");
    expect(prStep(pr({ statusCheckRollup: [{ __typename: "StatusContext", context: "ci", state: "PENDING" }] }))).toBe("run");
    expect(prStep(pr({ isDraft: true }))).toBe("run");
    expect(prStep(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toBe("run");
  });

  test("no PR is todo, a merged one is done", () => {
    expect(prStep(null)).toBe("todo");
    expect(prStep({ error: "GitHub unavailable" })).toBe("todo");
    expect(prStep(pr({ state: "MERGED" }))).toBe("done");
  });

  test("the rollup names what failed and counts what runs", () => {
    const summary = rollup([check("build", "SUCCESS"), check("test", "FAILURE"), check("e2e", null, "QUEUED"), { __typename: "StatusContext", context: "PR Evidence", state: "SUCCESS" }]);
    expect(summary.failed).toEqual(["test"]);
    expect(summary.pending).toBe(1);
    expect(summary.items.map((item) => [item.name, item.state])).toEqual([["build", "ok"], ["test", "bad"], ["e2e", "run"], ["PR Evidence", "ok"]]);
  });
});

describe("alerts and badge", () => {
  const running = { step: "run", merged: false, number: 42, repo: "app", id: "CUP-1234", reason: "" };
  const readyPr = { ...running, step: "done" };
  const badPr = { ...running, step: "bad", reason: "test failed" };

  test("transitions only fire on a change seen twice", () => {
    expect(transitions({}, { a: readyPr })).toEqual([]);
    expect(transitions({ a: running }, { a: readyPr })).toEqual([{ key: "a", title: "PR #42 is ready to merge", body: "app · CUP-1234 · all checks passed", level: "success" }]);
    expect(transitions({ a: readyPr }, { a: readyPr })).toEqual([]);
  });

  test("a failure and a merge each alert once", () => {
    expect(transitions({ a: running }, { a: badPr })[0]).toMatchObject({ title: "PR #42 needs attention", body: "app · CUP-1234 · test failed", level: "warning" });
    expect(transitions({ a: readyPr }, { a: { ...readyPr, merged: true } })[0]).toMatchObject({ title: "PR #42 merged", body: "app · CUP-1234 · Copy the release message", level: "success" });
  });

  test("the alert state reads the PR of a lane", () => {
    expect(alertState(lane({ evidence: current(), pr: pr({ statusCheckRollup: [check("test", "FAILURE")] }) }))).toEqual({ step: "bad", merged: false, number: 42, repo: "app", id: "CUP-1234", reason: "test failed" });
    expect(alertState(lane())).toBeNull();
  });

  test("the badge counts what waits on you and turns red on a failure", () => {
    expect(badge([lane()])).toEqual({ count: 0, level: null });
    expect(badge([lane({ evidence: current(), pr: pr({ reviewDecision: "APPROVED" }) })])).toEqual({ count: 1, level: "wait" });
    expect(badge([lane({ evidence: current(), pr: pr({ statusCheckRollup: [check("test", "FAILURE")] }) }), lane()])).toEqual({ count: 1, level: "bad" });
    expect(badge([lane({ evidence: current(), pr: pr({ state: "MERGED" }) })]).count).toBe(1);
  });
});

describe("chips", () => {
  const chip = (l: any) => chipOf(l, stepsOf(l));
  test("chips follow the first unfinished step", () => {
    expect(chip(lane())).toEqual({ chip: "Task", tone: "idle" });
    expect(chip(lane({ skill: waitingAc }))).toEqual({ chip: "AC", tone: "work" });
    expect(chip(lane({ verified: "aaaaaaa", lastCode: "bbbbbbb" }))).toEqual({ chip: "AC stale", tone: "bad" });
    expect(chip(lane({ verified: "58197b4" }))).toEqual({ chip: "AC ✓", tone: "done" });
    expect(chip(lane({ verified: "58197b4", skill: { family: "ship", skill: "ship", waiting: false, active: true } }))).toEqual({ chip: "Ship", tone: "work" });
    expect(chip(lane({ evidence: current(), pr: pr({ statusCheckRollup: [check("test", null, "IN_PROGRESS")] }) }))).toEqual({ chip: "PR ●", tone: "work" });
    expect(chip(lane({ evidence: current(), pr: pr({ reviewDecision: "CHANGES_REQUESTED" }) }))).toEqual({ chip: "PR ✕", tone: "bad" });
    expect(chip(lane({ evidence: current(), pr: pr({ reviewDecision: "APPROVED" }) }))).toEqual({ chip: "Ready", tone: "done" });
    expect(chip(lane({ evidence: current(), pr: pr({ state: "MERGED" }) }))).toEqual({ chip: "Merged", tone: "done" });
  });
});

describe("sessions", () => {
  test("pickClaude takes the tty of the latest skill run", () => {
    const claudes = [{ terminal: "t1", status: "idle", tty: "ttys001" }, { terminal: "t2", status: "idle", tty: "ttys002" }];
    expect(pickClaude(claudes, { tty: "ttys002" })).toEqual({ terminal: "t2", status: "idle", count: 2, ambiguous: false });
    expect(pickClaude(claudes, { tty: "ttys009" })).toEqual({ terminal: null, status: null, count: 2, ambiguous: true });
    expect(pickClaude([claudes[0]], null)).toEqual({ terminal: "t1", status: "idle", count: 1, ambiguous: false });
    expect(pickClaude([], null)).toEqual({ terminal: null, status: null, count: 0, ambiguous: false });
  });

  test("skills group into families", () => {
    expect(["vjr-task", "vjr-ac", "review", "pp-client-slack-update", "pp-worktree-close", "investigate"].map(familyOf)).toEqual(["task", "ac", "ship", "ship", "clear", null]);
  });

  test("a vjr-ac stays active until its verification lands, waiting once its turn ends", () => {
    const record = { skill: "vjr-ac", started_at: "2026-11-02T20:00:00Z", ended_at: "2026-11-02T20:05:00Z" };
    expect(skillState(record, lane())).toEqual({ family: "ac", skill: "vjr-ac", waiting: true, active: true });
    expect(skillState({ ...record, ended_at: null }, lane()).waiting).toBe(false);
    expect(skillState(record, lane({ verified: "58197b4" })).active).toBe(false);
  });

  test("a ship stays active until the evidence is ready and the PR left draft", () => {
    const record = { skill: "pp-pr-screenshots", started_at: "2026-11-02T20:00:00Z", ended_at: null };
    expect(skillState(record, lane({ evidence: current(), pr: pr({ isDraft: true }) })).active).toBe(true);
    expect(skillState(record, lane({ evidence: current(), pr: pr() })).active).toBe(false);
    expect(skillState(record, lane({ pr: pr({ state: "MERGED" }) })).active).toBe(false);
  });

  test("other skills never block the lane", () => {
    expect(skillState({ skill: "investigate", started_at: "2026-11-02T20:00:00Z", ended_at: null }, lane())).toEqual({ family: null, skill: "investigate", waiting: false, active: false });
    expect(skillState(null, lane())).toBeNull();
  });
});
