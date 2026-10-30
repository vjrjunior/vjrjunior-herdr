import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repo } from "./helpers";

function parseGhostty(path: string): Record<string, string> {
  const pairs: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split("\n")) {
    if (!line) continue;
    const [key, value] = line.split(" = ");
    if (key === "palette") {
      const [index, color] = value.split("=");
      pairs[`palette ${index}`] = color;
    } else {
      pairs[key] = value;
    }
  }
  return pairs;
}

test("generated Ghostty theme matches the hand-written VJR on every key", () => {
  const fixture = parseGhostty(join(repo, "tests/fixtures/ghostty-VJR"));
  const generated = parseGhostty(join(repo, "targets/ghostty/VJR"));

  expect(Object.keys(fixture)).toHaveLength(27);
  expect(generated).toEqual(fixture);
});
