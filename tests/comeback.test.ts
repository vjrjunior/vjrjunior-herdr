import { describe, expect, test } from "bun:test";
import {
  autoCandidate,
  decodeNote,
  encodeNote,
  isShell,
  judge,
  keepArgs,
  lastLine,
  markTried,
  parseBoot,
  parseEtime,
  parseSession,
  planPass,
  quote,
  resumeCommand,
  summary,
} from "../mods/comeback/logic.js";

const note = {
  v: 1,
  agent: "claude",
  session: "152ba1e2-45b7-4fc9-83c9-33b8dfdadf6e",
  cwd: "/w/app",
  args: ["--dangerously-skip-permissions"],
  boot: "1793622627",
  shell: { pid: 2003, start: "Mon Nov  2 10:16:51 2026" },
  at: 1793637415819,
};

describe("machine facts", () => {
  test("reads the boot from macOS and Linux", () => {
    expect(parseBoot("{ sec = 1793622627, usec = 216801 } Mon Nov  2 09:30:27 2026")).toBe("1793622627");
    expect(parseBoot("4f3c2a1e-9b8d-4c7e-8f6a-1b2c3d4e5f60\n")).toBe("4f3c2a1e-9b8d-4c7e-8f6a-1b2c3d4e5f60");
    expect(parseBoot("")).toBeNull();
  });

  test("reads how long a process has run", () => {
    expect(parseEtime("  05:09")).toBe(309);
    expect(parseEtime("06:30:21")).toBe(23421);
    expect(parseEtime("2-01:02:03")).toBe(176523);
    expect(parseEtime("soon")).toBeNull();
  });
});

describe("parseSession", () => {
  test("reads the conversation and folder of a running Claude", () => {
    expect(parseSession('{"pid":5770,"sessionId":"abc-1","cwd":"/w/app","status":"busy"}')).toEqual({ session: "abc-1", cwd: "/w/app" });
    expect(parseSession('{"pid":5770,"sessionId":"abc-1","cwd":"/w/app","procStart":"Mon Nov  2 13:36:12 2026"}')?.procStart).toBe("Mon Nov  2 13:36:12 2026");
  });

  test("gives nothing for a missing or broken file", () => {
    expect(parseSession(null)).toBeNull();
    expect(parseSession("{")).toBeNull();
    expect(parseSession('{"cwd":"/w/app"}')).toBeNull();
  });
});

describe("shells", () => {
  test("knows login shells by name or path", () => {
    expect(isShell("/bin/zsh")).toBe(true);
    expect(isShell("-zsh")).toBe(true);
    expect(isShell("fish")).toBe(true);
    expect(isShell("claude")).toBe(false);
    expect(isShell("vim")).toBe(false);
  });
});

describe("keepArgs", () => {
  test("keeps only the options a resume accepts", () => {
    expect(keepArgs(["claude", "--dangerously-skip-permissions", "--model", "opus", "fix the login"])).toEqual(["--dangerously-skip-permissions", "--model", "opus"]);
  });

  test("drops prompts, pickers, print mode and unknown options", () => {
    expect(keepArgs(["claude", "-p", "hi", "--resume", "x", "-c", "--session-id", "y", "--worktree", "--chrome", "do it"])).toEqual([]);
  });

  test("keeps every folder of --add-dir and the = form", () => {
    expect(keepArgs(["claude", "--add-dir", "/a", "/b", "--verbose", "--permission-mode=plan"])).toEqual(["--add-dir", "/a", "/b", "--verbose", "--permission-mode", "plan"]);
  });

  test("drops an option whose value can't be quoted", () => {
    expect(keepArgs(["claude", "--add-dir", "/it's", "--verbose"])).toEqual(["--verbose"]);
  });
});

