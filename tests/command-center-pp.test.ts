import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PP_STEPS, ppChip, ppNext, ppSignals, ppSummary, ppWaits } from "../mods/command-center/flow-pp.js";
import { factsOf } from "../mods/command-center/lane-status.js";

const report = JSON.parse(readFileSync(join(import.meta.dir, "fixtures/command-center/lane-status.json"), "utf8"));
const REPO = { name: "app", main: "/r/app" };

const lane = (index: number, space: string, place: Record<string, unknown> = {}) =>
  ppSignals(report.lanes[index], factsOf(report.lanes[index], report), { repo: REPO, space, mainSpace: "sp-main", claudes: [], ...place });
const lincoln = (place = {}) => lane(0, "sp-l", place);
const bruno = (place = {}) => lane(1, "sp-b", place);
const gabriel = (place = {}) => lane(2, "sp-g", place);
const merged = (place = {}) => lane(3, "sp-m", place);
const idle11 = { claudes: [{ terminal: "t11", status: "idle", tty: "ttys011" }] };

describe("Work - PP lane", () => {
  test("a lane keeps the report's track, task and facts", () => {
    const l = bruno();
    expect(PP_STEPS).toEqual(["Build", "Ship", "Evidence", "PR", "Merge", "Clear"]);
    expect(l).toMatchObject({ key: "/w/app-cup-7001", path: "/w/app-cup-7001", flow: "pp", space: "sp-b", mainSpace: "sp-main", repo: REPO });
    expect(l.task).toEqual({ id: "CUP-7001", title: "Child of the umbrella", url: "https://app.clickup.com/t/86abc7001", source: "claim", base: "feat/CUP-7000", branch: "feat/CUP-7000--cup-7001-umbrella-child" });
    expect(l.steps).toEqual(["done", "done", "next", "run", "todo", "todo"]);
    expect(l.notes[2]).toBe("2 of 4 current");
    expect(l.pr).toMatchObject({ number: 901, isDraft: true });
    expect(l.ship).toMatchObject({ state: "current", count: 1 });
  });

  test("the lane's claude is the one on the tty of its latest skill", () => {
    const l = bruno({ claudes: [{ terminal: "t10", status: "idle", tty: "ttys010" }, { terminal: "t11", status: "idle", tty: "ttys011" }] });
    expect(l.claude).toEqual({ terminal: "t11", status: "idle", count: 2, ambiguous: false });
  });
});

describe("Work - PP next step", () => {
  test("a ship with commits after it opens /pp-ship in a new tab named for the worktree", () => {
    expect(ppNext(lincoln())).toEqual({ label: "Run /pp-ship (delta) in a new tab", kind: "tab", target: "new tab in this worktree", text: "/pp-ship", space: "sp-l", folder: "/w/app-lincoln", name: "ship · app-lincoln" });
  });

  test("a task id names the ship tab", () => {
    expect(ppNext(gabriel())).toMatchObject({ kind: "tab", text: "/pp-ship", name: "ship · CUP-7002" });
  });

  test("/pp-pr-ready goes to the worktree's idle claude", () => {
    expect(ppNext(bruno(idle11))).toMatchObject({ kind: "send", terminal: "t11", text: "/pp-pr-ready", target: "claude · t11 in this worktree" });
  });

  test("a working claude disables the send and keeps the new tab", () => {
    expect(ppNext(bruno({ claudes: [{ terminal: "t11", status: "working", tty: "ttys011" }] }))).toMatchObject({ kind: "wait", disabled: true, target: "claude is working", text: "/pp-pr-ready", space: "sp-b", folder: "/w/app-cup-7001" });
  });

  test("two claudes and no skill tty to pick one never type into either", () => {
    const l = gabriel({ claudes: [{ terminal: "t1", status: "idle", tty: "ttys001" }, { terminal: "t2", status: "idle", tty: "ttys002" }] });
    l.action = { label: "Run /pp-pr-ready", command: "/pp-pr-ready", url: null, where: "worktree", kind: "skill" };
    expect(ppNext(l)).toMatchObject({ kind: "wait", disabled: true, target: "More than one claude here" });
  });

  test("/pp-clear opens in the main checkout", () => {
    expect(ppNext(merged())).toMatchObject({ kind: "tab", space: "sp-main", folder: "/r/app", text: "/pp-clear 905" });
    expect(ppNext(merged({ mainSpace: null }))).toMatchObject({ kind: "space", space: null, folder: "/r/app", text: "/pp-clear 905" });
  });

  test("an open action opens its URL and a wait waits", () => {
    const open = bruno();
    open.action = { label: "Open PR #901", command: null, url: "https://github.com/acme/app/pull/901", where: "worktree", kind: "open" };
    expect(ppNext(open)).toEqual({ label: "Open PR #901", kind: "open", url: "https://github.com/acme/app/pull/901", target: "github.com" });
    const wait = bruno();
    wait.action = { label: "Wait for checks", command: null, url: null, where: "worktree", kind: "wait" };
    expect(ppNext(wait)).toEqual({ label: "Wait for checks", kind: "wait", disabled: true, target: "2 of 4 current" });
  });

  test("a skill that ended its turn before its step is done sends you to its claude", () => {
    const l = bruno(idle11);
    l.skill = { name: "pp-pr-ready", running: false, endedAt: "2026-11-05T10:00:00Z", tty: "ttys011" };
    expect(ppNext(l)).toEqual({ label: "Go to claude", kind: "focus", terminal: "t11", target: "pp-pr-ready is waiting on you" });
  });

  test("pp-ship that ended before new commits does not ask for you", () => {
    const l = lincoln({ claudes: [{ terminal: "t9", status: "idle", tty: "ttys009" }] });
    l.skill = { name: "pp-ship", running: false, endedAt: "2026-11-05T10:00:00Z", tty: "ttys009" };
    expect(ppNext(l).kind).toBe("tab");
  });

  test("a first /pp-ship that stopped to ask sends you to its claude", () => {
    const l = gabriel({ claudes: [{ terminal: "t7", status: "idle", tty: "ttys007" }] });
    l.skill = { name: "pp-ship", running: false, endedAt: "2026-11-05T10:00:00Z", tty: "ttys007" };
    expect(ppNext(l)).toEqual({ label: "Go to claude", kind: "focus", terminal: "t7", target: "pp-ship is waiting on you" });
  });

  test("a skill whose step is done does not ask for you", () => {
    expect(ppNext(bruno(idle11)).kind).toBe("send");
  });

  test("a blocked claude sends you to it", () => {
    expect(ppNext(bruno({ claudes: [{ terminal: "t11", status: "blocked", tty: "ttys011" }] }))).toEqual({ label: "Go to claude", kind: "focus", terminal: "t11", target: "claude · t11 needs you" });
  });

  test("a running skill makes the button wait", () => {
    const l = bruno();
    l.skill = { name: "pp-pr-ready", running: true, endedAt: null, tty: null };
    expect(ppNext(l)).toEqual({ label: "Waiting for /pp-pr-ready", kind: "wait", disabled: true, target: "the skill is still working" });
  });
});

