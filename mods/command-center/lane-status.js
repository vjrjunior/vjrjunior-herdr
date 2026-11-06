const VERSION = 1;

const lastSegment = (path) => String(path ?? "").replace(/\/+$/, "").split("/").pop() || null;

export function parseLaneStatus(text) {
  let report;
  try {
    report = JSON.parse(text);
  } catch {
    return { lanes: [], network: false, error: "pp-lane-status gave no JSON" };
  }
  if (!report || typeof report !== "object") return { lanes: [], network: false, error: "pp-lane-status gave no JSON" };
  if (report.version !== VERSION) return { lanes: [], network: false, error: `pp-lane-status speaks version ${report.version}; this Command Center reads version ${VERSION}` };
  return { ...report, lanes: Array.isArray(report.lanes) ? report.lanes : [], network: Boolean(report.network), error: report.error ?? null };
}

function evidenceOf(evidence) {
  if (!evidence) return { error: "pp-pr-evidence could not run" };
  return { ready: Boolean(evidence.ready), files: evidence.files ?? {}, reasons: evidence.reasons ?? {}, dir: evidence.dir ?? null, slug: lastSegment(evidence.dir) };
}

function prOf(pr, branch) {
  if (!pr) return null;
  return {
    number: pr.number,
    url: pr.url,
    title: pr.title ?? "",
    state: pr.state,
    isDraft: Boolean(pr.isDraft),
    reviewDecision: pr.reviewDecision ?? "",
    mergedAt: pr.mergedAt ?? null,
    baseRefName: pr.base ?? null,
    headRefName: branch ?? null,
    checks: pr.checks ?? { passed: 0, failed: [], pending: 0, items: [] },
  };
}

export function factsOf(lane, report) {
  return {
    base: lane.base || "main",
    baseSource: lane.baseSource ?? null,
    evidence: evidenceOf(lane.evidence),
    pr: prOf(lane.pr, lane.branch),
    preview: lane.pr?.preview ?? null,
    prError: report?.network && report?.error ? `GitHub unavailable · ${report.error}` : null,
  };
}
