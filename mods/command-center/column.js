import { div, image } from "gpui-kit";
import { Input, TextView, h_flex, v_flex } from "gpui-base";
import { CONTROL, ICON_SIZE, button, card, chip, heading, icon, iconButton, line, link, pill, statusDot, stepNode, toneColor } from "../../kit/kit.js";
import { answerStep, laneSummary, PROFILES, profileOf, rollup, stepNotes, viewFor } from "./logic.js";

const STEPS = ["Task", "AC", "Ship", "Evidence", "PR", "Merge", "Clear"];
const FILES = ["ship.json", "screenshots.md", "message.txt", "meta.json"];
const CHECK_CHIP = { passed: ["check", "done"], failed: ["exclamation", "blocked"], asking: ["dot", "working"], pending: ["ring", "unknown"] };
const MARK_OF = { ok: "check", run: "dot", bad: "exclamation", idle: "ring" };
const OPTIONS = [...Object.entries(PROFILES).map(([id, profile]) => [id, profile.label]), ["off", "Off"]];

const stateColor = (state, t) => ({ done: t.done, ok: t.done, current: t.done, run: t.working, next: t.accent, bad: t.blocked, stale: t.blocked }[state] ?? t.unknown);
const merged = (lane) => lane.pr && !lane.pr.error && lane.pr.state === "MERGED";
const hasPr = (lane) => Boolean(lane.pr && !lane.pr.error && lane.pr.number);
const currentOf = (steps) => {
  const index = steps.findIndex((step) => step !== "done");
  return index < 0 ? 6 : index;
};

function topBar(view, left, repo, profiles, t) {
  const profile = repo ? profileOf(profiles, repo.main) : null;
  return h_flex()
    .h(34)
    .flex_none()
    .pl(12)
    .pr(10)
    .gap(8)
    .items_center()
    .border_b_1()
    .border_color(t.border)
    .child(h_flex().flex_1().min_w(0).gap(6).items_center().text_size(11.5).text_color(t.muted).children(left))
    .when(Boolean(repo), (el) =>
      el.child(
        h_flex()
          .id("profile")
          .flex_none()
          .h(CONTROL.small)
          .px(8)
          .gap(5)
          .items_center()
          .rounded(5)
          .border_1()
          .border_color(t.input)
          .text_size(11)
          .text_color(t.foreground)
          .hover((s) => s.bg(t.hover))
          .on_click((_e, cx) => view.chooseProfile(repo, cx))
          .child(statusDot(profile === "off" ? t.dim : t.accent, { size: 6 }))
          .child(profile === "off" ? "Off" : PROFILES[profile].label)
          .child(icon("chevron-down", { size: ICON_SIZE.sm })),
      ),
    );
}

function identity(view, lane, t) {
  const task = lane.task;
  return v_flex()
    .gap(3)
    .child(h_flex().gap(8).items_center().child(pill(task.id ?? "TASK", t)).child(div().text_size(11).text_color(t.unknown).child(task.kind ?? "task")))
    .child(div().pt(3).text_size(13.5).font_semibold().text_color(t.foreground).child(task.title))
    .child(div().text_size(11).text_color(t.unknown).truncate().child(`${lane.branch ?? "detached"} → ${task.base}`))
    .child(
      h_flex()
        .pt(8)
        .gap(6)
        .flex_wrap()
        .when(Boolean(task.url), (el) => el.child(button("link-task", { label: "ClickUp", icon: "clickup", iconColor: t.muted, onClick: () => view.open(task.url) }, t)))
        .when(hasPr(lane), (el) => el.child(button("link-pr", { label: `PR #${lane.pr.number}`, icon: "github", iconColor: t.muted, onClick: () => view.open(lane.pr.url) }, t)))
        .child(button("link-file", { label: "VJR-TASK.md", icon: "eye", iconColor: t.muted, onClick: () => view.readTaskFile(lane) }, t))
        .child(button("link-zed", { label: "Zed", icon: "zed", iconColor: t.muted, onClick: () => view.zed(lane.path) }, t)),
    )
    .when(Boolean(lane.sessionShared), (el) => el.child(div().pt(4).text_size(11).text_color(t.working).child("Two tasks name this session; neither follows it")));
}

