const WEB = /^(https?:|mailto:)/i;
const MARKDOWN = /\.(md|markdown)$/i;
const FENCE = /^(---|\.\.\.)\s*$/;

export function stripFrontMatter(text) {
  const lines = String(text ?? "").split("\n");
  if (lines[0]?.replace(/\r$/, "") !== "---") return text;
  const end = lines.findIndex((line, index) => index > 0 && FENCE.test(line.replace(/\r$/, "")));
  if (end < 0) return text;
  return lines.slice(end + 1).join("\n");
}

export function nameOf(path) {
  return String(path).replace(/\/+$/, "").split("/").pop() || path;
}

export function folderOf(path) {
  const trimmed = String(path).replace(/\/+$/, "");
  const cut = trimmed.lastIndexOf("/");
  return cut > 0 ? trimmed.slice(0, cut) : "/";
}

export function shortFolder(path, home) {
  if (home && path === home) return "~";
  if (home && path.startsWith(`${home}/`)) return `~${path.slice(home.length)}`;
  return path;
}

function normalize(path) {
  const parts = [];
  for (const part of path.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
}

export function linkTarget(file, url) {
  const raw = String(url ?? "").trim();
  if (WEB.test(raw)) return { kind: "web", url: raw };
  let path = raw.replace(/^file:\/\//i, "").replace(/[#?].*$/, "");
  if (!path) return { kind: "none" };
  try {
    path = decodeURIComponent(path);
  } catch {}
  const full = normalize(path.startsWith("/") ? path : `${folderOf(file)}/${path}`);
  return MARKDOWN.test(full) ? { kind: "markdown", path: full } : { kind: "file", path: full };
}
