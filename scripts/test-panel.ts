import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { herdrAppHome, stateDir } from "./paths";

export const PANEL = "vjr-test-panel";
export const PANEL_KIT = "vjr-kit";

export type Step = { title: string; do?: string[]; expect?: string; run?: { command: string; args?: Record<string, unknown> }[] };
export type Run = {
  id: string;
  title: string;
  intro?: string;
  layouts?: string[];
  watch?: string[];
  shotOn?: string[];
  shots?: string;
  report?: string;
  closed?: boolean;
  steps: Step[];
};

function once(text: string, from: string, to: string, file: string): string {
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: expected ${from} once, found it ${count} times`);
  return text.replace(from, to);
}

export function panelFiles(repo: string, run: Run): Record<string, string> {
  const folder = join(repo, "tools/test-panel");
  let main = readFileSync(join(folder, "main.js"), "utf8");
  main = once(main, '"../../kit/kit.js"', '"./kit.js"', "main.js");
  main = once(main, '{ name: "test-panel" }', `{ name: "${PANEL}" }`, "main.js");
  const kit = once(readFileSync(join(repo, "kit/kit.js"), "utf8"), '{ name: "kit" }', `{ name: "${PANEL_KIT}" }`, "kit.js");
  return {
    "main.js": main,
    "events.js": readFileSync(join(folder, "events.js"), "utf8"),
    "kit.js": kit,
    "mod.json": readFileSync(join(folder, "mod.json"), "utf8"),
    "run.js": `export default ${JSON.stringify(run, null, 2)};\n`,
  };
}

export function readRun(file: string, now = Date.now()): Run {
  const run = JSON.parse(readFileSync(file, "utf8"));
  if (typeof run.title !== "string" || !Array.isArray(run.steps)) throw new Error(`${file}: a run needs a title and steps`);
  for (const [index, step] of run.steps.entries()) {
    if (typeof step.title !== "string") throw new Error(`${file}: step ${index + 1} needs a title`);
  }
  const id = typeof run.id === "string" && run.id ? run.id : `${basename(file).replace(/\.json$/, "")}-${now}`;
  return { ...run, id, shots: run.shots ?? join(stateDir(), "test-panel", id) };
}

export function formatResults(state: any): string {
  if (!state) return "No test panel run yet.";
  const lines = [`run ${state.run}, step ${state.step + 1}${state.reported ? ", reported" : ""}`];
  for (const result of state.results ?? []) {
    lines.push(`${result.step + 1}. ${result.verdict} — ${result.title}${result.note ? ` — "${result.note}"` : ""}${result.shot ? ` — ${result.shot}` : ""}`);
  }
  lines.push("events:");
  for (const item of state.log ?? []) lines.push(`  ${new Date(item.at).toISOString().slice(11, 19)} step ${item.step + 1}: ${item.text}`);
  return lines.join("\n");
}

async function app(args: string[]): Promise<string> {
  const proc = Bun.spawn(["herdr-app", ...args], { stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited]);
  if (code !== 0) throw new Error(`herdr-app ${args.join(" ")}: ${(err || out).trim()}`);
  return out;
}

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function install(file: string): Promise<void> {
  const repo = resolve(import.meta.dir, "..");
  const run = readRun(file);
  const folder = join(herdrAppHome(), "mods", PANEL);
  mkdirSync(folder, { recursive: true });
  mkdirSync(run.shots as string, { recursive: true });
  for (const [name, text] of Object.entries(panelFiles(repo, run))) writeFileSync(join(folder, name), text);
  await app(["check", folder]);
  const shown = JSON.parse(await app(["status"])).layout as string;
  const layouts = run.layouts?.length ? run.layouts : [shown];
  for (const layout of layouts) {
    await app(["do", "layout.switch", JSON.stringify({ name: layout })]);
    await wait(1200);
    await app(["do", "mod.open", JSON.stringify({ name: PANEL })]);
    await wait(1200);
  }
  if (layouts.at(-1) !== layouts[0]) await app(["do", "layout.switch", JSON.stringify({ name: layouts[0] })]);
  console.log(`test panel "${run.title}" (${run.id}) is open in ${layouts.join(", ")}; shots go to ${run.shots}`);
}

function results(): void {
  const file = join(herdrAppHome(), "shared.json");
  const shared = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  console.log(formatResults(shared["test-panel"]));
}

function close(): void {
  const file = join(herdrAppHome(), "mods", PANEL, "run.js");
  if (!existsSync(file)) return;
  const run = JSON.parse(readFileSync(file, "utf8").replace(/^export default /, "").replace(/;\s*$/, ""));
  writeFileSync(file, `export default ${JSON.stringify({ ...run, closed: true }, null, 2)};\n`);
  console.log(`test panel "${run.title}" closes in every layout`);
}

if (import.meta.main) {
  const [arg] = process.argv.slice(2);
  if (arg === "--results") results();
  else if (arg === "--close") close();
  else if (arg) await install(arg);
  else {
    console.error("usage: bun run test-panel <run.json> | --results | --close");
    process.exit(1);
  }
}
