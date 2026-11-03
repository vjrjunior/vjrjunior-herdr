const TITLE = /^# (?:(CUP-\d+) — )?(.+?)\s*$/;
const FIELD = /^\*\*([^*]+):\*\*\s*(.*)$/;
const URL = /^https?:\/\/\S+$/;
const ROW = /^\|\s*(D\d+)\s*\|(.*)\|\s*$/;
const VERIFICATION = /^## Verification — (\S+)\s*$/;
const SLACK_LINK = /<([^|>]+)\|([^>]+)>/g;

function sections(lines) {
  const found = [];
  let current = null;
  for (const line of lines) {
    if (line.startsWith("## ")) {
      current = { heading: line, lines: [] };
      found.push(current);
    } else if (current) current.lines.push(line);
  }
  return found;
}

function cells(rest) {
  return rest.split("|").map((cell) => cell.trim());
}

function headerFields(lines) {
  const fields = {};
  let url = null;
  for (const line of lines) {
    if (line.startsWith("## ")) break;
    for (const part of line.split(" · ")) {
      const trimmed = part.trim();
      const field = FIELD.exec(trimmed);
      if (field) fields[field[1].toLowerCase()] = field[2].trim();
      else if (!url && URL.test(trimmed)) url = trimmed;
    }
  }
  return { fields, url };
}

function parseVerification(section) {
  const sha = VERIFICATION.exec(section.heading)[1];
  const verification = { sha, gates: null, review: null, rows: [], limits: null };
  for (const line of section.lines) {
    if (line.startsWith("Gates:")) verification.gates = line.slice(6).trim();
    else if (line.startsWith("Review:")) verification.review = line.slice(7).trim();
    else if (line.startsWith("Known limits:")) verification.limits = line.slice(13).trim();
    else {
      const row = ROW.exec(line);
      if (row) {
        const [verdict = "", where = "", manual = ""] = cells(row[2]);
        verification.rows.push({ id: row[1], verdict, where, manual });
      }
    }
  }
  return verification;
}

export function parseTask(text) {
  const lines = (text ?? "").split("\n");
  const title = TITLE.exec(lines[0] ?? "");
  if (!title) return null;
  const { fields, url } = headerFields(lines.slice(1));
  const parts = sections(lines);
  const done = [];
  for (const line of parts.find((section) => section.heading.trim() === "## Done")?.lines ?? []) {
    const row = ROW.exec(line);
    if (row) done.push({ id: row[1], item: cells(row[2])[0] ?? "" });
  }
  const verifications = parts.filter((section) => VERIFICATION.test(section.heading));
  return {
    id: title[1] ?? null,
    title: title[2],
    kind: fields.kind ?? null,
    url,
    base: fields.base || "main",
    branch: fields.branch || null,
    done,
    verification: verifications.length ? parseVerification(verifications.at(-1)) : null,
  };
}

export function parseWorktrees(text) {
  const list = [];
  for (const block of (text ?? "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const path = lines.find((line) => line.startsWith("worktree "))?.slice(9);
    if (!path) continue;
    const ref = lines.find((line) => line.startsWith("branch "))?.slice(7) ?? null;
    list.push({ path, branch: ref ? ref.replace(/^refs\/heads\//, "") : null, main: list.length === 0 });
  }
  return list;
}

function messageParts(line) {
  const parts = [];
  let last = 0;
  for (const match of line.matchAll(SLACK_LINK)) {
    if (match.index > last) parts.push({ text: line.slice(last, match.index) });
    parts.push({ text: match[2], url: match[1] });
    last = match.index + match[0].length;
  }
  if (last < line.length) parts.push({ text: line.slice(last) });
  return parts;
}

export function parseMessage(text) {
  const lines = (text ?? "").split("\n").map((line) => line.trim());
  const release = /^Release\s+(\S+)/.exec(lines[0] ?? "")?.[1] ?? null;
  const titleLine = lines.slice(release ? 1 : 0).find(Boolean) ?? "";
  const title = titleLine.replace(/^\*(.+?)\*/, "$1").trim();
  const items = lines.filter((line) => line.startsWith("•")).map((line) => ({ parts: messageParts(line.replace(/^•\s*/, "")) }));
  return { release, title, items };
}

export function parseScreenshots(md) {
  const lines = (md ?? "").split("\n");
  const covers = lines.map((line) => /^Covers:\s*(\S+)/.exec(line)?.[1]).find(Boolean) ?? null;
  const shots = [];
  let title = null;
  for (const line of lines) {
    if (line.startsWith("### ")) title = line.slice(4).trim();
    const image = /^!\[([^\]]*)\]\(([^)]+)\)/.exec(line.trim());
    if (image) shots.push({ title: title ?? "", alt: image[1], file: image[2] });
  }
  return { covers, shots };
}

export function captionsFor(meta, shots) {
  const captions = meta?.captions && typeof meta.captions === "object" ? meta.captions : {};
  const byFile = new Map(shots.map((shot) => [shot.file, shot]));
  const featured = Object.entries(captions)
    .filter(([file]) => byFile.has(file))
    .map(([file, caption]) => ({ file, caption: String(caption), featured: true }));
  const taken = new Set(featured.map((shot) => shot.file));
  const rest = shots.filter((shot) => !taken.has(shot.file)).map((shot) => ({ file: shot.file, caption: shot.alt, featured: false }));
  return [...featured, ...rest];
}
