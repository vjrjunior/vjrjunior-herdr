# TODOS

## Layouts

### Confirm comeback after a real reboot

**What:** After the next restart of the Mac, open the window and confirm that each Claude Code that was running comes back on its conversation, that the toast lists them, and that `~/.claude/sessions/` matches the resumed sessions.

**Why:** The resume was tested by writing a note from another boot by hand. Only a real restart proves the boot check and the wait for recovered shells.

**Context:** Claudes running before `comeback` was installed have no note and won't come back. Check with `hc get <t> --json` that each running Claude has a `comeback` label before restarting.

**Effort:** S
**Priority:** P1
**Depends on:** The next restart

### The Command Center button in the tab bar on the kit

**What:** Draw the Command Center button in the tab bar with the kit's components.

**Why:** The button is drawn by hand inside the copy of Herdr's `tabs`.

**Context:** The kit only reaches this repo's mods. Copies of shipped mods would need the generator to inject it there, and `square` to treat `tabs` as an own mod.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### Command Center Inbox

**What:** An Inbox in the main checkout's view, under `Start a task`, with the open ClickUp tasks and a Start button that opens `/vjr-task CUP-xxxx` in a new tab of the main checkout.

**Why:** Starting a task still means typing its id.

**Context:** `~/.pp-stack/cache/clickup/my-open.json` stopped on Oct 9, so the Inbox needs a fresh ClickUp source first. The manual check buttons, the other half of phase 2, shipped.

**Effort:** M
**Priority:** P2
**Depends on:** A fresh ClickUp source

### A personal profile for the Command Center

**What:** A second profile for personal repos, with its own steps and skills, picked from the profile button next to Partner Programmer and Off.

**Why:** The Command Center follows the company flow (`/vjr-task`, `/vjr-ac`, `/pp-ship`, PR evidence); personal repos need a flow of their own.

**Context:** `PROFILES` in `mods/command-center/logic.js` holds only Partner Programmer, and the steps, notes and next-step rules are that flow's. A new profile needs its own versions of `stepsOf`, `stepNotes` and `nextStep`, chosen by the repo's profile.

**Effort:** M
**Priority:** P3
**Depends on:** Deciding the personal flow

### Draw Mermaid diagrams in the Markdown viewer

**What:** Draw ` ```mermaid ` blocks as diagrams in `mods/markdown/` instead of showing their source.

**Why:** Plans and specs use Mermaid for flows, and the pane shows them as code.

**Context:** `TextView.markdown` shows a ` ```mermaid ` block as code. Drawing it needs a renderer in the mod that turns the diagram into an SVG under `data/<copy>/`, the only place `image()` loads from, cached by the block's text.

**Effort:** M
**Priority:** P3
**Depends on:** The Markdown viewer

### Publish comeback on herdr.dev

**What:** Publish `mods/comeback/` as a community mod: a public repo or folder in Herdr's format with `mods/comeback/`, its `RECIPE.md` and a `preview.png`, and the `herdr-mod` topic.

**Why:** The other resume mods need hooks or only run on Linux; this one is just a folder.

**Context:** `RECIPE.md` is ready. Missing: `preview.png` (a window with a resumed conversation and the toast, no private data) and the package folder. The install step asks people to add a floating block to a cloned layout.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### Publish on herdr.dev

**What:** Add a command that writes one build into a package folder in Herdr's format, and publish it with the `herdr-layout` topic.

**Why:** The repo follows the community's conventions, but its mods are generated on the machine, so it can't be installed with `cp`.

**Context:** The build must drop the local `repo` and `bun` props of `vjr-sync`. Herdr's code is Apache-2.0, so a package with copies of it needs a `NOTICE`. `preview.png` needs a window with no private data, like the isolated demo in `shellscape/herdr-whitby`.

**Effort:** M
**Priority:** P3
**Depends on:** Nothing

### A toast for a move cut off by a layout switch or restart

**What:** When a layout switch or an app restart cancels a Move tab in the middle, show a toast that gives the Claude's resume command.

