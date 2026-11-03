import { View, div } from "gpui-kit";
import { InputState } from "gpui-base";
import * as fs from "fs/promises";
import { columnView, profileView, shotView } from "./column.js";
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
} from "./logic.js";

const SELF = { name: "command-center" };
const TICK = 2000;
const FOCUS_TASK = 5000;
const OTHER_TASK = 30000;
const DISCOVER = 60000;
const GH_OPEN = 60000;
const GH_NONE = 300000;
const CLAUDE = 5000;
const SKILLS = 10000;
const EVIDENCE_ACTIVE = 60000;
const SKILL_AGE = 12 * 3600 * 1000;
const LEASE = 30000;
const LEASE_KEY = "command-center.watch";
const PR_FIELDS = "number,url,state,isDraft,reviewDecision,mergedAt,baseRefName,headRefName,statusCheckRollup";

const inside = (path, root) => Boolean(path && root) && (path === root || path.startsWith(`${root}/`));
const basename = (path) => path.replace(/\/+$/, "").split("/").pop() ?? path;
const firstLine = (text) => String(text ?? "").trim().split("\n")[0] ?? "";
const bin = (name) => `${home()}/.claude/skills/pp-stack/bin/${name}`;
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
    openOverlay({ mod: "command-center", kind: "popup", at: "pointer", width: 240, height: 104, props: { role: "profile", repo: repo.main, name: repo.name } });
  }

  setProfile(repo, id) {
    const all = { ...(shared("command-center.profiles") ?? {}) };
    if (id === "off") all[repo] = "off";
    else delete all[repo];
    setShared("command-center.profiles", all);
    if (this.overlay) closeOverlay(this.overlay);
  }

  startTask(repo, cx) {
    const space = focused()?.space ?? null;
    this.newClaude(space, repo.main, "/vjr-task", "task");
    cx?.notify?.();
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

  act(lane, cx) {
    const next = lane.next;
    if (!next || next.disabled) return;
    if (next.kind === "send") this.send([lane.session, lane.claude].find((item) => item?.terminal === next.terminal) ?? { terminal: next.terminal, status: null }, next.text, cx);
    else if (next.kind === "focus") run("pane.focus", { terminal: next.terminal });
    else if (next.kind === "tab" || next.kind === "space") this.newClaude(next.kind === "tab" ? next.space : null, next.folder, next.text, next.name);
    else if (next.kind === "open") this.open(next.url);
  }

  newTab(lane) {
    if (lane.next?.text) this.newClaude(lane.space, lane.path, lane.next.text);
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
      const copied = (await attempt(bin("pp-stack-rich-copy"), [release.messagePath])) || (await attempt("sh", ["-c", 'pbcopy < "$1"', "_", release.messagePath]));
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

  startWatch(cx) {
    this.id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    this.clock = () => Date.now();
    this.lanes = [];
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
      for (const tree of list.slice(1)) {
        if ((await readTextFile(`${tree.path}/VJR-TASK.md`)) == null) continue;
        found.push({ key: tree.path, path: tree.path, branch: tree.branch, repo: { name: basename(main.path), main: main.path } });
      }
    }
    const keep = new Set(found.map((lane) => lane.key));
    for (const key of Object.keys(this.cache)) if (!keep.has(key)) delete this.cache[key];
    this.lanes = found;
    this.repos = repos;
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
    if (text != null && text !== cache.text) {
      cache.text = text;
      cache.task = parseTask(text) ?? cache.task;
    }
    const head = await this.run("git", ["rev-parse", "HEAD"], lane.path);
    const sha = head?.code === 0 ? head.stdout.trim() : null;
    const changed = sha !== cache.head;
    cache.head = sha;
    return changed;
  }

  async readEvidence(lane, cache, base, now, shipping) {
    const last = await this.run(bin("pp-pr-evidence"), ["last-code-sha", "--base", base], lane.path);
    cache.lastCode = last?.code === 0 && last.stdout.trim() ? last.stdout.trim() : cache.head;
    const verified = cache.task?.verification?.sha;
    cache.sinceVerified = 0;
    if (verified && cache.lastCode && !cache.lastCode.startsWith(verified)) {
      const count = await this.run("git", ["rev-list", "--count", `${verified}..${cache.lastCode}`], lane.path);
      cache.sinceVerified = count?.code === 0 ? Number(count.stdout.trim()) || 0 : 0;
    }
    cache.evidenceAt = now;
    let result;
    try {
      result = await exec(bin("pp-pr-evidence"), ["status", "--base", base, "--json"], { cwd: lane.path });
    } catch {
      cache.evidence = { error: "pp-stack not found" };
      return;
    }
    if (result.code !== 0 && result.code !== 1) {
      cache.evidence = { error: firstLine(result.stderr) || "pp-pr-evidence failed" };
      return;
    }
    try {
      const data = JSON.parse(result.stdout);
      const files = {};
      for (const file of data.files ?? []) files[file.file] = file.state;
      cache.evidence = { ready: Boolean(data.ready), files, slug: data.slug ?? null, dir: data.dir ?? null };
    } catch {
      cache.evidence = { error: "pp-pr-evidence failed" };
    }
    if (shipping) cache.ghAt = 0;
  }

  async readPr(lane, cache, now) {
    const open = cache.pr && cache.pr.state === "OPEN";
    if (cache.pr?.state === "MERGED" && cache.finalRead) return;
    if (cache.ghAt && now - cache.ghAt < (open ? GH_OPEN : GH_NONE)) return;
    cache.ghAt = now;
    if (!lane.branch) return;
    const result = await this.run("gh", ["pr", "list", "--head", lane.branch, "--state", "all", "--limit", "1", "--json", PR_FIELDS], lane.path);
    if (!result || result.code !== 0) {
      cache.prError = `GitHub unavailable · ${firstLine(result?.stderr) || "gh failed"}`;
      return;
    }
    try {
      const pr = JSON.parse(result.stdout).find((item) => item.headRefName === lane.branch) ?? null;
      cache.pr = pr;
      cache.prError = null;
      if (pr?.state === "MERGED") cache.finalRead = true;
      cache.preview = null;
      if (pr && pr.state === "OPEN") {
        const preview = await this.run(bin("pp-pr-preview-check"), ["--pr", String(pr.number)], lane.path);
        try {
          cache.preview = preview?.code === 0 ? JSON.parse(preview.stdout) : null;
        } catch {}
      }
    } catch {
      cache.prError = "GitHub unavailable · unreadable answer";
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

  async readLane(lane, places, headMoved) {
    const cache = (this.cache[lane.key] ??= {});
    const now = this.clock();
    const base = cache.pr?.baseRefName || cache.task?.base || "main";
    const found = skillRecord(this.records, { path: lane.path, task: cache.task }, this.sharedSessions);
    const record = found?.record ?? null;
    const treeRecord = skillRecord(this.records, { path: lane.path, task: null })?.record ?? null;
    const shipping = Boolean(record && ["ship"].includes(skillState(record, laneSignals(lane, cache))?.family));
    if (headMoved || !cache.evidence || (shipping && now - (cache.evidenceAt ?? 0) >= EVIDENCE_ACTIVE) || (cache.wasShipping && !shipping)) {
      await this.readEvidence(lane, cache, base, now, cache.wasShipping && !shipping);
    }
    cache.wasShipping = shipping;
    await this.readPr(lane, cache, now);
    await this.readRelease(lane, cache);
    const own = this.localSpaces();
    cache.space = own.find((space) => inside(space.folder, lane.path))?.id ?? null;
    cache.mainSpace = own.find((space) => inside(space.folder, lane.repo.main))?.id ?? null;
    for (const [id, paths] of Object.entries(places)) {
      const list = [...paths];
      if (!cache.space && list.some((path) => inside(path, lane.path))) cache.space = id;
      if (!cache.mainSpace && list.some((path) => inside(path, lane.repo.main) && !inside(path, lane.path))) cache.mainSpace = id;
    }
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
      const lanes = this.lanes.filter((lane) => profileOf(profiles, lane.repo.main) !== "off");
      const moved = {};
      for (const lane of lanes) moved[lane.key] = await this.readTask(lane, (this.cache[lane.key] ??= {}), this.clock());
      const claims = {};
      for (const lane of lanes) {
        const session = this.cache[lane.key]?.task?.session;
        if (session) claims[session] = (claims[session] ?? 0) + 1;
      }
      this.sharedSessions = new Set(Object.keys(claims).filter((session) => claims[session] > 1));
      const signals = [];
      for (const lane of lanes) signals.push(await this.readLane(lane, places, moved[lane.key]));
      this.publish(signals);
      await this.sweep();
    } finally {
      this.reading = false;
    }
    cx?.notify?.();
  }

  share(key, value) {
    const text = JSON.stringify(value);
    if (this.published[key] === text) return;
    this.published[key] = text;
    setShared(key, value);
  }

  publish(signals) {
    const lanes = signals.map((lane) => {
      const steps = stepsOf(lane);
      return { ...lane, steps, chip: chipOf(lane, steps), next: nextStep(lane), note: noteOf(lane) };
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
    this.share("command-center.state", { lanes, repos: this.repos });
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
    if (this.role === "profile") return profileView(this, profiles, t);
    return columnView(this, shared("command-center.state") ?? {}, this.checkoutCwd(), profiles, t);
  }
}
