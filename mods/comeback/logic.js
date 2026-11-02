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
