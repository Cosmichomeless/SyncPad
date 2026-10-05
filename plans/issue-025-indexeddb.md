# IndexedDB note persistence Implementation Plan

> [!NOTE]
> Este plan conserva el historial del diseño. Para el estado implementado:
> [Informe de entrega](../reports/025-persistence.md).

**Goal:** Persist visited Yjs notes by authenticated user and note (#25).

**Architecture:** Native IndexedDB adapter retaining the existing database keys
and version-one updates (autoIncrement) / custom schema. Hydrate before socket
synchronization. Full offline page recovery depends on #26/#30.

**Tech Stack:** Next.js, React, TypeScript, Yjs, native IndexedDB, node:test,
fake-indexeddb.

## Global constraints

- Preserve/exclude original backend test, next-env.d.ts and globals.css changes.
- Do not stage plans/issue-026-shell.md or plans/issue-030-offline-navigation.md;
  no publication or issue closure.
- No changes to metadata, offline shell, reconnection or disconnected editing.

## Requirements and implementation

- [x] Persist and restore visited documents with exact user/note isolation.
- [x] Preserve unambiguous syncpad:note: JSON [userId, noteId] keys.
- [x] Reproduce dependency failure before implementation: open/read errors
  produce unhandled rejections; cancelled hydration remains pending.
- [x] Replace y-indexeddb 9.0.12 after confirming its resolve-only whenSynced
  and unhandled _db.then/fetchUpdates chain. A page catch alone is insufficient.
- [x] Return NotePersistence with whenSynced: Promise<void>, destroy(): Promise<void>,
  and optional onError callback for failed writes. Reject actual hydration errors.
- [x] Preserve existing updates/custom stores and read previous updates.
- [x] Register update listener after hydration; submit writes synchronously so
  IndexedDB serializes conflicting transactions across replacement connections.
  Track handled promises and drain before closing. Report write failures separately.
- [x] Reproduce immediate same-key reopen before awaiting destruction (RED: empty
  instead of final edit), then verify exact restoration and five rapid reopens.
- [x] Preserve malformed-update rejection, consumed abort errors and cancellation.
- [x] Cancel safely during open/read without applying stale content. Cleanup is
  idempotent and consumes hydration failure without hiding it from whenSynced.
- [x] Hydrate before socket setup; show guarded Spanish open/write storage errors.
- [x] Remove unused y-indexeddb dependency; retain fake-indexeddb.
- [x] Run full frontend tests (19/19), lint, typecheck, build, post-build typecheck.
- [x] Update README and docs/issues/025-indexeddb.md with actual evidence/limits.
- [ ] Independent spec/quality reviews of corrective commit (parent gate).
- [x] Prior authenticated browser restoration/storage-denied checks (parent evidence).
- [ ] Browser lifecycle checks for immediate-reopen fix (not rerun in this scope).
- [ ] Integration and complete offline acceptance after #26/#30 (keep issue open).

## Evidence and handoff

Initial delivery: 3c545de. Corrective tests first returned code 1 with open/read
unhandledRejection and pending cancelled hydration. Native adapter passes 19/19
frontend tests, including legacy schema, exact queued edits, cancellation during
read and asynchronous write abort after request success. No unresolved claim
that catching the dependency whenSynced handles denied storage remains.

Quality regression: with implementation unchanged, the new immediate/repeated
reopen tests returned 17 pass, 2 fail, 0 cancelled (code 1). Submitting readwrite
transactions at update time rather than inside pending.then resolves the race
without a global abstraction. Final full suite: 19 pass, 0 fail, 0 cancelled
(code 0); lint, typecheck, production build and post-build typecheck also code 0.
The previous spec review covered 25250df..27d22ac only; independent rereview of
this fix remains the parent's publication gate.

The updates log is append-only; automatic compaction is not part of this scoped
fix. Failed writes report an error rather than a persistence guarantee. Browser
and independent review gates belong to the parent agent; no push/PR/issue closure.
