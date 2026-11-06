const TEAM_ARGV = ["env", "PP_EDITOR=herdr", "claude"];
const VJR_ARGV = ["claude"];
const CUP = /^cup-(\d+)$/i;
const INTERNAL = /^86[a-z0-9]{7}$/i;
const CLICKUP = /^https?:\/\/app\.clickup\.com\/t\/(?:\d+\/)?([A-Za-z0-9-]+)\/?(?:[?#].*)?$/i;
const NAME_LIMIT = 40;

export function oneLine(text) {
  return String(text ?? "")
    .replace(/[\u0000-\u001f\u007f\s]+/g, " ")
    .trim();
}

export function taskIdOf(word) {
  const value = String(word ?? "").trim();
  const link = CLICKUP.exec(value);
  const id = link ? link[1] : value;
  const cup = CUP.exec(id);
  if (cup) return `CUP-${cup[1]}`;
  return INTERNAL.test(id) ? id : null;
}

const sameId = (a, b) => Boolean(a && b) && String(a).toUpperCase() === String(b).toUpperCase();

export function startPlan({ text, route, repo, lanes, space }) {
  const line = oneLine(text);
  if (!line) return { kind: "none" };
  const [first, ...rest] = line.split(" ");
  const id = taskIdOf(first);
  if (id) {
    const lane = (lanes ?? []).find((item) => item.repo?.main === repo.main && sameId(item.task?.id, id));
    if (lane?.space) return { kind: "select", space: lane.space };
    if (lane) return { kind: "open", folder: lane.path };
  }
  const name = `start · ${id ?? line.split(" ").slice(0, 4).join(" ")}`.slice(0, NAME_LIMIT);
  const words = rest.join(" ");
  let task;
  if (route === "vjr") task = `/vjr-task ${line}`;
  else if (id) task = `/work start ${id}, then /pp-worktree-start for it${words ? `. ${words}` : ""}`;
  else task = `/pp-worktree-start ${line}`;
  const argv = route === "vjr" ? VJR_ARGV : TEAM_ARGV;
  if (space) return { kind: "tab", space, folder: repo.main, name, argv, task };
  return { kind: "space", folder: repo.main, name, argv, task };
}