function nextAction(view, lane, t) {
  const next = lane.next ?? {};
  const offerTab = Boolean(next.text) && (next.kind === "send" || next.kind === "wait");
  return v_flex()
    .gap(6)
    .child(button("next", { label: next.label ?? "", variant: "solid", full: true, height: CONTROL.large, disabled: next.disabled, onClick: (cx) => view.act(lane, cx) }, t))
    .child(
      h_flex()
        .gap(8)
        .text_size(11)
        .text_color(t.unknown)
        .child(div().flex_1().min_w(0).child(`→ ${next.target ?? ""}`))
        .when(offerTab, (el) => el.child(link("new-tab", { label: "New tab instead", onClick: (cx) => view.newTab(lane, cx) }, t))),
    )
    .when(Boolean(lane.note), (el) => el.child(div().text_size(11).text_color(t.working).child(lane.note)));
}

function checkRow(view, lane, check, t) {
  const asking = check.state === "asking";
  const sent = view.sent?.[`${lane.key}:${check.id}`] === check.state;
  const failing = view.failing?.lane === lane.key && view.failing?.id === check.id;
  const refused = asking && !sent ? answerStep(lane, check.id, "passed").refused : null;
  const [stateMark, stateTone] = CHECK_CHIP[check.state] ?? CHECK_CHIP.pending;
  return v_flex()
    .gap(4)
    .p(8)
    .rounded(5)
    .when(asking, (el) => el.bg(t.selection ?? t.raised).border_1().border_color(t.accent))
    .child(
      h_flex()
        .items_start()
        .gap(8)
        .child(div().flex_none().w(28).text_size(11).text_color(t.unknown).child(check.id))
        .child(div().flex_1().min_w(0).text_size(11.5).text_color(t.foreground).child(check.steps))
        .child(sent ? chip("Sent", { color: t.working }, t) : chip(check.state, { mark: stateMark, color: t[stateTone] }, t)),
    )
    .child(div().pl(36).text_size(11).text_color(t.muted).child(`→ ${check.expected}`))
    .when(check.state === "failed" && Boolean(check.note), (el) => el.child(div().pl(36).text_size(11).text_color(t.blocked).child(`Saw: ${check.note}`)))
    .when(asking && (Boolean(check.url) || !sent), (el) =>
      el.child(
        h_flex()
          .pl(36)
          .pt(4)
          .gap(6)
          .items_center()
          .flex_wrap()
          .when(Boolean(check.url), (row) => row.child(link(`check-open-${check.id}`, { label: "Open", icon: "external-link", onClick: () => view.open(check.url) }, t)))
          .when(!sent && !refused && !failing, (row) =>
            row
              .child(button(`check-pass-${check.id}`, { label: "Passed", icon: "check", color: t.done, onClick: (cx) => view.answer(lane, check.id, "passed", null, cx) }, t))
              .child(button(`check-fail-${check.id}`, { label: "Failed…", icon: "x", color: t.blocked, onClick: (cx) => view.startFailure(lane, check.id, cx) }, t)),
          )
          .when(!sent && Boolean(refused), (row) => row.child(div().text_size(11).text_color(t.unknown).child(refused))),
      ),
    )
    .when(!asking && Boolean(check.url), (el) => el.child(div().pl(36).child(link(`check-open-${check.id}`, { label: "Open", icon: "external-link", onClick: () => view.open(check.url) }, t))))
    .when(failing, (el) =>
      el.child(
        v_flex()
          .id("check-note")
          .pl(36)
          .gap(4)
          .on_key_down((event, cx) => view.noteKey(event.key, cx))
          .child(Input.new(view.failInput))
          .child(div().text_size(10.5).text_color(t.dim).child("Enter sends · Esc cancels")),
      ),
    );
}

function skillClaude(lane) {
  return (lane.skill?.from === "session" ? lane.session : lane.claude) ?? {};
}

function checksBody(view, lane, t) {
  const checks = lane.task.manual ?? [];
  const claude = skillClaude(lane);
  const running = lane.skill?.family === "ac" && lane.skill.active;
  return v_flex()
    .gap(2)
    .child(
      h_flex()
        .pb(4)
        .gap(8)
        .items_center()
        .text_size(11.5)
        .child(div().flex_1().min_w(0).text_color(t.foreground).child(running ? `${lane.skill.skill} is asking you` : "Manual checks"))
        .when(Boolean(claude.terminal), (el) => el.child(link("go-claude", { label: `claude · ${claude.terminal}`, icon: "terminal", onClick: () => view.focusClaude(claude.terminal) }, t))),
    )
    .children(checks.map((check) => checkRow(view, lane, check, t)));
}

