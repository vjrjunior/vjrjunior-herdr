import { View, div } from "gpui-kit";
import { agents, exec, home, readTextFile } from "herdr";
import { decodeNote, encodeNote, judge, keepArgs, parseBoot, parseEtime, parseSession } from "./logic.js";

const CHECK = 10000;
const FULL = 20;

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
    cx.timer.every(CHECK, (cx) => cx.spawn(async (cx) => this.check(cx)));
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
      for (const address of [...this.noted]) {
        if (running.has(address)) continue;
        const terminal = await this.readTerminal(address);
        if (!terminal?.note) this.noted.delete(address);
        else if (judge(terminal, boot) === "quit") await this.label(address, null);
      }
    } finally {
      this.checking = false;
    }
  }

  render() {
    return div();
  }
}
