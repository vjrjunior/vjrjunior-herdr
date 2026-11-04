import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { changes, snapshot, summary } from "../tools/test-panel/events.js";
import { formatResults, PANEL, PANEL_KIT, panelFiles, readRun } from "../scripts/test-panel";

const repo = resolve(import.meta.dir, "..");

const space = (id: string, name: string, tabs: [string, string, number?][]) => ({
  id,
  name,
  tabs: tabs.map(([tab, tabName, panes]) => ({ id: tab, name: tabName, panes: panes ?? 1 })),
});

describe("events", () => {
  const before = snapshot([space("s1", "app", [["t1", "Claude", 2], ["t2", "2"]]), space("s2", "feat-x", [["t3", "1"]])], "vjr-desk", { "move-tab.drag": null });

  test("nothing changed gives no lines", () => {
    expect(changes(before, before)).toEqual([]);
  });

  test("a tab moved to another space, a space opened and a key set", () => {
    const after = snapshot(
      [space("s1", "app", [["t1", "Claude", 2]]), space("s2", "feat-x", [["t3", "1"], ["t2", "2"]]), space("s3", "chore-y", [["t4", "1"]])],
      "vjr-desk-square",
      { "move-tab.drag": { tab: "t2", space: "s1", at: 1 } },
    );
    expect(changes(before, after)).toEqual([
      "layout vjr-desk-square",
      'space "chore-y" opened',
      'tab "2" moved from "app" to "feat-x"',
      'tab "1" opened in "chore-y"',
      'move-tab.drag = {"tab":"t2","space":"s1","at":1}',
    ]);
  });

  test("a reorder, a split, a closed tab, a closed space and a cleared key", () => {
    const set = snapshot([space("s1", "app", [["t1", "Claude", 2], ["t2", "2"]]), space("s2", "feat-x", [["t3", "1"]])], "vjr-desk", { "move-tab.drag": { tab: "t2" } });
    const after = snapshot([space("s1", "app", [["t2", "1", 2], ["t1", "Claude", 2]])], "vjr-desk", { "move-tab.drag": null });
    expect(changes(set, after)).toEqual([
      'space "feat-x" closed',
      'tab "1" in "app" has 2 panes',
      'tab "1" closed in "feat-x"',
      'tabs in "app" reordered: "1", "Claude"',
      "move-tab.drag cleared",
    ]);
  });

  test("the summary counts passes, names failures with their notes and skipped steps", () => {
    const steps = [{ title: "a" }, { title: "b" }, { title: "c" }];
    const results = [
      { step: 0, verdict: "passed", note: "" },
      { step: 1, verdict: "failed", note: "row never lit" },
    ];
    expect(summary("Move tab", steps, results)).toBe(
      'Test panel "Move tab": 1 of 3 passed. 1 passed; 2 FAILED (row never lit); 3 skipped. Details: bun run test-panel --results',
    );
  });
});

describe("install", () => {
  test("the installed copy imports its own kit, opens itself by its installed name and carries the run", () => {
    const run = { id: "r1", title: "Move tab", steps: [{ title: "Drag" }] };
    const files = panelFiles(repo, run);
    expect(Object.keys(files).sort()).toEqual(["events.js", "kit.js", "main.js", "mod.json", "run.js"]);
    expect(files["main.js"]).toContain('from "./kit.js"');
    expect(files["main.js"]).not.toContain("../../kit/kit.js");
    expect(files["main.js"]).toContain(`{ name: "${PANEL}" }`);
    expect(files["kit.js"]).toContain(`{ name: "${PANEL_KIT}" }`);
    expect(files["run.js"]).toBe(`export default ${JSON.stringify(run, null, 2)};\n`);
  });

  test("the package runs the installer and the panel docks nowhere until a run opens it", () => {
    expect(JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).scripts["test-panel"]).toBe("bun scripts/test-panel.ts");
    expect(JSON.parse(readFileSync(join(repo, "tools/test-panel/mod.json"), "utf8")).place).toBe("none");
  });

  test("a run gets an id and a shots folder when it names neither, and needs a title and step titles", () => {
    const dir = mkdtempSync(join(tmpdir(), "test-panel-"));
    const file = join(dir, "move.json");
    writeFileSync(file, JSON.stringify({ title: "Move tab", steps: [{ title: "Drag" }] }));
    const run = readRun(file, 42);
    expect(run.id).toBe("move-42");
    expect(run.shots?.endsWith(join("test-panel", "move-42"))).toBe(true);
    writeFileSync(file, JSON.stringify({ title: "Move tab", steps: [{ do: ["x"] }] }));
    expect(() => readRun(file)).toThrow("step 1 needs a title");
  });

  test("results list each verdict with its note and every event by step", () => {
    const state = {
      run: "r1",
      step: 2,
      reported: true,
      results: [{ step: 0, title: "Drag", verdict: "failed", note: "moved anyway", shot: "/s/01-failed.png" }],
      log: [{ at: Date.UTC(2026, 10, 4, 20, 0, 45), step: 0, text: 'tab "2" moved from "a" to "b"' }],
    };
    expect(formatResults(state)).toBe(
      ['run r1, step 3, reported', '1. failed — Drag — "moved anyway" — /s/01-failed.png', "events:", '  20:00:45 step 1: tab "2" moved from "a" to "b"'].join("\n"),
    );
    expect(formatResults(undefined)).toBe("No test panel run yet.");
  });
});
