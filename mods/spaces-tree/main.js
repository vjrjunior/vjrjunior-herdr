import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, exec, theme, shared, setShared, watchFolder, window } from "herdr";
import { assignColors, buildTree, duePlaces, parseRefs, parseWorktrees, place, readLook, repoName } from "./tree.js";

const WAIT = 1500;
const git = (args, cwd) => exec("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], { cwd });

export default class SpacesTree extends View {
  init(_props, cx) {
    this.looks = {};
    this.unsure = new Set();
    this.checked = {};
    this.repos = {};
    this.pending = new Set();
    this.refreshing = false;
    this.watching = new Set();
    this.lastPlaces = {};
    this.lastBusy = {};
    this.shown = new Set(spaces().map((space) => space.id));
    this.born = {};
    cx.timer.every(250, (cx) => this.tick(cx));
  }

  folded() {
    const value = shared("spaces.folded");
    return new Set(Array.isArray(value) ? value : []);
  }

  current() {
    const all = spaces();
    const ps = panes();
    const places = {};
    const spaceOfTab = {};
    for (const space of all) {
      for (const tab of space.tabs ?? []) spaceOfTab[tab.id] = space.id;
      if (space.machine != null) continue;
      const at = place(space, ps);
      if (at) places[space.id] = at;
    }
    const busy = {};
    const paneSpace = {};
    for (const pane of ps) {
      const id = spaceOfTab[pane.tab];
      if (!pane.terminal || !id) continue;
      busy[pane.pane] = pane.status === "working" || !(pane.program?.shell || pane.program?.agent);
      paneSpace[pane.pane] = id;
    }
    return { all, places, busy, paneSpace };
  }

  tick(cx) {
    const { all, places, busy, paneSpace } = this.current();
    const time = Date.now();
    for (const space of all) if (!this.shown.has(space.id)) this.born[space.id] ??= time;
    const due = duePlaces({
      places,
      lastPlaces: this.lastPlaces,
      busy,
      lastBusy: this.lastBusy,
      paneSpace,
      looks: this.looks,
      unsure: this.unsure,
      checked: this.checked,
      time,
      active: Boolean(window()?.active),
      folded: this.folded(),
    });
    this.lastPlaces = places;
    this.lastBusy = busy;
    if (due.size) this.refresh(due, cx);
    if (all.some((space) => !this.shown.has(space.id))) cx.notify();
  }

  refresh(paths, cx) {
    for (const path of paths) this.pending.add(path);
    if (this.refreshing) return;
    this.refreshing = true;
    cx.spawn(async (cx) => {
      try {
        while (this.pending.size) {
          const batch = [...this.pending];
          this.pending.clear();
          const repos = new Map();
          for (const path of batch) {
            const look = await this.lookAt(path);
            if (look) repos.set(look.common, look.top);
          }
          for (const [common, top] of repos) await this.readRepo(common, top, cx);
          cx.notify();
        }
        this.forget();
      } finally {
        this.refreshing = false;
      }
      cx.notify();
    });
  }

  async lookAt(path) {
    this.checked[path] = Date.now();
    try {
      const look = readLook(await git(["rev-parse", "--show-toplevel", "--path-format=absolute", "--git-common-dir"], path));
      if (look === undefined) {
        this.unsure.add(path);
        return this.looks[path] ?? null;
      }
      this.unsure.delete(path);
      this.looks[path] = look;
      return look;
    } catch {
      this.unsure.add(path);
      return this.looks[path] ?? null;
    }
  }

  async readRepo(common, top, cx) {
    try {
      const list = await git(["worktree", "list", "--porcelain"], top);
      if (list.code !== 0) return;
      const refs = await git(["for-each-ref", "--format=%(refname:short)%09%(upstream:track)%09%(committerdate:unix)", "refs/heads"], top);
      this.repos[common] = { common, name: repoName(common), checkouts: parseWorktrees(list.stdout), refs: refs.code === 0 ? parseRefs(refs.stdout) : {} };
      this.watch(common, cx);
    } catch {}
  }

  watch(common, cx) {
    if (this.watching.has(common)) return;
    this.watching.add(common);
    cx.spawn(async (cx) => {
      try {
        while (this.watching.has(common)) {
          await watchFolder(common);
          if (!this.watching.has(common)) break;
          const used = new Set(Object.values(this.lastPlaces));
          this.refresh(Object.keys(this.looks).filter((path) => used.has(path) && this.looks[path]?.common === common), cx);
        }
      } catch {
        this.watching.delete(common);
      }
    });
  }

  forget() {
    const used = new Set(Object.values(this.lastPlaces).map((path) => this.looks[path]?.common).filter(Boolean));
    for (const common of this.watching) if (!used.has(common)) this.watching.delete(common);
  }

  entries() {
    const time = Date.now();
    const all = spaces();
    const lookOf = (space) => this.looks[this.lastPlaces[space.id]];
    const settled = (space) => {
      const look = lookOf(space);
      return space.machine != null || look === null || Boolean(look && this.repos[look.common]);
    };
    for (const space of all) {
      if (!this.shown.has(space.id) && (settled(space) || time - (this.born[space.id] ?? time) > WAIT)) this.shown.add(space.id);
    }
    const visible = all.filter((space) => this.shown.has(space.id));
    const looks = Object.fromEntries(visible.map((space) => [space.id, lookOf(space)]));
    return buildTree(visible, looks, this.repos);
  }

  render() {
    const t = theme();
    const { colors, changed } = assignColors(spaces(), shared("space.colors") ?? {});
    if (changed) setShared("space.colors", colors);
    const rows = this.entries().flatMap((entry) => (entry.kind === "repo" ? [entry.main, ...entry.kids] : [entry.row]));
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .child(h_flex().h(31).pl(16).pr(10).items_center().text_size(11.5).text_color(t.dim).child("Spaces"))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .px(8)
          .overflow_y_scrollbar()
          .children(rows.map((row) => div().id(`row-${row.key}`).h(28).px(8).flex().items_center().rounded(8).text_color(row.open ? t.foreground : t.unknown).child(row.name))),
      );
  }
}
