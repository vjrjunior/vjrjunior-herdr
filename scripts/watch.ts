import { build } from "./build";
import { install } from "./install";

function rereadHerdrAppTheme(): void {
  if (!Bun.which("herdr-app")) {
    console.warn("herdr-app is not on PATH; an open window keeps the previous colors");
    return;
  }
  for (const name of ["graphite", "vjr"]) {
    const result = Bun.spawnSync(["herdr-app", "do", "app.theme", JSON.stringify({ name })]);
    if (!result.success) {
      const reason = `${result.stdout}${result.stderr}`.trim();
      console.warn(`herdr-app did not switch to ${name}: ${reason}`);
      return;
    }
  }
}

if (!build()) process.exitCode = 1;
else if (install().includes("herdr-app")) rereadHerdrAppTheme();
