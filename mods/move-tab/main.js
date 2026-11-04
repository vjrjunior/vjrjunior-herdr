import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { closeOverlay, notify, panes, props, setShared, shared, spaces, theme } from "herdr";
import { CONTROL, RADIUS, TEXT, heading, icon } from "../../kit/kit.js";
import { appIo } from "./io.js";
import { REASONS, parseWorktrees, placeOf, targetsFor } from "./logic.js";
import { moveTab } from "./move.js";

const KEY = "move-tab.request";
const STALE = 10000;
const LIST_HEIGHT = 260;

function message(text, t) {
  return div().px(8).py(6).text_size(TEXT.md).text_color(t.muted).child(text);
}

export default class MoveTab extends View {
  init(given, cx) {
    const own = { ...(props() ?? {}), ...(given && typeof given === "object" ? given : {}) };
    this.role = own.role === "worker" ? "worker" : "popup";
    this.seen = null;
    this.running = false;
    this.tab = typeof own.tab === "string" ? own.tab : null;
    this.space = typeof own.space === "string" ? own.space : null;
    this.overlay = own.overlay ?? null;
    this.at = 0;
    this.targets = null;
    this.picked = false;
    this.handle = null;
    if (this.role === "worker" || !this.tab) return;
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.spawn(async (cx) => {
      try {
        this.targets = await this.load(cx);
      } catch {
        this.targets = [];
      }
      cx.notify();
    });
  }

  async load(cx) {
    const all = spaces();
    const space = all.find((candidate) => candidate.id === this.space) ?? all.find((candidate) => candidate.tabs.some((tab) => tab.id === this.tab));
    if (!space) return [];
    this.space = space.id;
    const folder = placeOf({ tabs: [{ id: this.tab }], folder: space.folder }, panes());
    const text = folder ? await appIo(cx).worktrees(folder) : null;
    if (!text) return [];
    return targetsFor({ checkouts: parseWorktrees(text), spaces: spaces(), panes: panes(), from: { space: space.id } });
  }

  pick(index) {
    const target = this.targets?.[index];
    if (!target || this.picked) return;
    this.picked = true;
    const now = Date.now();
    setShared(KEY, { id: String(now), tab: this.tab, space: this.space, to: target.path, toSpace: target.space, at: now });
    if (this.overlay) closeOverlay(this.overlay);
  }

  key(name) {
    const count = this.targets?.length ?? 0;
    if (name === "down" && count > 0) this.at = (this.at + 1) % count;
    else if (name === "up" && count > 0) this.at = (this.at + count - 1) % count;
    else if (name === "enter") this.pick(this.at);
    else if (name === "escape") {
      if (this.overlay) closeOverlay(this.overlay);
    } else return false;
    return true;
  }

  take(cx) {
    const request = shared(KEY);
    if (!request || typeof request.id !== "string" || request.id === this.seen) return;
    this.seen = request.id;
    setShared(KEY, null);
    if (!Number.isFinite(request.at) || Date.now() - request.at > STALE) return;
    if (this.running) {
      notify({ title: "Can't move this tab", body: REASONS.running(), level: "warning" });
      return;
    }
    this.running = true;
    cx.spawn(async (cx) => {
      try {
        await moveTab(request, appIo(cx));
      } finally {
        this.running = false;
      }
    });
  }

  row(target, index, t) {
    return h_flex()
      .id(`target-${index}`)
      .flex_none()
      .min_h(CONTROL.large)
      .px(8)
      .py(4)
      .gap(8)
      .items_center()
      .rounded(RADIUS.control)
      .when(index === this.at, (el) => el.bg(t.selected))
      .hover((s) => s.bg(t.hover))
      .on_click(() => this.pick(index))
      .child(icon("git-branch", { color: t.muted }))
      .child(
        v_flex()
          .flex_1()
          .min_w(0)
          .child(div().truncate().text_color(t.foreground).child(target.label))
          .when(target.detail !== target.label, (el) => el.child(div().truncate().text_size(TEXT.sm).text_color(t.muted).child(target.detail))),
      );
  }

  render(cx) {
    if (this.role === "worker") {
      this.take(cx);
      return div();
    }
    if (!this.tab) return div();
    const t = theme();
    const root = v_flex()
      .id("move-tab")
      .when(this.handle != null, (el) => el.track_focus(this.handle))
      .on_key_down((event, cx) => {
        if (this.key(event.key)) cx.notify();
      })
      .w_full()
      .p(5)
      .gap(2)
      .bg(t.popover)
      .text_size(TEXT.lg)
      .child(heading("Move to", t).px(8).pt(4).pb(2));
    if (this.targets === null) return root.child(message("Looking for checkouts…", t));
    if (this.targets.length === 0) return root.child(message("No other checkout of this repo.", t));
    return root.child(
      v_flex()
        .id("move-tab-targets")
        .max_h(LIST_HEIGHT)
        .gap(2)
        .overflow_y_scrollbar()
        .children(this.targets.map((target, index) => this.row(target, index, t))),
    );
  }
}
