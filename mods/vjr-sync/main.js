import { View, div } from "gpui-kit";
import { exec, notify, props, updates } from "herdr";

export default class VjrSync extends View {
  init(_props, cx) {
    const { built, repo, bun } = props();
    const version = updates().app.version;
    if (version === built) return;
    cx.spawn(async () => {
      const result = await exec(bun, ["scripts/layout.ts", "apply", "--herdr-version", version], { cwd: repo }).catch((error) => ({
        code: 1,
        stderr: String(error),
      }));
      if (result.code === 0) return;
      const reason = result.stderr.trim().split("\n")[0].replace(/^error: /, "");
      notify({
        title: `VJR layout stayed on ${built}`,
        body: `${reason}. Run bun run apply-layout in ${repo}.`,
        level: "warning",
        timeout: 15000,
      });
    });
  }

  render() {
    return div();
  }
}
