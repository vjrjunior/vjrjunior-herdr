export type ModSource = { name: string; from: "mods" | "frame" | "repo" };
export type Copy = { name: string; files: Record<string, string>; meta: Record<string, unknown> };
export type LayoutNode = Record<string, unknown>;
export type RecipeContext = {
  copies: Record<string, Copy>;
  layout: LayoutNode;
  replacements: Record<string, string>;
  keys: Record<string, string>;
  variant: Variant;
};
export type Recipe = { name: string; mods: ModSource[]; apply(context: RecipeContext): void };
export type Variant = { layout: string; prefix: string; preview: string; recipes: Recipe[] };

export class RecipeError extends Error {}

export function findNode(node: LayoutNode, id: string): LayoutNode {
  const found = search(node, id);
  if (!found) throw new RecipeError(`layout node ${id} not found`);
  return found;
}

function search(node: LayoutNode, id: string): LayoutNode | null {
  if (node.id === id) return node;
  for (const child of (node.children as LayoutNode[] | undefined) ?? []) {
    const found = search(child, id);
    if (found) return found;
  }
  return null;
}

export function exact(copy: Copy, from: string, to: string, expected = 1): void {
  const found = Object.values(copy.files).reduce((total, text) => total + text.split(from).length - 1, 0);
  if (found !== expected) throw new RecipeError(`${copy.name}: expected ${expected} of ${JSON.stringify(from)}, found ${found}`);
  for (const [name, text] of Object.entries(copy.files)) copy.files[name] = text.replaceAll(from, () => to);
}

export function pattern(copies: Copy[], regex: RegExp, to: string | ((...groups: string[]) => string), minimum = 0): number {
  let total = 0;
  for (const copy of copies) {
    for (const [name, text] of Object.entries(copy.files)) {
      copy.files[name] = text.replace(regex, (...groups: string[]) => {
        total += 1;
        return typeof to === "string" ? to : to(...groups);
      });
    }
  }
  if (total < minimum) throw new RecipeError(`expected at least ${minimum} of ${regex}, found ${total}`);
  return total;
}
