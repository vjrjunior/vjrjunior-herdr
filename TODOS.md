# TODOS

## Palette

### Detect drift between the Zed theme and the palette

**What:** Add a local-only `bun run check-zed` that compares the key colors in `~/.config/zed/themes/vjr.json` with `palette/vjr.toml`.

**Why:** Zed stays hand-edited in v1, so a palette change that never reaches Zed goes unnoticed.

**Context:** `palette/vjr.toml` was written from the Zed theme, and the two can drift apart with no warning. The Zed file lives outside the repo, so the check cannot run on a clean CI runner and should skip when the file is absent. Start from the role table in the design doc and compare the UI ladder plus the three accents. If Zed later becomes a generated target, drop this item.

**Effort:** S
**Priority:** P3
**Depends on:** `palette/vjr.toml` and `scripts/build.ts` existing

## Completed
