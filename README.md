# vjrjunior-herdr

My customizations for [Herdr](https://herdr.dev). Today that is the VJR theme, a dark palette of three hues (peach, mint and red) over a gray ladder, generated from one file for herdr-app and Ghostty.

## Use the theme

Copy one file and pick the theme:

```sh
cp themes/vjr.json ~/.config/herdr-app/themes/
```

Then open **Settings → Look → Dark** and choose `vjr`, or run:

```sh
herdr-app do app.theme '{"name":"vjr"}'
```

The command palette will not show it: its `Theme:` list holds only the four built-in themes. The choice applies to the layout on screen, and each layout keeps its own.

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
| `XDG_STATE_HOME` | `~/.local/state` | backups and the install record |

## License

[MIT](LICENSE)
