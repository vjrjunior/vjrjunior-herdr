# VJR Desk

Herdr's own window (spaces and agents on the left, tabs as pills, panes as cards, a status bar) in the VJR palette: near-black surfaces, a gray ladder and a peach accent. A **Graph** button opens a git history in the side panel, and the `vjr` theme is listed in the command palette. It comes in two versions: `vjr-desk`, with Herdr's rounded corners, and `vjr-desk-square`, with every corner a layout can reach squared.

## What you see

Left to right, at zoom 1, in both versions:

- **Sidebar**, 268px wide (44-480), on `chrome` `#101010`, no system title bar:
  - top 46px: the Herdr brand row with search and fold buttons;
  - Spaces and Agents lists, sharing the height equally;
  - bottom 69px: Settings and Add machine.
- A 1px `border` divider, `#232323`.
- **Work column** on `canvas` `#101010`:
  - top 42px: tabs as pills, a `+` menu, then the **Files**, **Changes** and **Graph** buttons;
  - panes as cards with 8px padding and gaps, on `background` `#101010`, with a 1px `#232323` border, a 1px `#FFC799` border on the focused pane and a 30px header on top;
  - a side panel on the right, 368px (280-900), hidden at start, showing Files, Changes or Graph;
  - bottom 28px: the status bar.
- **Terminals:** text `#DBDBDB` on `#101010`, cursor `#FFC799`, selection `#332B24`, padding 14px by 12px. Fonts are Herdr's defaults, JetBrains Mono 14 and Geist.

Other colors: `surface` and `popover` `#161616`, `raised` `#1C1C1C`, `hover` `#282828`, `selected` `#232323`, `input` `#343434`, `muted` `#A0A0A0`, `dim` `#505050`.

**In `vjr-desk`,** corners are Herdr's: pane cards at radius 10, pills at 7, popups inside Herdr's rounded frame.

**In `vjr-desk-square`,** pane cards are at radius 0, and so is every element in the sidebar, tab bar, panels, status bar, menus, popups, the command palette, Settings and Git Graph. Popups lose Herdr's rounded frame and draw a straight 1px `#232323` border. Status dots become squares, and the `●` and `○` status marks become `■` and `□`.

## How it behaves

- **Agent status:** working `#FFC799` with a spinner, blocked `#FF8080`, done `#99FFE4`, idle `#505050`.
- Everything else is Herdr's main layout: click a space or tab to show it, `+` starts a terminal or an agent, panes drag by the top-center grip.
- **Graph button:** right after Changes. It selects `graph` in the side panel's stack and shows the panel. Clicking it again while it shows hides the panel, and each space remembers its choice.
- **Graph panel:** the commit history of the focused terminal's repository, with branch labels, commit details, and checkout, merge and rebase from right-click menus and double-clicks.
- **Palette:** `cmd-shift-p`, or the status bar hint, opens a copy of Herdr's palette that also lists `Theme: vjr`.
- **In the square version,** `cmd-,`, `cmd-p` and `cmd-/`, or whichever keys `global` binds to Settings, search and help, open square copies of those screens.
- **After a Herdr update,** the layout rebuilds itself within seconds. If it can't, the previous copies keep running and a warning toast says why.

## Built from

Nothing here is a frozen copy of Herdr. `recipes/` holds small edits, and `scripts/layout.ts` applies them to the files of the Herdr you have installed:

- `layouts/vjr-desk.json` and `layouts/vjr-desk-square.json`: Herdr's `main` layout, plus `theme: { light: "paper", dark: "vjr" }`, a `preview` and a floating `vjr-sync` block.
- **`list-vjr-theme`:** copies `frame/palette` and `workspace-status`, adds `vjr` to the palette's theme list and opens the copy from `keys.json` and the status bar.
- **`git-graph-panel`:** copies `tabs`, adds the Graph button and `"graph"` to the enabled panels, and adds `{ "id": "graph", "type": "block", "content": { "mod": "git-graph" } }` to the `panel-body` stack.
- **`square`:** copies 14 more mods, sets every `.rounded*()` to 0, passes `frame: "none"` to the popups that have a copy, adds a border to their roots, sets `pane.radius` to 0 and sets `terminal_menu`.
- `mods/vjr-sync/`: an invisible floating mod. It compares `updates().app.version` with the version in its props and runs `scripts/layout.ts apply` when they differ, with `exec` and an absolute path to `bun`.
- `mods/git-graph/`: [herdr-git-graph](https://github.com/rabeeh-ta/herdr-git-graph) by Rabeeh T A, MIT, at commit `1cfcff3`, unmodified. It runs `git` in the focused repository, reads the folders open in other panes ahead of time, also on other machines, and reaches the network only through git on Fetch, Push and when deleting a remote branch.
- `themes/vjr.json`: generated from `palette/vjr.toml`.
- `keys.json`: `layout:vjr-desk` and `layout:vjr-desk-square` sections, derived from the `global` section.

## Watch out

- The mods in `~/.config/herdr-app/mods/vjr-*` are generated. Edit `recipes/`, not them, then run `bun run apply-layout`.
- `herdr-app check` loads a mod without props, so `vjr-sync` must cope with `props()` being null.
- `exec("bun")` fails inside the app: its PATH doesn't reach `~/.bun/bin`. The layout stores the absolute path, and the repo's path too, so moving the repo needs a new `apply-layout`.
- A block with `hidden: true` never starts its mod. `vjr-sync` floats and renders an empty `div()`, which shows nothing.
- The app writes `gpui-kit.d.ts` and `jsconfig.json` into every mod folder. Comparing a generated mod with an installed one must ignore them.
- `frame: "none"` removes the border with the corners, so a mod that uses it must draw its own. Don't set it on a popup with no copy: the palette opens Herdr's `prompt`, which has no border.
- The app opens `prompt`, `confirm`, `toast` and `peek` itself, so renaming, close confirmations, notifications and peek stay rounded. So do Welcome, What's new, the feedback window and Add machine's terminal dialog.
- Herdr's own screens open from places a layout can't reach, like an update notice. Those keep the rounded versions.
- The spinner is a round SVG and stays round.
- The window's outer corners belong to macOS.
- Keys are derived when `apply-layout` runs. Rerun it after changing a shortcut for the palette, Settings, help or search.
- Name a theme differently from a layout: `themes/vjr.json` would otherwise belong to a layout called `vjr`.

## Done when

- `bun run apply-layout` prints `applied`, and running it again prints `unchanged`.
- `herdr-app do layout.switch '{"name":"vjr-desk-square"}'` shows the layout and `herdr-app status` lists no errors.
- `herdr-app check` passes on every `mods/vjr-*` folder and on `mods/git-graph`.
- The focused pane's border reads `#FFC799`, and its corners are square in `vjr-desk-square` and rounded in `vjr-desk`.
- `herdr-app do layout.select '{"stack":"panel-body","child":"graph"}'` followed by `herdr-app do layout.show '{"id":"panel"}'` shows the focused repository's history.
- Changing `built` in the layout's `vjr-sync` props to an older version brings it back to the installed version within seconds.
