# Move tab

A tab belongs to the space it was opened in. When work starts in one checkout of a repo and continues in another (a worktree, say), Move tab sends the tab there with its Claude Code conversation resumed. Right-click a tab, pick `Move to…`, pick a checkout, and a moment later the same conversation runs in that checkout's folder, in its space, with the old space left behind. Nothing to install besides this folder: no hooks, no shell startup edits.

## What you see

- **Menu item:** a `Move to…` row with the `git-branch` icon in the tab's right-click menu, just above `Close`. It is part of a copy of Herdr's `menu`, since the shipped one is read-only.
- **Popup:** opens next to the menu, 300 x 320 px, `popover` background, 5px padding, 2px between rows.
  - A `Move to` heading (the kit's `heading`).
  - One row per target, in a scrollable list: 8px side padding, 8px gap, radius `RADIUS.control`, minimum height `CONTROL.large`. Each row has a `git-branch` icon in `muted`, the label in `foreground` and, when it differs from the label, a second line at the kit's small size in `muted`.
  - The first row is on `selected`; a hovered row is on `hover`. The arrow keys move the selection (wrapping at both ends), Enter picks, Escape closes.
  - While it reads the checkouts it says `Looking for checkouts…`. With nothing to pick it says `No other checkout of this repo.`
- **Targets,** in this order:
  1. the main checkout: its space if it has one, else a row named after its folder;
  2. spaces open in a worktree, labelled with the space's name and detailed `<branch> · open`;
  3. worktrees with no space yet, by branch name, detailed with the branch.
  Every space open in the tab's repo is a row, extra spaces in the same checkout included, except the tab's own space. A main checkout's rows are detailed `main checkout`.
- **After the move:** a toast, `Moved the tab`, body `<tab name or "The tab"> is now in <branch or folder name>.`, plus ` Anything Claude ran in the background ended with it.` when a Claude was ended; level success, 4 s. The target space and the moved tab are selected. In the old space the tab is gone, and when it was the space's only tab the space has a new tab with a shell in its checkout's root, so the space keeps its name and color.
- **When it can't:** a warning toast, `Can't move this tab`, with the reason (see Watch out), and nothing changes.
- The worker, a floating block, draws an empty `div()`.

## How it behaves

- **Asking.** The popup writes a request to shared state under `move-tab.request`: `{ id, tab, space, to, toSpace, at }` (`to` is the target checkout's path, `toSpace` the target space or `null`). It closes at once. The worker copy sees the request, clears it, drops it when it is older than 10 s, and runs the move. Only one move runs at a time; a second request gets the warning `Another move is running.`
- **What moves, per pane of the tab:**
  - **Claude Code:** its process is ended with `kill -TERM`, then it is resumed in the matching folder with `claude --resume <session id>`, the options it started with and, when the checkout changes, `--append-system-prompt` with a note: `This session moved from <old> (branch <name>) to <new> (branch <name>). Work in <new> from now on; files under <old> belong to another checkout.` (`detached HEAD` stands for a missing branch.) Claude is told its folder changed, and the conversation takes no extra turn.
  - **A shell with nothing running:** a new shell in the matching folder.
  - **A mod pane:** the same mod with the same props, in the new tab.
- **Matching folder.** The terminal's folder relative to its checkout's root, applied to the target's root (`main/src/app` becomes `worktree/src/app`). When that folder doesn't exist in the target (`test -d`), the target's root.
- **Which conversation.** The Claude's foreground pid names `~/.claude/sessions/<pid>.json`, which holds the live `sessionId` (it follows `/clear` and `/resume`). The options kept are `--dangerously-skip-permissions`, `--permission-mode <v>`, `--model <v>`, `--add-dir <dir…>`, `--verbose`, `--agent <v>`, `--effort <v>`, `--settings <v>`, `--mcp-config <v…>`, `--strict-mcp-config` and `--plugin-dir <v>`, also as `--opt=value`. Any other option is dropped, and so is one whose value holds a single quote, a backslash or a control character. A session id is used only when it is letters, digits and dashes.
- **Order.**
  1. Every pane is read before anything is touched: the tab's tree from Herdr's document, then each terminal with `hc get <t> --json`. Any refusal stops here.
  2. The checkouts come from `git worktree list --porcelain` in the tab's folder. The target and the source must both be among them.
  3. Each Claude is read once more (same pid, same session), signalled, and polled with `ps -p` every 250 ms until its process is gone, up to 10 s. The shell stays, since the Claude was its child.
  4. The target space is the requested one, else any open space of the target checkout, else a new one with `space.new {folder}` (its first tab is closed later).
  5. The new tab is made with `tab.new {space, folder, argv?, name?}` (or `mod`, `props` for a mod pane), named only when the old one had a name. The other panes follow the old tab's splits: `pane.focus` on the pane to split, then `terminal.open {place, folder, argv?}`, or `pane.split {direction, pane, mod, props}` for a mod pane.
  6. If the old tab was its space's only tab, `tab.new {space, folder}` gives the space a shell tab in its checkout's root. Then `tab.close {id, confirmed: true}` closes the old tab, and `space.select` and `tab.select` show the new one.
- **If something fails.** Before any Claude ended, the move is refused or fails and nothing changed. After one ended, a `Couldn't move the tab` error toast says why and gives `cd <folder> && claude --resume <id> <options>` for each Claude that wasn't started again. Its click action opens a new tab in the old space that resumes the first of them. After the new tab exists, a failure to close the old one gives a warning, `Moved the tab`, `<name> is now in <target>, but <reason>.`

## Built from

- `mod.json`: `{ "place": "none", "title": "Move tab" }`.
- **The recipe** (`recipes/move-tab.ts`), in both layouts:
  - copies `mods/move-tab/` and Herdr's `menu`;
  - adds to the menu's `tab` case `["Move to…", "move-tab", { tab: tg.id, space: tg.space }]` before `Close`;
  - makes choosing it run `openOverlay({ mod: "move-tab", kind: "popup", width: 300, height: 320, props: it[2] })`, and gives it the `git-branch` icon;
  - adds a floating block to the root, `{ "id": "move-tab", "content": { "mod": "move-tab", "props": { "role": "worker" } }, "edge": "left", "align": "end" }`.
- **Installed names:** `vjr-move-tab` and `vjr-menu` in `vjr-desk`; `vjr-square-move-tab` and `vjr-square-menu` in `vjr-desk-square`. The square copy is also listed in `recipes/square.ts` in `mods` and `OWN_MODS`, so its corners are squared and its popup is frameless with a 1px border.
- `logic.js`: pure functions, no imports. `REASONS`, `parseWorktrees`, `checkoutOf`, `matchingFolder`, `parseSession`, `isShell`, `quote`, `keepArgs`, `resumeCommand`, `atShell`, `isClaude`, `movedNote`, `resumeArgv`, `tabTree`, `leaves`, `splitSteps`, `placeOf`, `targetsFor`.
- `move.js`: `moveTab(request, io)`, the order above, with every effect behind `io` so it is tested with a fake.
- `io.js`: the real `io`. Programs: `git worktree list --porcelain`, `hc get <t> --json`, `sh -c 'printf "%s\n" "$1" | hc connect'` with `doc.get {name: "herdr-app"}` (the `sh` is only there to pipe into `hc connect`, which has no `doc` command), `test -d`, `ps -p`, `kill -TERM`, and `herdr-app do <command> '<json>'` for every change, so each command reports what it made or its error. It reads `~/.claude/sessions/<pid>.json` with `readTextFile`.
- `main.js`: the View. Role `worker` (from `props.role`) takes requests; any other role is the popup. `herdr`: `spaces`, `panes`, `terminals`, `shared`, `setShared`, `props`, `notify`, `closeOverlay`, `exec`, `home`, `readTextFile`, `theme`. The kit: `heading`, `icon`, `CONTROL`, `RADIUS`, `TEXT`.
- It never writes Herdr's document (`doc.set`), never reaches the network, and runs no program besides those above and the resumed `claude`.

## Watch out

- **Refusals.** Nothing changes and a warning toast, `Can't move this tab`, says one of these (`where` is `this tab`, or `pane 2` in a split tab):
  - `Claude is working in <where>. Move it when the turn ends.`
  - `Claude is waiting for you in <where>.`
  - `<Program> is running in <where>.` for anything but Claude, an idle shell or a mod: a dev server, `nvim`, another agent, a shell with a program in front. The program is the name Herdr shows for the pane.
  - `Claude has sub-agents running in <where>.` (live terminals whose `parent` is that Claude).
  - `Couldn't find Claude's conversation in <where>.` (no `~/.claude/sessions/<pid>.json`, or the id isn't safe to type, or the Claude changed since the check).
  - `Tabs on other machines can't move yet.`
  - `This tab isn't in a git repo.` (also when the repo has no other checkout: the popup then says `No other checkout of this repo.`)
  - `That checkout is gone.`
  - `The tab is already there.`
  - `The tab is gone.`
  - `Another move is running.`
- **Claude's background processes end with it** (shells it started in the background, its MCP servers), as when Claude exits on its own. They can't be told from the MCP servers, so they don't block a move. The success toast says so.
- **The toast shows one line.** A failure notice puts the resume command in its body, which gets cut, so its click action resumes the conversation in a new tab of the old space. That tab is the way back; the command in the body is for copying.
- **A move cut off** by a layout switch or an app restart is not run again and gives no toast: the worker's task is cancelled and the session id goes with it. If Claude had ended, the old tab shows a shell where it was, and Claude's own `/resume` in the old folder lists the conversation.
- **Splits keep their shape, not their sizes.** The row and column tree is reproduced from Herdr's document; every split is made at Herdr's default size.
- **An original `--append-system-prompt` is not kept.** It is not in the options list, so a resumed Claude gets only the moved note (or none, when the checkout doesn't change).
- **A move between two spaces of one checkout** ends the Claude and resumes it in the same folder with no note, since nothing changed for it.
- **Claude may ask to trust a folder it hasn't seen.** The resumed Claude stops at that prompt in the new tab. Answer it there.
- **A Claude that is its terminal's own process** (Herdr started it as the terminal's command, with no shell behind it) takes its pane with it when it ends. The new tab holds the resumed one, and the old tab is closed anyway.
- **The transcript stays under the first folder's project** in `~/.claude/projects/`. `claude --resume <id>` works from any folder, but the worktree's own `/resume` picker may not list the conversation.
- **Two Claudes never share a conversation.** The new one starts only after the old process is gone from `ps`. If it doesn't exit in 10 s, nothing moves, and the toast says `Claude in <where> didn't exit, so nothing moved.`
- Local spaces only. A tab can't be dragged onto a space yet; the right-click menu is the only way.
- Herdr's `run()` returns nothing inside a mod, which is why every change goes through `herdr-app do`.
- `pane.split` takes no folder, so a split terminal is made with `terminal.open {place, folder}` after focusing the pane to split.

## Done when

- `herdr-app check` passes on the mod folder, and `bun test` passes.
- Right-clicking a tab shows `Move to…` just above `Close`, and picking it opens the popup with the tab's repo's other checkouts and no row for the tab's own space.
- A Claude tab in the main checkout, moved to a worktree, shows up in that worktree's space with the same name. Asking Claude `pwd` answers the worktree, and the conversation continues.
- The main checkout's space no longer has the tab. When it was the only one, the space has a tab with a shell at the checkout's root.
- A tab with `python3 -m http.server 8765` running refuses with `Python is running in this tab.` (the name Herdr shows for the program), and nothing changes.
- A Claude that is working refuses with `Claude is working in this tab. Move it when the turn ends.`
- The same holds in `vjr-desk-square`, with the popup square and frameless.
