import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
import { spaces, panes, run, openOverlay, exec, theme, shared, setShared, watchFolder, window, nextCommand, layout } from "herdr";
import {
  accepts,
  assignColors,
  branchLabel,
  buildTree,
  canOpen,
  counts,
  DRAG_GRACE,
  dropTarget,
  duePlaces,
  foldedTail,
  holdsActive,
  isFolded,
  liveFolds,
  parseRefs,
  parseWorktrees,
  place,
  readLook,
  repoName,
} from "./tree.js";
import { CONTROL, ICON_SIZE, TEXT, iconButton, statusDot, toneColor } from "../../kit/kit.js";

const WAIT = 1500;
const RAIL = 16.25;
const HEAD = 36;
const TALL = 44;
const AVATAR = 18;
const SUB = 14;
const LANE = 42;
const MARK = { ansi6: "#22a99a", ansi3: "#e3814f", ansi4: "#5b8def", ansi5: "#8b7cf6", ansi2: "#3fae6a", ansi1: "#d9649a" };
const NARROW = 160;
const DRAG = "move-tab.drag";
const REQUEST = "move-tab.request";

function findNode(node, id) {
  if (node?.id === id) return node;
  for (const child of node?.children ?? []) {
    const found = findNode(child, id);
    if (found) return found;
  }
  return null;
}

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
    this.pressed = null;
    this.over = null;
    this.dropOver = null;
    cx.timer.every(250, (cx) => this.tick(cx));
    cx.spawn(async (cx) => {
      for (;;) {
        if ((await nextCommand()) === "style") this.toggleStyle();
        cx.notify();
      }
    });
  }

  style() {
    return shared("spaces.style") === "blocks" ? "blocks" : "graph";
  }

  toggleStyle() {
    setShared("spaces.style", this.style() === "blocks" ? "graph" : "blocks");
  }

  narrow() {
    return (findNode(layout(), "sidebar")?.size?.px ?? Infinity) < NARROW;
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
      folded: liveFolds(this.folded(), this.repos),
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
          const repos = new Set();
          for (const path of batch) {
            const look = await this.lookAt(path);
            if (look) repos.add(look.common);
          }
          for (const common of repos) await this.readRepo(common, cx);
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

  async readRepo(common, cx) {
    try {
      const list = await git(["worktree", "list", "--porcelain"], common);
      if (list.code !== 0) return;
      const refs = await git(["for-each-ref", "--format=%(refname:short)%09%(upstream:track)%09%(committerdate:unix)", "refs/heads"], common);
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
    run("space.new", { folder: row.path, machine: "" });
  }

  endDrag() {
    if (shared(DRAG) != null) setShared(DRAG, null);
  }

  forgetOldDrag() {
    const drag = shared(DRAG);
    if (drag != null && !(Date.now() - drag.at <= DRAG_GRACE)) setShared(DRAG, null);
  }

  dropFor(entry, row) {
    return dropTarget(entry, row, row.space ? this.looks[this.lastPlaces[row.space.id]] : null);
  }

  taking(target, row) {
    const drag = shared(DRAG);
    const source = typeof drag?.space === "string" ? (this.looks[this.lastPlaces[drag.space]]?.common ?? null) : null;
    return accepts(drag, target, row, source, Date.now()) ? drag : null;
  }

  dropping(target, row) {
    return this.dropOver === row.key && Boolean(this.taking(target, row));
  }

  hinting(target, row) {
    return shared(DRAG)?.moving === true && Boolean(this.taking(target, row));
  }

  dragOver(target, row, on, cx) {
    const over = on && this.taking(target, row) ? row.key : this.dropOver === row.key ? null : this.dropOver;
    if (over === this.dropOver) return;
    this.dropOver = over;
    cx.notify();
  }

  drop(target, row) {
    const lit = this.dropOver === row.key;
    const drag = this.taking(target, row);
    this.dropOver = null;
    if (!lit || !drag) return false;
    const time = Date.now();
    setShared(REQUEST, { id: String(time), tab: drag.tab, space: drag.space, to: target.path, toSpace: row.space?.id ?? null, at: time });
    setShared(DRAG, null);
    return true;
  }

  pointer(el, row, target, t, events = {}) {
    return el
      .when(this.dropping(target, row), (el) => el.border_1().border_color(t.accent))
      .when(!this.dropping(target, row) && this.hinting(target, row), (el) => el.border_1().border_dashed().border_color(t.accent))
      .on_hover((on, cx) => {
        events.hover?.(on, cx);
        this.dragOver(target, row, on, cx);
      })
      .on_mouse_move((_e, cx) => {
        events.move?.(cx);
        this.dragOver(target, row, true, cx);
      })
      .on_mouse_down("left", () => {
        this.endDrag();
        events.down?.();
      })
      .on_mouse_up("left", (_e, cx) => {
        if (this.drop(target, row)) cx.notify();
        else events.up?.(cx);
      });
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
      .size(AVATAR)
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
    return statusDot(t[status] ?? t.unknown);
  }

  iconButton(id, name, tooltip, action, t) {
    return iconButton(id, { icon: name, tooltip, color: t.unknown, size: CONTROL.tiny, iconSize: ICON_SIZE.md, bordered: false, stop: true, onPress: () => this.endDrag(), onClick: action }, t);
  }

  name(row, t) {
    return div().flex_1().min_w(0).truncate().text_color(row.open ? t.foreground : t.unknown).child(row.name);
  }

  sub(text, t) {
    return div()
      .pl(AVATAR + 8)
      .min_w(0)
      .h(SUB)
      .line_height(`${SUB}px`)
      .truncate()
      .text_size(11)
      .text_color(t.unknown)
      .child(text);
  }

  laneLine(row, t) {
    const found = row.path ? (shared("command-center.lanes") ?? {})[row.path] : null;
    if (!found?.chip) return null;
    const color = toneColor(found.tone, t);
    const sub = h_flex()
      .h(SUB)
      .flex_none()
      .min_w(0)
      .items_center()
      .gap(4)
      .truncate()
      .text_size(TEXT.sm)
      .child(div().flex_none().text_color(color).child(found.chip))
      .when(Boolean(found.why), (el) => el.child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(`· ${found.why}`)));
    return { height: LANE, sub };
  }

  note(text, t) {
    return div().flex_none().text_size(11).text_color(t.unknown).child(text);
  }

  bar(status, t, height) {
    return div().absolute().left(0).top(0).w(3).h(height).bg(t[status] ?? t.unknown);
  }

  headRow(entry, row, t, rail, flat = false) {
    const repo = entry.kind === "repo";
    const folded = isFolded(this.folded(), entry);
    const selected = Boolean(row.space?.active) || (folded && holdsActive(entry));
    const adding = repo && this.hovered === entry.key;
    const summary = folded ? foldedTail(entry) : null;
    const branch = summary ? "" : branchLabel(row);
    const text = summary ? String(summary.count) : counts(row);
    const height = branch ? TALL : HEAD;
    const status = summary ? summary.status : row.status;
    const all = spaces();
    const index = row.space ? all.findIndex((space) => space.id === row.space.id) : -1;
    const line = h_flex()
      .gap(8)
      .items_center()
      .child(this.avatar(row, t))
      .child(this.name(row, t).font_medium())
      .when(adding, (el) => el.child(this.iconButton(`add-${entry.key}`, "plus", "New worktree", () => this.newWorktree(entry), t)))
      .when(!adding && Boolean(text), (el) => el.child(this.note(text, t)))
      .when(Boolean(status) && !flat, (el) => el.child(this.statusDot(status, t)))
      .when(repo && entry.kids.length > 0, (el) =>
        el.child(this.iconButton(`fold-${entry.key}`, folded ? "chevron-right" : "chevron-down", folded ? "Unfold" : "Fold", () => this.toggleFold(entry.key), t)),
      );
    const bottom = (height - (branch ? AVATAR + 1 + SUB : AVATAR)) / 2 + AVATAR;
    const el = (branch ? v_flex().justify_center().gap(1).child(line.h(AVATAR)).child(this.sub(branch, t)) : line)
      .id(`head-${entry.key}`)
      .relative()
      .h(height)
      .flex_none()
      .px(flat ? 10 : 8)
      .when(!flat, (el) => el.rounded(8))
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
      .when(index < 0, (el) => el.on_click(() => this.open(row)))
      .when(index >= 0, (el) => this.draggable(el, index, t))
      .when(Boolean(row.space), (el) => el.on_mouse_down("right", () => this.menu(row.space)))
      .when(Boolean(rail), (el) => el.child(div().absolute().left(RAIL).top(bottom).w(1.5).h(height - bottom).bg(rail)))
      .when(Boolean(status) && flat, (el) => el.child(this.bar(status, t, height)));
    const events = { hover: (on, cx) => this.hover(entry.key, on, cx), ...(index >= 0 ? this.reorder(row, index, all) : {}) };
    return this.pointer(el, row, this.dropFor(entry, row), t, events);
  }

  draggable(el, index, t) {
    return el
      .when(this.pressed === index && this.over !== index, (el) => el.opacity(0.5))
      .when(this.pressed !== null && this.over === index && this.pressed !== index, (el) =>
        el.child(
          div()
            .absolute()
            .left(0)
            .w_full()
            .h(2)
            .bg(t.accent)
            .when(this.pressed < index, (line) => line.bottom(0))
            .when(this.pressed > index, (line) => line.top(0)),
        ),
      );
  }

  reorder(row, index, all) {
    return {
      down: () => {
        this.pressed = index;
        this.over = index;
      },
      move: (cx) => {
        const source = all[this.pressed];
        const over = source && (source.machine ?? null) === (row.space.machine ?? null) ? index : null;
        if (this.pressed !== null && this.over !== over) {
          this.over = over;
          cx.notify();
        }
      },
      up: (cx) => {
        const from = this.pressed;
        const over = this.over;
        this.pressed = null;
        this.over = null;
        if (from !== null && over === index && from !== index) run("space.move", { id: spaces()[from].id, index: index + 1 });
        else if (from === index) this.open(row);
        cx.notify();
      },
    };
  }

  compactRows(entries, t) {
    const all = spaces();
    const rows = entries.flatMap((entry) => (entry.kind === "repo" ? [entry.main, ...entry.kids] : [entry.row])).filter((row) => row.space);
    return rows.map((row) => {
      const active = Boolean(row.space.active);
      return h_flex()
        .id(`compact-${row.key}`)
        .h(26)
        .flex_none()
        .justify_center()
        .gap(4)
        .when(active, (el) => el.bg(t.raised))
        .hover((s) => s.bg(t.hover))
        .on_mouse_down("left", () => this.endDrag())
        .on_click(() => this.open(row))
        .child(div().text_color(active ? t.foreground : t.muted).child(String(all.findIndex((space) => space.id === row.space.id) + 1)))
        .when(row.status === "blocked" || row.status === "done", (el) => el.child(statusDot(t[row.status], { size: 5 })));
    });
  }

  kidLines(row, lane, t) {
    const line = h_flex().h(AVATAR).flex_none().gap(8).items_center().child(this.name(row, t)).when(Boolean(counts(row)), (el) => el.child(this.note(counts(row), t)));
    return lane ? [line, lane.sub] : [line];
  }

  graphKid(entry, row, t, rail, last) {
    const selected = Boolean(row.space?.active);
    const lane = this.laneLine(row, t);
    const height = lane?.height ?? 28;
    const el = v_flex()
      .id(`kid-${row.key}`)
      .relative()
      .h(height)
      .flex_none()
      .pl(46)
      .pr(8)
      .justify_center()
      .rounded(8)
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => this.open(row))
      .when(Boolean(row.space), (el) => el.on_mouse_down("right", () => this.menu(row.space)))
      .when(!last, (el) => el.child(div().absolute().left(RAIL).top(14).w(1.5).h(height - 14).bg(rail)))
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
      .children(this.kidLines(row, lane, t));
    return this.pointer(el, row, this.dropFor(entry, row), t);
  }

  graphEntry(entry, t) {
    if (entry.kind === "plain") return [this.headRow(entry, entry.row, t, null)];
    const kids = isFolded(this.folded(), entry) ? [] : entry.kids;
    const rail = faded(this.fill(entry.main.space, t));
    return [this.headRow(entry, entry.main, t, kids.length ? rail : null), ...kids.map((row, index) => this.graphKid(entry, row, t, rail, index === kids.length - 1))];
  }

  blockKid(entry, row, t) {
    const selected = Boolean(row.space?.active);
    const lane = this.laneLine(row, t);
    const height = lane?.height ?? 28;
    const el = v_flex()
      .id(`kid-${row.key}`)
      .relative()
      .h(height)
      .flex_none()
      .pl(36)
      .pr(10)
      .justify_center()
      .when(selected, (el) => el.bg(t.selected))
      .when(!selected, (el) => el.hover((s) => s.bg(t.hover)))
      .on_click(() => this.open(row))
      .when(Boolean(row.space), (el) => el.on_mouse_down("right", () => this.menu(row.space)))
      .when(row.open && Boolean(row.status), (el) => el.child(this.bar(row.status, t, height)))
      .children(this.kidLines(row, lane, t));
    return this.pointer(el, row, this.dropFor(entry, row), t);
  }

  blockEntry(entry, t) {
    const row = entry.kind === "repo" ? entry.main : entry.row;
    const kids = entry.kind === "repo" && !isFolded(this.folded(), entry) ? entry.kids : [];
    return v_flex()
      .id(`block-${entry.key}`)
      .flex_none()
      .mb(6)
      .overflow_hidden()
      .bg(t.surface)
      .border_1()
      .border_color(t.border)
      .rounded(10)
      .child(this.headRow(entry, row, t, null, true))
      .when(kids.length > 0, (el) => el.child(div().h(1).flex_none().bg(t.border)))
      .children(kids.map((kid) => this.blockKid(entry, kid, t)));
  }

  header(t, narrow) {
    if (narrow) {
      return h_flex()
        .h(31)
        .flex_none()
        .items_center()
        .justify_center()
        .child(this.iconButton("space-new", "plus", "New space", () => run("space.new"), t));
    }
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
      .child(
        h_flex()
          .gap(4)
          .items_center()
          .child(
            this.style() === "blocks"
              ? this.iconButton("space-style", "git-branch", "Show as a graph", () => this.toggleStyle(), t)
              : this.iconButton("space-style", "layers", "Show as blocks", () => this.toggleStyle(), t),
          )
          .child(this.iconButton("space-new", "plus", "New space", () => run("space.new"), t)),
      );
  }

  render() {
    const t = theme();
    const { colors, changed } = assignColors(spaces(), shared("space.colors") ?? {});
    if (changed) setShared("space.colors", colors);
    const narrow = this.narrow();
    const entries = this.entries();
    const blocks = this.style() === "blocks";
    return v_flex()
      .size_full()
      .min_h(0)
      .bg(t.chrome)
      .text_size(13)
      .on_mouse_down("left", () => this.endDrag())
      .child(this.header(t, narrow).on_mouse_down_out(() => this.forgetOldDrag()))
      .child(
        v_flex()
          .flex_1()
          .min_h(0)
          .px(narrow ? 0 : 8)
          .pb(14)
          .overflow_y_scrollbar()
          .mode("always")
          .on_mouse_up("left", (_e, cx) => {
            this.pressed = null;
            this.over = null;
            this.dropOver = null;
            this.endDrag();
            cx.notify();
          })
          .children(narrow ? this.compactRows(entries, t) : entries.flatMap((entry) => (blocks ? [this.blockEntry(entry, t)] : this.graphEntry(entry, t)))),
      );
  }
}
