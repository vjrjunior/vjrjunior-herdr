# vjrjunior-herdr

My customizations for [Herdr](https://herdr.dev): the VJR theme, a dark palette of three hues (peach, mint and red) over a gray ladder, generated from one file for herdr-app and Ghostty, and two herdr-app layouts built on it.

## Use the theme

Copy one file and pick the theme:

```sh
cp themes/vjr.json ~/.config/herdr-app/themes/
```

Then open **Settings → Look → Dark** and choose `vjr`, or run:

```sh
herdr-app do app.theme '{"name":"vjr"}'
```

Herdr's own command palette will not show it: its `Theme:` list holds only the four built-in themes. The layouts below add it. The choice applies to the layout on screen, and each layout keeps its own.

For Ghostty, copy `targets/ghostty/VJR` to `~/.config/ghostty/themes/` and set `theme = VJR`.

## Work on the palette

You need [Bun](https://bun.sh). There are no dependencies, so there is nothing to `bun install`.

`palette/vjr.toml` is the only source. `themes/vjr.json` and `targets/ghostty/VJR` are generated, and committed so that people can use them without running anything.

| Command | What it does |
|---|---|
| `bun run build` | Validates the palette and regenerates both themes. Writes only inside this repo. |
| `bun run install-theme` | Copies both themes into the apps. |
| `bun run uninstall-theme` | Puts back what was there before. |
| `bun run watch` | Builds and installs on every palette save, then refreshes herdr-app. |
| `bun test` | Runs the tests. |

The scripts are not called `install` and `uninstall` because a package script named `install` also runs on every `bun install`.

`selection` and `search` are computed from `peach.base`, so changing the accent moves them too.

### What install does

- Copies each theme atomically: a complete temp file next to `themes/`, then a rename, so an app never reads a partial theme.
- Keeps any file it did not create in `~/.local/state/vjr-herdr/backups/`, recorded in `~/.local/state/vjr-herdr/install.json`, before replacing it. It refuses to overwrite a backup.
- Skips an app whose config folder does not exist, with a warning.
- Does nothing when the content is already installed, and never changes which theme is selected.

`uninstall-theme` restores each backup and removes what install created. A target you changed after installing stays as it is, with a warning. It leaves the herdr-app selection alone, so if `vjr` was selected, pick another theme in Settings.

### What watch does

herdr-app does not watch `themes/`: it reads a theme file only when you switch to it. So after installing a change, `watch` switches to `graphite` and back to `vjr`, which also selects `vjr` in the layout on screen. If the app is closed or `herdr-app` is not on your PATH, it warns and keeps watching.

A palette that does not validate installs nothing, and the last good theme stays in place. Ghostty picks up changes when you reload its config.

### Paths

| Variable | Default | Used for |
|---|---|---|
| `HERDR_APP_HOME` | `~/.config/herdr-app` | herdr-app's folder, and which running window `herdr-app` talks to |
| `XDG_CONFIG_HOME` | `~/.config` | Ghostty's folder |
| `XDG_STATE_HOME` | `~/.local/state` | backups, the install records and the layout log |

## Use the layouts

Two layouts for herdr-app, built from the version you have installed:

| Layout | What it is |
|---|---|
| `vjr-desk` | Herdr's window with the VJR theme, `vjr` in the command palette, a **Graph** button that opens Git Graph in the side panel, and Spaces as a tree of each repository's worktrees, open or closed, drawn as a graph or as blocks. |
| `vjr-desk-square` | The same window with every corner a layout can reach squared, including menus, popups, the command palette, Settings, Git Graph and the Spaces tree. |

```sh
bun run install-theme
bun run apply-layout
herdr-app do layout.switch '{"name":"vjr-desk-square"}'
```

Switch between layouts with `cmd-shift-l`, or with `Layout:` in the command palette. `bun run uninstall-layout` removes everything `apply-layout` created and goes back to `main` if needed. It leaves the theme installed.

These stay rounded, because the app draws them or opens them by itself: renaming, close confirmations, notifications, peek, Welcome, What's new, the feedback window, Add machine's terminal dialog, the spinner and the window's outer corners.

### How they stay current

[`RECIPE.md`](RECIPE.md) describes the layouts. The layouts follow Herdr's format: `themes/`, `mods/` and `layouts/` mirror the app's folder. The difference is that the mods are not stored here, so this repo is not ready for a plain `cp`. Community layouts ship a copy of Herdr's mods from one version, and those stop receiving Herdr's fixes. Here `recipes/` holds small edits, and `bun run apply-layout` applies them to the files of the Herdr you have installed.

When Herdr updates, the invisible `vjr-sync` mod notices the new version and runs the same command, so the copies rebuild themselves within seconds. It only runs while one of these layouts is on screen.

If a recipe no longer fits the new version, nothing changes in either layout: the previous copies keep running and a warning says what to run. The shipped `main` layout is never touched, so `cmd-shift-l` always has somewhere to go.

- The folders in `~/.config/herdr-app/mods/vjr-*` are generated. To change one, edit `recipes/` and run `bun run apply-layout`.
- Run it again after changing the shortcut for the palette, Settings, help or search in the `global` section of `keys.json`.
- The layouts store this repo's path. If you move it, run `bun run apply-layout` from the new place.
- `~/.local/state/vjr-herdr/layout.log` records every run.

### Git Graph

`mods/git-graph/` is [herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph) by Rabeeh T A (MIT), unmodified, at commit `1cfcff3`. `apply-layout` installs it, and leaves an identical copy you already have alone.

It runs `git` in the focused repository and reads the folders open in other panes ahead of time, also on other machines. It reaches the network only through git, on Fetch, Push and when deleting a remote branch.

It is third-party code that runs with your permissions, so it never updates by itself. To move to a new version, read the new code, replace `mods/git-graph/` and run `bun run apply-layout`.

### Comeback

When the Mac restarts, Herdr brings every terminal back as a bare shell. `mods/comeback/` notes which Claude Code conversation runs in each terminal and, when the window opens after a restart, types `claude --resume` back into each terminal that lost its Claude, with the same safe options, then shows a toast with what came back. It needs no hooks and edits no files outside Herdr's: it reads `hc`, `ps`, `sysctl` and `~/.claude/sessions/`, and keeps its notes as a `comeback` label on each terminal.

Each loss gets one automatic try. `herdr-app do vjr-square-comeback.resume` (or `vjr-comeback.resume` in `vjr-desk`) tries again. [`mods/comeback/RECIPE.md`](mods/comeback/RECIPE.md) describes it in full and is ready for herdr.dev.

### Command Center

The `Command Center` button, right after `+` in the top bar, opens a column for the checkout of the focused terminal. Like the side panel, each space remembers whether its column was open.

- **In a task's worktree** (a worktree other than the main checkout, with a `VJR-TASK.md` from `/vjr-task`), the column shows the task and its track as a timeline: Task, AC, Ship, Evidence, PR, Merge, Clear. Each step says what happened or what comes next. The current step opens with what it needs: the manual checks while `/vjr-ac` asks them, the PR's checks, preview and review, or the next step's button. Task and Evidence open with a click, on the done items and on the receipts with the release card (the screenshots and `Copy message`); Evidence opens by itself once the PR merges. The task's links (ClickUp, the PR, `VJR-TASK.md`, Zed) are outline buttons with a gray icon and the name. The timeline's nodes are drawn icons: done is filled with a check, the current step is a ring with a dot (an exclamation when it went wrong), later steps are empty rings, and Task and Evidence have a chevron that turns when they are open. Check states are chips with an icon. `VJR-TASK.md` opens in the Markdown viewer next to the terminal.
- **In the main checkout,** it lists the repo's tasks, each with its step, why it waits and what to do, and `Start a task` opens `/vjr-task` in a new tab.
- **Profiles:** the button in the header picks the repo's flow. `Partner Programmer` is every repo's default, and `Off` stops the panel from reading that repo at all.

The number on the button counts the tasks that wait on you, red when one failed. Each worktree with a lane gets a second line in the Spaces tree under its name: the step (`Task`, `AC 3/5`, `AC done`, `Ship`, `PR open`, `PR failed`, `Ready`, `Merged`...) in the lane's color, red when it waits on you, then `· <why>`.

While `/vjr-ac` asks its manual checks, the AC step shows them as cards, read from the `## Manual checks` table it writes to `VJR-TASK.md`: the check being asked has `Passed` and `Failed…` (type what you saw, Enter sends, Esc cancels), which answer in the Claude running `/vjr-ac`.

The next step is one click:
- `/vjr-ac` goes to the Claude session that ran `/vjr-task`, named by the `**Session:**` line `/vjr-task` writes to `VJR-TASK.md`, even when it runs in the main checkout. Without that line it goes to the worktree's Claude, else to a new tab.
- `/pp-ship` opens in a new tab of the worktree, named `ship · <id>`, with the base and the scope it needs.
- The push for a task based on another branch, `/pp-pr-ready` and the release message go to the worktree's Claude.
- `/pp-clear` always runs in a new tab of the main checkout.

It never types into another worktree, into a working Claude, into one waiting on a prompt, or into a session whose skill is still running. A send to an idle Claude uses `hc send --if idle`, so it fails rather than typing into a Claude that just started working. It never merges, pushes, posts to Slack or changes ClickUp.

`mods/command-center/` reads `VJR-TASK.md`, `git`, `gh`, the pp-stack scripts in `~/.claude/skills/pp-stack/bin/`, `~/.pp-stack/session/` and `~/.claude/sessions/`, where each Claude's current conversation tells which one is the task's session. It asks GitHub at most once a minute per open PR, and alerts only when a PR becomes ready, needs attention or merges. It writes nothing but copies of the screenshots under `data/<copy>/shots/`, removed when the task is gone, and the repos switched off, in `command-center.profiles` in shared state. Clicking an alert runs `vjr-command-center.show` (`vjr-square-command-center.show` in the square layout), which selects the task's space and opens the column.

### Markdown viewer

`mods/markdown/` shows one Markdown file in a pane. Another mod opens it with `pane.split` and `props: { file }`, and so can you:

```sh
herdr-app do pane.split --direction right --mod vjr-markdown --props '{"file":"/path/to/VJR-TASK.md"}'
```

In the square layout the mod is `vjr-square-markdown`. The pane reads the file again when it changes and hides front matter. A link to another `.md` opens in the same pane, with `Back` (an outline button with an arrow) to return; web links open in the browser and other files in their own app. The header's right side has two buttons: Zed, an outline button with a gray Zed icon and the name, opens the file in Zed, and Reload, an icon button with a tooltip, reads it again. It reads only the file it shows and the files it links to, runs `open` and `zed`, and never reaches the network.

### Move tab

Right-click a tab and pick `Move to…`, press `cmd-shift-m` for the focused tab, or drag the tab onto the Spaces tree to send it to another checkout of its repo: the main checkout, or a worktree, open as a space or not. The tab's Claude Code conversation is ended and resumed there with `claude --resume`, with the same options and a note that its folder changed. A shell with nothing running gets a new shell in the matching folder (`src/app` in the main checkout is `src/app` in the worktree), and a mod pane such as the Markdown viewer opens again with its props. Splits keep their shape, not their sizes. The tab shows up in the target space, selected, and the old space stays open: when the tab was its only one, the space gets a new tab with a shell at its checkout's root. A worktree with no space gets one first.

To drag it, press the tab in the tab bar and release it on a row of the Spaces tree: the main checkout, a worktree, open as a space or not, or another space of the same checkout. While the button is held, a row that takes the tab gets an `accent` border; the tab's own space and rows outside its repo never do. Releasing there asks for the same move as the popup, and releasing anywhere else moves nothing. The narrow rail, below 160px, takes no drops.

The mod is installed as `vjr-move-tab` in `vjr-desk` and `vjr-square-move-tab` in `vjr-desk-square`, with a copy of Herdr's menu that holds the item (`vjr-menu` and `vjr-square-menu`) and the layout's copy of Herdr's tab bar (`vjr-tabs` and `vjr-square-tabs`), which starts the drag. `cmd-shift-m` opens the popup for the focused tab in both layouts, and the menu shows the key next to `Move to…`. `apply-layout` writes it to each layout's section of `keys.json` (`mod.open:vjr-move-tab` and `mod.open:vjr-square-move-tab`) on every run, so change it in `recipes/move-tab.ts`, not there. The copy of the mod that runs the move is an invisible floating block, so a move outlives the popup that asked for it.

It reads Herdr's live data (spaces, panes, terminals), `~/.claude/sessions/<pid>.json` for each Claude's current conversation and Herdr's document through `doc.get`, which it never writes. It runs `git`, `ps`, `kill`, `test`, `hc` and `herdr-app do`, plus `sh` only to pipe into `hc connect`. It never reaches the network.

It refuses, with a toast that says why, when Claude is working or waiting for you, when anything other than Claude, an idle shell or a mod runs in a pane (the toast names the program), when Claude has sub-agents or is another agent's sub-agent kept as a pane, or when the tab is on another machine or not in a git repo. Claude's own background processes end with it.

The transcript stays under the first folder's project in `~/.claude/projects/`, so `claude --resume <id>` works anywhere, but the worktree's own `/resume` picker may not list the conversation. A tab let go anywhere but the tab bar or the Spaces tree, over a terminal say, stays in the drag until the next press, for at most 30 s: until then, rows that would take it light up under the pointer. Any press anywhere ends a drag older than 300 ms, so a later click on a row only opens that row, and a later drag never drops the old tab. [`mods/move-tab/RECIPE.md`](mods/move-tab/RECIPE.md) describes it in full.

## Kit

`kit/kit.js` is the UI kit of this repo's mods (the Command Center, the Spaces tree, the Markdown viewer and Move tab): tokens (sizes, text, radii), components (`button`, `iconButton`, `link`, `chip`, `pill`, `card`, `heading`, `line`, `mark`, `statusDot`, `stepNode`, `icon`) and the SVG icons in `kit/icons/`. A mod imports it as `../../kit/kit.js`, and `apply-layout` copies `kit.js` into each installed mod that imports it. The icons are installed once per layout, in the `kit` mod's `icons/` folder, where the kit reads them. A layout whose mods use the kit must include the `kit` recipe; the generator refuses otherwise.

`mods/kit/` is a gallery that shows every component and icon. Open it beside the focused terminal:

```sh
herdr-app do pane.split --direction right --mod vjr-kit
```

In the square layout the mod is `vjr-square-kit`.

Credits:
- [Lucide](https://lucide.dev) icons by Lucide Contributors (ISC; portions from Feather by Cole Bemis, MIT), from `lucide-static@0.469.0`. The license is in `kit/icons/LICENSE-lucide`.
- [Simple Icons](https://simpleicons.org) by Simple Icons contributors (CC0), from `simple-icons@13.21.0`: ClickUp, GitHub and Zed. Brand marks are their owners' trademarks.

## License

[MIT](LICENSE)
