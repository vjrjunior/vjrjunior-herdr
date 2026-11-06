export const NO_CLAUDE = { terminal: null, status: null, count: 0, ambiguous: false };

export function pickClaude(claudes, record) {
  const none = { terminal: null, status: null, count: claudes.length, ambiguous: false };
  const pick = (claude) => ({ terminal: claude.terminal, status: claude.status, count: claudes.length, ambiguous: false });
  const match = record?.tty ? claudes.find((claude) => claude.tty === record.tty) : null;
  if (match) return pick(match);
  if (claudes.length === 1) return pick(claudes[0]);
  return claudes.length === 0 ? none : { ...none, ambiguous: true };
}

export function sendArgs(claude, text) {
  return claude.status === "idle" ? ["send", "--if", "idle", claude.terminal, text] : ["send", claude.terminal, text];
}

export function sendTo(lane, label, text, preferred = null) {
  const own = preferred?.terminal ? preferred : null;
  const claude = own ?? lane.claude ?? NO_CLAUDE;
  const fallback = { text, space: lane.space ?? null, folder: lane.path };
  if (claude.ambiguous) return { label, kind: "wait", disabled: true, target: "More than one claude here", ...fallback };
  if (claude.terminal && claude.status === "working") return { label, kind: "wait", disabled: true, target: "claude is working", ...fallback };
  if (claude.terminal) return { label, kind: "send", terminal: claude.terminal, target: own ? `the task's claude · ${claude.terminal}` : `claude · ${claude.terminal} in this worktree`, ...fallback };
  if (lane.space) return { label: `${label} in a new tab`, kind: "tab", target: `new tab in ${lane.repo?.name ?? "this repo"}`, ...fallback };
  return { label: `${label} in a new space`, kind: "space", target: "new space in this worktree", ...fallback };
}

export function inNewTab(lane, label, text, name) {
  if (lane.space) return { label: `${label} in a new tab`, kind: "tab", target: "new tab in this worktree", text, space: lane.space, folder: lane.path, name };
  return { label: `${label} in a new space`, kind: "space", target: "new space in this worktree", text, space: null, folder: lane.path, name };
}

export function inMain(lane, label, text) {
  const where = { text, space: lane.mainSpace ?? null, folder: lane.repo?.main ?? null };
  if (lane.mainSpace) return { label, kind: "tab", target: `new tab in ${lane.repo?.name ?? "the main checkout"}`, ...where };
  return { label, kind: "space", target: "new space in the main checkout", ...where };
}
