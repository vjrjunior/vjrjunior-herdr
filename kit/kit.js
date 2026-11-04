import { div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";

export const KIT = { name: "kit" };
export const CONTROL = { tiny: 18, small: 22, regular: 24, square: 26, row: 28, large: 32 };
export const TEXT = { xs: 10.5, sm: 11, md: 11.5, base: 12, lg: 12.5, xl: 13, title: 13.5 };
export const RADIUS = { chip: 3, pill: 4, control: 5, card: 6, row: 8, block: 10, round: 9 };
export const ICON_SIZE = { sm: 11, md: 12, lg: 14 };
export const BRAND = { clickup: "#7B68EE", zed: "#4A9EFF" };
export const ICONS = [
  "arrow-left",
  "check",
  "check-heavy",
  "chevron-down",
  "chevron-right",
  "clickup",
  "exclamation",
  "external-link",
  "eye",
  "git-branch",
  "github",
  "layers",
  "plus",
  "rotate-cw",
  "terminal",
  "x",
  "zed",
];

export const iconPath = (name) => `mods/${KIT.name}/icons/${name}.svg`;

export function icon(name, { size = ICON_SIZE.md, color } = {}) {
  return svg(iconPath(name))
    .size(size)
    .flex_none()
    .when(color != null, (el) => el.text_color(color));
}

export function statusDot(color, { size = 7, hollow = false } = {}) {
  return div()
    .size(size)
    .flex_none()
    .rounded(RADIUS.round)
    .when(!hollow, (el) => el.bg(color))
    .when(hollow, (el) => el.border(1.5).border_color(color));
}

export function mark(kind, color, { size = ICON_SIZE.sm } = {}) {
  if (kind === "dot") return statusDot(color, { size: 7 });
  if (kind === "ring") return statusDot(color, { size: 7, hollow: true });
  return icon(kind, { size, color });
}

export function stepNode(state, t) {
  const box = h_flex().size(18).flex_none().items_center().justify_center().rounded(RADIUS.round);
  if (state === "done") return box.bg(t.done).child(icon("check-heavy", { size: 11, color: t.accent_foreground }));
  if (state === "current") return box.border(1.5).border_color(t.accent).child(statusDot(t.accent, { size: 8 }));
  if (state === "bad") return box.border(1.5).border_color(t.blocked).child(icon("exclamation", { size: 11, color: t.blocked }));
  return box.border(1.5).border_color(t.input);
}

export function button(id, { label, icon: iconName, variant = "outline", color, height = CONTROL.regular, full = false, disabled = false, hint, onClick }, t) {
  const solid = variant === "solid" && !disabled;
  const textColor = disabled ? t.unknown : solid ? t.accent_foreground : (color ?? t.foreground);
  return h_flex()
    .id(id)
    .flex_none()
    .h(height)
    .px(9)
    .gap(6)
    .items_center()
    .rounded(RADIUS.control)
    .text_size(height === CONTROL.large ? TEXT.base : height === CONTROL.row ? TEXT.md : TEXT.sm)
    .text_color(textColor)
    .when(disabled, (el) => el.bg(t.raised))
    .when(solid, (el) => el.bg(color ?? t.accent).font_bold().hover((s) => s.opacity(0.9)))
    .when(!disabled && !solid, (el) => el.border_1().border_color(color ?? t.input).hover((s) => s.bg(t.hover)))
    .when(!disabled && variant === "dashed", (el) => el.border_dashed())
    .when(full, (el) => el.w_full().justify_center())
    .on_click((_e, cx) => onClick?.(cx))
    .when(iconName != null, (el) => el.child(icon(iconName, { size: ICON_SIZE.md, color: textColor })))
    .when(label != null, (el) => el.child(label))
    .when(hint != null, (el) => el.child(div().text_color(t.unknown).child(hint)));
}

export function iconButton(id, { icon: iconName, tooltip, color, size = CONTROL.square, iconSize = ICON_SIZE.lg, bordered = true, stop = false, onClick }, t) {
  return div()
    .id(id)
    .size(size)
    .flex_none()
    .flex()
    .items_center()
    .justify_center()
    .rounded(RADIUS.control)
    .when(bordered, (el) => el.border_1().border_color(t.input))
    .hover((s) => s.bg(t.hover))
    .when(tooltip != null, (el) => el.tooltip(tooltip))
    .when(stop, (el) => el.on_mouse_down("left", (_e, cx) => cx.stop_propagation()))
    .on_click((_e, cx) => {
      if (stop) cx.stop_propagation();
      onClick?.(cx);
    })
    .child(icon(iconName, { size: iconSize, color: color ?? t.muted }));
}

export function link(id, { label, icon: iconName, onClick }, t) {
  return h_flex()
    .id(id)
    .flex_none()
    .gap(4)
    .items_center()
    .text_size(TEXT.sm)
    .text_color(t.ansi12 ?? t.accent)
    .hover((s) => s.text_color(t.foreground))
    .on_click((_e, cx) => onClick?.(cx))
    .child(label)
    .when(iconName != null, (el) => el.child(icon(iconName, { size: ICON_SIZE.sm })));
}

export function chip(text, { mark: kind, color }, t) {
  return h_flex()
    .flex_none()
    .h(16)
    .px(5)
    .gap(4)
    .items_center()
    .rounded(RADIUS.chip)
    .text_size(TEXT.xs)
    .border_1()
    .border_color(color)
    .text_color(color)
    .when(kind != null, (el) => el.child(mark(kind, color)))
    .child(text);
}

export function pill(text, t) {
  return h_flex().flex_none().h(18).px(6).items_center().rounded(RADIUS.pill).text_size(TEXT.xs).font_bold().bg(t.accent).text_color(t.accent_foreground ?? t.chrome).child(text);
}

export function card(t) {
  return v_flex().gap(8).p(10).rounded(RADIUS.card).bg(t.surface).border_1().border_color(t.border);
}

export function heading(text, t, right) {
  return h_flex()
    .justify_between()
    .text_size(TEXT.xs)
    .text_color(t.unknown)
    .child(div().child(text.toUpperCase()))
    .when(right != null, (el) => el.child(div().text_color(t.dim).child(String(right))));
}

export function line(name, { detail, color, mark: kind }, t) {
  return h_flex()
    .h(24)
    .gap(10)
    .items_center()
    .border_t_1()
    .border_color(t.border)
    .text_size(TEXT.md)
    .child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(name))
    .child(
      h_flex()
        .flex_none()
        .gap(4)
        .items_center()
        .text_size(TEXT.sm)
        .text_color(color)
        .when(kind != null, (el) => el.child(mark(kind, color)))
        .child(detail),
    );
}
