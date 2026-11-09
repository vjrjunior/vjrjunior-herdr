# Mod pitfalls

Read before writing or changing a mod's code. Herdr's guide covers `cx`, timers, animation and the API; these are what it leaves out.

## Already written in this repo

Read the Watch out section of the one that matches the area you touch:

- `RECIPE.md`: props in `herdr-app check`, `exec` and `bun`'s PATH, the 30 s `exec` limit, hidden blocks, `frame: "none"`, the kit's import path.
- `mods/move-tab/RECIPE.md`: drags across blocks, `on_mouse_down_out`, one handler per event, `run()` returning nothing, `pane.split` without a folder, ending and resuming Claude.
- `mods/comeback/RECIPE.md`: `fs/promises` without `stat`, `hc get`'s `turn`, `hc send`, Claude's folder-trust prompt.

## Not written anywhere else yet

- **Text height.** `.line_height(14)` multiplies the font size, and the text vanishes under `truncate`. Pass `"14px"`.
- **Shared state redraws every mod.** Never call `setShared` from `render` or a hover. Publish only real changes, from an event or a timer.
- **Scrolling fakes hovers.** A list scrolling under a still pointer fires a hover per row. Count a hover as real only when the pointer moved in the last ~150 ms, and give the scroll area a stable `.id()`.
- **Drag targets.** A drag is `on_mouse_down` on the source and `on_mouse_move` / `on_mouse_up` on every target. Reset it in the list's own `on_mouse_up`, which runs after the target's.
- **Popups over a dialog.** A popup opens at the pointer, which Herdr doesn't track over dialogs. Anchor it with `at` from the pressed control's bounds.
- **`cx.spawn` is synchronous until its first `await`.** Don't reach state the constructor hasn't built yet.
- **`space.new` needs a folder.** Without one it starts where the focused terminal is, so from a worktree it opens a second space on the same checkout, and removing either one deletes the folder under both. Pass `folder` (and the machine), and look for other spaces on a checkout before `git worktree remove`.
- **Stopping an agent.** Never send ctrl+c: Herdr starts agents through `zsh -lic '"$@"; exec "$0" -li'`, and SIGINT aborts that wrapper and closes the pane. Send `/exit`, or SIGTERM to the program's process group.
- **Prefilling Claude.** Its input line is `❯` followed by a non-breaking space, and the folder-trust prompt uses `❯` too. Match `^❯`, and wait until the trust prompt is gone.
- **`hc wait` on your own terminal ignores `--timeout`.** Don't use it to sleep.
- **Writing your own `mod.json` reloads the mod.**
- **Long work runs in a terminal.** A clone or an install outlives `exec`'s limit. Open it with `terminal.open` so its progress shows.
- **The code view's colors.** `EditorState` tags `//`, `/*` and quotes as `punctuation`, which beats `comment`, and only the documented syntax names apply.
- **The JS runtime.** There is no `TextEncoder` (`encodeURIComponent` gives UTF-8 bytes), and `toLocaleDateString` ignores its options.
