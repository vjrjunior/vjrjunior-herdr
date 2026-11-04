import { REASONS, atShell, base, checkoutOf, isClaude, keepArgs, leaves, matchingFolder, movedNote, parseWorktrees, placeOf, resumeArgv, resumeCommand, runsSession, splitSteps } from "./logic.js";

export const END_WAIT = 10000;
export const POLL = 250;
const PANE_WAIT = 2000;

export async function moveTab(request, io) {
  const run = { home: null, place: null, ended: [], started: new Set(), unsure: new Set(), moved: null };
  let notice;
  try {
    notice = await move(request, io, run);
  } catch (error) {
    const message = bare(error?.message ?? String(error));
    notice = run.moved ? { title: "Moved the tab", body: `${run.moved}, but ${message}.`, level: "warning" } : failed(`${message}.`, run);
  }
  try {
    io.notify(notice);
  } catch {}
  return { moved: run.moved !== null };
}

async function move(request, io, run) {
  const space = io.spaces().find((candidate) => candidate.tabs.some((tab) => tab.id === request.tab));
  if (!space) return refused(REASONS.gone());
  if (space.machine != null) return refused(REASONS.remote());
  run.home = space.id;
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
  run.place = target.branch ?? base(target.path);

  const note = target.path === source.path ? null : movedNote({ from: source.path, fromBranch: source.branch, to: target.path, toBranch: target.branch });
  for (const part of parts) {
    if (part.kind === "mod") continue;
    const folder = matchingFolder(part.cwd, source.path, target.path);
    part.launch = { folder: (await io.exists(folder)) ? folder : target.path };
    if (part.kind !== "claude") continue;
    part.launch.argv = resumeArgv({ session: part.session, args: part.args, note });
    if (!part.launch.argv) return refused(REASONS.session(part.where));
  }

  let sheltered = false;
  for (const claude of parts.filter((part) => part.kind === "claude")) {
    const now = await readPane(claude.block, claude.where, io);
    const reason = now.reason ?? (now.pid === claude.pid && now.session === claude.session ? null : REASONS.session(claude.where));
    if (reason) return run.ended.length > 0 ? failed(reason, run) : refused(reason);
    if (claude.own && !sheltered && io.spaces().find((candidate) => candidate.id === space.id)?.tabs.length === 1) {
      await io.act("tab.new", { space: space.id, folder: source.path });
      sheltered = true;
    }
    if (!(await ended(claude.pid, io))) return failed(`Claude in ${claude.where} didn't exit, so nothing moved.`, run);
    run.ended.push(claude);
  }

  const live = io.spaces().filter((candidate) => candidate.machine == null);
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
      made[step.leaf] = await launch("tab.new", args, part, run, io);
    } else if (part.kind === "mod") {
      made[step.leaf] = await launch("pane.split", { direction: step.direction, pane: await paneOf(made[step.from], io), ...part.launch }, part, run, io);
    } else {
      await io.act("pane.focus", { pane: await paneOf(made[step.from], io) });
      made[step.leaf] = await launch("terminal.open", { place: step.direction, ...part.launch }, part, run, io);
    }
  }

  run.moved = `${name ?? "The tab"} is now in ${run.place}`;
  if (extra) await io.act("tab.close", { id: extra, confirmed: true });
  const old = io.spaces().find((candidate) => candidate.id === space.id);
  if (old?.tabs.some((candidate) => candidate.id === tab.id)) {
    if (old.tabs.length === 1 && !sheltered) await io.act("tab.new", { space: space.id, folder: source.path });
    await io.act("tab.close", { id: tab.id, confirmed: true });
  }
  await io.act("space.select", { id: into });
  await io.act("tab.select", { id: made[0].tab });
  const notice = { title: `Moved to ${run.place}`, level: "success", timeout: 4000 };
  return run.ended.length > 0 ? { ...notice, body: "Anything Claude ran in the background ended." } : notice;
}

async function readPane(block, where, io) {
  const address = block.content?.terminal;
  if (!address) return { kind: "mod", where, launch: { mod: block.content?.mod, props: block.content?.props } };
  const info = await io.get(address);
  if (!info) return { reason: REASONS.gone() };
  if (isClaude(info)) {
    if (info.parent != null) return { reason: REASONS.subagent(where) };
    const state = info.status?.state;
    if (state === "working" || state === "blocked") return { reason: REASONS[state](where) };
    if (io.terminals().some((terminal) => terminal.parent === address && terminal.state === "live")) return { reason: REASONS.subagents(where) };
    const pid = info.foreground.pid;
    const found = await io.session(pid);
    if (!found) return { reason: REASONS.session(where) };
    return { kind: "claude", block, address, where, pid, own: info.pid === pid, session: found.session, cwd: found.cwd, args: keepArgs(info.foreground.argv ?? []) };
  }
  if (atShell(info)) return { kind: "shell", where, cwd: info.cwd ?? info.foreground?.cwd ?? null };
  const pane = io.panes().find((candidate) => candidate.terminal === address);
  return { reason: REASONS.busy(pane?.program?.name ?? base(info.foreground.argv?.[0] ?? ""), where) };
}

async function launch(name, args, part, run, io) {
  try {
    const made = await io.act(name, args);
    if (part.kind === "claude") run.started.add(part);
    return made;
  } catch (error) {
    if (part.kind === "claude") (resumed(part, io) ? run.started : run.unsure).add(part);
    throw error;
  }
}

function resumed(claude, io) {
  try {
    return io.terminals().some((terminal) => terminal.address !== claude.address && runsSession(terminal, claude.session));
  } catch {
    return false;
  }
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

function failed(message, run) {
  const offered = run.ended.filter((claude) => !run.started.has(claude) && !run.unsure.has(claude));
  const unsure = [...run.unsure].map((claude) => `Claude from ${claude.where} may already be running in ${run.place}.`);
  const notice = { title: "Couldn't move the tab", body: [message, ...unsure].join(" "), level: "error" };
  if (offered.length === 0) return notice;
  const commands = offered.map((claude) => resumeCommand({ cwd: claude.cwd, session: claude.session, args: claude.args }) ?? `claude --resume ${claude.session}`);
  const [first] = offered;
  return {
    ...notice,
    body: `${notice.body} To resume Claude by hand: ${commands.join("; ")}`,
    action: { name: "tab.new", args: { space: run.home, folder: first.cwd, argv: resumeArgv({ session: first.session, args: first.args, note: null }) } },
  };
}

function bare(text) {
  return text.replace(/[.!?]+$/, "");
}
