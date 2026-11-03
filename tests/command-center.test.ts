import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { captionsFor, parseMessage, parseScreenshots, parseTask, parseWorktrees } from "../mods/command-center/logic.js";

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
