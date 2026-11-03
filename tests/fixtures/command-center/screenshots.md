# Screenshots — fix(app): keep drafts across reloads (CUP-1234)

Covers: 58197b4b2aeb820e4ebd94758581fcb1180d3f23
Preview: local dev (app.fix-cup-1234-draft-reload.localhost)
Tool: pp-stack 0.93.0

### Inbox — draft saving
![The reply box with the saving indicator](01-inbox-draft-saving.png)
Files: `components/draft-status.tsx`
Look for: the "Saving…" label under the reply box.

### Inbox — after a reload
![The same reply still in the box after a reload](02-inbox-draft-after-reload.png)
Files: `lib/drafts/save.ts`
Look for: the text typed before the reload.

### Inbox — sent reply
![The conversation after sending, with an empty reply box](03-inbox-sent-reply.png)
Files: `lib/drafts/save.ts`
Look for: an empty reply box.
