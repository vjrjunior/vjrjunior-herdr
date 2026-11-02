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

## License

[MIT](LICENSE)
