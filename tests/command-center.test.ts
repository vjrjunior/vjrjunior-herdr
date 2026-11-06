import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  alertState,
  answerStep,
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
  profileOf,
  PROFILES,
  prStep,
  pushLine,
  regenerateStep,
  prChecks,
  scopeLine,
  sendArgs,
  laneSummary,
  skillRecord,
  skillState,
  stepNotes,
  stepsOf,
  transitions,
  viewFor,
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
    expect(parseTask("# Fix the thing\n\nfree text")).toEqual({ id: null, title: "Fix the thing", kind: null, url: null, base: "main", branch: null, session: null, done: [], manual: [], verification: null });
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
const pr = (over: Record<string, unknown> = {}) => ({ number: 42, url: "https://github.com/acme/app/pull/42", state: "OPEN", isDraft: false, reviewDecision: "", checks: checks(), ...over });
const check = (name: string, conclusion: string | null, status = "COMPLETED") => ({
  name,
  state: status !== "COMPLETED" ? "run" : ["SUCCESS", "SKIPPED", "NEUTRAL"].includes(conclusion ?? "") ? "ok" : conclusion === "FAILURE" ? "bad" : "idle",
  detail: (conclusion ?? status).toLowerCase(),
  link: null,
});
function checks(...items: ReturnType<typeof check>[]) {
  return { passed: items.filter((item) => item.state === "ok").length, failed: items.filter((item) => item.state === "bad").map((item) => item.name), pending: items.filter((item) => item.state === "run").length, items };
}

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

  test("a verified task on main ships with its base and scope in a new tab of the worktree", () => {
    const step = nextStep(lane({ verified: "58197b4" }));
    expect(step).toMatchObject({ label: "Run /pp-ship in a new tab", kind: "tab", space: "sp-1234", folder: "/w/cup-1234", name: "ship · CUP-1234", text: scopeLine(task()) });
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
    expect(nextStep(lane({ evidence: current(), pr: pr({ checks: checks(check("test", null, "IN_PROGRESS")) }) }))).toMatchObject({ label: "Open PR #42", kind: "open", url: "https://github.com/acme/app/pull/42" });
    expect(nextStep(lane({ evidence: current(), pr: pr({ reviewDecision: "APPROVED", checks: checks(check("test", "SUCCESS")) }) }))).toMatchObject({ label: "Open PR #42 to merge", kind: "open" });
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
    expect(prStep(pr({ checks: checks(check("test", "FAILURE")) }))).toBe("bad");
    expect(prStep(pr({ checks: checks(check("ci", "FAILURE")) }))).toBe("bad");
    expect(prStep(pr({ reviewDecision: "CHANGES_REQUESTED" }))).toBe("bad");
    expect(prStep(pr({ state: "CLOSED" }))).toBe("bad");
  });

  test("skipped and neutral checks count as passed", () => {
    expect(prStep(pr({ checks: checks(check("lint", "SKIPPED"), check("docs", "NEUTRAL")) }))).toBe("done");
  });

  test("a pending check, a draft or a required review keeps it running", () => {
    expect(prStep(pr({ checks: checks(check("test", null, "IN_PROGRESS")) }))).toBe("run");
    expect(prStep(pr({ checks: checks(check("ci", null, "PENDING")) }))).toBe("run");
    expect(prStep(pr({ isDraft: true }))).toBe("run");
    expect(prStep(pr({ reviewDecision: "REVIEW_REQUIRED" }))).toBe("run");
  });

  test("no PR is todo, a merged one is done", () => {
    expect(prStep(null)).toBe("todo");
    expect(prStep({ error: "GitHub unavailable" })).toBe("todo");
    expect(prStep(pr({ state: "MERGED" }))).toBe("done");
  });

  test("a PR's checks are the ones pp-lane-status reports", () => {
    const summary = prChecks(pr({ checks: checks(check("build", "SUCCESS"), check("test", "FAILURE"), check("e2e", null, "QUEUED")) }));
    expect(summary.failed).toEqual(["test"]);
    expect(summary.pending).toBe(1);
    expect(summary.items.map((item: { name: string; state: string }) => [item.name, item.state])).toEqual([["build", "ok"], ["test", "bad"], ["e2e", "run"]]);
  });

  test("a PR without checks, or no PR, has none", () => {
    expect(prChecks(pr({ checks: undefined }))).toEqual({ items: [], failed: [], pending: 0 });
    expect(prChecks(null)).toEqual({ items: [], failed: [], pending: 0 });
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
    expect(alertState(lane({ evidence: current(), pr: pr({ checks: checks(check("test", "FAILURE")) }) }))).toEqual({ step: "bad", merged: false, number: 42, repo: "app", id: "CUP-1234", reason: "test failed" });
    expect(alertState(lane())).toBeNull();
  });

  test("the badge counts what waits on you and turns red on a failure", () => {
    expect(badge([lane()])).toEqual({ count: 0, level: null });
    expect(badge([lane({ evidence: current(), pr: pr({ reviewDecision: "APPROVED", checks: checks(check("test", "SUCCESS")) }) })])).toEqual({ count: 1, level: "wait" });
    expect(badge([lane({ evidence: current(), pr: pr({ checks: checks(check("test", "FAILURE")) }) }), lane()])).toEqual({ count: 1, level: "bad" });
    expect(badge([lane({ evidence: current(), pr: pr({ state: "MERGED" }) })]).count).toBe(1);
  });
});

