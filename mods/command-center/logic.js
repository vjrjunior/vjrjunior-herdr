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
  const manual = [];
  for (const line of parts.find((section) => section.heading.trim() === "## Manual checks")?.lines ?? []) {
    const row = ROW.exec(line);
    if (!row) continue;
    const [url = "", steps = "", expected = "", state = ""] = cells(row[2]);
    const failed = /^failed:\s*(.*)$/i.exec(state);
    manual.push({
      id: row[1],
      url: /^https?:\/\//.test(url) ? url : null,
      steps,
      expected,
      state: failed ? "failed" : state.toLowerCase(),
      note: failed ? failed[1].trim() : null,
    });
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
    manual,
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
    if (image && BARE_FILE.test(image[2])) shots.push({ title: title ?? "", alt: image[1], file: image[2] });
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

const FAMILIES = {
  "vjr-task": "task",
  "vjr-ac": "ac",
  "pp-ship": "ship",
  ship: "ship",
  review: "ship",
  "adversarial-review": "ship",
  codex: "ship",
  "pp-pr-ready": "ship",
  "pp-pr-screenshots": "ship",
  "pp-client-slack-update": "ship",
  "pp-clear": "clear",
  "pp-worktree-close": "clear",
  "docker-cleanup": "clear",
};
const PASSED = new Set(["SUCCESS", "SKIPPED", "NEUTRAL"]);
const FAILED = new Set(["FAILURE", "ERROR", "CANCELLED", "TIMED_OUT", "ACTION_REQUIRED", "STARTUP_FAILURE"]);
const PLAIN_WORD = /^[A-Za-z0-9_./@%+=:,-]+$/;
const BARE_FILE = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

const hasPr = (pr) => Boolean(pr && !pr.error && pr.number);
const merged = (lane) => hasPr(lane.pr) && lane.pr.state === "MERGED";
const fileState = (lane, file) => (lane.evidence && !lane.evidence.error ? lane.evidence.files?.[file] : undefined);
const shipped = (lane) => hasPr(lane.pr) || ["current", "stale"].includes(fileState(lane, "ship.json"));

function verifiedNow(lane) {
  const sha = lane.task?.verification?.sha;
  const code = lane.lastCode;
  return Boolean(sha && code && (code.startsWith(sha) || sha.startsWith(code)));
}

export function familyOf(skill) {
  return FAMILIES[skill] ?? null;
}

export function skillState(record, lane) {
  if (!record?.skill) return null;
  const family = familyOf(record.skill);
  let active = false;
  if (family === "ac") active = !verifiedNow(lane);
  if (family === "ship") active = !(merged(lane) || (lane.evidence?.ready && hasPr(lane.pr) && !lane.pr.isDraft));
  return { family, skill: record.skill, waiting: Boolean(record.ended_at), active };
}

export function pickClaude(claudes, record) {
  const none = { terminal: null, status: null, count: claudes.length, ambiguous: false };
  const pick = (claude) => ({ terminal: claude.terminal, status: claude.status, count: claudes.length, ambiguous: false });
  const match = record?.tty ? claudes.find((claude) => claude.tty === record.tty) : null;
  if (match) return pick(match);
  if (claudes.length === 1) return pick(claudes[0]);
  return claudes.length === 0 ? none : { ...none, ambiguous: true };
}

export function rollup(statusCheckRollup) {
  const items = (Array.isArray(statusCheckRollup) ? statusCheckRollup : []).map((check) => {
    const name = check.name ?? check.context ?? "check";
    if (check.__typename === "StatusContext" || (check.state && !check.status)) {
      const state = String(check.state ?? "").toUpperCase();
      return { name, state: state === "SUCCESS" ? "ok" : FAILED.has(state) ? "bad" : "run", detail: state.toLowerCase() };
    }
    const conclusion = String(check.conclusion ?? "").toUpperCase();
    if (String(check.status ?? "").toUpperCase() !== "COMPLETED") return { name, state: "run", detail: "running" };
    if (PASSED.has(conclusion)) return { name, state: "ok", detail: conclusion.toLowerCase() };
    return { name, state: FAILED.has(conclusion) ? "bad" : "idle", detail: conclusion.toLowerCase() };
  });
  return { items, failed: items.filter((item) => item.state === "bad").map((item) => item.name), pending: items.filter((item) => item.state === "run").length };
}

export function prStep(pr) {
  if (!hasPr(pr)) return "todo";
  if (pr.state === "MERGED") return "done";
  if (pr.state === "CLOSED") return "bad";
  const checks = rollup(pr.statusCheckRollup);
  if (checks.failed.length || pr.reviewDecision === "CHANGES_REQUESTED") return "bad";
  if (pr.isDraft || checks.pending || checks.items.length === 0 || pr.reviewDecision === "REVIEW_REQUIRED") return "run";
  return "done";
}

export function stepsOf(lane) {
  const skill = lane.skill?.active ? lane.skill : null;
  const ship = fileState(lane, "ship.json");
  const files = lane.evidence && !lane.evidence.error ? Object.values(lane.evidence.files ?? {}) : [];
  if (merged(lane)) return ["done", "done", "done", "done", "done", "done", "next"];
  const steps = ["done", "todo", "todo", "todo", "todo", "todo", "todo"];
  if (skill?.family === "ac") steps[1] = "run";
  else if (verifiedNow(lane) || shipped(lane)) steps[1] = "done";
  else steps[1] = lane.task?.verification ? "bad" : "next";

  if (skill?.family === "ship" && ship !== "current") steps[2] = "run";
  else if (ship === "current" || (ship === undefined && hasPr(lane.pr) && !lane.pr.isDraft)) steps[2] = "done";
  else if (ship === "stale") steps[2] = "bad";
  else if (steps[1] === "done") steps[2] = "next";

  if (skill?.family === "ship" && ship === "current") steps[3] = "run";
  else if (lane.evidence?.ready || merged(lane) || (lane.evidence?.error && hasPr(lane.pr) && !lane.pr.isDraft)) steps[3] = "done";
  else if (files.includes("stale") && steps[2] === "done") steps[3] = "bad";

  steps[4] = prStep(lane.pr);
  if (merged(lane)) {
    steps[5] = "done";
    steps[6] = "next";
  } else if (steps[4] === "done") steps[5] = "next";
  return steps;
}

export function noteOf(lane) {
  if (!lane.task?.verification || verifiedNow(lane) || !shipped(lane) || !(lane.sinceVerified > 0)) return null;
  return `${lane.sinceVerified} code commit${lane.sinceVerified === 1 ? "" : "s"} since vjr-ac`;
}

export function chipOf(lane, steps) {
  const first = steps.findIndex((step) => step !== "done");
  const state = steps[first];
  if (first === 1) {
    const manual = lane.task?.manual ?? [];
    if (state === "run") return { chip: manual.length ? `AC ${manual.filter((check) => check.state === "passed").length}/${manual.length}` : "AC", tone: "work" };
    if (state === "bad") return { chip: "AC stale", tone: "bad" };
    return { chip: "Task", tone: "idle" };
  }
  if (first === 2 && state === "next") return { chip: "AC ✓", tone: "done" };
  if (first === 2 || first === 3 || (first === 4 && state === "todo")) return { chip: "Ship", tone: state === "bad" ? "bad" : "work" };
  if (first === 4) return state === "bad" ? { chip: "PR ✕", tone: "bad" } : { chip: "PR ●", tone: "work" };
  if (first === 5) return { chip: "Ready", tone: "done" };
  return { chip: "Merged", tone: "done" };
}

function shellWord(value) {
  return PLAIN_WORD.test(value) ? value : `'${String(value).replaceAll("'", "'\\''")}'`;
}

function doneRange(task) {
  const ids = (task.done ?? []).map((item) => item.id);
  if (ids.length === 0) return "in VJR-TASK.md";
  return ids.length === 1 ? ids[0] : `${ids[0]}–${ids.at(-1)}`;
}

export function scopeLine(task) {
  const range = doneRange(task);
  const owner = task.id ? `${task.id}'s` : "This task's";
  return `/pp-ship --base ${shellWord(task.base || "main")} Scope: ${owner} done items ${range} only. Step 8: no plan file — VJR-TASK.md and the kickoff plan are not a ship plan; the done items were verified by vjr-ac. Findings that don't break ${range}, and weren't introduced by this branch on their path, are known limits: not fixed, not asked, no follow-ups. Never fix informational findings after the cycle cap; stop and report.`;
}

export function pushLine(task) {
  const title = task.id ? `${task.title} (${task.id})` : task.title;
  return `!git push -u origin HEAD && gh pr create --draft --base ${shellWord(task.base || "main")} --title '${String(title).replaceAll("'", "'\\''")}' --body ''`;
}

function sendTo(lane, label, text) {
  const claude = lane.claude ?? { terminal: null, status: null, count: 0, ambiguous: false };
  const fallback = { text, space: lane.space ?? null, folder: lane.path };
  if (claude.ambiguous) return { label, kind: "wait", disabled: true, target: "More than one claude here", ...fallback };
  if (claude.terminal && claude.status === "working") return { label, kind: "wait", disabled: true, target: "claude is working", ...fallback };
  if (claude.terminal) return { label, kind: "send", terminal: claude.terminal, target: `claude · ${claude.terminal} in this worktree`, ...fallback };
  if (lane.space) return { label: `${label} in a new tab`, kind: "tab", target: `new tab in ${lane.repo?.name ?? "this repo"}`, ...fallback };
  return { label: `${label} in a new space`, kind: "space", target: "new space in this worktree", ...fallback };
}

export function nextStep(lane) {
  const claude = lane.claude ?? {};
  const skill = lane.skill?.active ? lane.skill : null;
  if (claude.terminal && (claude.status === "blocked" || skill?.waiting)) {
    return { label: "Go to claude", kind: "focus", terminal: claude.terminal, target: skill?.waiting ? `${skill.skill} is waiting on you` : `claude · ${claude.terminal} needs you` };
  }
  if (skill?.waiting) return { label: `${skill.skill} is waiting on you`, kind: "wait", disabled: true, target: "no claude found in this worktree" };
  if (skill) return { label: `Waiting for /${skill.skill}`, kind: "wait", disabled: true, target: "the skill is still working" };
  const steps = stepsOf(lane);
  const pr = hasPr(lane.pr) ? lane.pr : null;
  if (steps[1] === "next" || steps[1] === "bad") return sendTo(lane, "Run /vjr-ac", "/vjr-ac");
  if (steps[2] === "next" || steps[2] === "bad") {
    if ((lane.task.base || "main") !== "main" && !pr) return sendTo(lane, "Push and open draft PR", pushLine(lane.task));
    return sendTo(lane, "Run /pp-ship", scopeLine(lane.task));
  }
  if (steps[6] === "next" && pr) {
    const text = `/pp-clear ${pr.number}`;
    const where = { text, space: lane.mainSpace ?? null, folder: lane.repo?.main ?? null };
    if (lane.mainSpace) return { label: "Run /pp-clear", kind: "tab", target: `new tab in ${lane.repo?.name ?? "the main checkout"}`, ...where };
    return { label: "Run /pp-clear", kind: "space", target: "new space in the main checkout", ...where };
  }
  if (steps[3] === "bad" || (steps[2] === "done" && steps[3] === "todo" && !pr)) return sendTo(lane, "Run /pp-pr-ready", "/pp-pr-ready");
  if (pr && steps[5] === "next") return { label: `Open PR #${pr.number} to merge`, kind: "open", url: pr.url, target: "you merge on GitHub" };
  if (pr) return { label: `Open PR #${pr.number}`, kind: "open", url: pr.url, target: "github.com" };
  return { label: "Waiting for the PR", kind: "wait", disabled: true, target: "nothing to run yet" };
}

export function sendArgs(claude, text) {
  return claude.status === "idle" ? ["send", "--if", "idle", claude.terminal, text] : ["send", claude.terminal, text];
}

export function answerStep(lane, id, verdict, note) {
  if (lane.skill?.family !== "ac" || !lane.skill.active) return { refused: "vjr-ac is not running here" };
  const claude = lane.claude ?? {};
  if (claude.ambiguous) return { refused: "More than one claude here" };
  if (!claude.terminal) return { refused: "no claude in this worktree" };
  if (claude.status === "working") return { refused: "claude is working" };
  if (claude.status === "blocked") return { refused: "claude is waiting on a prompt" };
  const check = (lane.task?.manual ?? []).find((item) => item.id === id);
  if (check?.state !== "asking") return { refused: `${id} is not being asked` };
  if (verdict === "passed") return { terminal: claude.terminal, text: `${id} passed` };
  const line = String(note ?? "").replace(/\s+/g, " ").replaceAll("|", "/").trim();
  if (!line) return { refused: "Say what you saw" };
  return { terminal: claude.terminal, text: `${id} failed: ${line}` };
}

export function regenerateStep(lane) {
  const label = "Regenerate with production links";
  const claude = lane.claude ?? {};
  if ((claude.terminal && claude.status === "blocked") || lane.skill?.active) return { label, kind: "wait", disabled: true, target: "claude needs you first" };
  return sendTo(lane, label, "/pp-client-slack-update");
}

export function alertState(lane) {
  if (!hasPr(lane.pr)) return null;
  const step = prStep(lane.pr);
  const checks = rollup(lane.pr.statusCheckRollup);
  let reason = "";
  if (checks.failed.length) reason = `${checks.failed.join(", ")} failed`;
  else if (lane.pr.reviewDecision === "CHANGES_REQUESTED") reason = "changes requested";
  else if (lane.pr.state === "CLOSED") reason = "closed without merging";
  return { step, merged: lane.pr.state === "MERGED", number: lane.pr.number, repo: lane.repo?.name ?? "", id: lane.task?.id ?? lane.branch ?? "", reason };
}

export function transitions(before, after) {
  const alerts = [];
  for (const [key, now] of Object.entries(after ?? {})) {
    const was = before?.[key];
    if (!was || !now) continue;
    const where = `${now.repo} · ${now.id}`;
    if (now.merged && !was.merged) alerts.push({ key, title: `PR #${now.number} merged`, body: `${where} · Copy the release message`, level: "success" });
    else if (!now.merged && now.step === "done" && was.step !== "done") alerts.push({ key, title: `PR #${now.number} is ready to merge`, body: `${where} · all checks passed`, level: "success" });
    else if (now.step === "bad" && was.step !== "bad") alerts.push({ key, title: `PR #${now.number} needs attention`, body: `${where} · ${now.reason}`, level: "warning" });
  }
  return alerts;
}

export function badge(lanes) {
  let count = 0;
  let bad = false;
  for (const lane of lanes) {
    const steps = stepsOf(lane);
    const next = nextStep(lane);
    const failed = steps[4] === "bad";
    if (failed) bad = true;
    if (next.kind === "focus" || failed || steps[5] === "next" || steps[6] === "next") count += 1;
  }
  return { count, level: bad ? "bad" : count > 0 ? "wait" : null };
}
