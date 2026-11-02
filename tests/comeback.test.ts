import { describe, expect, test } from "bun:test";
import { decodeNote, encodeNote, isShell, keepArgs, lastLine, parseBoot, parseEtime, parseSession, quote, resumeCommand } from "../mods/comeback/logic.js";

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
