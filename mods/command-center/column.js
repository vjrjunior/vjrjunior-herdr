import { div, image } from "gpui-kit";
import { TextView, h_flex, v_flex } from "gpui-base";
import { rollup } from "./logic.js";

const STEPS = ["Task", "AC", "Ship", "Evidence", "PR", "Merge", "Clear"];
const MARK = { done: "✓", run: "●", next: "○", bad: "!", todo: "" };
const FILES = ["ship.json", "screenshots.md", "message.txt", "meta.json"];

const toneColor = (tone, t) => ({ done: t.done, work: t.working, bad: t.blocked }[tone] ?? t.unknown);
const stateColor = (state, t) => ({ done: t.done, ok: t.done, current: t.done, run: t.working, next: t.accent, bad: t.blocked, stale: t.blocked }[state] ?? t.unknown);
const linkColor = (t) => t.ansi12 ?? t.accent;
const merged = (lane) => lane.pr && !lane.pr.error && lane.pr.state === "MERGED";

function heading(text, t) {
  return div().text_size(10.5).text_color(t.dim).child(text.toUpperCase());
}

function pill(text, t) {
  return h_flex().flex_none().h(18).px(6).items_center().rounded(4).text_size(11).font_bold().bg(t.accent).text_color(t.accent_foreground ?? t.chrome).child(text);
}

function link(id, text, t, action) {
  return div().id(id).flex_none().text_size(11.5).text_color(linkColor(t)).hover((s) => s.text_color(t.foreground)).on_click((_e, cx) => action(cx)).child(text);
}

function row(mark, color, name, detail, t) {
  return h_flex()
    .h(26)
    .flex_none()
    .px(8)
    .gap(8)
    .items_center()
    .rounded(6)
    .bg(t.surface)
    .border_1()
    .border_color(t.border)
    .child(div().flex_none().w(10).text_color(color).child(mark))
    .child(div().flex_1().min_w(0).truncate().child(name))
    .when(Boolean(detail), (el) => el.child(div().flex_none().text_size(11).text_color(t.unknown).child(detail)));
}

function header(view, lane, t) {
  const task = lane.task;
  const pr = lane.pr && !lane.pr.error ? lane.pr : null;
  return v_flex()
    .gap(4)
    .child(h_flex().gap(8).items_center().child(pill(task.id ?? "TASK", t)).child(div().text_size(11.5).text_color(t.unknown).child(lane.repo.name)))
    .child(div().text_size(13.5).font_semibold().text_color(t.foreground).child(task.title))
    .child(div().text_size(11.5).text_color(t.unknown).truncate().child(`${lane.branch ?? "detached"} → ${task.base}`))
    .child(
      h_flex()
        .gap(12)
        .flex_wrap()
        .when(Boolean(task.url), (el) => el.child(link("link-task", "ClickUp ↗", t, () => view.open(task.url))))
        .when(Boolean(pr), (el) => el.child(link("link-pr", `PR #${pr.number} ↗`, t, () => view.open(pr.url))))
        .child(link("link-file", "VJR-TASK.md", t, () => view.open(`${lane.path}/VJR-TASK.md`)))
        .child(link("link-zed", "Zed ↗", t, () => view.zed(lane.path))),
    );
}

function stepper(lane, t) {
  return h_flex()
    .gap(2)
    .children(
      STEPS.map((name, index) => {
        const state = lane.steps[index] ?? "todo";
        const color = stateColor(state, t);
        return v_flex()
          .flex_1()
          .min_w(0)
          .items_center()
          .gap(4)
          .child(
            h_flex()
              .w_full()
              .h(22)
              .items_center()
              .justify_center()
              .rounded(4)
              .text_size(11)
              .bg(state === "done" ? t.raised : t.surface)
              .border_1()
              .border_color(state === "todo" ? t.border : color)
              .text_color(color)
              .child(MARK[state] ?? ""),
          )
          .child(div().whitespace_nowrap().text_size(10).text_color(state === "todo" ? t.dim : state === "done" ? t.muted : t.foreground).child(name));
      }),
    );
}

