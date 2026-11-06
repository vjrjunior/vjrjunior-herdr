import { View, div } from "gpui-kit";
import { InputState } from "gpui-base";
import * as fs from "fs/promises";
import { columnView, profileView, shotView } from "./column.js";
import { ppChip, ppNext, ppSignals, ppSummary } from "./flow-pp.js";
import { factsOf, parseLaneStatus } from "./lane-status.js";
import { startPlan } from "./start.js";
import {
  agents,
  appHome,
  closeOverlay,
  exec,
  focused,
  home,
  nextCommand,
  notify,
  openOverlay,
  panes,
  props,
  readTextFile,
  run,
  setShared,
  shared,
  spaces,
  theme,
  watchFolder,
} from "herdr";
import {
  alertState,
  answerStep,
  badge,
  captionsFor,
  chipOf,
  nextStep,
  noteOf,
  parseMessage,
  parseScreenshots,
  parseTask,
  parseWorktrees,
  pickClaude,
  profileOf,
  regenerateStep,
  sendArgs,
  skillRecord,
  skillState,
  stepsOf,
  transitions,
  viewFor,
} from "./logic.js";

const SELF = { name: "command-center" };
const TICK = 2000;
const FOCUS_TASK = 5000;
const OTHER_TASK = 30000;
const DISCOVER = 60000;
const STATUS_FOCUS = 5000;
const STATUS_OTHER = 30000;
const CLAUDE = 5000;
const SKILLS = 10000;
const SKILL_AGE = 12 * 3600 * 1000;
const LEASE = 30000;
const LEASE_KEY = "command-center.watch";
const OLD_PP_STACK = "Command Center needs pp-stack 0.94.0 or later";
const OFFLINE = { network: false, error: null };

const inside = (path, root) => Boolean(path && root) && (path === root || path.startsWith(`${root}/`));
const basename = (path) => path.replace(/\/+$/, "").split("/").pop() ?? path;
const firstLine = (text) => String(text ?? "").trim().split("\n")[0] ?? "";
const firstWord = (text) => String(text ?? "").trim().split(/\s+/)[0] ?? "";
const cacheDir = () => `${appHome()}/data/${SELF.name}/shots`;

function laneSignals(lane, cache) {
  return {
    key: lane.key,
    path: lane.path,
    repo: lane.repo,
    branch: lane.branch,
    space: cache.space ?? null,
    mainSpace: cache.mainSpace ?? null,
    task: cache.task ?? { id: null, title: basename(lane.path), kind: null, url: null, base: "main", branch: lane.branch, done: [], verification: null },
    lastCode: cache.lastCode ?? null,
    sinceVerified: cache.sinceVerified ?? 0,
    skill: null,
    claude: { terminal: null, status: null, count: 0, ambiguous: false },
    evidence: cache.evidence ?? null,
    preview: cache.preview ?? null,
    pr: cache.pr ?? (cache.prError ? { error: cache.prError } : null),
    prError: cache.pr && cache.prError ? cache.prError : null,
    release: cache.release ?? null,
  };
}

export default class CommandCenter extends View {
  init(given, cx) {
    const own = given && typeof given === "object" ? given : {};
    this.role = own.role ?? props()?.role ?? null;
    this.ppStack = own.ppStack ?? props()?.ppStack ?? null;
    this.bun = own.bun ?? props()?.bun ?? null;
    if (this.role === "watch") this.startWatch(cx);
    else if (this.role === "shot") this.startShot(own, cx);
    else if (this.role === "profile") this.startProfile(own);
    else this.startColumn();
  }

  startProfile(own) {
    const given = { ...(props() ?? {}), ...own };
    this.profileRepo = given.repo ?? null;
    this.profileName = given.name ?? "";
    this.overlay = given.overlay ?? null;
  }

  startColumn() {
    this.expanded = {};
    this.flashText = null;
    this.failing = null;
    this.sent = {};
    this.failInput = InputState.new({ placeholder: "What did you see?" });
    this.failInput.on("submit", (_e, cx) => this.submitFailure(cx));
    this.startInput = InputState.new({ placeholder: "CUP-1234 or what you'll work on" });
    this.startInput.on("submit", (_e, cx) => this.submitStart(cx));
  }

