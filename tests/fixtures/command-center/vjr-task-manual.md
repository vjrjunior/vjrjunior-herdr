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

## Manual checks

| # | URL | Steps | Expected | State |
|---|---|---|---|---|
| D01 | http://app.localhost/inbox | Type a reply, then reload the page. | The reply is still in the box. | passed |
| D02 | http://app.localhost/inbox | Watch the label under the reply box while typing. | "Saving…" shows, then "Saved". | asking |
| D03 | — | Send a reply, then reload. | No draft comes back. | pending |
| D04 | http://app.localhost/inbox | Hold Send while it saves. | Send stays enabled. | failed: Send turned grey for a second |