describe("chips", () => {
  const chip = (l: any) => chipOf(l, stepsOf(l));
  test("chips follow the first unfinished step", () => {
    expect(chip(lane())).toMatchObject({ chip: "Task", tone: "idle" });
    expect(chip(lane({ skill: waitingAc }))).toMatchObject({ chip: "AC", tone: "blocked" });
    expect(chip(lane({ verified: "aaaaaaa", lastCode: "bbbbbbb" }))).toMatchObject({ chip: "AC stale", tone: "idle" });
    expect(chip(lane({ verified: "58197b4" }))).toMatchObject({ chip: "AC done", tone: "idle" });
    expect(chip(lane({ verified: "58197b4", skill: { family: "ship", skill: "ship", waiting: false, active: true } }))).toMatchObject({ chip: "Ship", tone: "working" });
    expect(chip(lane({ evidence: current(), pr: pr({ checks: checks(check("test", null, "IN_PROGRESS")) }) }))).toMatchObject({ chip: "PR open", tone: "working" });
    expect(chip(lane({ evidence: current(), pr: pr({ reviewDecision: "CHANGES_REQUESTED" }) }))).toMatchObject({ chip: "PR failed", tone: "blocked", why: "changes requested" });
    expect(chip(lane({ evidence: current(), pr: pr({ reviewDecision: "APPROVED", checks: checks(check("test", "SUCCESS")) }) }))).toMatchObject({ chip: "Ready", tone: "done" });
    expect(chip(lane({ evidence: current(), pr: pr({ state: "MERGED" }) }))).toMatchObject({ chip: "Merged", tone: "done", why: "merged · clean up" });
  });

  test("a lane waiting on the person is blocked in its chip too", () => {
    const l = lane({ task: parseTask(fixture("vjr-task-manual.md")), skill: { family: "ac", skill: "vjr-ac", waiting: true, active: true } });
    const found = chip(l);
    expect(found.tone).toBe("blocked");
    expect(found.why).toBe(laneSummary(l).why);
    expect(found.why).toBe("vjr-ac asks D02");
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

describe("review fixes", () => {
  test("a merged PR finishes AC, Ship and Evidence and goes straight to pp-clear", () => {
    const merged = lane({ verified: "aaaaaaa", lastCode: "bbbbbbb", evidence: evidence({ "ship.json": "stale", "screenshots.md": "stale" }), pr: pr({ state: "MERGED" }) });
    expect(stepsOf(merged)).toEqual(["done", "done", "done", "done", "done", "done", "next"]);
    expect(chipOf(merged, stepsOf(merged))).toMatchObject({ chip: "Merged", tone: "done" });
    expect(nextStep(merged).text).toBe("/pp-clear 42");
  });

  test("an open PR with no checks yet is still running", () => {
    expect(prStep(pr())).toBe("run");
    expect(prStep(pr({ reviewDecision: "APPROVED" }))).toBe("run");
    expect(prStep(pr({ checks: checks(check("test", "SUCCESS")) }))).toBe("done");
  });

  test("regenerating the links follows the next-step rules", () => {
    expect(regenerateStep(lane())).toMatchObject({ kind: "send", terminal: "t12", text: "/pp-client-slack-update" });
    expect(regenerateStep(lane({ claude: { terminal: "t12", status: "blocked", count: 1, ambiguous: false } }))).toMatchObject({ disabled: true, target: "claude needs you first" });
    expect(regenerateStep(lane({ skill: waitingAc }))).toMatchObject({ disabled: true });
    expect(regenerateStep(lane({ skill: { family: "ship", skill: "review", waiting: false, active: true } }))).toMatchObject({ disabled: true });
    expect(regenerateStep(lane({ claude: { terminal: null, status: null, count: 0, ambiguous: false } }))).toMatchObject({ kind: "tab", space: "sp-1234", folder: "/w/cup-1234" });
  });

  test("a screenshot name that leaves its folder is dropped", () => {
    const md = "### A\n![a](../../../../.zshrc)\n### B\n![b](sub/x.png)\n### C\n![c](.hidden.png)\n### D\n![d](04-ok_shot.png)";
    expect(parseScreenshots(md).shots.map((shot) => shot.file)).toEqual(["04-ok_shot.png"]);
  });
});

describe("manual checks", () => {
  const manualTask = () => parseTask(fixture("vjr-task-manual.md")) as any;
  const acRunning = { family: "ac", skill: "vjr-ac", waiting: true, active: true };
  const withChecks = (over: Record<string, any> = {}) => lane({ task: manualTask(), skill: acRunning, ...over });

  test("the Manual checks table reads each row, its link and its state", () => {
    expect(manualTask().manual).toEqual([
      { id: "D01", url: "http://app.localhost/inbox", steps: "Type a reply, then reload the page.", expected: "The reply is still in the box.", state: "passed", note: null },
      { id: "D02", url: "http://app.localhost/inbox", steps: "Watch the label under the reply box while typing.", expected: "\"Saving…\" shows, then \"Saved\".", state: "asking", note: null },
      { id: "D03", url: null, steps: "Send a reply, then reload.", expected: "No draft comes back.", state: "pending", note: null },
      { id: "D04", url: "http://app.localhost/inbox", steps: "Hold Send while it saves.", expected: "Send stays enabled.", state: "failed", note: "Send turned grey for a second" },
    ]);
  });

  test("a task without the section has no manual checks", () => {
    expect(parseTask(fixture("vjr-task-1234.md"))?.manual).toEqual([]);
  });

  test("the asking check can be answered in the task's claude", () => {
    expect(answerStep(withChecks(), "D02", "passed")).toEqual({ terminal: "t12", text: "D02 passed" });
    expect(answerStep(withChecks(), "D02", "failed", "  Saved never showed\nafter | reload ")).toEqual({ terminal: "t12", text: "D02 failed: Saved never showed after / reload" });
  });

  test("an answer is refused when the check is not asked, the note is empty, or vjr-ac is not running", () => {
    expect(answerStep(withChecks(), "D03", "passed")).toEqual({ refused: "D03 is not being asked" });
    expect(answerStep(withChecks(), "D02", "failed", "   ")).toEqual({ refused: "Say what you saw" });
    expect(answerStep(withChecks({ skill: null }), "D02", "passed")).toEqual({ refused: "vjr-ac is not running here" });
  });

  test("an answer never goes to a working, blocked, missing or ambiguous claude", () => {
    const claude = (over: Record<string, unknown>) => withChecks({ claude: { terminal: "t12", status: "idle", count: 1, ambiguous: false, ...over } });
    expect(answerStep(claude({ status: "working" }), "D02", "passed")).toEqual({ refused: "claude is working" });
    expect(answerStep(claude({ status: "blocked" }), "D02", "passed")).toEqual({ refused: "claude is waiting on a prompt" });
    expect(answerStep(claude({ terminal: null, count: 0 }), "D02", "passed")).toEqual({ refused: "no claude in this worktree" });
    expect(answerStep(claude({ terminal: null, count: 2, ambiguous: true }), "D02", "passed")).toEqual({ refused: "More than one claude here" });
  });

  test("an idle claude only gets the text if it is still idle when it lands", () => {
    expect(sendArgs({ terminal: "t12", status: "idle" }, "D02 passed")).toEqual(["send", "--if", "idle", "t12", "D02 passed"]);
    expect(sendArgs({ terminal: "t12", status: "done" }, "D02 passed")).toEqual(["send", "t12", "D02 passed"]);
  });

  test("a running AC with manual checks counts the passed ones", () => {
    const l = withChecks();
    expect(chipOf(l, stepsOf(l))).toMatchObject({ chip: "AC 1/4", tone: "blocked", why: "vjr-ac asks D02" });
  });
});

describe("the task's session", () => {
  const SESSION = "36e3d7b8-84b8-4835-b4d8-bdf862298d31";
  const withSession = (text: string, line: string) => text.replace("**Worktree:**", `${line}\n**Worktree:**`);
  const sessionClaude = { terminal: "t30", status: "idle", count: 1, ambiguous: false };
  const record = (over: Record<string, unknown>) => ({ session_id: SESSION, skill: "vjr-task", tty: "ttys030", cwd: "/r/app", started_at: "2026-11-03T10:00:00Z", ended_at: "2026-11-03T10:05:00Z", ...over });

  test("vjr-task's Session line names the session", () => {
    expect(parseTask(withSession(fixture("vjr-task-1234.md"), `**Session:** ${SESSION}`))?.session).toBe(SESSION);
    expect(parseTask(withSession(fixture("vjr-task-1234.md"), "**Session:** ${CLAUDE_SESSION_ID}"))?.session).toBeNull();
    expect(parseTask(fixture("vjr-task-1234.md"))?.session).toBeNull();
  });

  test("the session's record counts for its task wherever the session runs", () => {
    const l = lane({ task: task({ session: SESSION }) });
    const records = [record({ skill: "vjr-ac", started_at: "2026-11-03T11:00:00Z" }), record({ session_id: "other", skill: "review", cwd: "/r/app" })];
    expect(skillRecord(records, l)).toEqual({ record: records[0], from: "session" });
  });

  test("the newest record wins between the session and the worktree", () => {
    const l = lane({ task: task({ session: SESSION }) });
    const tree = record({ session_id: "ship", skill: "pp-ship", tty: "ttys031", cwd: "/w/cup-1234", started_at: "2026-11-03T12:00:00Z" });
    expect(skillRecord([record({ skill: "vjr-ac" }), tree], l)).toEqual({ record: tree, from: "worktree" });
    expect(skillRecord([tree], lane())).toEqual({ record: tree, from: "worktree" });
    expect(skillRecord([record({})], lane())).toBeNull();
  });

  test("only the session's vjr-ac counts for the task; its other skills don't", () => {
    const l = lane({ task: task({ session: SESSION }) });
    expect(skillRecord([record({ skill: "review", started_at: "2026-11-03T13:00:00Z" })], l)).toBeNull();
    const tree = record({ session_id: "ship", skill: "pp-ship", tty: "ttys031", cwd: "/w/cup-1234", started_at: "2026-11-03T12:00:00Z" });
    expect(skillRecord([record({ skill: "docker-cleanup", started_at: "2026-11-03T13:00:00Z" }), tree], l)).toEqual({ record: tree, from: "worktree" });
  });

  test("a session shared by two tasks counts for neither", () => {
    const l = lane({ task: task({ session: SESSION }) });
    expect(skillRecord([record({ skill: "vjr-ac" })], l, new Set([SESSION]))).toBeNull();
  });

  test("vjr-ac goes to the task's session", () => {
    expect(nextStep(lane({ session: sessionClaude }))).toMatchObject({ label: "Run /vjr-ac", kind: "send", terminal: "t30", text: "/vjr-ac", target: "the task's claude · t30" });
  });

  test("vjr-ac falls back to the worktree's claude, then a new tab", () => {
    expect(nextStep(lane({ session: null }))).toMatchObject({ kind: "send", terminal: "t12", target: "claude · t12 in this worktree" });
    expect(nextStep(lane({ session: null, claude: { terminal: null, status: null, count: 0, ambiguous: false } }))).toMatchObject({ kind: "tab", label: "Run /vjr-ac in a new tab" });
  });

  test("a working session waits instead of falling back", () => {
    expect(nextStep(lane({ session: { ...sessionClaude, status: "working" } }))).toMatchObject({ disabled: true, target: "claude is working" });
  });

  test("pp-ship opens a new tab even next to an idle claude", () => {
    const step = nextStep(lane({ verified: "58197b4", session: sessionClaude }));
    expect(step).toMatchObject({ kind: "tab", space: "sp-1234", folder: "/w/cup-1234", name: "ship · CUP-1234" });
    expect(step.terminal).toBeUndefined();
    expect(nextStep(lane({ verified: "58197b4", space: null }))).toMatchObject({ kind: "space", label: "Run /pp-ship in a new space", folder: "/w/cup-1234" });
  });

  test("the push for a stacked task never goes to the session in the main checkout", () => {
    expect(nextStep(lane({ base: "feat/parent", verified: "58197b4", session: sessionClaude }))).toMatchObject({ label: "Push and open draft PR", kind: "send", terminal: "t12" });
    expect(nextStep(lane({ base: "feat/parent", verified: "58197b4", session: sessionClaude, claude: { terminal: null, status: null, count: 0, ambiguous: false } }))).toMatchObject({ kind: "tab" });
  });

  test("a vjr-ac waiting in the session sends you to the session", () => {
    const step = nextStep(lane({ session: sessionClaude, skill: { family: "ac", skill: "vjr-ac", waiting: true, active: true, from: "session" } }));
    expect(step).toMatchObject({ label: "Go to claude", kind: "focus", terminal: "t30" });
  });

  test("a blocked session sends you to it", () => {
    expect(nextStep(lane({ session: { ...sessionClaude, status: "blocked" } }))).toMatchObject({ kind: "focus", terminal: "t30" });
  });

  test("manual checks asked in the session are answered there", () => {
    const l = lane({ task: parseTask(fixture("vjr-task-manual.md")), session: sessionClaude, claude: { terminal: null, status: null, count: 0, ambiguous: false }, skill: { family: "ac", skill: "vjr-ac", waiting: true, active: true, from: "session" } });
    expect(answerStep(l, "D02", "passed")).toEqual({ terminal: "t30", text: "D02 passed" });
  });
});

describe("profiles", () => {
  test("every repo follows Partner Programmer until it is switched off", () => {
    expect(PROFILES.pp.label).toBe("Partner Programmer");
    expect(profileOf({}, "/r/app")).toBe("pp");
    expect(profileOf(null, "/r/app")).toBe("pp");
    expect(profileOf({ "/r/app": "off" }, "/r/app")).toBe("off");
    expect(profileOf({ "/r/app": "nonsense" }, "/r/app")).toBe("pp");
  });
});

describe("one view per checkout", () => {
  const repos = [{ name: "app", main: "/r/app", trees: ["/r/app", "/w/cup-1234", "/w/bare"] }, { name: "site", main: "/r/site", trees: ["/r/site"] }];
  const one = lane();
  const state = { lanes: [one], repos };

  test("a worktree with a task shows its task", () => {
    expect(viewFor("/w/cup-1234/src", state, {})).toEqual({ kind: "task", lane: one, repo: repos[0] });
  });

  test("the main checkout shows the repo and its tasks", () => {
    expect(viewFor("/r/app", state, {})).toEqual({ kind: "repo", repo: repos[0], lanes: [one] });
    expect(viewFor("/r/site/docs", state, {})).toEqual({ kind: "repo", repo: repos[1], lanes: [] });
  });

  test("a worktree without a task says so", () => {
    expect(viewFor("/w/bare", state, {})).toEqual({ kind: "bare", repo: repos[0] });
  });

  test("a repo switched off shows nothing but the switch", () => {
    expect(viewFor("/w/cup-1234", state, { "/r/app": "off" })).toEqual({ kind: "off", repo: repos[0] });
    expect(viewFor("/r/app", state, { "/r/app": "off" })).toEqual({ kind: "off", repo: repos[0] });
  });

  test("outside every repo there is nothing to show", () => {
    expect(viewFor("/Users/me", state, {})).toEqual({ kind: "none" });
    expect(viewFor(null, state, {})).toEqual({ kind: "none" });
  });

  test("a worktree nested in the main checkout is still its own task", () => {
    const nested = lane({ key: "/r/app/.worktrees/x", path: "/r/app/.worktrees/x" });
    expect(viewFor("/r/app/.worktrees/x", { lanes: [nested], repos: [{ name: "app", main: "/r/app", trees: ["/r/app", "/r/app/.worktrees/x"] }] }, {}).kind).toBe("task");
  });
});

describe("step notes", () => {
  test("each step says what happened or what comes next", () => {
    const planned = lane();
    expect(stepNotes(planned, stepsOf(planned))).toEqual(["4 done items", "next: /vjr-ac", "/pp-ship in a new tab", "4 receipts", "no PR yet", "you merge on GitHub", "/pp-clear from main"]);
  });

  test("a running AC counts its checks and a verified one shows its sha", () => {
    const asking = lane({ task: parseTask(fixture("vjr-task-manual.md")), skill: { family: "ac", skill: "vjr-ac", waiting: true, active: true } });
    expect(stepNotes(asking, stepsOf(asking))[1]).toBe("1 of 4 checks");
    const verified = lane({ verified: "58197b4" });
    expect(stepNotes(verified, stepsOf(verified))[1]).toBe("verified · 58197b4");
  });

  test("an open PR shows its number and checks, a merged one says so", () => {
    const open = lane({ evidence: current(), pr: pr({ number: 482, isDraft: true, checks: checks(check("lint", "SUCCESS"), check("e2e", null, "IN_PROGRESS")) }) });
    expect(stepNotes(open, stepsOf(open)).slice(2, 5)).toEqual(["shipped", "4 of 4 current", "#482 · 1/2 checks · draft"]);
    const done = lane({ evidence: current(), pr: pr({ number: 482, state: "MERGED" }) });
    expect(stepNotes(done, stepsOf(done)).slice(4)).toEqual(["#482 merged", "merged", "/pp-clear from main"]);
  });

  test("a GitHub error shows on the PR step", () => {
    const l = lane({ pr: { error: "gh: not logged in" } });
    expect(stepNotes(l, stepsOf(l))[4]).toBe("GitHub unavailable");
  });
});

describe("repo rows", () => {
  test("a task waiting on you is red and says why", () => {
    const l = lane({ task: parseTask(fixture("vjr-task-manual.md")), skill: { family: "ac", skill: "vjr-ac", waiting: true, active: true } });
    expect(laneSummary(l)).toMatchObject({ stage: 1, tone: "blocked", why: "vjr-ac asks D02", action: "Go to task" });
  });

  test("a running PR is working, a ready one offers the PR, a merged one the cleanup", () => {
    expect(laneSummary(lane({ evidence: current(), pr: pr({ checks: checks(check("e2e", null, "IN_PROGRESS")) }) }))).toMatchObject({ stage: 4, tone: "working", action: null });
    expect(laneSummary(lane({ evidence: current(), pr: pr({ reviewDecision: "APPROVED", checks: checks(check("e2e", "SUCCESS")) }) }))).toMatchObject({ stage: 5, tone: "done", action: "Open PR" });
    expect(laneSummary(lane({ evidence: current(), pr: pr({ state: "MERGED" }) }))).toMatchObject({ stage: 6, tone: "done", why: "merged · clean up", action: "Run /pp-clear" });
  });

  test("a failed PR is red", () => {
    expect(laneSummary(lane({ evidence: current(), pr: pr({ checks: checks(check("e2e", "FAILURE")) }) }))).toMatchObject({ stage: 4, tone: "blocked", why: "e2e failed" });
  });

  test("a task with nothing to do yet is idle and shows its next step", () => {
    expect(laneSummary(lane())).toMatchObject({ stage: 1, tone: "idle", why: "next: /vjr-ac", action: null });
  });
});