  startShot(own, cx) {
    const given = { ...(props() ?? {}), ...own };
    this.shotLane = given.lane ?? null;
    this.index = Number(given.index) || 0;
    this.overlay = given.overlay ?? null;
    this.handle = cx?.focus_handle?.() ?? null;
    if (this.handle) cx?.timer?.after?.(100, () => this.handle.focus());
  }

  stateLanes() {
    const state = shared("command-center.state");
    return Array.isArray(state?.lanes) ? state.lanes : [];
  }

  later(cx, work) {
    if (cx?.spawn) cx.spawn(async (cx) => work(cx));
    else work(null);
  }

  async flash(text, cx) {
    this.flashText = text;
    cx?.notify?.();
    if (!cx?.sleep) return;
    await cx.sleep(2000);
    if (this.flashText !== text) return;
    this.flashText = null;
    cx.notify();
  }

  open(target) {
    exec("open", [target]).catch(() => {});
  }

  zed(path) {
    exec("zed", [path]).catch(() => {});
  }

  openEditor(path) {
    const zed = shared("command-center.state")?.editor === "zed";
    (zed ? exec("zed", [path]) : exec("open", ["-na", "Cursor", "--args", path])).catch(() => {});
  }

  newClaude(space, folder, text, name) {
    const label = name ? { [space ? "name" : "tab"]: name } : {};
    if (space) run("tab.new", { space, folder, ...label, argv: ["claude"], task: text });
    else run("space.new", { folder, ...label, argv: ["claude"], task: text, machine: "" });
  }

  checkoutCwd() {
    const now = focused();
    if (now?.cwd) return now.cwd;
    const pane = (panes() ?? []).find((item) => item.tab === now?.tab && item.cwd);
    if (pane) return pane.cwd;
    return (spaces() ?? []).find((space) => space.id === now?.space)?.folder ?? null;
  }

  readTaskFile(lane) {
    run("pane.split", { direction: "right", mod: "markdown", props: { file: `${lane.path}/VJR-TASK.md` } });
  }

  focusClaude(terminal) {
    run("pane.focus", { terminal });
  }

  chooseProfile(repo) {
    openOverlay({ mod: "command-center", kind: "popup", at: "pointer", width: 260, height: 124, props: { role: "profile", repo: repo.main, name: repo.name } });
  }

  setProfile(repo, id) {
    const all = { ...(shared("command-center.profiles") ?? {}) };
    if (id === "off") all[repo] = "off";
    else delete all[repo];
    setShared("command-center.profiles", all);
    if (this.overlay) closeOverlay(this.overlay);
  }

  submitStart(cx) {
    const state = shared("command-center.state") ?? {};
    const shown = viewFor(this.checkoutCwd(), state, shared("command-center.profiles") ?? {});
    if (shown.kind === "repo") this.startTask(shown.repo, state.vjrTask ? "vjr" : "team", cx);
  }

  startTask(repo, route, cx) {
    const lanes = shared("command-center.state")?.lanes ?? [];
    const plan = startPlan({ text: this.startInput.value(), route, repo, lanes, space: focused()?.space ?? null });
    if (plan.kind === "none") return;
    if (plan.kind === "select") run("space.select", { id: plan.space });
    else if (plan.kind === "open") run("space.new", { folder: plan.folder, machine: "" });
    else if (plan.kind === "tab") run("tab.new", { space: plan.space, folder: plan.folder, name: plan.name, argv: plan.argv, task: plan.task });
    else run("space.new", { folder: plan.folder, tab: plan.name, argv: plan.argv, task: plan.task, machine: "" });
    this.startInput.set_value("");
    this.tell(plan.kind === "select" || plan.kind === "open" ? "Went to that task" : `Started: ${plan.name}`, cx);
  }

  isOpen(lane, name, current) {
    const chosen = this.expanded?.[`${lane.key}:${name}`];
    if (chosen != null) return chosen;
    return name === "Evidence" && current >= 5 && Boolean(lane.release);
  }

  toggle(lane, name, current, cx) {
    this.expanded[`${lane.key}:${name}`] = !this.isOpen(lane, name, current);
    cx?.notify?.();
  }

