import { describe, expect, test } from "bun:test";
import { folderOf, linkTarget, nameOf, shortFolder, stripFrontMatter } from "../mods/markdown/logic.js";

const FILE = "/w/app/cup-1234/VJR-TASK.md";

describe("front matter", () => {
  test("a YAML block at the top is hidden", () => {
    expect(stripFrontMatter("---\ntitle: Plan\ntags: [a]\n---\n# Plan\n\nBody\n")).toBe("# Plan\n\nBody\n");
  });

  test("a block closed with three dots is hidden too", () => {
    expect(stripFrontMatter("---\ntitle: Plan\n...\nBody")).toBe("Body");
  });

  test("a rule further down stays", () => {
    const text = "# Plan\n\n---\n\nMore";
    expect(stripFrontMatter(text)).toBe(text);
  });

  test("an unclosed block stays as it is", () => {
    const text = "---\ntitle: Plan\nBody";
    expect(stripFrontMatter(text)).toBe(text);
  });

  test("Windows line endings work", () => {
    expect(stripFrontMatter("---\r\ntitle: Plan\r\n---\r\nBody")).toBe("Body");
  });
});

describe("links", () => {
  test("web addresses open in the browser", () => {
    expect(linkTarget(FILE, "https://app.clickup.com/t/86")).toEqual({ kind: "web", url: "https://app.clickup.com/t/86" });
    expect(linkTarget(FILE, "mailto:a@b.co")).toEqual({ kind: "web", url: "mailto:a@b.co" });
  });

  test("a relative markdown file opens next to the current one", () => {
    expect(linkTarget(FILE, "docs/plan.md")).toEqual({ kind: "markdown", path: "/w/app/cup-1234/docs/plan.md" });
    expect(linkTarget(FILE, "../README.MD")).toEqual({ kind: "markdown", path: "/w/app/README.MD" });
    expect(linkTarget(FILE, "./notes/../plan.markdown#steps")).toEqual({ kind: "markdown", path: "/w/app/cup-1234/plan.markdown" });
  });

  test("absolute paths and file URLs are read as paths", () => {
    expect(linkTarget(FILE, "/tmp/other.md")).toEqual({ kind: "markdown", path: "/tmp/other.md" });
    expect(linkTarget(FILE, "file:///tmp/My%20Notes.md")).toEqual({ kind: "markdown", path: "/tmp/My Notes.md" });
  });

  test("other files open in their own app", () => {
    expect(linkTarget(FILE, "shots/01-home.png")).toEqual({ kind: "file", path: "/w/app/cup-1234/shots/01-home.png" });
  });

  test("an anchor on the same page does nothing", () => {
    expect(linkTarget(FILE, "#plan")).toEqual({ kind: "none" });
    expect(linkTarget(FILE, "")).toEqual({ kind: "none" });
  });

  test("a path cannot climb above the root", () => {
    expect(linkTarget("/a.md", "../../b.md")).toEqual({ kind: "markdown", path: "/b.md" });
  });
});

describe("names", () => {
  test("the header shows the file name and its folder from home", () => {
    expect(nameOf(FILE)).toBe("VJR-TASK.md");
    expect(folderOf(FILE)).toBe("/w/app/cup-1234");
    expect(shortFolder("/Users/me/work/app", "/Users/me")).toBe("~/work/app");
    expect(shortFolder("/Users/me", "/Users/me")).toBe("~");
    expect(shortFolder("/Users/meg/app", "/Users/me")).toBe("/Users/meg/app");
  });
});
