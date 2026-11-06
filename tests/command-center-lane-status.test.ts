import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { factsOf, parseLaneStatus } from "../mods/command-center/lane-status.js";

const fixture = (name: string) => readFileSync(join(import.meta.dir, "fixtures/command-center", name), "utf8");

describe("pp-lane-status report", () => {
  test("a v1 report gives its lanes", () => {
    expect(parseLaneStatus(fixture("lane-status.json")).lanes.map((lane: { path: string }) => lane.path)).toEqual(["/w/app-lincoln", "/w/app-cup-7001", "/w/app-gabriel", "/w/app-cup-7003"]);
  });

  test("a v1 report says whether it reached GitHub and what failed", () => {
    expect(parseLaneStatus(fixture("lane-status.json"))).toMatchObject({ network: true, error: null });
    expect(parseLaneStatus(JSON.stringify({ version: 1, network: true, error: "gh: 504", lanes: [] }))).toMatchObject({ network: true, error: "gh: 504" });
  });

  test("text that is not JSON is an error, not a crash", () => {
    expect(parseLaneStatus("bun: command not found")).toEqual({ lanes: [], network: false, error: "pp-lane-status gave no JSON" });
  });

  test("another version is refused", () => {
    expect(parseLaneStatus(JSON.stringify({ version: 2, lanes: [] })).error).toBe("pp-lane-status speaks version 2; this Command Center reads version 1");
    expect(parseLaneStatus(JSON.stringify({ version: 2, lanes: [{ path: "/w/x" }] })).lanes).toEqual([]);
  });
});

describe("a lane's facts", () => {
  test("a lane's PR keeps the shape the column reads", () => {
    const report = JSON.parse(fixture("lane-status.json"));
    const facts = factsOf(report.lanes[1], report);
    expect(facts.pr).toMatchObject({ number: 901, isDraft: true, baseRefName: "feat/CUP-7000", headRefName: report.lanes[1].branch, reviewDecision: "" });
    expect(facts.pr.checks).toEqual(report.lanes[1].pr.checks);
    expect(facts.evidence.slug).toBe(report.lanes[1].evidence.dir.split("/").pop());
    expect(facts.base).toBe("feat/CUP-7000");
  });

  test("the preview comes from the PR", () => {
    const report = JSON.parse(fixture("lane-status.json"));
    expect(factsOf(report.lanes[0], report).preview).toMatchObject({ state: "SUCCESS", link: "https://preview.example/862" });
    expect(factsOf(report.lanes[2], report).preview).toBeNull();
  });

  test("no evidence becomes an error the Evidence card shows", () => {
    expect(factsOf({ evidence: null, pr: null, base: "main" }, { network: true, error: null }).evidence).toEqual({ error: "pp-pr-evidence could not run" });
  });

  test("a GitHub failure is a PR error, offline is none", () => {
    expect(factsOf({ evidence: null, pr: null, base: "main" }, { network: true, error: "gh: 504" }).prError).toBe("GitHub unavailable · gh: 504");
    expect(factsOf({ evidence: null, pr: null, base: "main" }, { network: false, error: null }).prError).toBeNull();
  });
});