  goTo(lane, cx) {
    if (lane.space) run("space.select", { id: lane.space });
    if (lane.next?.kind === "focus") run("pane.focus", { terminal: lane.next.terminal });
    cx?.notify?.();
  }

  laneAction(lane, action, cx) {
    if (action === "Go to task") this.goTo(lane, cx);
    else if (action === "Open PR" && lane.pr?.url) this.open(lane.pr.url);
    else if (action === "Run /pp-clear") this.act(lane, cx);
  }

  send(claude, text, cx) {
    this.later(cx, async (cx) => {
      let sent = false;
      try {
        sent = (await exec("hc", sendArgs(claude, text)))?.code === 0;
      } catch {}
      await this.flash(sent ? `Sent to claude · ${claude.terminal}` : `Not sent: claude · ${claude.terminal} is busy`, cx);
    });
  }

  answer(lane, id, verdict, note, cx) {
    const step = answerStep(lane, id, verdict, note);
    if (step.refused) {
      this.later(cx, (cx) => this.flash(step.refused, cx));
      return false;
    }
    this.sent[`${lane.key}:${id}`] = lane.task.manual.find((check) => check.id === id)?.state ?? null;
    const claude = [lane.session, lane.claude].find((item) => item?.terminal === step.terminal) ?? { terminal: step.terminal, status: null };
    this.send(claude, step.text, cx);
    return true;
  }

  startFailure(lane, id, cx) {
    this.failing = { lane: lane.key, id };
    this.failInput.set_value("");
    this.failInput.focus();
    cx?.notify?.();
  }

  submitFailure(cx) {
    const lane = this.stateLanes().find((item) => item.key === this.failing?.lane);
    if (lane && this.answer(lane, this.failing.id, "failed", this.failInput.value(), cx)) {
      this.failing = null;
      this.failInput.set_value("");
    }
    cx?.notify?.();
  }

  noteKey(name, cx) {
    if (name !== "escape") return;
    this.failing = null;
    cx?.notify?.();
  }

  tell(text, cx) {
    this.later(cx, (cx) => this.flash(text, cx));
  }

  act(lane, cx) {
    const next = lane.next;
    if (!next || next.disabled) return;
    if (next.kind === "send") this.send([lane.session, lane.claude].find((item) => item?.terminal === next.terminal) ?? { terminal: next.terminal, status: null }, next.text, cx);
    else if (next.kind === "focus") {
      run("pane.focus", { terminal: next.terminal });
      this.tell(`Went to claude · ${next.terminal}`, cx);
    } else if (next.kind === "tab" || next.kind === "space") {
      this.newClaude(next.kind === "tab" ? next.space : null, next.folder, next.text, next.name);
      this.tell(`${next.kind === "tab" ? "New tab" : "New space"}: ${firstWord(next.text)}`, cx);
    } else if (next.kind === "open") {
      this.open(next.url);
      this.tell(`Opened ${next.url}`, cx);
    }
  }

  newTab(lane, cx) {
    if (!lane.next?.text) return;
    this.newClaude(lane.space, lane.path, lane.next.text);
    this.tell(`${lane.space ? "New tab" : "New space"}: ${firstWord(lane.next.text)}`, cx);
  }

  regenerate(lane, cx) {
    const step = regenerateStep(lane);
    if (step.disabled) {
      this.later(cx, (cx) => this.flash(step.target, cx));
      return;
    }
    this.act({ ...lane, next: step }, cx);
  }

  copy(release, cx) {
    this.later(cx, async (cx) => {
      const attempt = async (command, args) => {
        try {
          return (await exec(command, args))?.code === 0;
        } catch {
          return false;
        }
      };
      const copied = (await attempt(this.bin("pp-stack-rich-copy"), [release.messagePath])) || (await attempt("sh", ["-c", 'pbcopy < "$1"', "_", release.messagePath]));
      await this.flash(copied ? "Copied the message" : "Could not copy the message", cx);
    });
  }

  openShot(lane, index) {
    openOverlay({ kind: "window", key: "command-center-shot", mod: "command-center", props: { role: "shot", lane: lane.key, index }, width: 0.7, height: 0.8 });
  }

