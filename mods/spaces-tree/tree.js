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