function prBody(lane, t) {
  const pr = lane.pr;
  if (!pr || pr.error) return div().text_size(11.5).text_color(t.unknown).child(pr?.error ?? "No PR yet");
  const checks = rollup(pr.statusCheckRollup);
  const body = v_flex().child(div().pb(4).text_size(11.5).text_color(t.foreground).child(`PR #${pr.number} · ${pr.isDraft ? "draft" : pr.state === "MERGED" ? "merged" : "ready for review"}`));
  if (lane.prError) body.child(div().pb(4).text_size(11).text_color(t.working).child(lane.prError));
  for (const item of checks.items) body.child(line(item.name, { detail: item.detail, color: stateColor(item.state, t), mark: MARK_OF[item.state] }, t));
  if (lane.preview?.link) body.child(line("Preview", { detail: lane.preview.state?.toLowerCase?.() ?? "ready", color: t.done, mark: "check" }, t));
  if (pr.reviewDecision) {
    const color = pr.reviewDecision === "CHANGES_REQUESTED" ? t.blocked : pr.reviewDecision === "APPROVED" ? t.done : t.working;
    body.child(line("Review", { detail: pr.reviewDecision.toLowerCase().replaceAll("_", " "), color }, t));
  }
  return body;
}

function doneBody(lane, t) {
  const rows = new Map((lane.task.verification?.rows ?? []).map((item) => [item.id, item]));
  const verification = lane.task.verification;
  const body = v_flex();
  for (const item of lane.task.done) {
    const verified = rows.get(item.id);
    body.child(line(`${item.id}  ${item.item}`, { detail: verified ? verified.verdict.toLowerCase() : "to verify", color: verified ? t.done : t.unknown, mark: verified ? "check" : "ring" }, t));
  }
  if (lane.task.done.length === 0) body.child(div().text_size(11.5).text_color(t.unknown).child("No done items in VJR-TASK.md"));
  if (verification?.gates) body.child(line(verification.gates, { detail: "gates", color: t.done, mark: "check" }, t));
  if (verification?.review) body.child(line(verification.review, { detail: "review", color: t.done, mark: "check" }, t));
  return body;
}

function evidenceBody(view, lane, t) {
  const evidence = lane.evidence;
  const body = v_flex();
  if (evidence?.error) body.child(div().text_size(11.5).text_color(t.unknown).child(evidence.error));
  else if (evidence) {
    for (const file of FILES) {
      const state = evidence.files?.[file] ?? "missing";
      body.child(line(file, { detail: state, color: stateColor(state, t), mark: state === "current" ? "check" : state === "stale" ? "exclamation" : "ring" }, t));
    }
  }
  const release = releaseCard(view, lane, t);
  return release ? body.child(div().pt(10).child(release)) : body;
}

function releaseCard(view, lane, t) {
  const release = lane.release;
  if (!release) return null;
  const done = merged(lane);
  const shots = done ? release.shots : release.shots.slice(0, 2);
  const pairs = [];
  for (let index = 0; index < shots.length; index += 2) pairs.push(shots.slice(index, index + 2).map((shot, offset) => [shot, index + offset]));
  const warn = done && release.links && release.links !== "production";
  return v_flex()
    .gap(8)
    .child(heading([release.release ? `Release ${release.release}` : "Release", release.channel ? `#${release.channel}` : null].filter(Boolean).join(" · "), t))
    .child(div().font_bold().text_color(t.foreground).child(release.title))
    .when(release.items.length > 0, (el) =>
      el.child(
        div()
          .pl(8)
          .border_l(2)
          .border_color(t.accent)
          .text_size(11.5)
          .text_color(t.muted)
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
                .child(image(shot.image).w_full().h(84).rounded(4))
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
          .rounded(5)
          .border_1()
          .border_color(t.working)
          .text_size(11)
          .text_color(t.working)
          .child(div().child(`Links still point to ${release.links}.`))
          .child(link("regenerate", { label: "Regenerate with production links", onClick: (cx) => view.regenerate(lane, cx) }, t)),
      ),
    )
    .when(Boolean(release.messagePath), (el) =>
      el.child(
        button("copy", { label: "Copy message", variant: done ? "solid" : "outline", full: true, height: CONTROL.row, onClick: (cx) => view.copy(release, cx) }, t),
      ),
    );
}

function stepBody(view, lane, index, now, t) {
  if (index === 0) return doneBody(lane, t);
  const asking = index === 1 && (lane.task.manual ?? []).some((check) => check.state === "asking") && lane.skill?.family === "ac" && lane.skill.active;
  const parts = [];
  if (index === 1 && (lane.task.manual ?? []).length) parts.push(checksBody(view, lane, t));
  if (index === 3) parts.push(evidenceBody(view, lane, t));
  if (index === 4) parts.push(prBody(lane, t));
  if (now && !asking) parts.push(nextAction(view, lane, t));
  return v_flex().gap(10).children(parts.filter(Boolean));
}