function nextCard(view, lane, t) {
  const next = lane.next ?? {};
  const offerTab = Boolean(next.text) && (next.kind === "send" || next.kind === "wait");
  return v_flex()
    .gap(8)
    .p(12)
    .rounded(8)
    .bg(t.surface)
    .border_1()
    .border_color(t.border)
    .child(heading("Next step", t))
    .child(
      h_flex()
        .id("next")
        .h(34)
        .w_full()
        .items_center()
        .justify_center()
        .rounded(6)
        .font_bold()
        .bg(next.disabled ? t.raised : t.accent)
        .text_color(next.disabled ? t.unknown : (t.accent_foreground ?? t.chrome))
        .when(!next.disabled, (el) => el.hover((s) => s.opacity(0.9)))
        .on_click((_e, cx) => view.act(lane, cx))
        .child(next.label ?? ""),
    )
    .child(
      h_flex()
        .gap(8)
        .justify_between()
        .text_size(11)
        .text_color(t.unknown)
        .child(div().flex_1().min_w(0).child(`→ ${next.target ?? ""}`))
        .when(offerTab, (el) => el.child(link("new-tab", "New tab instead", t, () => view.newTab(lane)))),
    )
    .when(Boolean(lane.note), (el) => el.child(div().text_size(11.5).text_color(t.working).child(lane.note)));
}

function doneBlock(lane, t) {
  const rows = new Map((lane.task.verification?.rows ?? []).map((item) => [item.id, item]));
  return v_flex()
    .gap(6)
    .child(heading("Done when · VJR-TASK.md", t))
    .children(
      lane.task.done.map((item) => {
        const verified = rows.get(item.id);
        return h_flex()
          .items_start()
          .gap(8)
          .p(8)
          .rounded(6)
          .bg(t.surface)
          .border_1()
          .border_color(t.border)
          .child(div().flex_none().w(30).text_color(t.unknown).child(item.id))
          .child(
            v_flex()
              .flex_1()
              .min_w(0)
              .child(div().child(item.item))
              .when(Boolean(verified?.where), (el) => el.child(div().text_size(11).text_color(t.unknown).child(verified.where))),
          )
          .child(div().flex_none().text_size(11).text_color(verified ? t.done : t.unknown).child(verified ? `✓ ${verified.verdict.toLowerCase()}` : "to verify"));
      }),
    )
    .when(lane.task.done.length === 0, (el) => el.child(div().text_size(11.5).text_color(t.unknown).child("No done items in VJR-TASK.md")));
}

function gatesBlock(lane, t) {
  const verification = lane.task.verification;
  if (!verification) return null;
  return v_flex()
    .gap(6)
    .child(heading(`Verification · ${verification.sha}`, t))
    .when(Boolean(verification.gates), (el) => el.child(row("✓", t.done, verification.gates, null, t)))
    .when(Boolean(verification.review), (el) => el.child(row("✓", t.done, verification.review, null, t)));
}

function evidenceBlock(lane, t) {
  const evidence = lane.evidence;
  if (!evidence) return null;
  const block = v_flex().gap(6).child(heading("Evidence · pp-pr-evidence", t));
  if (evidence.error) return block.child(div().text_size(11.5).text_color(t.unknown).child(evidence.error));
  return block.children(
    FILES.map((file) => {
      const state = evidence.files?.[file] ?? "missing";
      return row(state === "current" ? "✓" : state === "stale" ? "!" : "○", stateColor(state, t), file, state, t);
    }),
  );
}

function prBlock(lane, t) {
  const pr = lane.pr;
  if (!pr) return null;
  if (pr.error) return v_flex().gap(6).child(heading("Pull request", t)).child(div().text_size(11.5).text_color(t.unknown).child(pr.error));
  const checks = rollup(pr.statusCheckRollup);
  const status = pr.state === "MERGED" ? "merged" : pr.isDraft ? "draft" : pr.reviewDecision === "APPROVED" ? "ready, approved" : "ready for review";
  const marks = { ok: "✓", run: "●", bad: "!", idle: "○" };
  const block = v_flex().gap(6).child(heading(`PR #${pr.number} · ${status}`, t));
  if (lane.prError) block.child(div().text_size(11.5).text_color(t.working).child(lane.prError));
  for (const item of checks.items) block.child(row(marks[item.state], stateColor(item.state, t), item.name, item.detail, t));
  if (lane.preview?.link) block.child(row("✓", t.done, "Preview", lane.preview.state?.toLowerCase?.() ?? "", t));
  if (pr.reviewDecision) block.child(row(pr.reviewDecision === "APPROVED" ? "✓" : "●", pr.reviewDecision === "CHANGES_REQUESTED" ? t.blocked : pr.reviewDecision === "APPROVED" ? t.done : t.working, "Review", pr.reviewDecision.toLowerCase().replaceAll("_", " "), t));
  return block;
}

