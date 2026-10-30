import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import palette from "../palette/vjr.toml";

type Palette = Record<string, Record<string, string>>;

const root = join(import.meta.dir, "..");

const ROLES = [
  "bg.base",
  "bg.raised1",
  "bg.raised2",
  "bg.selected",
  "bg.hover",
  "line.subtle",
  "line.strong",
  "text.primary",
  "text.terminal",
  "text.muted",
  "text.subtle",
  "text.dim",
  "peach.base",
  "peach.light",
  "peach.lighter",
  "mint.base",
  "mint.light",
  "red.base",
  "red.light",
  "gray.bright",
];

function paletteErrors(p: Palette): string[] {
  return ROLES.flatMap((role) => {
    const [group, name] = role.split(".");
    const value = p[group]?.[name];
    if (value === undefined) return [`${role}: missing`];
    return /^#[0-9A-Fa-f]{6}$/.test(value) ? [] : [`${role}: ${value} is not #RRGGBB`];
  });
}

function blend(background: string, color: string, amount: number): string {
  const channel = (hex: string, at: number) => parseInt(hex.slice(at, at + 2), 16);
  const mixed = [1, 3, 5].map((at) => {
    const from = channel(background, at);
    const value = Math.round(from + amount * (channel(color, at) - from));
    return value.toString(16).padStart(2, "0");
  });
  return `#${mixed.join("")}`.toUpperCase();
}

function selection(p: Palette): string {
  return blend(p.bg.base, p.peach.base, 0.145);
}

function search(p: Palette): string {
  return blend(p.bg.base, p.peach.base, 64 / 255);
}

function ansi(p: Palette): string[] {
  return [
    p.bg.base,
    p.red.base,
    p.mint.base,
    p.peach.base,
    p.text.muted,
    p.peach.light,
    p.mint.base,
    p.text.primary,
    p.text.dim,
    p.red.light,
    p.mint.light,
    p.peach.light,
    p.gray.bright,
    p.peach.lighter,
    p.mint.light,
    p.text.primary,
  ];
}

function herdrAppTheme(p: Palette): string {
  const theme = {
    background: p.bg.base,
    foreground: p.text.terminal,
    selection: selection(p),
    cursor: p.peach.base,
    ansi: ansi(p),
    colors: {
      background: p.bg.base,
      canvas: p.bg.base,
      chrome: p.bg.base,
      surface: p.bg.raised1,
      popover: p.bg.raised1,
      raised: p.bg.raised2,
      hover: p.bg.hover,
      selected: p.bg.selected,
      border: p.bg.selected,
      input: p.line.strong,
      foreground: p.text.primary,
      muted: p.text.muted,
      dim: p.text.dim,
      accent: p.peach.base,
      accent_foreground: p.bg.base,
      solid: p.peach.base,
      solid_foreground: p.bg.base,
      selection: selection(p),
      working: p.peach.base,
      blocked: p.red.base,
      done: p.mint.base,
      idle: p.text.dim,
      unknown: p.text.subtle,
    },
  };
  return `${JSON.stringify(theme, null, 2)}\n`;
}

function ghosttyTheme(p: Palette): string {
  const lines = [
    `background = ${p.bg.base}`,
    `foreground = ${p.text.terminal}`,
    `cursor-color = ${p.peach.base}`,
    `cursor-text = ${p.bg.base}`,
    `selection-background = ${selection(p)}`,
    `selection-foreground = ${p.text.primary}`,
    `search-background = ${search(p)}`,
    `search-foreground = ${p.text.primary}`,
    `search-selected-background = ${p.peach.base}`,
    `search-selected-foreground = ${p.bg.base}`,
    `split-divider-color = ${p.line.subtle}`,
    ...ansi(p).map((color, index) => `palette = ${index}=${color}`),
  ];
  return `${lines.join("\n")}\n`;
}

function write(path: string, text: string): void {
  const target = join(root, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, text);
}

export function build(): boolean {
  const errors = paletteErrors(palette);
  if (errors.length > 0) {
    for (const error of errors) console.error(`palette: ${error}`);
    return false;
  }
  write("themes/vjr.json", herdrAppTheme(palette));
  write("targets/ghostty/VJR", ghosttyTheme(palette));
  return true;
}

if (import.meta.main && !build()) process.exit(1);
