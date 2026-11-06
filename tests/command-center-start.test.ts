import { describe, expect, test } from "bun:test";
import { oneLine, startPlan, taskIdOf } from "../mods/command-center/start.js";

const REPO = { name: "app", main: "/r/app" };
const TEAM = ["env", "PP_EDITOR=herdr", "claude"];

describe("Start a task", () => {
  test("the text goes on one line", () => {
    expect(oneLine("fix\nthe\tlogin\u0007  now\r\n")).toBe("fix the login now");
    expect(oneLine(" it's \"quoted\" ")).toBe("it's \"quoted\"");
  });

  test("task ids come as CUP numbers, ClickUp links or internal ids", () => {
    expect(["CUP-1234", "cup-77", "https://app.clickup.com/t/86abc1234", "https://app.clickup.com/t/9011/CUP-1234?x=1", "86abc1234", "86abc123", "fix", ""].map(taskIdOf)).toEqual([
      "CUP-1234",
      "CUP-77",
      "86abc1234",
      "CUP-1234",
      "86abc1234",
      null,
      null,
      null,
    ]);
  });

  test("the team flow claims an id with /work, then starts the worktree", () => {
    expect(startPlan({ text: "CUP-1234", route: "team", repo: REPO, lanes: [], space: "sp-main" })).toEqual({
      kind: "tab",
      space: "sp-main",
      folder: "/r/app",
      name: "start · CUP-1234",
      argv: TEAM,
      task: "/work start CUP-1234, then /pp-worktree-start for it",
    });
  });

  test("a ClickUp link is claimed by its id", () => {
    expect(startPlan({ text: "https://app.clickup.com/t/86abc1234", route: "team", repo: REPO, lanes: [], space: "sp-main" })).toMatchObject({
      name: "start · 86abc1234",
      task: "/work start 86abc1234, then /pp-worktree-start for it",
    });
  });

  test("words after the id follow the claim", () => {
    expect(startPlan({ text: "CUP-1234 only the export", route: "team", repo: REPO, lanes: [], space: "sp-main" }).task).toBe("/work start CUP-1234, then /pp-worktree-start for it. only the export");
  });

  test("without an id the text starts the worktree", () => {
    expect(startPlan({ text: "faster search\non the inbox", route: "team", repo: REPO, lanes: [], space: "sp-main" })).toMatchObject({
      name: "start · faster search on the",
      argv: TEAM,
      task: "/pp-worktree-start faster search on the inbox",
    });
  });

  test("a long text gives a tab name of at most 40 characters", () => {
    expect(startPlan({ text: "internationalization-everywhere-and-more-words here", route: "team", repo: REPO, lanes: [], space: "sp-main" }).name).toHaveLength(40);
  });

  test("the vjr route sends the text to /vjr-task", () => {
    expect(startPlan({ text: "CUP-1234", route: "vjr", repo: REPO, lanes: [], space: "sp-main" })).toMatchObject({ kind: "tab", argv: ["claude"], task: "/vjr-task CUP-1234", name: "start · CUP-1234" });
  });

  test("an id that already has a lane selects its space, or opens one", () => {
    const lane = { task: { id: "CUP-7001" }, space: "sp-7001", path: "/w/app-cup-7001", repo: REPO };
    expect(startPlan({ text: "cup-7001", route: "team", repo: REPO, lanes: [lane], space: "sp-main" })).toEqual({ kind: "select", space: "sp-7001" });
    expect(startPlan({ text: "CUP-7001", route: "vjr", repo: REPO, lanes: [{ ...lane, space: null }], space: "sp-main" })).toEqual({ kind: "open", folder: "/w/app-cup-7001" });
  });

  test("a lane in another repo does not count", () => {
    const lane = { task: { id: "CUP-7001" }, space: "sp-7001", path: "/w/site-cup-7001", repo: { name: "site", main: "/r/site" } };
    expect(startPlan({ text: "CUP-7001", route: "team", repo: REPO, lanes: [lane], space: "sp-main" }).kind).toBe("tab");
  });

  test("empty text starts nothing, and no main space opens one", () => {
    expect(startPlan({ text: " \n ", route: "team", repo: REPO, lanes: [], space: "sp-main" })).toEqual({ kind: "none" });
    expect(startPlan({ text: "x", route: "team", repo: REPO, lanes: [], space: null })).toEqual({ kind: "space", folder: "/r/app", name: "start · x", argv: TEAM, task: "/pp-worktree-start x" });
  });
});