describe("the command", () => {
  test("quotes only what needs it", () => {
    expect(quote("/w/app")).toBe("/w/app");
    expect(quote("/w/My App/ação")).toBe("'/w/My App/ação'");
    expect(quote("/w/it's")).toBeNull();
    expect(quote("/w/a\\b")).toBeNull();
    expect(quote("/w/a\nb")).toBeNull();
  });

  test("goes to the folder and resumes with the kept options", () => {
    expect(resumeCommand({ ...note, cwd: "/w/My App" })).toBe("cd '/w/My App' && claude --resume 152ba1e2-45b7-4fc9-83c9-33b8dfdadf6e --dangerously-skip-permissions");
  });

  test("refuses a folder it can't type", () => {
    expect(resumeCommand({ ...note, cwd: "/w/it's" })).toBeNull();
  });
});

describe("the note", () => {
  test("survives a round trip", () => {
    expect(decodeNote(encodeNote(note))).toEqual(note);
  });

  test("a note edited by hand comes back filtered", () => {
    const edited = JSON.stringify({ ...note, args: ["--dangerously-skip-permissions", "rm -rf /", "--chrome"] });
    expect(decodeNote(edited)?.args).toEqual(["--dangerously-skip-permissions"]);
  });

  test("a broken or foreign note is ignored", () => {
    expect(decodeNote(undefined)).toBeNull();
    expect(decodeNote("{")).toBeNull();
    expect(decodeNote(JSON.stringify({ ...note, v: 2 }))).toBeNull();
    expect(decodeNote(JSON.stringify({ ...note, session: "a b" }))).toBeNull();
    expect(decodeNote(JSON.stringify({ ...note, cwd: "relative" }))).toBeNull();
  });
});

describe("lastLine", () => {
  test("gives the last line above the prompt", () => {
    expect(lastLine("Error: session not found\n\nvjr@mac app % \n")).toBe("Error: session not found");
    expect(lastLine("vjr@mac app % ")).toBe("");
  });
});

const term = (over = {}) => ({
  address: "t8",
  where: "app / 1",
  pid: 2003,
  start: "Mon Nov  2 10:16:51 2026",
  age: 30,
  foreground: { pid: 2003, argv: ["/bin/zsh", "-l"] },
  app: null,
  note,
  ...over,
});

describe("judge", () => {
  test("a Claude in front is running, by name or by its report", () => {
    expect(judge(term({ foreground: { pid: 9, argv: ["/opt/homebrew/bin/claude"] } }), note.boot)).toBe("running");
    expect(judge(term({ foreground: { pid: 9, argv: ["node", "/x/cli.js"] }, app: "claude-code" }), note.boot)).toBe("running");
  });

  test("the same shell back in front means the person quit", () => {
    expect(judge(term(), note.boot)).toBe("quit");
  });

  test("another boot, another shell or another start means it was lost", () => {
    expect(judge(term(), "1700000000")).toBe("lost");
    expect(judge(term({ pid: 3000, foreground: { pid: 3000, argv: ["zsh"] } }), note.boot)).toBe("lost");
    expect(judge(term({ start: "Tue Nov  3 08:00:00 2026" }), note.boot)).toBe("lost");
  });

  test("a lost terminal with something else in front is busy", () => {
    expect(judge(term({ foreground: { pid: 4000, argv: ["vim"] } }), "1700000000")).toBe("busy");
  });

  test("a terminal without a note is none of these", () => {
    expect(judge(term({ note: null }), note.boot)).toBe("none");
  });
});