function stepRow(view, lane, index, current, notes, t) {
  const name = STEPS[index];
  const state = lane.steps[index] ?? "todo";
  const now = index === current;
  const done = state === "done";
  const expandable = done && (index === 0 || index === 3);
  const open = now || (expandable && view.isOpen(lane, name, current));
  const node = stepNode(done ? "done" : now && state === "bad" ? "bad" : now ? "current" : "todo", t);
  const label = div()
    .flex_none()
    .text_size(12.5)
    .text_color(now ? t.foreground : done ? t.muted : t.dim)
    .when(now, (el) => el.font_bold())
    .child(name);
  const note = div()
    .min_w(0)
    .truncate()
    .text_size(11)
    .text_color(now ? (state === "bad" ? t.blocked : t.accent) : done ? t.done : t.dim)
    .when(done && !now, (el) => el.opacity(0.75))
    .child(notes[index]);
  const head = h_flex()
    .id(`step-${name}`)
    .h(20)
    .gap(10)
    .items_center()
    .child(label)
    .when(expandable, (el) => el.child(icon(open ? "chevron-down" : "chevron-right", { size: ICON_SIZE.md, color: t.unknown })))
    .child(h_flex().flex_1().min_w(0).justify_end().child(note))
    .when(expandable, (el) => el.on_click((_e, cx) => view.toggle(lane, name, current, cx)));
  const rail = h_flex()
    .flex_1()
    .justify_center()
    .items_stretch()
    .when(index < STEPS.length - 1, (el) => el.child(div().w(1.5).bg(done ? t.done : t.border).when(done, (line) => line.opacity(0.35))));
  return h_flex()
    .items_stretch()
    .gap(10)
    .child(v_flex().flex_none().w(18).child(h_flex().h(20).items_center().justify_center().child(node)).child(rail))
    .child(
      v_flex()
        .flex_1()
        .min_w(0)
        .pb(open ? 14 : 12)
        .child(head)
        .when(open, (el) => el.child(div().pt(8).child(card(t).child(stepBody(view, lane, index, now, t))))),
    );
}

function taskView(view, lane, t) {
  const current = currentOf(lane.steps);
  const notes = stepNotes(lane, lane.steps);
  const rows = STEPS.map((_, index) => stepRow(view, lane, index, current, notes, t));
  const hint = current === 1 && (lane.task.manual ?? []).length > 0;
  return [
    identity(view, lane, t),
    v_flex().pt(4).children(rows),
    hint ? div().text_size(11).text_color(t.unknown).child("When every check is answered, /pp-ship opens in a new tab of this worktree.") : null,
  ].filter(Boolean);
}

function laneRow(view, lane, t) {
  const summary = laneSummary(lane);
  const tone = toneColor(summary.tone, t);
  const dots = STEPS.map((_, index) => {
    if (index < summary.stage) return statusDot(t.done, { size: 6 }).opacity(0.6);
    if (index === summary.stage) return statusDot(tone, { size: 6 });
    return statusDot(t.dim, { size: 6, hollow: true });
  });
  return h_flex()
    .gap(8)
    .px(4)
    .py(8)
    .items_center()
    .border_b_1()
    .border_color(t.border)
    .child(div().flex_none().w(3).h(32).rounded(2).bg(tone))
    .child(
      v_flex()
        .id(`lane-${lane.key}`)
        .flex_1()
        .min_w(0)
        .gap(3)
        .hover((s) => s.opacity(0.85))
        .on_click((_e, cx) => view.goTo(lane, cx))
        .child(h_flex().gap(6).text_size(11.5).child(div().flex_none().text_color(t.unknown).child(lane.task.id ?? "TASK")).child(div().flex_1().min_w(0).truncate().text_color(t.foreground).child(lane.task.title)))
        .child(
          h_flex()
            .gap(8)
            .items_center()
            .text_size(11)
            .child(h_flex().flex_none().gap(1).children(dots))
            .child(div().flex_none().text_color(tone).child(STEPS[summary.stage]))
            .child(div().flex_1().min_w(0).truncate().text_color(t.muted).child(summary.why ?? "")),
        ),
    )
    .when(Boolean(summary.action), (el) => el.child(button(`lane-act-${lane.key}`, { label: summary.action, color: t.muted, onClick: (cx) => view.laneAction(lane, summary.action, cx) }, t)));
}

