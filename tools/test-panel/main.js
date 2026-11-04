import { View, div } from "gpui-kit";
import { Input, InputState, h_flex, v_flex } from "gpui-base";
import { closeOverlay, exec, openOverlay, props, run, setShared, shared, spaces, terminals, theme } from "herdr";
import { RADIUS, TEXT, button, heading, stepNode } from "../../kit/kit.js";
import plan from "./run.js";
import { changes, same, snapshot, summary } from "./events.js";

const SELF = { name: "test-panel" };
const KEY = "test-panel";
const WIDTH = 380;
const AT = { x: 560, y: 64 };

const pad = (n) => String(n).padStart(2, "0");

function fresh() {
  return { run: plan.id, step: -1, results: [], log: [], seen: null, closed: false, reported: false };
}

export default class TestPanel extends View {
  init(_props, _cx) {
    this.note = InputState.new({ placeholder: "What did you see? (optional)" });
    const own = props() ?? {};
    this.handoff = Boolean(own.overlay) && !own.kept;
    if (this.handoff) {
      openOverlay({ mod: SELF.name, kind: "window", key: KEY, keep: true, width: WIDTH, at: AT, props: { kept: true } });
      closeOverlay(own.overlay);
    }
  }

  state() {
    const value = shared(KEY);
    return value?.run === plan.id ? value : fresh();
  }

  track(state, cx) {
    const values = Object.fromEntries((plan.watch ?? []).map((key) => [key, shared(key) ?? null]));
    const now = snapshot(spaces(), shared("layout"), values);
    if (state.seen && same(state.seen, now)) return;
    const at = Date.now();
    const lines = state.seen && state.step >= 0 ? changes(state.seen, now) : [];
    setShared(KEY, { ...state, seen: now, log: [...state.log, ...lines.map((text) => ({ at, step: state.step, text }))].slice(-300) });
    if (lines.some((text) => (plan.shotOn ?? []).some((key) => text.startsWith(`${key} = `)))) this.shot(`${pad(state.step + 1)}-event-${at}`, cx);
  }

  shot(name, cx) {
    if (!plan.shots) return null;
    const file = `${plan.shots}/${name}.png`;
    cx.spawn(async () => {
      try {
        await exec("herdr-app", ["shot", file]);
      } catch {}
    });
    return file;
  }

  go(state, step, cx) {
    const next = { ...state, step };
    setShared(KEY, next);
    for (const action of plan.steps[step]?.run ?? []) run(action.command, action.args ?? {});
    if (step >= plan.steps.length) this.report(next, cx);
    cx.notify();
  }

  start(cx) {
    this.go({ ...fresh(), seen: this.state().seen }, 0, cx);
  }

  answer(verdict, cx) {
    const state = this.state();
    const step = plan.steps[state.step];
    if (!step) return;
    const note = this.note.value().trim();
    this.note.set_value("");
    const shot = this.shot(`${pad(state.step + 1)}-${verdict}`, cx);
    const results = [...state.results.filter((item) => item.step !== state.step), { step: state.step, title: step.title, verdict, note, at: Date.now(), shot }];
    this.go({ ...state, results }, state.step + 1, cx);
  }

  back(cx) {
    const state = this.state();
    if (state.step <= 0) return;
    setShared(KEY, { ...state, step: state.step - 1 });
    cx.notify();
  }

  report(state, cx) {
    if (!plan.report || state.reported) return;
    setShared(KEY, { ...state, reported: true });
    const text = summary(plan.title, plan.steps, state.results);
    const idle = terminals().find((terminal) => terminal.address === plan.report)?.status === "idle";
    cx.spawn(async () => {
      try {
        await exec("hc", idle ? ["send", "--if", "idle", plan.report, text] : ["send", plan.report, text]);
      } catch {}
    });
  }

  finish(state) {
    setShared(KEY, { ...state, closed: true });
  }

  controls(children) {
    return v_flex().id("test-panel-controls").gap(8).on_mouse_down("left", (_e, cx) => cx.stop_propagation()).children(children);
  }

