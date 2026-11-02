const SHELLS = ["zsh", "bash", "fish", "sh", "dash", "ksh"];
const ALLOWED = { "--dangerously-skip-permissions": 0, "--permission-mode": 1, "--model": 1, "--add-dir": "many", "--verbose": 0 };
const PLAIN = /^[A-Za-z0-9_/.,:@%+=-]+$/;
const UNTYPABLE = /['\\\u0000-\u001f\u007f]/;
const SESSION = /^[A-Za-z0-9-]+$/;

const base = (path) => path.replace(/\/+$/, "").split("/").pop() ?? "";

export function parseBoot(text) {
  const mac = /sec\s*=\s*(\d+)/.exec(text ?? "");
  if (mac) return mac[1];
  const id = (text ?? "").trim();
  return /^[0-9a-f-]{8,}$/i.test(id) ? id : null;
}

export function parseEtime(text) {
  const match = /^\s*(?:(\d+)-)?(?:(\d+):)?(\d+):(\d+)\s*$/.exec(text ?? "");
  if (!match) return null;
  const [, days = "0", hours = "0", minutes, seconds] = match;
  return ((Number(days) * 24 + Number(hours)) * 60 + Number(minutes)) * 60 + Number(seconds);
}

export function parseSession(text) {
  if (typeof text !== "string") return null;
  try {
    const data = JSON.parse(text);
    if (typeof data?.sessionId !== "string" || typeof data.cwd !== "string") return null;
    return { session: data.sessionId, cwd: data.cwd };
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

const validShell = (shell) => Boolean(shell) && Number.isInteger(shell.pid) && typeof shell.start === "string";

export function encodeNote(note) {
  return JSON.stringify(note);
}

export function decodeNote(text) {
  if (typeof text !== "string") return null;
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return null;
  }
  if (!raw || raw.v !== 1 || raw.agent !== "claude") return null;
  if (typeof raw.session !== "string" || !SESSION.test(raw.session)) return null;
  if (typeof raw.cwd !== "string" || !raw.cwd.startsWith("/")) return null;
  if (typeof raw.boot !== "string" || !validShell(raw.shell) || typeof raw.at !== "number") return null;
  const args = Array.isArray(raw.args) ? keepArgs(["claude", ...raw.args.filter((arg) => typeof arg === "string")]) : [];
  const note = { v: 1, agent: "claude", session: raw.session, cwd: raw.cwd, args, boot: raw.boot, shell: { pid: raw.shell.pid, start: raw.shell.start }, at: raw.at };
  if (raw.tried && typeof raw.tried.boot === "string" && validShell(raw.tried.shell)) {
    note.tried = { boot: raw.tried.boot, shell: { pid: raw.tried.shell.pid, start: raw.tried.shell.start } };
    if (typeof raw.tried.reason === "string") note.tried.reason = raw.tried.reason;
  }
  return note;
}

export function lastLine(screen) {
  const lines = (screen ?? "")
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);
  lines.pop();
  return (lines.at(-1) ?? "").trim().slice(0, 120);
}

const FRESH = 600;

export function judge(terminal, boot) {
  const front = terminal.foreground;
  const atShell = Boolean(front) && front.pid === terminal.pid && isShell(front.argv?.[0]);
  if (front && (base(front.argv?.[0] ?? "") === "claude" || (terminal.app === "claude-code" && !atShell))) return "running";
  const note = terminal.note;
  if (!note) return "none";
  const same = note.boot === boot && note.shell.pid === terminal.pid && note.shell.start === terminal.start;
  if (same) return atShell ? "quit" : "none";
  return atShell ? "lost" : "busy";
}

export function triedNow(note, terminal, boot) {
  const tried = note?.tried;
  return Boolean(tried) && tried.boot === boot && tried.shell.pid === terminal.pid && tried.shell.start === terminal.start;
}

export function markTried(note, terminal, boot, reason) {
  return { ...note, tried: { boot, shell: { pid: terminal.pid, start: terminal.start }, ...(reason ? { reason } : {}) } };
}

export function planPass(lost, ctx) {
  const candidates = lost.filter((terminal) => !ctx.auto || (!triedNow(terminal.note, terminal, ctx.boot) && terminal.age <= FRESH));
  const ordered = [...candidates].sort((a, b) => b.note.at - a.note.at);
  const todo = [];
  const skipped = [];
  const taken = new Set();
  for (const terminal of ordered) {
    const { cwd, session } = terminal.note;
    let reason = null;
    if (quote(cwd) === null) reason = "its folder can't be typed";
    else if (!ctx.folderOk(cwd)) reason = "its folder is gone";
    else if (!ctx.transcriptOk(session)) reason = "no saved conversation";
    else if (ctx.open.has(session)) reason = "open in another terminal";
    else if (taken.has(session)) reason = "already resumed in this pass";
    if (reason) skipped.push({ terminal, reason });
    else {
      todo.push(terminal);
      taken.add(session);
    }
  }
  return { todo, skipped };
}

const conversations = (count) => `${count} Claude conversation${count === 1 ? "" : "s"}`;

export function summary({ resumed, failed, skipped }, manual) {
  const missed = [...failed, ...skipped];
  const total = resumed.length + missed.length;
  if (total === 0) return manual ? { title: "No Claude conversation to resume", body: "No terminal lost its Claude.", level: "info", timeout: 3000 } : null;
  if (missed.length === 0) return { title: `Resumed ${conversations(resumed.length)}`, body: resumed.join(", "), level: "success", timeout: 5000 };
  const title = resumed.length > 0 ? `Resumed ${resumed.length} of ${total} Claude conversations` : `Couldn't resume ${conversations(missed.length)}`;
  return { title, body: `Not resumed: ${missed.map((item) => `${item.where}: ${item.reason}`).join("; ")}`, level: "warning", timeout: 8000 };
}
