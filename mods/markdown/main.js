import { View, div } from "gpui-kit";
import { h_flex, TextView, v_flex } from "gpui-base";
import { exec, home, props, readTextFile, theme, watchFolder } from "herdr";
import { button, iconButton } from "../../kit/kit.js";
import { folderOf, linkTarget, nameOf, shortFolder, stripFrontMatter } from "./logic.js";

function message(text, t) {
  return div().p(16).text_size(12).text_color(t.dim).child(text);
}

export default class Markdown extends View {
  init(given, cx) {
    const file = (given ?? props() ?? {}).file;
    this.history = [];
    this.reads = 0;
    this.watches = 0;
    this.dir = null;
    this.file = null;
    if (typeof file === "string" && file) this.show(file, cx);
  }

  show(file, cx) {
    this.file = file;
    this.text = null;
    this.raw = undefined;
    this.missing = false;
    this.reload(cx);
    this.watch(folderOf(file), cx);
    cx?.notify?.();
  }

  reload(cx) {
    const file = this.file;
    if (!file) return;
    const ticket = ++this.reads;
    cx.spawn(async (cx) => {
      let text = null;
      try {
        text = await readTextFile(file);
      } catch {}
      if (ticket !== this.reads || text === this.raw) return;
      this.raw = text;
      this.missing = text == null;
      this.text = text == null ? null : stripFrontMatter(text);
      cx.notify();
    });
  }

  watch(dir, cx) {
    if (this.dir === dir) return;
    this.dir = dir;
    const mine = ++this.watches;
    cx.spawn(async (cx) => {
      for (;;) {
        let changed;
        try {
          changed = await watchFolder(dir);
        } catch {
          if (this.watches === mine) this.dir = null;
          return;
        }
        if (this.watches !== mine) return;
        const name = nameOf(this.file);
        if ((changed ?? []).some((path) => path === this.file || path === dir || nameOf(path) === name)) this.reload(cx);
      }
    });
  }

  follow(url, cx) {
    const target = linkTarget(this.file, url);
    if (target.kind === "web") exec("open", [target.url]).catch(() => {});
    else if (target.kind === "file") exec("open", [target.path]).catch(() => {});
    else if (target.kind === "markdown") {
      this.history.push(this.file);
      this.show(target.path, cx);
    }
  }

  back(cx) {
    const previous = this.history.pop();
    if (previous) this.show(previous, cx);
  }

  render() {
    const t = theme();
    const file = this.file;
    const head = h_flex()
      .id("md-head")
      .flex_none()
      .h(32)
      .pl(12)
      .pr(6)
      .gap(8)
      .items_center()
      .bg(t.chrome)
      .border_b_1()
      .border_color(t.border)
      .when(this.history.length > 0, (el) => el.child(button("md-back", { icon: "arrow-left", label: "Back", onClick: (cx) => this.back(cx) }, t)))
      .child(div().flex_none().text_size(12).font_semibold().text_color(t.foreground).child(file ? nameOf(file) : "Markdown"))
      .child(div().flex_1().min_w(0).overflow_hidden().whitespace_nowrap().text_ellipsis_start().text_size(11).text_color(t.dim).child(file ? shortFolder(folderOf(file), home()) : ""))
      .when(Boolean(file), (el) =>
        el
          .child(button("md-zed", { label: "Zed", icon: "zed", iconColor: t.muted, onClick: () => exec("zed", [file]).catch(() => {}) }, t))
          .child(
            iconButton(
              "md-reload",
              {
                icon: "rotate-cw",
                tooltip: "Reload",
                onClick: (cx) => {
                  this.reload(cx);
                  this.watch(folderOf(file), cx);
                },
              },
              t,
            ),
          ),
      );
    let body;
    if (!file) body = message("No file to show", t);
    else if (this.missing) body = message(`${nameOf(file)} is gone`, t);
    else if (this.text == null) body = message("Loading…", t);
    else
      body = TextView.markdown(`md-${file}`, this.text)
        .size_full()
        .scrollable(true)
        .selectable(true)
        .on_link_click((url, cx) => this.follow(url, cx));
    return v_flex()
      .id("root")
      .size_full()
      .bg(t.background)
      .text_color(t.foreground)
      .child(head)
      .child(div().flex_1().min_h(0).px(16).py(12).text_size(13).child(body));
  }
}
