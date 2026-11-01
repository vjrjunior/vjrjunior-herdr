# TODOS

## Palette

### Detect drift between the Zed theme and the palette

**What:** Add a local-only `bun run check-zed` that compares the key colors in `~/.config/zed/themes/vjr.json` with `palette/vjr.toml`.

**Why:** Zed stays hand-edited in v1, so a palette change that never reaches Zed goes unnoticed.

**Context:** `palette/vjr.toml` was written from the Zed theme, and the two can drift apart with no warning. The Zed file lives outside the repo, so the check cannot run on a clean CI runner and should skip when the file is absent. Start from the role table in the design doc and compare the UI ladder plus the three accents. If Zed later becomes a generated target, drop this item.

**Effort:** S
**Priority:** P3
**Depends on:** `palette/vjr.toml` and `scripts/build.ts` existing

## Layouts

### Confirm the first real Herdr update

**What:** After the next Herdr update, confirm that `built` in `layouts/vjr-desk-square.json` follows the new version, `herdr-app status` shows no errors and `~/.local/state/vjr-herdr/layout.log` records the run.

**Why:** The update flow was tested by simulating an old version. Only a real update proves the whole path.

**Context:** The recipes' strings survived the real 0.1.10 to 0.1.11 update, but `vjr-sync` did not exist yet.

**Effort:** S
**Priority:** P1
**Depends on:** The next Herdr release

### Publish on herdr.dev

**What:** Add a command that writes one build into a package folder in Herdr's format, and publish it with the `herdr-layout` topic.

**Why:** The repo follows the community's conventions, but its mods are generated on the machine, so it can't be installed with `cp`.

**Context:** The build must drop the local `repo` and `bun` props of `vjr-sync`. Herdr's code is Apache-2.0, so a package with copies of it needs a `NOTICE`. `preview.png` needs a window with no private data, like the isolated demo in `shellscape/herdr-whitby`.

**Effort:** M
**Priority:** P3
**Depends on:** Nothing

## Completed