function releaseBlock(view, lane, t) {
  const release = lane.release;
  if (!release) return null;
  const done = merged(lane);
  const shots = done ? release.shots : release.shots.slice(0, 2);
  const pairs = [];
  for (let index = 0; index < shots.length; index += 2) pairs.push(shots.slice(index, index + 2).map((shot, offset) => [shot, index + offset]));
  const warn = done && release.links && release.links !== "production";
  return v_flex()
    .gap(8)
    .p(12)
    .rounded(8)
    .bg(t.surface)
    .border_1()
    .border_color(t.border)
    .child(heading("Release update", t))
    .child(div().text_size(11).text_color(t.unknown).child([release.release ? `Release ${release.release}` : null, release.channel ? `#${release.channel}` : null].filter(Boolean).join(" · ")))
    .child(div().font_bold().text_color(t.foreground).child(release.title))
    .when(release.items.length > 0, (el) =>
      el.child(
        div()
          .text_size(12)
          .child(TextView.markdown("release-items", release.items.map((item) => `- ${item.parts.map((part) => (part.url ? `[${part.text}](${part.url})` : part.text)).join("")}`).join("\n"))),
      ),
    )
    .children(
      pairs.map((pair) =>
        h_flex()
          .gap(6)
          .items_start()
          .children(
            pair.map(([shot, index]) =>
              v_flex()
                .id(`shot-${index}`)
                .flex_1()
                .min_w(0)
                .gap(3)
                .on_click(() => view.openShot(lane, index))
                .child(image(shot.image).w_full().h(96).rounded(4))
                .child(div().text_size(10.5).text_color(t.unknown).child(shot.caption)),
            ),
          ),
      ),
    )
    .when(warn, (el) =>
      el.child(
        v_flex()
          .gap(4)
          .p(8)
          .rounded(6)
          .border_1()
          .border_color(t.working)
          .text_size(11.5)
          .text_color(t.working)
          .child(div().child(`Links still point to ${release.links}.`))
          .child(link("regenerate", "Regenerate with production links", t, (cx) => view.regenerate(lane, cx))),
      ),
    )
    .when(Boolean(release.messagePath), (el) =>
      el.child(
        h_flex()
          .id("copy")
          .h(30)
          .w_full()
          .items_center()
          .justify_center()
          .rounded(6)
          .font_bold()
          .bg(done ? t.accent : t.raised)
          .text_color(done ? (t.accent_foreground ?? t.chrome) : t.foreground)
          .border_1()
          .border_color(done ? t.accent : t.input)
          .on_click((_e, cx) => view.copy(release, cx))
          .child("Copy message"),
      ),
    );
}

function taskView(view, lane, t) {
  const blocks = [header(view, lane, t), stepper(lane, t), nextCard(view, lane, t)];
  if (lane.pr) blocks.push(prBlock(lane, t), releaseBlock(view, lane, t), doneBlock(lane, t));
  else if (lane.evidence && (lane.evidence.error || !lane.evidence.ready || lane.steps[2] !== "next")) blocks.push(evidenceBlock(lane, t), releaseBlock(view, lane, t), doneBlock(lane, t), gatesBlock(lane, t));
  else blocks.push(doneBlock(lane, t), gatesBlock(lane, t), releaseBlock(view, lane, t));
  return blocks.filter(Boolean);
}