function repoView(view, repo, lanes, t) {
  const start = button("start-task", { label: "Start a task", icon: "plus", variant: "dashed", full: true, height: CONTROL.large, hint: "/vjr-task in a new tab", onClick: (cx) => view.startTask(repo, cx) }, t);
  const list = lanes.length ? v_flex().children(lanes.map((lane) => laneRow(view, lane, t))) : div().text_size(11.5).text_color(t.unknown).child("No tasks in progress.");
  return [start, v_flex().gap(6).child(heading(`Tasks in ${repo.name}`, t, lanes.length)).child(list)];
}

function message(title, detail, t) {
  return v_flex()
    .pt(24)
    .gap(6)
    .items_center()
    .child(div().text_size(12.5).text_color(t.foreground).child(title))
    .when(Boolean(detail), (el) => el.child(div().text_size(11).text_color(t.unknown).child(detail)));
}

export function columnView(view, state, cwd, profiles, t) {
  const shown = viewFor(cwd, state, profiles);
  const repo = shown.repo ?? null;
  const name = (path) => path.split("/").pop();
  let left = [div().child("Command Center")];
  let body = [message("Not in a repository", "Focus a terminal in a repo or one of its worktrees.", t)];
  if (shown.kind === "task") {
    left = [div().font_semibold().text_color(t.foreground).child(repo.name), div().text_color(t.dim).child("/"), div().min_w(0).truncate().child(name(shown.lane.path))];
    body = taskView(view, shown.lane, t);
  } else if (shown.kind === "repo") {
    left = [div().font_semibold().text_color(t.foreground).child(repo.name), div().text_color(t.unknown).child("· main")];
    body = repoView(view, repo, shown.lanes, t);
  } else if (shown.kind === "bare") {
    left = [div().font_semibold().text_color(t.foreground).child(repo.name), div().text_color(t.dim).child("/"), div().min_w(0).truncate().child(name(cwd))];
    body = [message("No task in this worktree", "A task is a worktree with a VJR-TASK.md from /vjr-task.", t)];
  } else if (shown.kind === "off") {
    left = [div().font_semibold().text_color(t.foreground).child(repo.name)];
    body = [message(`Command Center is off in ${repo.name}`, "Nothing is read here until a profile is on.", t), h_flex().justify_center().child(button("profile-on", { label: `Use ${PROFILES.pp.label}`, color: t.muted, onClick: () => view.setProfile(repo.main, "pp") }, t))];
  }
  return v_flex()
    .size_full()
    .min_h(0)
    .bg(t.chrome)
    .text_size(12.5)
    .text_color(t.foreground)
    .child(topBar(view, left, repo, profiles, t))
    .child(v_flex().flex_1().min_h(0).p(12).gap(14).overflow_y_scrollbar().children(body))
    .when(Boolean(view.flashText), (el) => el.child(div().flex_none().px(12).py(8).border_t_1().border_color(t.border).text_size(11.5).text_color(t.done).child(view.flashText)));
}

export function profileView(view, profiles, t) {
  const chosen = profileOf(profiles, view.profileRepo);
  return v_flex()
    .size_full()
    .p(4)
    .gap(2)
    .bg(t.popover)
    .text_size(12)
    .child(div().px(8).py(4).text_size(10.5).text_color(t.unknown).child(`PROFILE · ${(view.profileName ?? "").toUpperCase()}`))
    .children(
      OPTIONS.map(([id, label]) =>
        h_flex()
          .id(`profile-${id}`)
          .h(28)
          .px(8)
          .gap(8)
          .items_center()
          .rounded(4)
          .hover((s) => s.bg(t.hover))
          .on_click(() => view.setProfile(view.profileRepo, id))
          .child(div().w(12).flex().items_center().when(id === chosen, (el) => el.child(icon("check", { color: t.accent }))))
          .child(div().text_color(t.foreground).child(label)),
      ),
    );
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
        .child(div().flex_1().text_color(t.unknown).child(shots.length ? `${view.index + 1} of ${shots.length} · arrow keys to move · Esc to close` : ""))
        .child(iconButton("close", { icon: "x", tooltip: "Close", bordered: false, size: CONTROL.small, stop: true, onClick: () => view.key("escape") }, t)),
    )
    .child(h_flex().flex_1().min_h(0).items_center().justify_center().p(12).bg(t.background ?? t.chrome).when(Boolean(shot), (el) => el.child(image(shot.image).size_full())))
    .child(div().flex_none().px(12).py(10).border_t(1).border_color(t.border).text_size(12).child(shot?.caption ?? ""));
}
