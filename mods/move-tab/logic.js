const SHELLS = ["zsh", "bash", "fish", "sh", "dash", "ksh"];
const ALLOWED = {
  "--dangerously-skip-permissions": 0,
  "--permission-mode": 1,
  "--model": 1,
  "--add-dir": "many",
  "--verbose": 0,
  "--agent": 1,
  "--effort": 1,
  "--settings": 1,
  "--mcp-config": "many",
  "--strict-mcp-config": 0,
  "--plugin-dir": 1,
};
const PLAIN = /^[A-Za-z0-9_/.,:@%+=-]+$/;
const UNTYPABLE = /['\\\u0000-\u001f\u007f]/;
const SESSION = /^[A-Za-z0-9-]+$/;

export const REASONS = {
  working: (where) => `Claude is working in ${where}. Move it when the turn ends.`,
  blocked: (where) => `Claude is waiting for you in ${where}.`,
  busy: (program, where) => `${program} is running in ${where}.`,
  subagents: (where) => `Claude has sub-agents running in ${where}.`,
  session: (where) => `Couldn't find Claude's conversation in ${where}.`,
  remote: () => "Tabs on other machines can't move yet.",
  repo: () => "This tab isn't in a git repo.",
  target: () => "That checkout is gone.",
  same: () => "The tab is already there.",
  gone: () => "The tab is gone.",
  running: () => "Another move is running.",
};

export function base(path) {
  return path.replace(/\/+$/, "").split("/").pop() ?? "";
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

export function checkoutOf(folder, checkouts) {
  let best = null;
  for (const checkout of checkouts) {
    const path = checkout.path.replace(/\/+$/, "");
    if ((folder === path || folder.startsWith(`${path}/`)) && (!best || path.length > best.path.length)) best = checkout;
  }
  return best;
}

export function matchingFolder(cwd, fromRoot, toRoot) {
  const from = fromRoot.replace(/\/+$/, "");
  const to = toRoot.replace(/\/+$/, "");
  if (typeof cwd !== "string") return to;
  const path = cwd.replace(/\/+$/, "");
  if (path === from) return to;
  return path.startsWith(`${from}/`) ? `${to}${path.slice(from.length)}` : to;
}

export function parseSession(text) {
  if (typeof text !== "string") return null;
  try {
    const data = JSON.parse(text);
    if (typeof data?.sessionId !== "string" || typeof data.cwd !== "string") return null;
    return { session: data.sessionId, cwd: data.cwd, procStart: typeof data.procStart === "string" ? data.procStart : undefined };
  } catch {
    return null;
  }
}

export function isShell(argv0) {
  return SHELLS.includes(base(argv0 ?? "").replace(/^-/, ""));
}

export function quote(value) {
  if (typeof value !== "string" || value === "") return null;
  if (PLAIN.test(value)) return value;
  if (UNTYPABLE.test(value)) return null;
  return `'${value}'`;
}

export function keepArgs(argv) {
  const list = argv.slice(1);
  const out = [];
  for (let i = 0; i < list.length; i++) {
    let flag = list[i];
    let inline = null;
    if (flag.startsWith("--") && flag.includes("=")) {
      inline = flag.slice(flag.indexOf("=") + 1);
      flag = flag.slice(0, flag.indexOf("="));
    }
    if (!Object.hasOwn(ALLOWED, flag)) continue;
    const arity = ALLOWED[flag];
    const values = [];
    if (inline !== null) values.push(inline);
    else if (arity === 1 && i + 1 < list.length && !list[i + 1].startsWith("-")) values.push(list[++i]);
    else if (arity === "many") while (i + 1 < list.length && !list[i + 1].startsWith("-")) values.push(list[++i]);
    if (arity === 0 && values.length > 0) continue;
    if (arity !== 0 && values.length === 0) continue;
    if (values.some((value) => quote(value) === null)) continue;
    out.push(flag, ...values);
  }
  return out;
}

export function resumeCommand(note) {
  const folder = quote(note.cwd);
  if (folder === null || !SESSION.test(note.session)) return null;
  return [`cd ${folder} && claude --resume ${note.session}`, ...note.args.map(quote)].join(" ");
}

export function atShell(info) {
  const front = info?.foreground;
  if (!front) return true;
  return front.pid === info.pid && isShell(front.argv?.[0]);
}

export function isClaude(info) {
  const front = info?.foreground;
  if (front && base(front.argv?.[0] ?? "") === "claude") return true;
  return info?.status?.app === "claude-code" && !atShell(info);
}

export function movedNote({ from, fromBranch, to, toBranch }) {
  const branch = (name) => (name ? `branch ${name}` : "detached HEAD");
  return `This session moved from ${from} (${branch(fromBranch)}) to ${to} (${branch(toBranch)}). Work in ${to} from now on; files under ${from} belong to another checkout.`;
}

export function resumeArgv({ session, args, note }) {
  if (typeof session !== "string" || !SESSION.test(session)) return null;
  return ["claude", "--resume", session, ...args, "--append-system-prompt", note];
}

export function tabTree(stdout, tab) {
  try {
    const spaces = JSON.parse(stdout)?.result?.value?.spaces;
    if (!Array.isArray(spaces)) return null;
    for (const space of spaces) {
      const found = (space?.tabs ?? []).find((candidate) => candidate?.id === tab);
      if (found) return found.root ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

export function leaves(node) {
  if (!node) return [];
  if (node.type === "block") return [node];
  return (node.children ?? []).flatMap(leaves);
}

export function splitSteps(node) {
  const steps = [{ leaf: 0, from: null, direction: null }];
  const walk = (current, start) => {
    if (current.type === "block") return;
    const direction = current.type === "column" ? "down" : "right";
    const children = current.children ?? [];
    const firsts = [];
    let offset = start;
    for (const child of children) {
      firsts.push(offset);
      offset += leaves(child).length;
    }
    for (let i = 1; i < children.length; i++) steps.push({ leaf: firsts[i], from: firsts[i - 1], direction });
    children.forEach((child, i) => walk(child, firsts[i]));
  };
  walk(node, 0);
  return steps;
}

export function placeOf(space, panes) {
  const tabs = new Set((space.tabs ?? []).map((tab) => tab.id));
  const pane = panes.find((candidate) => tabs.has(candidate.tab) && candidate.cwd);
  return pane?.cwd ?? space.folder ?? null;
}

export function targetsFor({ checkouts, spaces, panes, from }) {
  const main = [];
  const open = [];
  const idle = [];
  for (const checkout of checkouts) {
    const here = spaces.filter((space) => {
      const place = placeOf(space, panes);
      return place !== null && checkoutOf(place, checkouts) === checkout;
    });
    const detail = checkout.main ? "main checkout" : checkout.branch;
    const rows = here
      .filter((space) => space.id !== from.space)
      .map((space) => ({ key: space.id, path: checkout.path, label: space.name, detail: `${detail ?? base(checkout.path)} · open`, space: space.id }));
    if (checkout.main) main.push(...rows);
    else open.push(...rows);
    if (here.length === 0) {
      const row = {
        key: checkout.path,
        path: checkout.path,
        label: checkout.main ? base(checkout.path) : (checkout.branch ?? base(checkout.path)),
        detail: detail ?? base(checkout.path),
        space: null,
      };
      if (checkout.main) main.push(row);
      else idle.push(row);
    }
  }
  idle.sort((a, b) => a.label.localeCompare(b.label));
  return [...main, ...open, ...idle];
}
