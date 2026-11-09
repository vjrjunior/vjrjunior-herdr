---
name: herdr-feature
description: Build a feature for this repo's herdr-app layouts (vjr-desk and vjr-desk-square) - a mod, a panel, a button, a key, a recipe or a layout change, or an item from an inventory in docs/. Runs prior art and the plan, creates the feature's worktree and moves this session into it while the plan waits for approval, then builds in both layouts and closes with the repo's Done checks. Use for /herdr-feature, "nova feature no herdr", "criar um mod", "adicionar ao layout", "construir o item N do inventário".
---

# herdr-feature

The loop: **frame → prior art → plan → worktree and move → build → Done → land**.

`AGENTS.md` holds the rules this skill orders: Herdr's guide, Planning, Worktrees, Both layouts, UI, Done and Commits. Where they differ, `AGENTS.md` wins. Steps 1 to 3 only read and write the plan. Prose for the user, the plan included, follows the user's language; code and commits stay English.

## 1. Frame

1. Herdr's guide reaches the session through `CLAUDE.md`. Read it again, in one read, only when a reminder says it changed. Run `herdr-app --version`.
2. Say in a few lines what the person sees and does, in `vjr-desk` and in `vjr-desk-square`, and where it lands: a new mod, one of ours (`mods/spaces-tree`, `command-center`, `comeback`, `move-tab`, `markdown`), a recipe that patches a copy of a Herdr mod (as `recipes/move-tab.ts` patches `menu` and `tabs`), or the layout tree.

## 2. Prior art and questions

1. Read `TODOS.md` and the inventories in the main checkout's `docs/`: an open item can change the scope.
2. Run `AGENTS.md` › Planning steps 2 to 4. A candidate is a herdr-app mod or layout that does the same job for the person; Herdr TUI plugins (`herdr-plugin.toml`) and other apps are not. Read every candidate's `RECIPE.md`, and the code of the ones you would adopt or take from.
   - Clone each into the scratchpad, one folder per repo, and only read it.
   - For each: link, commit, license, what it does well, what doesn't fit (a frozen copy of Herdr's mods from one version, hooks, one OS, network calls), and the verdict: adopt at a commit, build ours from its ideas, or skip.
   - Before adopting, tell the user if it reaches the network, runs programs (`exec`, `hc`) or reads files outside its folder.
   - Modified Apache-2.0 code also lists what changed in it, in a `CHANGES.md` next to it.
3. Ask what changes the code, with `AskUserQuestion`: at most three questions, recommended answer first. Decide the rest and list it in the plan.

## 3. Plan

Name the branch (`feat/`, `fix/`, `chore/`, `docs/`, `refactor/` plus a topic) and write `~/orbita/vjrjunior-herdr/docs/plans/<YYYY-MM-DD>-<topic>.md`:

1. **Goal**: what the person sees and does.
2. **Prior art**: the searches run, each candidate with its link, verdict and what we take ("nothing fits" counts).
3. **Herdr's guide**: the sections the change relies on.
4. **In each layout**: how it looks in `vjr-desk` and in `vjr-desk-square`.
5. **Decisions**: what you chose without asking, so the user can overturn it at approval.
6. **Changes**: the files, in the order they'll be touched.
7. **Done → proof**: each behavior and what proves it: a `tests/` case, a layout shot or a test-panel step.
8. **Out of scope**, and what goes to `TODOS.md`.

## 4. Worktree and move, in the approval turn

With the plan written, and before asking for approval:

1. Reuse what exists: check `git -C ~/orbita/vjrjunior-herdr worktree list` and `git branch --list '<branch>'` first.
2. Create it as `AGENTS.md` › Worktrees shows.
3. Schedule the move. When this turn ends, the conversation resumes with `claude --resume` in a space of the worktree, or a new one named after the branch:

   ```bash
   WT=~/.herdr/worktrees/vjrjunior-herdr/<branch, / as ->
   MTW="$(herdr plugin list --plugin vjr.move-to-worktree --json 2>/dev/null | jq -r '.result.plugins[0].plugin_root // empty')"
   if { [ "${HERDR_ENV:-}" = 1 ] || [ -n "${HC_TERMINAL_ID:-}" ]; } && [ -n "$MTW" ]; then "$MTW/bin/mtw" schedule --to "$WT"; fi
   ```

   Without the plugin, or outside Herdr, enter it with `EnterWorktree` (`path: $WT`), or keep to absolute paths, and say which.
4. End the turn with the plan's summary, its path and the request to approve, as plain text. `AskUserQuestion` keeps the session busy, so the move would wait and the answer would land in the old pane.

The user answers in the worktree's space, from a new pane: read `$HC_TERMINAL_ID` again before using it. If they reject the plan, offer to remove the worktree and its branch.

## 5. Build

In the worktree, with the plan approved:

- Logic goes in a pure module (`mods/<name>/logic.js`, no `herdr` import) tested in `tests/<name>.test.ts`; the view in `tests/<name>-view.test.ts` through `tests/app-mocks.ts`.
- Start from the closest recipe: `recipes/markdown.ts` (a pane mod), `recipes/comeback.ts` (an invisible floating worker), `recipes/move-tab.ts` (patches Herdr's `menu` and `tabs` and binds a key).
- Wire both layouts as `AGENTS.md` › Both layouts says, and draw with the kit as `AGENTS.md` › UI says.
- Before writing a mod or a recipe, read `references/pitfalls.md`.
- Try it with `bun run apply-layout` from the worktree, then `herdr-app status`.

## 6. Done

All of `AGENTS.md` › Done. The live checks go in one test-panel run, `~/orbita/vjrjunior-herdr/docs/runs/<topic>.json`:

- `"layouts"` names both, with one step per layout that switches to it with `run` and shows the change; the shot each answer takes is that layout's Done shot.
- `"report"` is `$HC_TERMINAL_ID`, so the summary comes back to this session.
- The run acts on the person's real window. What it changes, it does to spaces and tabs it creates, or its last step puts back.
- Read `bun run test-panel --results` and match each `passed` with its events: a pass whose events don't show the change is a finding.

## 7. Land

- Commit each change a person would name on its own, as `AGENTS.md` › Commits says; a feature is usually one commit.
- `/verify` selects tests against `origin/main`. Failures or `UNMAPPED` files that only local `main`'s unpushed commits touched are not this branch's: report them, and offer to push `main`.
- Ask whether to open a PR or merge into `main`. Once it lands or is dropped, update the main checkout and run `bun run apply-layout` there. Remove the worktree last, from the main checkout, because this session runs inside it.