function laneCard(view, lane, current, t) {
  const tone = toneColor(lane.chip?.tone, t);
  return v_flex()
    .id(`lane-${lane.key}`)
    .gap(6)
    .p(10)
    .rounded(8)
    .bg(t.surface)
    .border_1()
    .border_color(current ? t.accent : t.border)
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => view.pick(lane, cx))
    .child(h_flex().gap(8).items_center().child(pill(lane.task.id ?? "TASK", t)).child(div().flex_1().text_size(11.5).text_color(t.unknown).child(lane.chip?.chip ?? "")))
    .child(div().truncate().text_color(t.foreground).child(lane.task.title))
    .child(h_flex().gap(2).children(lane.steps.map((state) => div().flex_1().h(4).bg(state === "todo" ? t.input : stateColor(state, t)))))
    .child(div().text_size(11.5).text_color(tone).child(lane.next?.label ?? ""));
}

function lanesView(view, lanes, current, t) {
  if (lanes.length === 0) return [div().text_size(12).text_color(t.unknown).child("No task in progress. A task is a worktree with a VJR-TASK.md.")];
  const groups = new Map();
  for (const lane of lanes) groups.set(lane.repo.name, [...(groups.get(lane.repo.name) ?? []), lane]);
  const out = [];
  for (const [name, list] of groups) {
    out.push(div().text_size(11).text_color(t.dim).child(name));
    for (const lane of list) out.push(laneCard(view, lane, lane.key === current?.key, t));
  }
  return out;
}

function tabButton(view, id, label, count, on, t) {
  return h_flex()
    .id(`tab-${id}`)
    .h(30)
    .px(10)
    .gap(4)
    .items_center()
    .text_size(12)
    .text_color(on ? t.foreground : t.unknown)
    .border_b(2)
    .border_color(on ? t.accent : t.chrome)
    .on_click((_e, cx) => view.switchTab(id, cx))
    .child(label)
    .when(count != null, (el) => el.child(div().text_color(t.dim).child(String(count))));
}

export function columnView(view, lanes, current, t) {
  const body = view.tab === "lanes" ? lanesView(view, lanes, current, t) : current ? taskView(view, current, t) : [div().text_size(12.5).text_color(t.muted).child("No task here"), ...lanesView(view, lanes, null, t)];
  return v_flex()
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .text_size(12.5)
    .text_color(t.foreground)
    .child(
      h_flex()
        .h(36)
        .flex_none()
        .px(8)
        .gap(2)
        .items_end()
        .border_b(1)
        .border_color(t.border)
        .child(tabButton(view, "task", "Task", null, view.tab === "task", t))
        .child(tabButton(view, "lanes", "Lanes", lanes.length, view.tab === "lanes", t)),
    )
    .child(v_flex().flex_1().min_h(0).p(14).gap(14).overflow_y_scrollbar().children(body))
    .when(Boolean(view.flashText), (el) => el.child(div().flex_none().px(14).py(8).border_t(1).border_color(t.border).text_size(11.5).text_color(t.done).child(view.flashText)));
}

export function shotView(view, lane, t) {
  const shots = lane?.release?.shots ?? [];
  const shot = shots[view.index];
  return v_flex()
    .id("shot")
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .when(Boolean(view.handle), (el) => el.track_focus(view.handle))
    .on_key_down((event, cx) => view.key(event.key, cx))
    .child(
      h_flex()
        .h(32)
        .flex_none()
        .px(10)
        .gap(10)
        .items_center()
        .border_b(1)
        .border_color(t.border)
        .text_size(12)
        .child(div().text_color(t.foreground).child(shot?.file ?? "No screenshot"))
        .child(div().flex_1().text_color(t.unknown).child(shots.length ? `${view.index + 1} of ${shots.length} · ← → to move · Esc to close` : ""))
        .child(div().id("close").text_color(t.unknown).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).on_click(() => view.key("escape")).child("✕")),
    )
    .child(h_flex().flex_1().min_h(0).items_center().justify_center().p(12).bg(t.background ?? t.chrome).when(Boolean(shot), (el) => el.child(image(shot.image).size_full())))
    .child(div().flex_none().px(12).py(10).border_t(1).border_color(t.border).text_size(12).child(shot?.caption ?? ""));
}