describe("Work - PP rows and chips", () => {
  test("chips name the first step not done", () => {
    expect([lincoln(), bruno(), gabriel(), merged()].map((l) => ppChip(l).chip)).toEqual(["Ship stale", "Evidence", "Build", "Merged"]);
    expect(ppChip(lincoln()).tone).toBe("accent");
  });

  test("a failed PR, a ready one and a waiting claude have their own chips", () => {
    const failed = bruno();
    failed.steps = ["done", "done", "done", "bad", "todo", "todo"];
    const ready = bruno();
    ready.steps = ["done", "done", "done", "done", "next", "todo"];
    const open = bruno();
    open.steps = ["done", "done", "done", "run", "todo", "todo"];
    expect([failed, ready, open].map((l) => ppChip(l))).toEqual([
      { chip: "PR failed", tone: "blocked", why: "2 of 4 current" },
      { chip: "Ready", tone: "done", why: "2 of 4 current" },
      { chip: "PR open", tone: "working", why: "2 of 4 current" },
    ]);
  });

  test("a row says where the lane stands, why, and what to do", () => {
    expect(ppSummary(lincoln())).toEqual({ stage: 1, tone: "accent", why: "3 commits since ship", action: null });
    expect(ppSummary(bruno())).toMatchObject({ stage: 2, tone: "accent" });
    expect(ppSummary(gabriel())).toMatchObject({ stage: 0, tone: "idle" });
    expect(ppSummary(merged())).toEqual({ stage: 5, tone: "done", why: "/pp-clear 905 from main", action: "Run /pp-clear" });
    const failed = bruno();
    failed.steps = ["done", "done", "done", "bad", "todo", "todo"];
    expect(ppSummary(failed)).toMatchObject({ stage: 3, tone: "blocked", action: "Open PR" });
    expect(ppSummary(bruno({ claudes: [{ terminal: "t11", status: "blocked", tty: "ttys011" }] }))).toMatchObject({ tone: "blocked", why: "claude · t11 needs you", action: "Go to task" });
  });

  test("only a blocked claude, a failed PR, a PR ready to merge or a merged PR wait on you", () => {
    expect([lincoln(), bruno(), gabriel(), merged()].map((l) => ppWaits(l))).toEqual([
      { waits: false, failed: false },
      { waits: false, failed: false },
      { waits: false, failed: false },
      { waits: true, failed: false },
    ]);
    const failed = bruno();
    failed.steps = ["done", "done", "done", "bad", "todo", "todo"];
    expect(ppWaits(failed)).toEqual({ waits: true, failed: true });
  });

  test("nothing a Work - PP lane says mentions vjr", () => {
    for (const l of [lincoln(), bruno(idle11), gabriel(), merged()]) expect(JSON.stringify([ppNext(l), ppChip(l), ppSummary(l)])).not.toMatch(/vjr/i);
  });
});
