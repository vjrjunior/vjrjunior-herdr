# Comeback

When the machine restarts, Herdr brings every terminal back as a bare shell in its last folder, and the Claude Code conversations that were open there are gone. Comeback brings them back by itself: as soon as the window opens, each terminal that lost its Claude gets it again, on the same conversation and with the same safe options, and a toast says what came back. Nothing to install besides this folder: no hooks, no shell startup edits, no Node or Python.

![Comeback](preview.png)

## Installing it (for the agent doing it)

1. Read every file in this folder before copying anything. Tell the person that the mod runs `hc`, `ps` and `sysctl`, reads `~/.claude/sessions/*.json` and lists `~/.claude/projects/`, writes nothing but a `comeback` label on terminals, and types into a terminal only to resume a lost conversation.
2. Copy this folder to `~/.config/herdr-app/mods/comeback`, without `RECIPE.md`.
3. Run `herdr-app check ~/.config/herdr-app/mods/comeback`. It must pass.
4. The mod has `"place": "none"`, so it only runs where a layout puts it. Herdr's own layouts are read-only: clone the one the person uses (`herdr-app do layout.clone '{"name":"main","as":"my-desk"}'`) and add this to the root's `floating` list of the clone:
   `{ "id": "comeback", "content": { "mod": "comeback" }, "edge": "left", "align": "end" }`
5. Conversations are noted from then on. Claudes that were already running get noted within 10 seconds; the ones lost before the mod ran can't come back.

## What you see

- Nothing while you work: the floating block draws an empty `div()`.
- After a restart, in each terminal that gets its Claude back, the shell shows the typed command, `cd '<folder>' && claude --resume <id> <options>` (the folder quoted only when it needs it), and Claude opens on its old conversation.
- Then Herdr's toast, one line of body:
  - success: "Resumed 2 Claude conversations", body the terminals' `space / tab` joined by commas, 5 s;
  - warning: "Resumed 1 of 2 Claude conversations", or "Couldn't resume 1 Claude conversation", body "Not resumed: web / 2: its folder is gone; …", 8 s;
  - info, only from the command: "No Claude conversation to resume", body "No terminal lost its Claude.", 3 s.
- An automatic pass with nothing to do shows nothing.

## How it behaves

