import { View, div } from "gpui-kit";
import * as fs from "fs/promises";
import { agents, exec, home, readTextFile, notify, nextCommand } from "herdr";
import {
  decodeNote,
  encodeNote,
  judge,
  keepArgs,
  lastLine,
  markTried,
  parseBoot,
  parseEtime,
  parseSession,
  planPass,
  resumeCommand,
  summary,
  triedNow,
} from "./logic.js";

const CHECK = 10000;
const FULL = 20;
const SETTLE = 12000;
const READY = 1.5;
const GAP = 150;
const CONFIRM = 5000;

const local = (address) => typeof address === "string" && !address.includes("/");
const sameNote = (a, b) =>
  Boolean(a) &&
  Boolean(b) &&
  a.session === b.session &&
  a.cwd === b.cwd &&
  a.boot === b.boot &&
  a.shell.pid === b.shell.pid &&
  a.shell.start === b.shell.start &&
  a.args.join("\u0000") === b.args.join("\u0000");

export default class Comeback extends View {
  init(_props, cx) {
    this.noted = new Set();
    this.seen = {};
    this.checks = 0;
    this.scanned = false;
    this.checking = false;
    this.boot = null;
    this.passing = false;
    cx.timer.every(CHECK, (cx) => cx.spawn(async (cx) => this.check(cx)));
    cx.spawn(async (cx) => this.startup(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "resume") await this.pass(cx, true);
      }
    });
  }

  async startup(cx) {
    const { boot } = await this.facts();
    if (!boot) return;
    await this.scan();
    for (let waited = 0; waited < SETTLE; waited += 500) {
      let pending = false;
      for (const address of this.noted) if (!(await this.readTerminal(address))?.foreground) pending = true;
      if (!pending) break;
      await this.pause(500);
    }
    await this.pass(cx, false);
  }

  async hc(args) {
    try {
      const result = await exec("hc", args);
      return result.code === 0 ? JSON.parse(result.stdout) : null;
    } catch {
      return null;
    }
  }

  async facts() {
    if (!this.boot) {
      try {
        const result = await exec("sysctl", ["-n", "kern.boottime"]);
        if (result.code === 0) this.boot = parseBoot(result.stdout);
      } catch {}
    }
    if (!this.boot) this.boot = parseBoot(await readTextFile("/proc/sys/kernel/random/boot_id"));
    return { boot: this.boot };
  }

  async ps(field, pid) {
    try {
      const result = await exec("ps", ["-o", field, "-p", String(pid)]);
      return result.code === 0 ? result.stdout.trim() : "";
    } catch {
      return "";
    }
  }

  async readTerminal(address) {
    const data = await this.hc(["get", address, "--json"]);
    if (!data || data.state !== "live" || !Number.isInteger(data.pid)) return null;
    const [start, elapsed] = await Promise.all([this.ps("lstart=", data.pid), this.ps("etime=", data.pid)]);
    return {
      address,
      where: data.labels?.where ?? address,
      pid: data.pid,
      start,
      age: parseEtime(elapsed) ?? Infinity,
      foreground: data.foreground ?? null,
      app: data.status?.app ?? null,
      note: decodeNote(data.labels?.comeback),
    };
  }

  async label(address, note) {
    await exec("hc", ["label", address, note ? `comeback=${encodeNote(note)}` : "comeback="]);
    if (note) this.noted.add(address);
    else this.noted.delete(address);
  }

  async pause(ms) {
    try {
      await exec("sleep", [String(ms / 1000)]);
    } catch {}
  }

  async scan() {
    this.scanned = true;
    const list = await this.hc(["ls", "--json"]);
    for (const item of list?.terminals ?? []) {
      if (!local(item.address)) continue;
      const terminal = await this.readTerminal(item.address);
      if (terminal?.note) this.noted.add(item.address);
    }
  }

  async record(terminal, boot) {
    const found = parseSession(await readTextFile(`${home()}/.claude/sessions/${terminal.foreground.pid}.json`));
    if (!found) return;
    const note = {
      v: 1,
      agent: "claude",
      session: found.session,
      cwd: found.cwd,
      args: keepArgs(terminal.foreground.argv ?? []),
      boot,
      shell: { pid: terminal.pid, start: terminal.start },
      at: Date.now(),
    };
    if (sameNote(note, terminal.note)) this.noted.add(terminal.address);
    else await this.label(terminal.address, note);
  }

  async check(_cx) {
    if (this.checking) return;
    this.checking = true;
    try {
      const { boot } = await this.facts();
      if (!boot) return;
      if (!this.scanned) await this.scan();
      const full = this.checks++ % FULL === 0;
      const running = new Set();
      for (const agent of agents()) {
        if (agent.app !== "claude-code" || !local(agent.address)) continue;
        running.add(agent.address);
        if (!full && this.seen[agent.address] === agent.seq) continue;
        const terminal = await this.readTerminal(agent.address);
        if (!terminal) continue;
        this.seen[agent.address] = agent.seq;
        if (judge(terminal, boot) === "running") await this.record(terminal, boot);
      }
      let waiting = false;
      for (const address of [...this.noted]) {
        if (running.has(address)) continue;
        const terminal = await this.readTerminal(address);
        if (!terminal?.note) this.noted.delete(address);
        else if (judge(terminal, boot) === "quit") await this.label(address, null);
        else if (judge(terminal, boot) === "lost" && !triedNow(terminal.note, terminal, boot)) waiting = true;
      }
      if (waiting) await this.pass(_cx, false);
    } finally {
      this.checking = false;
    }
  }

  async folderOk(cwd) {
    try {
      return (await exec("test", ["-d", cwd])).code === 0;
    } catch {
      return false;
    }
  }

  async transcriptOk(session) {
    const root = `${home()}/.claude/projects`;
    try {
      for (const project of await fs.readdir(root)) {
        try {
          await fs.stat(`${root}/${project}/${session}.jsonl`);
          return true;
        } catch {}
      }
    } catch {}
    return false;
  }

  async openSessions() {
    const folder = `${home()}/.claude/sessions`;
    const byPid = new Map();
    try {
      for (const name of await fs.readdir(folder)) {
        if (!/^\d+\.json$/.test(name)) continue;
        const found = parseSession(await readTextFile(`${folder}/${name}`));
        if (found) byPid.set(name.slice(0, -5), found.session);
      }
    } catch {}
    if (byPid.size === 0) return new Set();
    let alive = [];
    try {
      const result = await exec("ps", ["-o", "pid=", "-p", [...byPid.keys()].join(",")]);
      alive = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean);
    } catch {}
    return new Set(alive.filter((pid) => byPid.has(pid)).map((pid) => byPid.get(pid)));
  }

  async lastWords(address) {
    return lastLine((await this.hc(["read", address, "--json", "--lines", "20"]))?.text ?? "");
  }

  async pass(_cx, manual) {
    if (this.passing) return;
    this.passing = true;
    try {
      const { boot } = await this.facts();
      if (!boot) return;
      const lost = [];
      for (const item of (await this.hc(["ls", "--json"]))?.terminals ?? []) {
        if (!local(item.address)) continue;
        const terminal = await this.readTerminal(item.address);
        if (terminal?.note) this.noted.add(item.address);
        if (terminal && judge(terminal, boot) === "lost") lost.push(terminal);
      }
      const folders = new Map();
      const transcripts = new Map();
      for (const terminal of lost) {
        if (!folders.has(terminal.note.cwd)) folders.set(terminal.note.cwd, await this.folderOk(terminal.note.cwd));
        if (!transcripts.has(terminal.note.session)) transcripts.set(terminal.note.session, await this.transcriptOk(terminal.note.session));
      }
      const open = lost.length > 0 ? await this.openSessions() : new Set();
      const plan = planPass(lost, { auto: !manual, boot, folderOk: (cwd) => folders.get(cwd), transcriptOk: (session) => transcripts.get(session), open });
      const outcome = { resumed: [], failed: [], skipped: [] };
      for (const { terminal, reason } of plan.skipped) {
        outcome.skipped.push({ where: terminal.where, reason });
        await this.label(terminal.address, markTried(terminal.note, terminal, boot, reason));
      }
      const sent = [];
      for (const planned of plan.todo) {
        if (planned.age < READY) await this.pause((READY - planned.age) * 1000);
        const now = await this.readTerminal(planned.address);
        if (!now?.note || judge(now, boot) !== "lost" || now.note.session !== planned.note.session) continue;
        if (!manual && triedNow(now.note, now, boot)) continue;
        const command = resumeCommand(now.note);
        if (!command) continue;
        await this.label(now.address, markTried(now.note, now, boot));
        await exec("hc", ["send", now.address, command]);
        sent.push(now);
        await this.pause(GAP);
      }
      if (sent.length > 0) {
        await this.pause(CONFIRM);
        for (const terminal of sent) {
          const after = await this.readTerminal(terminal.address);
          if (after && judge(after, boot) === "running") outcome.resumed.push(terminal.where);
          else {
            const words = await this.lastWords(terminal.address);
            outcome.failed.push({ where: terminal.where, reason: words ? `exited right away: ${words}` : "exited right away" });
          }
        }
      }
      const notice = summary(outcome, manual);
      if (notice) notify(notice);
    } finally {
      this.passing = false;
    }
  }

  render() {
    return div();
  }
}
