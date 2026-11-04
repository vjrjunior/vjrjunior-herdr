import { View, div } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { theme } from "herdr";
import { ICONS, TEXT, button, card, chip, heading, icon, iconButton, line, link, pill, stepNode, statusDot } from "../../kit/kit.js";

const STATUSES = ["working", "blocked", "done", "idle", "unknown"];
const STEPS = ["done", "current", "bad", "todo"];

function section(id, title, t) {
  return v_flex().id(`kit-${id}`).gap(8).w_full().child(heading(title, t));
}

function row() {
  return h_flex().gap(8).items_center().flex_wrap();
}

export default class Kit extends View {
  render() {
    const t = theme();
    const noop = () => {};
    const buttons = row()
      .child(button("kit-b-solid", { label: "Solid", variant: "solid", onClick: noop }, t))
      .child(button("kit-b-outline", { label: "Outline", onClick: noop }, t))
      .child(button("kit-b-dashed", { label: "Dashed", variant: "dashed", onClick: noop }, t))
      .child(button("kit-b-icon", { label: "With icon", icon: "plus", onClick: noop }, t))
      .child(button("kit-b-hint", { label: "With hint", hint: "ctrl-k", onClick: noop }, t))
      .child(button("kit-b-disabled", { label: "Disabled", disabled: true, onClick: noop }, t));
    const iconButtons = row()
      .child(iconButton("kit-ib-bordered", { icon: "eye", tooltip: "Bordered", onClick: noop }, t))
      .child(iconButton("kit-ib-plain", { icon: "terminal", tooltip: "Plain", bordered: false, onClick: noop }, t))
      .child(iconButton("kit-ib-clickup", { icon: "clickup", tooltip: "ClickUp", onClick: noop }, t))
      .child(iconButton("kit-ib-zed", { icon: "zed", tooltip: "Zed", bordered: false, onClick: noop }, t));
    const links = row()
      .child(link("kit-l-plain", { label: "A link", onClick: noop }, t))
      .child(link("kit-l-icon", { label: "An external link", icon: "external-link", onClick: noop }, t));
    const chips = row()
      .child(chip("passed", { mark: "check", color: t.done }, t))
      .child(chip("failed", { mark: "x", color: t.blocked }, t))
      .child(chip("asking", { mark: "dot", color: t.working }, t))
      .child(chip("Sent", { color: t.muted }, t));
    const lines = card(t)
      .child(line("Check", { detail: "check", color: t.done, mark: "check" }, t))
      .child(line("Cross", { detail: "x", color: t.blocked, mark: "x" }, t))
      .child(line("Dot", { detail: "dot", color: t.working, mark: "dot" }, t))
      .child(line("Ring", { detail: "ring", color: t.idle, mark: "ring" }, t))
      .child(line("No mark", { detail: "plain", color: t.muted }, t));
    const dots = v_flex()
      .gap(8)
      .child(row().children(STATUSES.map((name) => h_flex().gap(4).items_center().text_size(TEXT.sm).text_color(t.muted).child(statusDot(t[name])).child(name))))
      .child(row().children(STATUSES.map((name) => h_flex().gap(4).items_center().text_size(TEXT.sm).text_color(t.muted).child(statusDot(t[name], { hollow: true })).child(name))));
    const steps = row().gap(16).children(
      STEPS.map((state) => h_flex().gap(6).items_center().text_size(TEXT.sm).text_color(t.muted).child(stepNode(state, t)).child(state)),
    );
    const icons = row().gap(12).children(
      ICONS.map((name) =>
        v_flex()
          .w(84)
          .gap(4)
          .items_center()
          .text_size(TEXT.xs)
          .text_color(t.muted)
          .child(icon(name, { size: 18, color: t.foreground }))
          .child(name),
      ),
    );

    return v_flex()
      .id("kit")
      .size_full()
      .overflow_y_scrollbar()
      .bg(t.background)
      .p(16)
      .gap(20)
      .text_color(t.foreground)
      .child(section("buttons", "Buttons", t).child(buttons))
      .child(section("icon-buttons", "Icon buttons", t).child(iconButtons))
      .child(section("links", "Links", t).child(links))
      .child(section("chips", "Chips", t).child(chips))
      .child(section("pill", "Pill", t).child(row().child(pill("Pill", t))))
      .child(section("lines", "Lines", t).child(lines))
      .child(section("dots", "Dots", t).child(dots))
      .child(section("steps", "Steps", t).child(steps))
      .child(section("icons", "Icons", t).child(icons));
  }
}