  key(name, cx) {
    const total = this.stateLanes().find((lane) => lane.key === this.shotLane)?.release?.shots?.length ?? 0;
    if (name === "escape") {
      if (this.overlay) closeOverlay(this.overlay);
      return;
    }
    if (!total) return;
    if (name === "right") this.index = (this.index + 1) % total;
    if (name === "left") this.index = (this.index + total - 1) % total;
    cx?.notify?.();
  }

  bin(name) {
    return `${this.ppStack || `${home()}/.claude/skills/pp-stack`}/bin/${name}`;
  }

  laneStatus(args) {
    const script = this.bin("pp-lane-status");
    return this.bun ? [this.bun, [script, ...args]] : [script, args];
  }

  startWatch(cx) {
    this.id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.clock = () => Date.now();
    this.lanes = [];
    this.worktrees = [];
    this.vjrTask = false;
    this.editor = "cursor";
    this.cache = {};
    this.claudes = {};
    this.records = [];
    this.repos = [];
    this.sharedSessions = new Set();
    this.skillsAt = 0;
    this.skillsDirty = true;
    this.discoveredAt = 0;
    this.spaceIds = "";
    this.before = {};
    this.lastAlerted = null;
    this.published = {};
    this.status = {};
    this.settled = [];
    this.reading = false;
    cx.timer.every(TICK, (cx) => cx.spawn(async (cx) => this.read(cx)));
    cx.spawn(async (cx) => this.read(cx));
    cx.spawn(async () => {
      try {
        for (;;) {
          await watchFolder(`${home()}/.pp-stack/session`);
          this.skillsDirty = true;
        }
      } catch {}
    });
    cx.spawn(async (cx) => {
      for (;;) await this.command(await nextCommand(), cx);
    });
  }

  async run(command, args, cwd) {
    try {
      return await exec(command, args, cwd ? { cwd } : undefined);
    } catch {
      return null;
    }
  }

  lease() {
    const held = shared(LEASE_KEY);
    const now = this.clock();
    if (held && held.owner !== this.id && held.until > now) return false;
    if (held?.owner === this.id && held.until - now > LEASE / 2) return true;
    setShared(LEASE_KEY, { owner: this.id, until: now + LEASE });
    return true;
  }

  async close() {
    if (this.role === "watch" && shared(LEASE_KEY)?.owner === this.id) setShared(LEASE_KEY, null);
  }

  localSpaces() {
    return (spaces() ?? []).filter((space) => space.machine == null);
  }

  spacePlaces() {
    const tabSpace = {};
    const places = {};
    for (const space of this.localSpaces()) {
      places[space.id] = new Set(space.folder ? [space.folder] : []);
      for (const tab of space.tabs ?? []) tabSpace[tab.id] = space.id;
    }
    for (const pane of panes() ?? []) {
      const id = tabSpace[pane.tab];
      if (id && pane.cwd) places[id].add(pane.cwd);
    }
    return places;
  }

