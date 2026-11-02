import { View, div, svg } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, exec, theme, shared, setShared, watchFolder, window } from "herdr";
import {
  assignColors,
  branchLabel,
  buildTree,
  canOpen,
  counts,
  duePlaces,
  foldedTail,
  holdsActive,
  parseRefs,
  parseWorktrees,
  place,
  readLook,
  repoName,
} from "./tree.js";

const WAIT = 1500;
const RAIL = 16.25;
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const icon = (name) => `mods/workspace-chrome/${name}.svg`;
const faded = (color) => (/^#[0-9a-f]{6}$/i.test(color) ? `${color}B3` : color);
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
    this.opening = {};
    this.hovered = null;
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

  open(row) {
    if (row.space) {
      run("space.select", { id: row.space.id });
      return;
    }
    const time = Date.now();
    if (!row.path || !canOpen(this.opening, row.path, time)) return;
    this.opening[row.path] = time;
    run("space.new", { folder: row.path });
  }

  menu(space) {
    openOverlay({ mod: "menu", kind: "popup", width: 200, height: 260, props: { tab: "space", target: { id: space.id } } });
  }

  newWorktree(entry) {
    const props = entry.main.space ? { space: entry.main.space.id, action: "new" } : { folder: entry.main.path, action: "new" };
    openOverlay({ mod: "worktree", kind: "dialog", width: 440, height: 260, props });
  }

  toggleFold(key) {
    const folded = this.folded();
    if (!folded.delete(key)) folded.add(key);
    setShared("spaces.folded", [...folded]);
  }

  hover(key, on, cx) {
    if (on) this.hovered = key;
    else if (this.hovered === key) this.hovered = null;
    cx.notify();
  }

  fill(space, t) {
    if (!space) return t.dim;
    const color = (shared("space.colors") ?? {})[space.id] ?? "ansi6";
    return color.startsWith("#") ? color : (MARK[color] ?? t[color] ?? t.dim);
  }

  avatar(row, t) {
    return h_flex()
      .size(18)
      .flex_none()
      .rounded(5)
      .bg(this.fill(row.space, t))
      .items_center()
      .justify_center()
      .text_size(10.5)
      .font_bold()
      .text_color("#ffffff")
      .child([...row.name][0]?.toUpperCase() ?? "?");
  }

  statusDot(status, t) {
    return div().size(7).flex_none().rounded(4).bg(t[status] ?? t.unknown);
  }

  iconButton(id, name, tooltip, action, t) {
    return div()
      .id(id)
      .size(18)
      .flex_none()
      .flex()
      .items_center()
      .justify_center()
      .rounded(4)
      .text_color(t.unknown)
      .hover((s) => s.bg(t.hover).text_color(t.foreground))
      .tooltip(tooltip)
      .on_click((_e, cx) => {
        cx.stop_propagation();
        action();
      })
      .child(svg(icon(name)).size(12));
  }

  name(row, t) {
    return div().flex_1().min_w(0).truncate().text_color(row.open ? t.foreground : t.unknown).child(row.name);
  }

  note(text, t) {
    return div().flex_none().text_size(11).text_color(t.unknown).child(text);
  }

  headRow(entry, row, t, rail) {
    const repo = entry.kind === "repo";
    const folded = repo && this.folded().has(entry.key);
    const selected = Boolean(row.space?.active) || (folded && holdsActive(entry));
    const adding = repo && this.hovered === entry.key;
    const summary = folded ? foldedTail(entry) : null;
    const text = summary ? String(summary.count) : [branchLabel(row), counts(row)].filter(Boolean).join(" ");
    const status = summary ? summary.status : row.status;
    return h_flex()
      .id(`head-${entry.key}`)
      .relative()
      .h(30)
      .flex_none()
      .px(8)
      .gap(8)
      .items_center()
      .rounded(8)
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
      .on_hover((on, cx) => this.hover(entry.key, on, cx))
      .on_click(() => this.open(row))
      .when(Boolean(row.space), (el) => el.on_mouse_down("right", () => this.menu(row.space)))
      .when(Boolean(rail), (el) => el.child(div().absolute().left(RAIL).top(24).w(1.5).h(6).bg(rail)))
      .child(this.avatar(row, t))
      .child(this.name(row, t).font_medium())
      .when(adding, (el) => el.child(this.iconButton(`add-${entry.key}`, "plus", "New worktree", () => this.newWorktree(entry), t)))
      .when(!adding && Boolean(text), (el) => el.child(this.note(text, t)))
      .when(Boolean(status), (el) => el.child(this.statusDot(status, t)))
      .when(repo && entry.kids.length > 0, (el) =>
        el.child(this.iconButton(`fold-${entry.key}`, folded ? "chevron-right" : "chevron-down", folded ? "Unfold" : "Fold", () => this.toggleFold(entry.key), t)),
      );
  }

  graphKid(row, t, rail, last) {
    const selected = Boolean(row.space?.active);
    return h_flex()
      .id(`kid-${row.key}`)
      .relative()
      .h(28)
      .flex_none()
      .pl(46)
      .pr(8)
      .gap(8)
      .items_center()
      .rounded(8)
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => this.open(row))
      .when(Boolean(row.space), (el) => el.on_mouse_down("right", () => this.menu(row.space)))
      .when(!last, (el) => el.child(div().absolute().left(RAIL).top(14).w(1.5).h(14).bg(rail)))
      .child(div().absolute().left(RAIL).top(0).h(14).w(13).border_l(1.5).border_b(1.5).border_color(rail).rounded_bl(9))
      .child(
        div()
          .absolute()
          .left(29)
          .top(9)
          .size(10)
          .rounded(5)
          .when(row.open, (el) => el.bg(t[row.status] ?? t.dim))
          .when(!row.open, (el) => el.border(1.5).border_color(rail)),
      )
      .child(this.name(row, t))
      .when(Boolean(counts(row)), (el) => el.child(this.note(counts(row), t)));
  }

  graphEntry(entry, t) {
    if (entry.kind === "plain") return [this.headRow(entry, entry.row, t, null)];
    const kids = this.folded().has(entry.key) ? [] : entry.kids;
    const rail = faded(this.fill(entry.main.space, t));
    return [this.headRow(entry, entry.main, t, kids.length ? rail : null), ...kids.map((row, index) => this.graphKid(row, t, rail, index === kids.length - 1))];
  }

  header(t) {
    return h_flex()
      .h(31)
      .flex_none()
      .pl(16)
      .pr(12)
      .items_center()
      .justify_between()
      .text_size(11.5)
      .text_color(t.dim)
      .child("Spaces")
      .child(h_flex().gap(4).items_center().child(this.iconButton("space-new", "plus", "New space", () => run("space.new"), t)));
  }

  render() {
    const t = theme();
    const { colors, changed } = assignColors(spaces(), shared("space.colors") ?? {});
    if (changed) setShared("space.colors", colors);
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .child(this.header(t))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .px(8)
          .pb(14)
          .overflow_y_scrollbar()
          .mode("always")
          .children(this.entries().flatMap((entry) => this.graphEntry(entry, t))),
      );
  }
}
