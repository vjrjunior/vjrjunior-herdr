import { inMain, inNewTab, NO_CLAUDE, pickClaude, sendTo } from "./route.js";

export const PP_STEPS = ["Build", "Ship", "Evidence", "PR", "Merge", "Clear"];
export const SKILL_STEP = { "pp-ship": 1, ship: 1, review: 1, "pp-pr-ready": 2, "pp-pr-screenshots": 2, "pp-client-slack-update": 2, "land-and-deploy": 4, "pp-clear": 5 };

const BUILD = 0;
const SHIP = 1;
const PR = 3;
const MERGE = 4;
const CLEAR = 5;
const basename = (path) => String(path ?? "").replace(/\/+$/, "").split("/").pop() ?? "";

export function ppSignals(json, facts, place) {
  const skill = json.skill ? { name: json.skill.name, running: Boolean(json.skill.running), endedAt: json.skill.endedAt ?? null, tty: json.skill.tty ?? null } : null;
  const steps = (json.steps ?? []).map((step) => step.state);
  return {
    key: json.path,
    path: json.path,
    repo: place.repo,
    branch: json.branch ?? null,
    flow: "pp",
    space: place.space ?? null,
    mainSpace: place.mainSpace ?? null,
    task: { id: json.task?.id ?? null, title: json.task?.name ?? basename(json.path), url: json.task?.url ?? null, source: json.task?.source ?? null, base: json.base || "main", branch: json.branch ?? null },
    commitsAhead: json.commitsAhead ?? null,
    ship: json.ship ?? null,
    evidence: facts.evidence,
    pr: facts.pr ?? (facts.prError ? { error: facts.prError } : null),
    prError: facts.pr && facts.prError ? facts.prError : null,
    preview: facts.preview,
    release: null,
    skill,
    claude: pickClaude(place.claudes ?? [], { tty: skill?.tty }),
    steps: steps.length === PP_STEPS.length ? steps : PP_STEPS.map(() => "todo"),
    notes: (json.steps ?? []).map((step) => step.note ?? ""),
    action: json.next ?? null,
    why: json.why ?? null,
    error: json.error ?? null,
  };
}

function waitingSkill(lane) {
  const skill = lane.skill;
  if (!skill || skill.running || !skill.endedAt) return null;
  const step = SKILL_STEP[skill.name];
  if (step == null || lane.steps[step] === "done") return null;
  if (!lane.steps.slice(0, step).every((state) => state === "done")) return null;
  if (step === SHIP && (lane.ship?.commitsSince ?? 0) > 0) return null;
  return skill;
}

export function ppNext(lane) {
  const claude = lane.claude ?? NO_CLAUDE;
  const waiting = waitingSkill(lane);
  if (waiting && claude.terminal) return { label: "Go to claude", kind: "focus", terminal: claude.terminal, target: `${waiting.name} is waiting on you` };
  if (claude.terminal && claude.status === "blocked") return { label: "Go to claude", kind: "focus", terminal: claude.terminal, target: `claude · ${claude.terminal} needs you` };
  if (lane.skill?.running) return { label: `Waiting for /${lane.skill.name}`, kind: "wait", disabled: true, target: "the skill is still working" };
  const action = lane.action;
  if (!action) return { label: "Nothing to run yet", kind: "wait", disabled: true, target: lane.why ?? "" };
  if (action.kind === "open") return { label: action.label, kind: "open", url: action.url, target: "github.com" };
  if (action.kind !== "skill" || !action.command) return { label: action.label, kind: "wait", disabled: true, target: lane.why ?? "" };
  if (action.where === "main") return inMain(lane, action.label, action.command);
  if (action.command.startsWith("/pp-ship")) return inNewTab(lane, action.label, action.command, `ship · ${lane.task?.id ?? basename(lane.path)}`);
  return sendTo(lane, action.label, action.command);
}

const stageOf = (steps) => {
  const found = steps.findIndex((state) => state !== "done");
  return found < 0 ? CLEAR : found;
};

function toneOf(lane, next, stage) {
  if (next.kind === "focus" || lane.steps[PR] === "bad") return "blocked";
  if (lane.steps[MERGE] === "next" || lane.steps[CLEAR] === "next") return "done";
  if (lane.steps[stage] === "run" && stage !== BUILD) return "working";
  return "idle";
}

export function ppSummary(lane) {
  const next = lane.next ?? ppNext(lane);
  const stage = stageOf(lane.steps);
  const tone = toneOf(lane, next, stage);
  if (next.kind === "focus") return { stage, tone, why: next.target, action: "Go to task" };
  if (lane.steps[PR] === "bad") return { stage, tone, why: lane.why, action: "Open PR" };
  if (lane.steps[CLEAR] === "next") return { stage, tone, why: lane.why, action: "Run /pp-clear" };
  if (lane.steps[MERGE] === "next") return { stage, tone, why: lane.why, action: "Open PR" };
  return { stage, tone, why: lane.why, action: null };
}

function chipText(lane, stage) {
  const state = lane.steps[stage];
  if (stage === BUILD) return "Build";
  if (stage === SHIP) return lane.ship?.state === "stale" ? "Ship stale" : "Ship";
  if (stage === PR) return state === "bad" ? "PR failed" : "PR open";
  if (stage === MERGE) return "Ready";
  if (stage === CLEAR) return "Merged";
  return "Evidence";
}

export function ppChip(lane) {
  const { stage, tone, why } = ppSummary(lane);
  return { chip: chipText(lane, stage), tone, why: why ?? null };
}

export function ppWaits(lane) {
  const next = lane.next ?? ppNext(lane);
  const failed = lane.steps[PR] === "bad";
  return { waits: next.kind === "focus" || failed || lane.steps[MERGE] === "next" || lane.steps[CLEAR] === "next", failed };
}
