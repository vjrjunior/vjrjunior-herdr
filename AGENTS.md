# AGENTS.md

This repo customizes herdr-app: the VJR palette and theme (also built for Ghostty), the `vjr-desk` layouts and their mods. Weigh every idea by what it does for herdr-app. `README.md` covers each part and its commands; `RECIPE.md` describes the layouts.

## Herdr's guide

`~/.config/herdr-app/AGENTS.md` is the contract for everything built here: the app's files, its commands, the mod API, and what is read-only. Herdr rewrites it on every start and update, so read it at the start of every session that plans or builds, all of it, in one read. Searching or skimming it has already cost a wrong plan (themes do not reload live) and an edit to a read-only shipped layout. Claude Code loads it through `CLAUDE.md`. `herdr.d.ts` and `gpui-kit.d.ts` next to it are the API, and `herdr-app --version` says which version it describes.

The guide speaks to someone editing the app's folder by hand. Here that folder is an output:

- Change `recipes/` and this repo's `mods/`, then run `bun run apply-layout`. It generates `~/.config/herdr-app/mods/vjr-*`, the `vjr-desk*` layouts and their `keys.json` sections.
- Shipped layouts and mods, `frame/` and `layouts/.state/` stay untouched, even for a test.

## Planning

1. Read Herdr's guide, as above.
2. Look for prior art before designing a mod, a layout or a behavior. herdr.dev lists the GitHub repos with these topics:

   ```sh
   gh search repos --topic herdr-mod --limit 100
   gh search repos --topic herdr-layout --limit 100
   gh search repos "herdr <idea>"
   ```

   Herdr's shipped mods in `~/.config/herdr-app/mods/` are prior art too.
3. For each candidate that fits, read its `RECIPE.md` and its code, not only the README. Note what it does well, what doesn't fit here (a frozen copy of Herdr's mods from one version, hooks, a single OS, network calls) and its license.
4. Decide for each one: adopt it unmodified at a commit, as `mods/git-graph/` is; build ours from its best ideas; or skip it.
5. Write the plan in the main checkout's `docs/`. It is ready when it has a **Prior art** section (the searches run, each candidate with its link, verdict and what we take from it; "nothing fits" counts when the searches are listed), names the sections of Herdr's guide the change relies on, and says how the feature looks in each of the [two layouts](#both-layouts).

Copied code needs a license that allows it and a credit in `README.md` with author, license and commit, as Git Graph has. Apache-2.0 code also needs a `NOTICE`. Before adopting a mod, tell the user if it reaches the network, runs programs (`exec`, `hc`) or reads files outside its folder.

## Worktrees

Each feature or fix gets its own branch in its own worktree. The main checkout, `~/orbita/vjrjunior-herdr`, stays on `main` and may hold another session's work: leave its branch, index and files as they are.

- Branch names carry a conventional prefix: `feat/`, `fix/`, `chore/`, `docs/`, `refactor/`.
- Worktrees go where Herdr's New worktree puts them, so one made from Herdr's space menu and one made in a shell sit side by side: `~/.herdr/worktrees/vjrjunior-herdr/<branch with / as ->`.

  ```sh
  git -C ~/orbita/vjrjunior-herdr worktree add -b feat/<topic> ~/.herdr/worktrees/vjrjunior-herdr/feat-<topic> main
  ```

- Specs and plans live in the main checkout's `docs/`, by absolute path. `docs/` is git-ignored, and removing a worktree deletes its ignored files. Planning files stay out of every commit, whatever a skill says.
- `bun run apply-layout` stores the folder it runs from in the live layouts, and `vjr-sync` rebuilds from that folder on every Herdr update. Run it from a worktree to try a change in the window. When the branch lands or is dropped, update the main checkout and run it there before removing the worktree.

## Both layouts

Every feature ships in `vjr-desk` and `vjr-desk-square`, built from the same recipes, as Comeback and the Spaces tree do.

- Add the feature's recipe to both entries of `VARIANTS` in `recipes/variants.ts`. In `vjr-desk-square`, `square` stays last: it squares every corner and turns `●` and `○` into `■` and `□` in what the recipes before it produced.
- A mod from this repo's `mods/` also goes in `recipes/square.ts`, in its `mods` (`from: "repo"`) and in `OWN_MODS`. Nothing warns when a feature is missing from one layout, so the shot of each layout in Done is the check.
- Mods are installed as `vjr-<name>` in one layout and `vjr-square-<name>` in the other. Name another mod as `mod: "<name>"` or `{ name: "<name>" }`, in double quotes, so the generator can add the prefix; it refuses a reference it cannot rewrite. Commands sent to a mod differ the same way (`vjr-comeback.resume`, `vjr-square-comeback.resume`), so docs give both.

## Done

- `bun test` passes. The tests use temporary homes, never the real app folder.
- For a mod or a recipe, `bun run apply-layout` passes (it runs `herdr-app check` on every changed mod and installs nothing if one fails) and `herdr-app status` shows no errors. Then switch to each layout (`herdr-app do layout.switch '{"name":"vjr-desk"}'`, then `vjr-desk-square`) and take a `herdr-app shot` that shows the change in both.
- A change people can see updates its section of `README.md` and the recipe that describes it (`RECIPE.md`, or `mods/<name>/RECIPE.md`) on the same branch. Recipes follow the order in Herdr's guide.
- Work left for later goes in `TODOS.md`, in its What, Why, Context, Effort, Priority and Depends on shape.

## Commits

The subject is a plain sentence about what changes for the person using it, as in `git log`: "Give a space's own row more room and its branch a line of its own". The prefix belongs to the branch name, not the subject. The body says what was wrong and why this is the fix. Commits and PRs carry only the user's authorship: no `Co-Authored-By` trailer for an AI and no "Generated with" footer.
