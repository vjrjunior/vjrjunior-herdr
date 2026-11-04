import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Copy, type LayoutNode, type ModSource, RecipeError, type RecipeContext, type Variant } from "../recipes/recipe";

export type GenerateOptions = { home: string; version: string; repo: string; bun: string };
export type Generated = {
  layout: string;
  layoutText: string;
  mods: Record<string, Record<string, string>>;
  replacements: Record<string, string>;
};

const REFERENCE = /(\bmod:\s*"|\{\s*name:\s*")([a-z-]+)"/g;
const LEFTOVER = /(openOverlay\(\{[^)]*\bmod:\s*|"mod\.open",\s*\{\s*name:\s*)['`]([a-z-]+)['`]/g;

function sourceFolder(source: ModSource, options: GenerateOptions): string {
  if (source.from === "repo") return join(options.repo, "mods", source.name);
  return join(options.home, source.from, source.name);
}

const KIT_IMPORT = "../../kit/kit.js";
const KIT_SPECIFIER = /(["'`])([^"'`\n]*kit\/kit\.js)\1/g;

function installKit(source: ModSource, options: GenerateOptions, files: Record<string, string>): void {
  let uses = false;
  for (const [file, text] of Object.entries(files)) {
    for (const match of text.matchAll(KIT_SPECIFIER)) {
      if (match[2] !== KIT_IMPORT) throw new RecipeError(`${source.name}/${file}: import the kit as "${KIT_IMPORT}"`);
    }
    const rewritten = text.replace(KIT_SPECIFIER, (whole, quote) => (whole === `${quote}${KIT_IMPORT}${quote}` ? `${quote}./kit.js${quote}` : whole));
    if (rewritten !== text) {
      files[file] = rewritten;
      uses = true;
    }
  }
  if (uses) files["kit.js"] = readFileSync(join(options.repo, "kit/kit.js"), "utf8");
  if (source.name === "kit") {
    const icons = join(options.repo, "kit/icons");
    for (const icon of readdirSync(icons).filter((name) => name.endsWith(".svg"))) files[`icons/${icon}`] = readFileSync(join(icons, icon), "utf8");
  }
}

function readCopy(source: ModSource, options: GenerateOptions): Copy {
  const folder = sourceFolder(source, options);
  if (!existsSync(join(folder, "main.js"))) throw new RecipeError(`mod ${source.name} not found in ${folder}`);
  const files: Record<string, string> = {};
  for (const name of readdirSync(folder)) {
    if (name.endsWith(".js")) files[name] = readFileSync(join(folder, name), "utf8");
  }
  if (source.from === "repo") installKit(source, options, files);
  return { name: source.name, files, meta: JSON.parse(readFileSync(join(folder, "mod.json"), "utf8")) };
}

function rewireFiles(copies: Record<string, Copy>, prefix: string): void {
  for (const copy of Object.values(copies)) {
    for (const [file, text] of Object.entries(copy.files)) {
      const rewired = text.replace(REFERENCE, (whole, start: string, name: string) => (Object.hasOwn(copies, name) ? `${start}${prefix}${name}"` : whole));
      for (const match of rewired.matchAll(LEFTOVER)) {
        if (Object.hasOwn(copies, match[2] as string)) throw new RecipeError(`${copy.name}/${file}: cannot rewire the reference to ${match[2]}`);
      }
      copy.files[file] = rewired;
    }
  }
}

function rewireLayout(node: unknown, copies: Record<string, Copy>, prefix: string): void {
  if (Array.isArray(node)) {
    for (const child of node) rewireLayout(child, copies, prefix);
    return;
  }
  if (node === null || typeof node !== "object") return;
  const fields = node as LayoutNode;
  for (const [key, value] of Object.entries(fields)) {
    if ((key === "mod" || key === "terminal_menu") && typeof value === "string" && Object.hasOwn(copies, value)) fields[key] = `${prefix}${value}`;
    else rewireLayout(value, copies, prefix);
  }
}

function applyRecipes(variant: Variant, context: RecipeContext): void {
  for (const recipe of variant.recipes) {
    try {
      recipe.apply(context);
    } catch (error) {
      throw new RecipeError(`recipe ${recipe.name}: ${(error as Error).message}`);
    }
  }
}

function modFiles(copy: Copy, version: string): Record<string, string> {
  const meta = { ...copy.meta, cloned_from: { name: copy.name, version } };
  return { ...copy.files, "mod.json": `${JSON.stringify(meta, null, 2)}\n` };
}

function finishLayout(layout: LayoutNode, variant: Variant, options: GenerateOptions): LayoutNode {
  const sync = {
    id: "vjr-sync",
    content: { mod: "vjr-sync", props: { built: options.version, repo: options.repo, bun: options.bun } },
    edge: "right",
    align: "end",
  };
  return {
    ...layout,
    cloned_from: { name: "main", version: options.version },
    theme: { light: "paper", dark: "vjr" },
    preview: variant.preview,
    floating: [...((layout.floating as unknown[] | undefined) ?? []), sync],
  };
}

export function generateVariant(variant: Variant, options: GenerateOptions): Generated {
  const layout: LayoutNode = JSON.parse(readFileSync(join(options.home, "layouts/main.json"), "utf8"));
  const copies: Record<string, Copy> = {};
  for (const source of variant.recipes.flatMap((recipe) => recipe.mods)) {
    copies[source.name] ??= readCopy(source, options);
  }
  const replacements: Record<string, string> = {};
  applyRecipes(variant, { copies, layout, replacements, variant });
  for (const copy of Object.values(copies)) {
    if (copy.files["kit.js"] !== undefined && !Object.hasOwn(copies, "kit")) throw new RecipeError(`${copy.name} uses the kit, but ${variant.layout} has no kit`);
  }
  rewireFiles(copies, variant.prefix);
  rewireLayout(layout, copies, variant.prefix);
  return {
    layout: variant.layout,
    layoutText: `${JSON.stringify(finishLayout(layout, variant, options), null, 2)}\n`,
    mods: Object.fromEntries(Object.values(copies).map((copy) => [`${variant.prefix}${copy.name}`, modFiles(copy, options.version)])),
    replacements: Object.fromEntries(Object.entries(replacements).map(([action, mod]) => [action, `mod.open:${variant.prefix}${mod}`])),
  };
}
