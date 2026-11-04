import { REASONS, atShell, base, checkoutOf, isClaude, keepArgs, leaves, matchingFolder, movedNote, parseWorktrees, placeOf, resumeArgv, resumeCommand, splitSteps } from "./logic.js";

export const END_WAIT = 10000;
export const POLL = 250;
const PANE_WAIT = 2000;

export async function moveTab(request, io) {
  const run = { claudes: [], started: new Set() };
  let notice;
  try {
    notice = await move(request, io, run);
  } catch (error) {
    notice = failed(sentence(error.message), run.claudes.filter((claude) => !run.started.has(claude)));
  }
  io.notify(notice);
  return { moved: notice.level === "success" };
}

async function move(request, io, run) {
  const space = io.spaces().find((candidate) => candidate.tabs.some((tab) => tab.id === request.tab));
  if (!space) return refused(REASONS.gone());
  if (space.machine != null) return refused(REASONS.remote());
  const tab = space.tabs.find((candidate) => candidate.id === request.tab);
  const root = await io.tree(tab.id);
  const blocks = leaves(root);
  if (blocks.length === 0) return refused(REASONS.gone());

  const parts = [];
  for (const [index, block] of blocks.entries()) {
    const part = await readPane(block, blocks.length === 1 ? "this tab" : `pane ${index + 1}`, io);
    if (part.reason) return refused(part.reason);
    parts.push(part);
  }

  const from = parts.find((part) => part.cwd)?.cwd ?? space.folder;
  const text = await io.worktrees(from);
  const checkouts = text ? parseWorktrees(text) : [];
  const source = checkoutOf(from, checkouts);
  if (!source) return refused(REASONS.repo());
  const target = checkouts.find((checkout) => checkout.path === request.to);
  if (!target) return refused(REASONS.target());
  if (request.toSpace === space.id || (request.toSpace == null && target === source)) return refused(REASONS.same());

  const note = movedNote({ from: source.path, fromBranch: source.branch, to: target.path, toBranch: target.branch });
  for (const part of parts) {
    if (part.kind === "mod") continue;
    const folder = matchingFolder(part.cwd, source.path, target.path);
    part.launch = { folder: (await io.exists(folder)) ? folder : target.path };
    if (part.kind !== "claude") continue;
    part.launch.argv = resumeArgv({ session: part.session, args: part.args, note });
    if (!part.launch.argv) return refused(REASONS.session(part.where));
  }

  const claudes = parts.filter((part) => part.kind === "claude");
  run.claudes = claudes;
  for (const claude of claudes) {
    if (!(await ended(claude.pid, io))) return failed(`Claude didn't end in ${END_WAIT / 1000} seconds, so the tab stayed.`, claudes);
  }

  const live = io.spaces();
  let into = live.find((candidate) => candidate.id === request.toSpace)?.id;
  into ??= live.find((candidate) => candidate.id !== space.id && within(candidate, io.panes(), checkouts, target))?.id;
  let extra = null;
  if (!into) {
    const made = await io.act("space.new", { folder: target.path });
    into = made.space;
    extra = made.tab;
  }

  const name = tab.named ? tab.name : null;
  const made = [];
  for (const step of splitSteps(root)) {
    const part = parts[step.leaf];
    if (step.from === null) {
      const args = { space: into, ...part.launch };
      if (name) args.name = name;
      made[step.leaf] = await io.act("tab.new", args);
    } else if (part.kind === "mod") {
      made[step.leaf] = await io.act("pane.split", { direction: step.direction, pane: await paneOf(made[step.from], io), ...part.launch });
    } else {
      await io.act("pane.focus", { pane: await paneOf(made[step.from], io) });
      made[step.leaf] = await io.act("terminal.open", { place: step.direction, ...part.launch });
    }
    if (part.kind === "claude") run.started.add(part);
  }

  if (extra) await io.act("tab.close", { id: extra, confirmed: true });
  if (io.spaces().find((candidate) => candidate.id === space.id)?.tabs.length === 1) await io.act("tab.new", { space: space.id, folder: source.path });
  await io.act("tab.close", { id: tab.id, confirmed: true });
  await io.act("space.select", { id: into });
  await io.act("tab.select", { id: made[0].tab });
  const background = claudes.length > 0 ? " Anything Claude ran in the background ended with it." : "";
  return { title: "Moved the tab", body: `${name ?? "The tab"} is now in ${target.branch ?? base(target.path)}.${background}`, level: "success", timeout: 4000 };
}

async function readPane(block, where, io) {
  const address = block.content?.terminal;
  if (!address) return { kind: "mod", where, launch: { mod: block.content?.mod, props: block.content?.props } };
  const info = await io.get(address);
  if (!info) return { reason: REASONS.gone() };
  if (isClaude(info)) {
    const state = info.status?.state;
    if (state === "working" || state === "blocked") return { reason: REASONS[state](where) };
    if (io.terminals().some((terminal) => terminal.parent === address && terminal.state === "live")) return { reason: REASONS.subagents(where) };
    const pid = info.foreground.pid;
    const found = await io.session(pid);
    if (!found) return { reason: REASONS.session(where) };
    return { kind: "claude", where, pid, session: found.session, cwd: found.cwd, args: keepArgs(info.foreground.argv ?? []) };
  }
  if (atShell(info)) return { kind: "shell", where, cwd: info.cwd ?? info.foreground?.cwd ?? null };
  const pane = io.panes().find((candidate) => candidate.pane === block.id);
  return { reason: REASONS.busy(pane?.program?.name ?? base(info.foreground.argv?.[0] ?? ""), where) };
}

async function ended(pid, io) {
  await io.signal(pid);
  const start = io.now();
  while (await io.alive(pid)) {
    if (io.now() - start >= END_WAIT) return false;
    await io.sleep(POLL);
  }
  return true;
}

function within(space, panes, checkouts, target) {
  const place = placeOf(space, panes);
  return place !== null && checkoutOf(place, checkouts) === target;
}

async function paneOf(made, io) {
  if (made.pane) return made.pane;
  const start = io.now();
  for (;;) {
    const pane = io.panes().find((candidate) => (made.terminal ? candidate.terminal === made.terminal : candidate.tab === made.tab));
    if (pane) return pane.pane;
    if (io.now() - start >= PANE_WAIT) throw new Error("The new pane didn't show up");
    await io.sleep(POLL);
  }
}

function refused(body) {
  return { title: "Can't move this tab", body, level: "warning" };
}

function failed(message, claudes) {
  const commands = claudes.map((claude) => resumeCommand({ cwd: claude.cwd, session: claude.session, args: claude.args }) ?? `claude --resume ${claude.session}`);
  return { title: "Couldn't move the tab", body: commands.length > 0 ? `${message} To resume Claude by hand: ${commands.join("; ")}` : message, level: "error" };
}

function sentence(text) {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}
