const URGENCY = ["blocked", "done", "working", "idle"];

export function base(path) {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
}

export function repoName(common) {
  const folder = common.endsWith("/.git") ? common.slice(0, -5) : common;
  return base(folder).replace(/\.git$/, "");
}

export function parseWorktrees(text) {
  const out = [];
  for (const block of text.split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    if (!path || lines.some((line) => line === "bare" || line.startsWith("prunable"))) continue;
    const branch = lines.find((line) => line.startsWith("branch "))?.slice(7).replace(/^refs\/heads\//, "") ?? null;
    out.push({ path, branch, main: out.length === 0 });
  }
  return out;
}

export function parseRefs(text) {
  const out = {};
  for (const line of text.split("\n")) {
    const [name, track = "", at = "0"] = line.split("\t");
    if (!name) continue;
    out[name] = {
      ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
      behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
      at: Number(at) || 0,
    };
  }
  return out;
}

export function readLook(result) {
  if (result.code !== 0) return /not a git repository/i.test(result.stderr ?? "") ? null : undefined;
  const [top, common] = result.stdout.trim().split("\n");
  return top && common ? { top, common } : undefined;
}

export function mostUrgent(statuses) {
  return URGENCY.find((status) => statuses.includes(status)) ?? null;
}

export function checkoutOf(top, checkouts) {
  let best = null;
  for (const checkout of checkouts) {
    const path = checkout.path.replace(/\/+$/, "");
    if ((top === path || top.startsWith(`${path}/`)) && (!best || path.length > best.path.length)) best = checkout;
  }
  return best;
}

function treeRow(checkout, repo, space, main) {
  const ref = (checkout.branch && repo.refs[checkout.branch]) || { ahead: 0, behind: 0 };
  const name = space?.named ? space.name : main ? repo.name : (checkout.branch ?? base(checkout.path));
  return {
    key: space?.id ?? checkout.path,
    path: checkout.path,
    name,
    branch: checkout.branch,
    space: space ?? null,
    status: space?.status ?? null,
    ahead: ref.ahead,
    behind: ref.behind,
    open: Boolean(space),
  };
}

function plainEntry(space) {
  const row = { key: space.id, path: null, name: space.name, branch: null, space, status: space.status ?? null, ahead: 0, behind: 0, open: true };
  return { kind: "plain", key: space.id, row };
}

function repoEntry(repo, spaces, where) {
  const inRepo = spaces.filter((space) => where.get(space.id)?.repo.common === repo.common);
  const mainCheckout = repo.checkouts.find((checkout) => checkout.main);
  const mainSpace = inRepo.find((space) => where.get(space.id).checkout === mainCheckout);
  const open = inRepo.filter((space) => !where.get(space.id).checkout.main).map((space) => treeRow(where.get(space.id).checkout, repo, space, false));
  const taken = new Set(inRepo.map((space) => where.get(space.id).checkout));
  const at = (checkout) => (checkout.branch && repo.refs[checkout.branch]?.at) || 0;
  const closed = repo.checkouts
    .filter((checkout) => !checkout.main && !taken.has(checkout))
    .sort((a, b) => at(b) - at(a))
    .map((checkout) => treeRow(checkout, repo, null, false));
  return { kind: "repo", key: repo.common, main: treeRow(mainCheckout, repo, mainSpace, true), kids: [...open, ...closed] };
}

export function buildTree(spaces, looks, repos) {
  const where = new Map();
  for (const space of spaces) {
    const look = space.machine == null ? looks[space.id] : null;
    const repo = look ? repos[look.common] : undefined;
    const checkout = repo ? checkoutOf(look.top, repo.checkouts) : null;
    if (checkout) where.set(space.id, { repo, checkout });
  }
  const anchors = new Map();
  for (const space of spaces) {
    const found = where.get(space.id);
    if (found?.checkout.main && !anchors.has(found.repo.common)) anchors.set(found.repo.common, space.id);
  }
  for (const space of spaces) {
    const found = where.get(space.id);
    if (found && !anchors.has(found.repo.common)) anchors.set(found.repo.common, space.id);
  }
  const out = [];
  for (const space of spaces) {
    const found = where.get(space.id);
    if (!found) out.push(plainEntry(space));
    else if (anchors.get(found.repo.common) === space.id) out.push(repoEntry(found.repo, spaces, where));
    else if (found.checkout.main) out.push(plainEntry(space));
  }
  return out;
}

export const PALETTE = ["ansi6", "ansi3", "ansi4", "ansi5", "ansi2", "ansi1"];
export const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };

export function paint(color, t) {
  if (typeof color === "string" && color.startsWith("#")) return color;
  return MARK[color] ?? t[color] ?? t.dim;
}
const FALLBACK = 60000;
const OPENING = 3000;

export function place(space, panes) {
  const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
  return panes.find((pane) => tabs.has(pane.tab) && pane.cwd)?.cwd || space.folder;
}

export function duePlaces({ places, lastPlaces, busy, lastBusy, paneSpace, looks, unsure, checked, time, active, folded }) {
  const due = new Set();
  const known = (path) => path in looks || unsure.has(path);
  const commonOf = (path) => looks[path]?.common ?? null;
  const paths = new Set(Object.values(places));
  for (const path of paths) if (!known(path)) due.add(path);
  for (const [id, path] of Object.entries(places)) {
    if (lastPlaces[id] && lastPlaces[id] !== path && known(path)) due.add(path);
  }
  for (const [pane, now] of Object.entries(busy)) {
    const path = places[paneSpace[pane]];
    if (now || !lastBusy[pane] || !path) continue;
    due.add(path);
    const common = commonOf(path);
    if (common) for (const other of paths) if (commonOf(other) === common) due.add(other);
  }
  if (active) {
    for (const path of paths) {
      const common = commonOf(path);
      const asks = Boolean(looks[path]) || unsure.has(path);
      if (asks && !(common && folded.has(common)) && time - (checked[path] ?? 0) > FALLBACK) due.add(path);
    }
  }
  return due;
}

export function assignColors(spaces, stored) {
  const ids = new Set(spaces.map((space) => space.id));
  const before = stored ?? {};
  const colors = Object.fromEntries(Object.entries(before).filter(([id]) => ids.has(id)));
  let changed = Object.keys(colors).length !== Object.keys(before).length;
  for (const space of spaces) {
    if (colors[space.id] || space.name === "~") continue;
    const uses = (color) => Object.values(colors).filter((used) => used === color).length;
    colors[space.id] = PALETTE.reduce((best, color) => (uses(color) < uses(best) ? color : best));
    changed = true;
  }
  return { colors, changed };
}

export function canOpen(opening, path, time) {
  return !(path in opening) || time - opening[path] >= OPENING;
}

export const rowsOf = (entry) => (entry.kind === "repo" ? [entry.main, ...entry.kids] : [entry.row]);

export function holdsActive(entry) {
  return rowsOf(entry).some((row) => row.space?.active);
}

export function foldedTail(entry) {
  return { count: entry.kind === "repo" ? entry.kids.length : 0, status: mostUrgent(rowsOf(entry).map((row) => row.status)) };
}

export function counts(row) {
  return [row.ahead ? `↑${row.ahead}` : "", row.behind ? `↓${row.behind}` : ""].filter(Boolean).join(" ");
}

export function branchLabel(row) {
  return !row.branch || row.branch === "main" || row.branch === "master" ? "" : row.branch;
}

export function isFolded(folded, entry) {
  return entry.kind === "repo" && entry.kids.length > 0 && folded.has(entry.key);
}

export function liveFolds(folded, repos) {
  return new Set([...folded].filter((key) => (repos[key]?.checkouts.length ?? 0) > 1));
}

export const DRAG_TTL = 30000;
export const DRAG_GRACE = 300;

export function dropTarget(entry, row, look) {
  if (entry.kind === "repo") return row.path ? { path: row.path, common: entry.key } : null;
  return look?.top && look.common ? { path: look.top, common: look.common } : null;
}

export function accepts(drag, target, row, sourceCommon, time) {
  if (!drag || typeof drag.tab !== "string" || typeof drag.space !== "string" || !Number.isFinite(drag.at)) return false;
  if (!target || !sourceCommon || time - drag.at > DRAG_TTL) return false;
  return row.space?.id !== drag.space && target.common === sourceCommon;
}
