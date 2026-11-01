import { beforeEach, describe, expect, mock, test } from "bun:test";

type Result = { code: number; stderr: string };
type Notification = { title: string; body: string; level: string };

const app = { version: "", built: "", result: { code: 0, stderr: "" } as Result, rejects: "" };
const execCalls: unknown[][] = [];
const notifications: Notification[] = [];

mock.module("gpui-kit", () => ({ View: class {}, div: () => ({}) }));
mock.module("herdr", () => ({
  exec: async (...args: unknown[]) => {
    execCalls.push(args);
    if (app.rejects) throw new Error(app.rejects);
    return app.result;
  },
  notify: (notification: Notification) => notifications.push(notification),
  props: () => (app.built ? { built: app.built, repo: "/repo", bun: "/bin/bun" } : null),
  updates: () => ({ app: { version: app.version } }),
}));

const { default: VjrSync } = await import("../mods/vjr-sync/main.js");

async function start(settings: Partial<typeof app>): Promise<void> {
  Object.assign(app, { result: { code: 0, stderr: "" }, rejects: "" }, settings);
  let task: Promise<unknown> | undefined;
  const cx = {
    spawn(run: (cx: unknown) => Promise<unknown>) {
      task = run(cx);
    },
  };
  new VjrSync().init({}, cx);
  await task;
}

beforeEach(() => {
  execCalls.length = 0;
  notifications.length = 0;
});

describe("vjr-sync", () => {
  test("does nothing when the version matches", async () => {
    await start({ version: "0.1.10", built: "0.1.10" });

    expect(execCalls).toEqual([]);
    expect(notifications).toEqual([]);
  });

  test("does nothing without props, as in herdr-app check", async () => {
    await start({ version: "0.1.11", built: "" });

    expect(execCalls).toEqual([]);
    expect(notifications).toEqual([]);
  });

  test("runs apply with the app's own version", async () => {
    await start({ version: "0.1.11", built: "0.1.10" });

    expect(execCalls).toEqual([["/bin/bun", ["scripts/layout.ts", "apply", "--herdr-version", "0.1.11"], { cwd: "/repo" }]]);
  });

  test("stays silent on success", async () => {
    await start({ version: "0.1.11", built: "0.1.10" });

    expect(notifications).toEqual([]);
  });

  test("warns when apply fails", async () => {
    await start({ version: "0.1.11", built: "0.1.10", result: { code: 1, stderr: "error: recipe square: gone\n" } });

    expect(notifications).toHaveLength(1);
    expect(notifications[0]?.level).toBe("warning");
    expect(notifications[0]?.title).toContain("0.1.10");
    expect(notifications[0]?.body).toContain("recipe square: gone");
    expect(notifications[0]?.body).toContain("bun run apply-layout");
  });

  test("warns when bun or the repo cannot be reached", async () => {
    await start({ version: "0.1.11", built: "0.1.10", rejects: "cannot run bun" });

    expect(notifications[0]?.body).toContain("cannot run bun");
  });

  test("renders nothing", () => {
    expect(new VjrSync().render()).toEqual({});
  });
});
