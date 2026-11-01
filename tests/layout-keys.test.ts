import { afterEach, describe, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { deriveSection, keysText, readKeys, withoutSections, withSections } from "../scripts/layout-keys";
import { removeTempDirs, tempDir } from "./helpers";

afterEach(removeTempDirs);

describe("deriveSection", () => {
  test("derives every global key bound to a replaced action", () => {
    expect(deriveSection({ "cmd-/": "app.help", "cmd-shift-/": "app.help", "cmd-t": "tab.new" }, { "app.help": "mod.open:vjr-square-help" })).toEqual({
      "cmd-/": "mod.open:vjr-square-help",
      "cmd-shift-/": "mod.open:vjr-square-help",
    });
  });

  test("follows a custom shortcut", () => {
    expect(deriveSection({ "ctrl-k": "app.palette" }, { "app.palette": "mod.open:vjr-palette" })).toEqual({ "ctrl-k": "mod.open:vjr-palette" });
  });

  test("an action with no key adds nothing", () => {
    expect(deriveSection({ "cmd-t": "tab.new" }, { "app.help": "mod.open:vjr-square-help" })).toEqual({});
  });
});

describe("sections", () => {
  test("keeps other sections and keys", () => {
    const table = { global: { "cmd-t": "tab.new" }, "layout:other": { a: "b" } };
    expect(withSections(table, { "layout:vjr-desk": { c: "d" } })).toEqual({ ...table, "layout:vjr-desk": { c: "d" } });
  });

  test("replaces a section it wrote before", () => {
    expect(withSections({ "layout:vjr-desk": { old: "x" } }, { "layout:vjr-desk": { c: "d" } })).toEqual({ "layout:vjr-desk": { c: "d" } });
  });

  test("removes only the named sections", () => {
    expect(withoutSections({ global: {}, "layout:vjr-desk": {} }, ["layout:vjr-desk"])).toEqual({ global: {} });
  });
});

describe("the file", () => {
  test("keeps escape sequences through a rewrite", () => {
    expect(keysText({ terminal: { "alt-left": "send:\u001bb" } })).toContain("\\u001b");
  });

  test("reads what it wrote", () => {
    const path = join(tempDir(), "keys.json");
    const table = { terminal: { "alt-left": "send:\u001bb" } };
    writeFileSync(path, keysText(table));
    expect(readKeys(path)).toEqual(table);
  });

  test("treats a missing file as empty", () => {
    expect(readKeys(join(tempDir(), "keys.json"))).toEqual({});
  });

  test("throws on invalid JSON", () => {
    const path = join(tempDir(), "keys.json");
    writeFileSync(path, "{");
    expect(() => readKeys(path)).toThrow(/keys\.json/);
  });
});