**Why:** The worker's task is cancelled with the move, and the session id is lost with it, so a Claude that already ended gets no notice and no way back besides `/resume`.

**Context:** `mods/move-tab/move.js` keeps the ended Claudes in `run.ended`, in memory only. Writing each one to shared state or a terminal label before ending it would let the next copy of the worker find it and post the toast.

**Effort:** S
**Priority:** P2
**Depends on:** Nothing

### Scroll the selected row into view in the Move to popup

**What:** Make the arrow keys in the `Move to…` popup scroll the selected row into view when the list is longer than the popup.

**Why:** The selection moves past the bottom edge and the person can't see which row Enter will pick.

**Context:** `mods/move-tab/main.js` keeps the selection in `this.at` and draws the rows in an `overflow_y_scrollbar()` list. `~/.config/herdr-app/gpui-kit.d.ts` shows what a scroll handle offers.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### Check that a moved Claude runs before saying it moved

**What:** After a move builds the new tab, wait a moment for `terminals()` to show a live terminal whose argv or foreground argv holds `--resume <id>`, and only then post the success toast. When it doesn't show up, post an error toast with the resume command and a click action that resumes it, as a failed move does.

**Why:** The success toast is posted as soon as `herdr-app do` returns. If the resumed Claude then fails to start (a bad option, a missing `claude`), the old tab is already closed, the toast said it moved, and nothing on screen holds the session id: only Claude's `/resume` in the old folder finds the conversation.

**Context:** `mods/move-tab/move.js` posts the notice at the end of `move`. `runsSession` in `mods/move-tab/logic.js` already tells whether a terminal resumes a session, and `resumed` in `move.js` uses it when a launch throws. The wait should be short and bounded, like `PANE_WAIT`, and use `io.sleep` so the fake clock tests it.

**Effort:** S
**Priority:** P2
**Depends on:** Nothing

### Clean up the space a failed move opened

**What:** When a move opened a space with `space.new` and the build then fails, close that space (or say in the error toast that it was left behind).

**Why:** `space.new` runs only after every Claude has ended. A failure after it leaves a new space holding Herdr's first shell tab, which the person didn't ask for and has to close by hand.

**Context:** `mods/move-tab/move.js` keeps the new space in `into` and its first tab in `extra`, and closes `extra` only after the build. Closing the space in the failure path must not touch a space the move didn't open, nor one where a Claude was started or may have started (`run.started`, `run.unsure`), since closing it would end that Claude.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

### A kit row for popup lists

**What:** A row component in `kit/kit.js` (icon, label, optional detail, selected state), shown in the kit's gallery, and used by Move tab's popup and the Command Center's profile popup.

**Why:** AGENTS.md puts a component in the kit as soon as a second mod would draw the same thing. Both rows are an `h_flex` with an icon, a label, 8px side padding, an 8px gap, rounded corners and a `hover` background.

**Context:** `row` in `mods/move-tab/main.js` uses the kit's tokens (`CONTROL.large`, `RADIUS.control`, `TEXT.sm`) and marks the selected row with `selected`. `profileView` in `mods/command-center/column.js` (the row at line 437) uses fixed sizes (28px high, radius 4) and marks the chosen row with an `accent` check, so the component needs both kinds of selected state. Kept out of the move-tab branch so that branch stays on moving tabs.

**Effort:** S
**Priority:** P3
**Depends on:** Nothing

## Completed

### Confirm the first real Herdr update

**Completed:** 2026-11-02, Herdr 0.1.11 to 0.1.12. `vjr-sync` rebuilt both layouts by itself in 3.4 s (`0.1.12 applied 3420ms` in `layout.log`). `built` and all 21 copies moved to 0.1.12, `herdr-app status` showed no errors, and the open window showed the new copies, Spaces tree included, with no further restart. The update changed `agents`, `files`, `new-menu`, `picker`, `spaces`, `workspace-chrome` and `frame/settings`, and every recipe still fit.
