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
