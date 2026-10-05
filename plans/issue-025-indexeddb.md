# IndexedDB note persistence Implementation Plan

**Goal:** Persist visited Yjs notes by authenticated user and note (#25).

**Architecture:** Native IndexedDB adapter retaining the existing database keys
and version-one updates (autoIncrement) / custom schema. Hydrate before socket
synchronization. Full offline page recovery depends on #26/#30.

**Tech Stack:** Next.js, React, TypeScript, Yjs, native IndexedDB, node:test,
fake-indexeddb.

## Global constraints

- Preserve/exclude original backend test, next-env.d.ts and globals.css changes.
- Do not stage plans/issue-026-shell.md; no publication or issue closure.
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
- [x] Register update listener after hydration; serialize pending writes and
  await transaction completion before closing. Report write failures separately.
- [x] Cancel safely during open/read without applying stale content. Cleanup is
  idempotent and consumes hydration failure without hiding it from whenSynced.
- [x] Hydrate before socket setup; show guarded Spanish open/write storage errors.
- [x] Remove unused y-indexeddb dependency; retain fake-indexeddb.
- [x] Run full frontend tests (16/16), lint, typecheck, build, post-build typecheck.
- [x] Update README and docs/issues/025-indexeddb.md with actual evidence/limits.
- [ ] Independent spec/quality reviews of corrective commit (parent gate).
- [ ] Authenticated browser lifecycle/failure checks (parent gate).
- [ ] Integration and complete offline acceptance after #26/#30 (keep issue open).

## Evidence and handoff

Initial delivery: 3c545de. Corrective tests first returned code 1 with open/read
unhandledRejection and pending cancelled hydration. Native adapter passes 16/16
frontend tests, including legacy schema, exact queued edits, cancellation during
read and asynchronous write abort after request success. No unresolved claim
that catching the dependency whenSynced handles denied storage remains.

The updates log is append-only; automatic compaction is not part of this scoped
fix. Failed writes report an error rather than a persistence guarantee. Browser
and independent review gates belong to the parent agent; no push/PR/issue closure.
