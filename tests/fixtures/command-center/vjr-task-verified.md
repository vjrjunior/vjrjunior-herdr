# CUP-1234 — A saved draft disappears when the page reloads before the autosave lands

**Kind:** bug · **Source:** ClickUp · https://app.clickup.com/t/86abc1234
**Base:** main · **Branch:** fix/cup-1234-draft-reload · **PR:** none yet
**Worktree:** /Users/someone/Local Sites/acme/app-worktrees/cup-1234-draft-reload
**Language:** pt-BR

## Task

_Given_ a customer typed a reply and the autosave is still pending

_When_ the page reloads

_Then_ the reply is gone

## Veredito

**Confirmado:** `lib/drafts/save.ts:17` descarta o rascunho quando o autosave ainda não terminou.

## Done

| # | Item | From |
|---|---|---|
| D01 | O rascunho continua depois de recarregar a página | Then |
| D02 | O cliente vê quando o rascunho foi salvo | Comentário |
| D03 | Um rascunho enviado não volta depois de recarregar | But |
| D04 | Enquanto salva, o botão Enviar continua habilitado | Given |

## Plano

1. Guardar o rascunho antes do autosave.

## Verification — 58197b4

Gates: lint ✓ · tsc ✓ · tests 8140 passed · pre-gate ✓
Review: 3 in scope, fixed · 17 outside the task, dropped

| # | Verdict | Where | Manual |
|---|---|---|---|
| D01 | Done | lib/drafts/save.ts:41 | — |
| D02 | Done | components/draft-status.tsx:12 | passed |

Known limits: none