describe("planPass", () => {
  const ctx = { auto: true, boot: "1800000000", folderOk: () => true, transcriptOk: () => true, open: new Set<string>() };

  test("resumes the newest first", () => {
    const older = term({ address: "t1", note: { ...note, at: 1 } });
    const newer = term({ address: "t2", note: { ...note, session: "other", at: 2 } });
    expect(planPass([older, newer], ctx).todo.map((t) => t.address)).toEqual(["t2", "t1"]);
  });

  test("gives the reason for each one it skips", () => {
    const lost = [
      term({ address: "t1", note: { ...note, session: "s1", cwd: "/w/it's" } }),
      term({ address: "t2", note: { ...note, session: "s2", cwd: "/gone" } }),
      term({ address: "t3", note: { ...note, session: "s3" } }),
      term({ address: "t4", note: { ...note, session: "s4" } }),
      term({ address: "t5", note: { ...note, session: "s4", at: 0 } }),
    ];
    const plan = planPass(lost, { ...ctx, folderOk: (cwd: string) => cwd !== "/gone", transcriptOk: (s: string) => s !== "s3", open: new Set() });
    expect(plan.skipped.map((s) => [s.terminal.address, s.reason])).toEqual([
      ["t1", "its folder can't be typed"],
      ["t2", "its folder is gone"],
      ["t3", "no saved conversation"],
      ["t5", "already resumed in this pass"],
    ]);
    expect(plan.todo.map((t) => t.address)).toEqual(["t4"]);
  });

  test("a conversation open in another terminal is skipped", () => {
    expect(planPass([term()], { ...ctx, open: new Set([note.session]) }).skipped[0]?.reason).toBe("open in another terminal");
  });

  test("the automatic pass leaves tried and old shells alone, silently", () => {
    const tried = markTried(note, term(), ctx.boot, "its folder is gone");
    const plan = planPass([term({ note: tried }), term({ address: "t9", age: 601 })], ctx);
    expect(plan).toEqual({ todo: [], skipped: [] });
  });

  test("the manual pass tries again", () => {
    const tried = markTried(note, term(), ctx.boot);
    expect(planPass([term({ note: tried, age: 5000 })], { ...ctx, auto: false }).todo).toHaveLength(1);
  });
});

describe("summary", () => {
  test("says how many came back", () => {
    expect(summary({ resumed: ["app / 1", "web / 2"], failed: [], skipped: [] }, false)).toEqual({
      title: "Resumed 2 Claude conversations",
      body: "app / 1, web / 2",
      level: "success",
      timeout: 5000,
    });
  });

  test("lists what didn't, with the reason", () => {
    expect(summary({ resumed: ["app / 1"], failed: [{ where: "web / 2", reason: "exited right away: Error" }], skipped: [] }, false)).toEqual({
      title: "Resumed 1 of 2 Claude conversations",
      body: "Not resumed: web / 2: exited right away: Error",
      level: "warning",
      timeout: 8000,
    });
    expect(summary({ resumed: [], failed: [], skipped: [{ where: "web / 2", reason: "its folder is gone" }] }, false)?.title).toBe("Couldn't resume 1 Claude conversation");
  });

  test("stays quiet when the automatic pass had nothing to do", () => {
    expect(summary({ resumed: [], failed: [], skipped: [] }, false)).toBeNull();
    expect(summary({ resumed: [], failed: [], skipped: [] }, true)).toEqual({
      title: "No Claude conversation to resume",
      body: "No terminal lost its Claude.",
      level: "info",
      timeout: 3000,
    });
  });
});

describe("the automatic pass", () => {
  const boot = "1800000000";

  test("only takes a fresh lost shell or a lost terminal busy with something else, once", () => {
    expect(autoCandidate(term(), boot)).toBe(true);
    expect(autoCandidate(term({ age: 121 }), boot)).toBe(false);
    expect(autoCandidate(term({ foreground: { pid: 4000, argv: ["npm", "run", "dev"] }, age: 5000 }), boot)).toBe(true);
    expect(autoCandidate(term({ note: markTried(note, term(), boot) }), boot)).toBe(false);
    expect(autoCandidate(term(), note.boot)).toBe(false);
  });

  test("a lost terminal with something else in front is skipped with a reason", () => {
    const busy = term({ foreground: { pid: 4000, argv: ["npm", "run", "dev"] } });
    expect(planPass([busy], { auto: true, boot, folderOk: () => true, transcriptOk: () => true, open: new Set() }).skipped.map((s) => s.reason)).toEqual(["something else is running there"]);
  });
});