  async discover() {
    this.discoveredAt = this.clock();
    this.spaceIds = this.localSpaces().map((space) => space.id).join(",");
    const commons = new Map();
    for (const paths of Object.values(this.spacePlaces())) {
      for (const path of paths) {
        const result = await this.run("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], path);
        const common = result?.code === 0 ? result.stdout.trim() : "";
        if (common && !commons.has(common)) commons.set(common, path);
      }
    }
    const found = [];
    const repos = [];
    for (const common of commons.keys()) {
      const result = await this.run("git", ["worktree", "list", "--porcelain"], common);
      if (result?.code !== 0) continue;
      const list = parseWorktrees(result.stdout);
      const main = list[0];
      if (!main) continue;
      repos.push({ name: basename(main.path), main: main.path, trees: list.map((tree) => tree.path) });
      for (const tree of list.slice(1)) found.push({ key: tree.path, path: tree.path, branch: tree.branch, repo: { name: basename(main.path), main: main.path } });
    }
    const keep = new Set(found.map((tree) => tree.key));
    for (const key of Object.keys(this.cache)) if (!keep.has(key)) delete this.cache[key];
    this.worktrees = found;
    this.repos = repos;
    await this.readMachine();
  }

  async readMachine() {
    this.vjrTask = (await readTextFile(`${home()}/.claude/skills/vjr-task/SKILL.md`)) != null;
    const shell = await this.run("sh", ["-c", `"\${SHELL:-/bin/sh}" -ic 'printf "\\n%s" "$PP_EDITOR"' 2>/dev/null`]);
    const last = shell?.code === 0 ? (shell.stdout.split("\n").pop() ?? "").trim() : "";
    this.editor = last === "zed" ? "zed" : "cursor";
  }

  async sweep() {
    const now = this.clock();
    if (now - (this.sweptAt ?? 0) < DISCOVER) return;
    if (this.lanes.some((lane) => !this.cache[lane.key]?.evidence)) return;
    this.sweptAt = now;
    const live = new Set(this.lanes.map((lane) => this.cache[lane.key]?.evidence?.slug).filter(Boolean));
    let names = [];
    try {
      names = await fs.readdir(cacheDir());
    } catch {
      return;
    }
    for (const name of names) if (!live.has(name)) await this.run("rm", ["-rf", `${cacheDir()}/${name}`]);
  }

  async readSkills() {
    const now = this.clock();
    if (!this.skillsDirty && now - this.skillsAt < SKILLS) return;
    this.skillsDirty = false;
    this.skillsAt = now;
    const folder = `${home()}/.pp-stack/session`;
    const records = [];
    try {
      for (const name of await fs.readdir(folder)) {
        if (!/^skill-.+\.json$/.test(name)) continue;
        try {
          const record = JSON.parse((await readTextFile(`${folder}/${name}`)) ?? "");
          const started = Date.parse(record.started_at ?? "");
          if (record?.skill && record.cwd && Number.isFinite(started) && now - started < SKILL_AGE) records.push(record);
        } catch {}
      }
    } catch {}
    this.records = records;
  }

  async readClaudes() {
    const now = this.clock();
    const seen = new Set();
    for (const agent of agents() ?? []) {
      if (agent.app !== "claude-code" || String(agent.address).includes("/")) continue;
      seen.add(agent.address);
      const known = this.claudes[agent.address];
      if (known?.status === "working" && agent.status !== "working" && known.cwd) this.settled.push(known.cwd);
      if (known && now - known.at < CLAUDE) {
        known.status = agent.status;
        continue;
      }
      const result = await this.run("hc", ["get", agent.address, "--json"]);
      let foreground = null;
      try {
        foreground = result?.code === 0 ? JSON.parse(result.stdout).foreground : null;
      } catch {}
      let tty = null;
      if (foreground?.pid) {
        const ps = await this.run("ps", ["-o", "tty=", "-p", String(foreground.pid)]);
        const value = ps?.code === 0 ? ps.stdout.trim() : "";
        tty = value && value !== "??" ? (value.startsWith("tty") ? value : `tty${value}`) : null;
      }
      let session = null;
      if (foreground?.pid) {
        try {
          session = JSON.parse((await readTextFile(`${home()}/.claude/sessions/${foreground.pid}.json`)) ?? "null")?.sessionId ?? null;
        } catch {}
      }
      this.claudes[agent.address] = { at: now, terminal: agent.address, status: agent.status, cwd: foreground?.cwd ?? null, tty, session };
    }
    for (const address of Object.keys(this.claudes)) if (!seen.has(address)) delete this.claudes[address];
  }

  focusedLane() {
    const cwd = focused()?.cwd;
    return this.lanes.find((lane) => inside(cwd, lane.path))?.key ?? null;
  }

  async readTask(lane, cache, now) {
    const every = this.focusedLane() === lane.key ? FOCUS_TASK : OTHER_TASK;
    if (cache.taskAt && now - cache.taskAt < every) return false;
    cache.taskAt = now;
    const text = await readTextFile(`${lane.path}/VJR-TASK.md`);
    if (text !== cache.text) {
      cache.text = text;
      cache.task = text == null ? null : (parseTask(text) ?? cache.task);
    }
    const head = await this.run("git", ["rev-parse", "HEAD"], lane.path);
    const sha = head?.code === 0 ? head.stdout.trim() : null;
    const changed = sha !== cache.head;
    cache.head = sha;
    return changed;
  }

  async readVerified(lane, cache, base) {
    const last = await this.run(this.bin("pp-pr-evidence"), ["last-code-sha", "--base", base], lane.path);
    cache.lastCode = last?.code === 0 && last.stdout.trim() ? last.stdout.trim() : cache.head;
    const verified = cache.task?.verification?.sha;
    cache.sinceVerified = 0;
    if (verified && cache.lastCode && !cache.lastCode.startsWith(verified)) {
      const count = await this.run("git", ["rev-list", "--count", `${verified}..${cache.lastCode}`], lane.path);
      cache.sinceVerified = count?.code === 0 ? Number(count.stdout.trim()) || 0 : 0;
    }
  }

  async readStatus(repo, now, focusedMain) {
    const held = this.status[repo.main];
    if (held && now - held.at < (focusedMain === repo.main ? STATUS_FOCUS : STATUS_OTHER)) return;
    const entry = { at: now, report: null, byPath: new Map(), alone: new Map(), error: null };
    this.status[repo.main] = entry;
    if (!(await fs.exists(this.bin("pp-lane-status")))) {
      entry.error = OLD_PP_STACK;
      return;
    }
    let result;
    try {
      result = await exec(...this.laneStatus(["--json"]), { cwd: repo.main });
    } catch {
      entry.error = "pp-lane-status could not start";
      return;
    }
    if (result.code !== 0) {
      entry.error = firstLine(result.stderr) || `pp-lane-status exited ${result.code}`;
      return;
    }
    const report = parseLaneStatus(result.stdout);
    if (!report.repo) {
      entry.error = report.error ?? "pp-lane-status gave no report";
      return;
    }
    entry.report = report;
    for (const lane of report.lanes) entry.byPath.set(lane.path, lane);
  }

  async readAlone(path) {
    const result = await this.run(...this.laneStatus(["--json", "--no-network", "--path", path]), path);
    if (result?.code !== 0) return null;
    const report = parseLaneStatus(result.stdout);
    return report.repo ? (report.lanes.find((lane) => lane.path === path) ?? null) : null;
  }

  applyFacts(lane, cache) {
    const entry = this.status[lane.repo.main];
    if (!entry) return;
    if (entry.error) {
      cache.evidence = { error: entry.error };
      return;
    }
    const alone = entry.alone.get(lane.path);
    const json = entry.byPath.get(lane.path) ?? alone ?? null;
    if (!json) return;
    const facts = factsOf(json, json === alone ? OFFLINE : entry.report);
    cache.base = facts.base;
    cache.baseSource = facts.baseSource;
    cache.evidence = facts.evidence;
    if (facts.pr) {
      cache.pr = facts.pr;
      cache.preview = facts.preview;
      cache.prError = null;
    } else if (facts.prError) cache.prError = facts.prError;
    else {
      cache.pr = null;
      cache.preview = null;
      cache.prError = null;
    }
  }

  async readRelease(lane, cache) {
    const evidence = cache.evidence;
    if (!evidence || evidence.error || !evidence.slug) return;
    const dir = evidence.dir || `${lane.path}/.pp-stack/updates/${evidence.slug}`;
    const [message, metaText, gallery] = await Promise.all([
      readTextFile(`${dir}/message.txt`),
      readTextFile(`${dir}/meta.json`),
      readTextFile(`${dir}/screenshots.md`),
    ]);
    if (message == null && gallery == null) {
      cache.release = null;
      return;
    }
    const stamp = `${message}\u0000${metaText}\u0000${gallery}`;
    const kept = cache.release?.shots ?? [];
    let missing = false;
    for (const shot of kept) if (!(await fs.exists(`${cacheDir()}/${evidence.slug}/${shot.file}`))) missing = true;
    if (stamp === cache.releaseStamp && !missing) return;
    cache.releaseStamp = stamp;
    let meta = {};
    try {
      meta = JSON.parse(metaText ?? "{}") ?? {};
    } catch {}
    const parsed = message ? parseMessage(message) : { release: null, title: "", items: [] };
    const shots = captionsFor(meta, parseScreenshots(gallery ?? "").shots);
    const target = `${cacheDir()}/${evidence.slug}`;
    await this.run("mkdir", ["-p", target]);
    for (const shot of shots) await this.run("cp", ["-f", `${dir}/${shot.file}`, `${target}/${shot.file}`]);
    cache.release = {
      slug: evidence.slug,
      dir,
      messagePath: message == null ? null : `${dir}/message.txt`,
      release: parsed.release ?? meta.release ?? null,
      title: parsed.title,
      items: parsed.items,
      channel: meta.announce ?? null,
      links: meta.links ?? null,
      shots: shots.map((shot) => ({ ...shot, image: `data/${SELF.name}/shots/${evidence.slug}/${shot.file}` })),
    };
  }

  placeOf(lane, places) {
    const own = this.localSpaces();
    let space = own.find((item) => inside(item.folder, lane.path))?.id ?? null;
    let mainSpace = own.find((item) => inside(item.folder, lane.repo.main))?.id ?? null;
    for (const [id, paths] of Object.entries(places)) {
      const list = [...paths];
      if (!space && list.some((path) => inside(path, lane.path))) space = id;
      if (!mainSpace && list.some((path) => inside(path, lane.repo.main) && !inside(path, lane.path))) mainSpace = id;
    }
    return { space, mainSpace };
  }

  async readPpLane(lane, places) {
    const cache = (this.cache[lane.key] ??= {});
    const entry = this.status[lane.repo.main];
    if (!entry?.report) return null;
    const alone = entry.alone.get(lane.path);
    const json = entry.byPath.get(lane.path) ?? alone;
    if (!json) return null;
    const facts = factsOf(json, json === alone ? OFFLINE : entry.report);
    cache.evidence = facts.evidence;
    await this.readRelease(lane, cache);
    const claudes = Object.values(this.claudes).filter((claude) => inside(claude.cwd, lane.path));
    const place = this.placeOf(lane, places);
    Object.assign(cache, place);
    const signals = ppSignals(json, facts, { repo: lane.repo, ...place, claudes });
    signals.release = cache.release ?? null;
    return signals;
  }

  async readLane(lane, places, headMoved) {
    const cache = (this.cache[lane.key] ??= {});
    this.applyFacts(lane, cache);
    const reported = cache.baseSource && cache.baseSource !== "default" ? cache.base : null;
    const base = reported || cache.task?.base || cache.base || "main";
    const found = skillRecord(this.records, { path: lane.path, task: cache.task }, this.sharedSessions);
    const record = found?.record ?? null;
    const treeRecord = skillRecord(this.records, { path: lane.path, task: null })?.record ?? null;
    if (headMoved || cache.lastCode === undefined) await this.readVerified(lane, cache, base);
    await this.readRelease(lane, cache);
    Object.assign(cache, this.placeOf(lane, places));
    const signals = laneSignals(lane, cache);
    const state = skillState(record, signals);
    signals.skill = state ? { ...state, from: found.from } : null;
    const here = Object.values(this.claudes).filter((claude) => inside(claude.cwd, lane.path));
    signals.claude = pickClaude(here, treeRecord);
    const session = cache.task?.session ?? null;
    signals.sessionShared = Boolean(session && this.sharedSessions.has(session));
    const mine = session && !signals.sessionShared ? Object.values(this.claudes).find((claude) => claude.session === session) : null;
    signals.session = mine ? { terminal: mine.terminal, status: mine.status, count: 1, ambiguous: false } : null;
    return signals;
  }

  async read(cx) {
    if (this.reading || !this.lease()) return;
    this.reading = true;
    try {
      const ids = this.localSpaces().map((space) => space.id).join(",");
      if (this.clock() - this.discoveredAt >= DISCOVER || ids !== this.spaceIds) await this.discover();
      await this.readSkills();
      await this.readClaudes();
      const places = this.spacePlaces();
      const profiles = shared("command-center.profiles");
      const on = (repo) => profileOf(profiles, repo.main) !== "off";
      const trees = this.worktrees.filter((tree) => on(tree.repo));
      const moved = {};
      for (const tree of trees) moved[tree.key] = await this.readTask(tree, (this.cache[tree.key] ??= {}), this.clock());
      await this.readStatuses(this.repos.filter(on));
      const lanes = this.lanesOf(trees);
      this.lanes = lanes;
      await this.readAlones(lanes);
      const claims = {};
      for (const lane of lanes) {
        const session = lane.flow === "vjr" ? this.cache[lane.key]?.task?.session : null;
        if (session) claims[session] = (claims[session] ?? 0) + 1;
      }
      this.sharedSessions = new Set(Object.keys(claims).filter((session) => claims[session] > 1));
      const signals = [];
      for (const lane of lanes) {
        const read = lane.flow === "pp" ? await this.readPpLane(lane, places) : await this.readLane(lane, places, moved[lane.key]);
        if (read) signals.push(read);
      }
      this.publish(signals);
      await this.sweep();
    } finally {
      this.reading = false;
    }
    cx?.notify?.();
  }

  lanesOf(trees) {
    const cwd = focused()?.cwd;
    const lanes = [];
    for (const tree of trees) {
      const cache = this.cache[tree.key];
      const flow = cache.text != null ? "vjr" : "pp";
      if (flow === "pp" && !this.status[tree.repo.main]?.byPath.has(tree.path) && !inside(cwd, tree.path)) continue;
      if (cache.flow && cache.flow !== flow) this.cache[tree.key] = { text: cache.text, task: cache.task, taskAt: cache.taskAt, head: cache.head };
      this.cache[tree.key].flow = flow;
      lanes.push({ ...tree, flow });
    }
    return lanes;
  }

  async readAlones(lanes) {
    for (const lane of lanes) {
      const entry = this.status[lane.repo.main];
      if (!entry?.report || entry.byPath.has(lane.path) || entry.alone.has(lane.path)) continue;
      const alone = await this.readAlone(lane.path);
      if (alone) entry.alone.set(lane.path, alone);
    }
  }

  async readStatuses(repos) {
    const now = this.clock();
    const trees = (repo) => repo.trees ?? [repo.main];
    for (const cwd of this.settled.splice(0)) {
      const repo = repos.find((item) => trees(item).some((tree) => inside(cwd, tree)));
      if (repo && this.status[repo.main]) this.status[repo.main].at = 0;
    }
    const cwd = focused()?.cwd;
    const focusedMain = repos.find((repo) => trees(repo).some((tree) => inside(cwd, tree)))?.main ?? null;
    for (const repo of repos) await this.readStatus(repo, now, focusedMain);
  }

  share(key, value) {
    const text = JSON.stringify(value);
    if (this.published[key] === text) return;
    this.published[key] = text;
    setShared(key, value);
  }

  publish(signals) {
    const lanes = signals.map((lane) => {
      if (lane.flow === "pp") {
        const shown = { ...lane, next: ppNext(lane) };
        return { ...shown, chip: ppChip(shown), summary: ppSummary(shown) };
      }
      const steps = stepsOf(lane);
      const next = nextStep(lane);
      return { ...lane, flow: "vjr", steps, chip: chipOf({ ...lane, next }, steps), next, note: noteOf(lane) };
    });
    const after = {};
    for (const lane of signals) {
      const alert = alertState(lane);
      if (alert) after[lane.key] = alert;
    }
    for (const alert of transitions(this.before, after)) {
      this.lastAlerted = alert.key;
      notify({ title: alert.title, body: alert.body, level: alert.level, timeout: 8000, action: { name: `${SELF.name}.show` } });
    }
    this.before = after;
    this.share("command-center.state", { lanes, repos: this.repos.map((repo) => ({ ...repo, error: this.status[repo.main]?.error ?? null })), vjrTask: this.vjrTask, editor: this.editor });
    this.share("command-center.badge", badge(signals));
    this.share("command-center.lanes", Object.fromEntries(lanes.map((lane) => [lane.key, lane.chip])));
  }

  async command(name, cx) {
    if (name !== "show") return;
    const space = this.lastAlerted ? this.cache[this.lastAlerted]?.space : null;
    if (space) {
      run("space.select", { id: space });
      await cx?.sleep?.(300);
    }
    run("layout.show", { id: "command-center" });
  }

  render() {
    if (this.role === "watch") return div();
    const t = theme();
    const lanes = this.stateLanes();
    if (this.role === "shot") return shotView(this, lanes.find((lane) => lane.key === this.shotLane), t);
    const profiles = shared("command-center.profiles") ?? {};
    if (this.role === "profile") return profileView(this, profiles, t, Boolean(shared("command-center.state")?.vjrTask));
    return columnView(this, shared("command-center.state") ?? {}, this.checkoutCwd(), profiles, t);
  }
}