  intro(t) {
    return v_flex()
      .gap(10)
      .when(Boolean(plan.intro), (el) => el.child(div().text_color(t.muted).child(plan.intro)))
      .child(
        this.controls([
          h_flex()
            .child(div().flex_1())
            .child(button("test-start", { label: plan.steps.length ? "Start" : "No steps", variant: "solid", disabled: !plan.steps.length, onClick: (cx) => this.start(cx) }, t)),
        ]),
      );
  }

  stepView(step, state, t) {
    const events = state.log.filter((item) => item.step === state.step).slice(-4);
    return v_flex()
      .gap(10)
      .child(h_flex().gap(8).items_center().child(stepNode("current", t)).child(div().flex_1().min_w(0).text_size(TEXT.title).font_semibold().child(step.title)))
      .child(
        v_flex()
          .gap(4)
          .children(
            (step.do ?? []).map((text, index) =>
              h_flex()
                .gap(6)
                .items_start()
                .child(div().flex_none().w(16).text_color(t.dim).child(`${index + 1}.`))
                .child(div().flex_1().min_w(0).child(text)),
            ),
          ),
      )
      .when(Boolean(step.expect), (el) =>
        el.child(
          v_flex()
            .gap(2)
            .child(div().text_size(TEXT.xs).text_color(t.unknown).child("EXPECT"))
            .child(div().text_color(t.muted).child(step.expect)),
        ),
      )
      .child(
        this.controls([
          Input.new(this.note).h(30).px(8).rounded(RADIUS.control).border_1().border_color(t.input).bg(t.background).text_size(TEXT.base).text_color(t.foreground),
          h_flex()
            .gap(8)
            .items_center()
            .when(state.step > 0, (el) => el.child(button("test-back", { label: "Back", icon: "arrow-left", onClick: (cx) => this.back(cx) }, t)))
            .child(div().flex_1())
            .child(button("test-fail", { label: "Failed", icon: "x", color: t.blocked, onClick: (cx) => this.answer("failed", cx) }, t))
            .child(button("test-pass", { label: "Passed", icon: "check", variant: "solid", onClick: (cx) => this.answer("passed", cx) }, t)),
        ]),
      )
      .when(events.length > 0, (el) => el.child(v_flex().gap(2).children(events.map((item) => div().text_size(TEXT.sm).text_color(t.dim).truncate().child(item.text)))));
  }

  doneView(state, t) {
    return v_flex()
      .gap(8)
      .children(
        plan.steps.map((step, index) => {
          const result = state.results.find((item) => item.step === index);
          const node = result?.verdict === "passed" ? "done" : result?.verdict === "failed" ? "bad" : "later";
          return h_flex()
            .gap(8)
            .items_center()
            .child(stepNode(node, t))
            .child(div().flex_1().min_w(0).truncate().child(step.title));
        }),
      )
      .child(div().text_color(t.muted).child(plan.report ? "Claude has the results." : "Done."))
      .child(
        this.controls([
          h_flex()
            .child(div().flex_1())
            .child(button("test-close", { label: "Close", icon: "x", onClick: () => this.finish(state) }, t)),
        ]),
      );
  }

  render(cx) {
    if (this.handoff) return div();
    const state = this.state();
    if (state.closed || plan.closed) {
      const overlay = props()?.overlay;
      if (!this.closing && overlay) {
        this.closing = true;
        closeOverlay(overlay);
      }
      return div();
    }
    this.track(state, cx);
    const t = theme();
    const total = plan.steps.length;
    const step = plan.steps[state.step];
    const where = state.step < 0 ? `${total} steps` : step ? `step ${state.step + 1} of ${total}` : "done";
    return v_flex()
      .id("test-panel")
      .w_full()
      .p(14)
      .gap(10)
      .text_size(TEXT.base)
      .text_color(t.foreground)
      .child(heading(plan.title ?? "Test", t, where))
      .child(state.step < 0 ? this.intro(t) : step ? this.stepView(step, state, t) : this.doneView(state, t));
  }
}