- **Noting.** Every 10 s it reads `agents()`. For each local agent with `app: "claude-code"` whose `seq` changed (every one on each 20th check), it runs `hc get <t> --json`. When Claude is in front (`foreground.argv[0]` is `claude`, or the report says `claude-code` and the shell isn't in front), it reads `~/.claude/sessions/<foreground.pid>.json` and sets the terminal's `comeback` label to compact JSON:
  `{"v":1,"agent":"claude","session":"<id>","cwd":"<folder>","args":[…],"boot":"<boot>","shell":{"pid":<pid>,"start":"<lstart>"},"at":<ms>}`.
  - `boot` is `kern.boottime`'s `sec` (macOS) or `/proc/sys/kernel/random/boot_id` (Linux).
  - `shell` is the terminal's program (`hc get` `pid`) and its start (`ps -o lstart=`), so a new shell that got an old pid isn't taken for the old one.
  - The label is only written when the session, folder, options, boot or shell changed. `/clear`, `/resume` and compaction change the session in the same process, and the note follows.
- **Options.** Only options `claude --resume` accepts come back: `--dangerously-skip-permissions`, `--permission-mode <v>`, `--model <v>`, `--add-dir <dir…>` and `--verbose`, also as `--opt=value`. Prompts, `--resume`, `--continue`, `--session-id`, `-p`/`--print`, `--worktree` and unknown options are dropped, and so is an option whose value holds a single quote, a backslash or a control character. A label read back is filtered again.
- **Forgetting.** A noted terminal whose own shell is back in front, on the same boot and the same shell process, was quit by the person: the label is removed.
- **Lost.** A noted terminal lost its Claude when its note is from another boot, or its program is another process (pid or start), and its own shell (`zsh`, `bash`, `fish`, `sh`, `dash`, `ksh`) is in front.
- **One try per loss.** Before typing, the label gets `"tried": {boot, shell}` for the current shell. It's on the terminal, so reopening the window, switching layouts or reloading the mod never tries again, and two copies never type into the same terminal. A skipped one gets `tried` with its reason too, so its toast isn't repeated.
- **A pass.** When the block starts it scans every live local terminal (`hc ls`, then `hc get`), waits up to 12 s, every 0.5 s, while noted terminals have nothing in front yet, then runs an automatic pass. A check that finds a lost terminal without `tried` runs one too. The automatic pass only looks at lost terminals without `tried` whose shell is younger than 600 s (`ps -o etime=`), so a shell the person has been using is never typed into.
  - Newest note first. Skipped, with the reason: "its folder can't be typed", "its folder is gone" (`test -d`), "no saved conversation" (no `~/.claude/projects/*/<id>.jsonl`), "open in another terminal" (a live `~/.claude/sessions/<pid>.json` with that session, checked with `ps -o pid=`), "already resumed in this pass".
  - For each one left: wait until its shell has run 1.5 s, read it again and give up if it's no longer lost (or another copy marked it), write `tried`, `hc send` the command, wait 150 ms.
  - 5 s after the last send, read each again: Claude in front is back; its shell in front again failed, "exited right away: <the last line above the prompt>" (`hc read <t> --json --lines 20`).
- **Again, by hand.** `herdr-app do comeback.resume` (or a key bound to `comeback.resume`) runs a pass that also tries terminals with `tried` and old shells. Only one pass runs at a time.

## Built from

- `mod.json`: `{ "place": "none", "title": "Comeback" }`.
- A floating block in the layout's root: `{ "id": "comeback", "content": { "mod": "comeback" }, "edge": "left", "align": "end" }`.
- `logic.js`: pure functions, no imports. `parseBoot`, `parseEtime`, `parseSession`, `isShell`, `keepArgs`, `quote`, `resumeCommand`, `encodeNote`, `decodeNote`, `lastLine`, `judge(terminal, boot)` → `running | quit | lost | busy | none`, `triedNow`, `markTried`, `planPass(lost, ctx)` → `{todo, skipped}`, `summary(outcome, manual)`.
- `main.js`: the View. `herdr`: `agents`, `exec`, `home`, `readTextFile`, `notify`, `nextCommand`. `fs/promises`: `readdir`, `exists`. Programs: `hc get|ls|label|send|read`, `ps -o lstart=|etime=|pid=`, `sysctl -n kern.boottime`, `test -d`, `sleep` (mods have no `setTimeout`).

## Watch out

- The mods' `fs/promises` has `readdir`, `exists`, `readFile`, `writeFile`, `mkdir`, `unlink` and `rmdir`, but no `stat`. A `stat` call throws, and inside a `try` it looks like a missing file.
- `turn` in `hc get` counts the agent's turns and survives a recovery, so it can't tell a fresh shell from a used one. Use the shell's age.
- `hc send` pastes and presses Enter. In a shell that runs a command; inside Claude it's a message (a pasted `/exit` is just text). Only type into a shell in front.
- Claude asks to trust a folder it hasn't seen. A conversation resumed in an untrusted folder stops at that prompt, with Claude in front, which counts as resumed.
- Mod commands reach shown copies only. A floating block that draws an empty `div()` counts as shown.
- Known limit: quit Claude while the window is closed, then restart the machine before opening it again, and that conversation comes back. Avoiding it takes a watcher started from a Claude hook, which this mod doesn't install.
- Local terminals only (addresses without `machine/`).

## Done when

- `herdr-app check` passes on the mod folder.
- With Claude running in a terminal, `hc get <t> --json` shows a `comeback` label with its session within 10 s.
- Quitting that Claude removes the label within 10 s.
- Writing that label back with `"boot":"1700000000"` on a shell younger than 10 minutes and switching layouts brings the conversation back, and the toast says "Resumed 1 Claude conversation".
- With `tried` set for the current shell, the automatic pass leaves it alone, and `herdr-app do <copy>.resume` brings it back.
