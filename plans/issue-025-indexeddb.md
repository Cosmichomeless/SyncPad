# IndexedDB note persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist visited Yjs notes by authenticated user and note (#25).

**Architecture:** Use y-indexeddb to retain updates separately from the UI. Hydrate before starting synchronization. Full offline page recovery also depends on shell caching (#26) and metadata navigation (#30); keep #25 open until verified.

**Tech Stack:** Next.js, React, TypeScript, Yjs, y-indexeddb, node:test and fake-indexeddb.

## Global Constraints

- Preserve and exclude existing user changes in backend tests, next-env.d.ts and globals.css.
- No secrets or production provisioning.
- Close issues only after verified acceptance and integration.

## [S1] Requirements

Guardar estado local por nota para abrirla sin conexión.
- Una nota visitada vuelve a abrir tras recargar offline.
- Los datos locales están separados por usuario y nota.

### Task 1: Persistence and editor hydration

**Covers:** [S1] document restoration and isolation; full page recovery awaits #26/#30.

**Files:** Create `frontend/src/lib/note-persistence.ts`, `frontend/tests/note-persistence.test.tsx`, `docs/issues/025-indexeddb.md`. Modify `frontend/src/app/page.tsx`, frontend package.json and lockfile, README.md.

**Interfaces:** `noteStorageKey(userId: string, noteId: string): string`; `persistNote(userId: string, noteId: string, doc: Y.Doc): IndexeddbPersistence`. Await `whenSynced`, destroy persistence before the document.

- [x] Install y-indexeddb and devDependency fake-indexeddb using npm in frontend with `--cache /tmp/syncpad-npm-cache --no-audit --no-fund`.
- [x] Write restoration test before implementation:

```ts
test('restores a visited note without network', async () => {
  const first = createEditorDocument();
  const saved = persistNote('restore-user', 'restore-note', first.doc);
  await saved.whenSynced;
  first.content.insert(0, 'offline content');
  await saved.destroy();
  first.doc.destroy();
  const second = createEditorDocument();
  const restored = persistNote('restore-user', 'restore-note', second.doc);
  await restored.whenSynced;
  assert.equal(second.content.toString(), 'offline content');
  await restored.destroy();
  second.doc.destroy();
});
```

- [x] Add tests for two users sharing a note ID, one user with two notes, unambiguous keys and repeated hydration without duplication. Use real Yjs with fake-indexeddb, no mocked persistence.
- [x] Run `npm --prefix frontend test`; observe failure from missing module/behavior before production code.
- [x] Implement boundary (standard Yjs type and IndexeddbPersistence imports):

```ts
export function noteStorageKey(userId: string, noteId: string): string {
  return 'syncpad:note:' + JSON.stringify([userId, noteId]);
}
export function persistNote(userId: string, noteId: string, doc: Y.Doc): IndexeddbPersistence {
  return new IndexeddbPersistence(noteStorageKey(userId, noteId), doc);
}
```

- [ ] In selected-note effect require authenticated user ID, hydrate before the existing socket setup; observe content, catch errors and cancel stale callbacks. Follow this lifetime:

```ts
const document = createEditorDocument();
const persistence = persistNote(userId, selectedNote.id, document.doc);
let cancelled = false;
let socket: WebSocket | null = null;
void persistence.whenSynced.then(() => {
  if (cancelled) return;
  setEditorText(document.content.toString());
  socket = new WebSocket(`${WS_URL}?noteId=${selectedNote.id}`);
  // Attach existing protocol handlers, guarded by cancelled.
}).catch(() => {
  if (!cancelled) setError('No se pudo abrir el almacenamiento local');
});
return () => {
  cancelled = true;
  socket?.close();
  void persistence.destroy().then(() => document.doc.destroy());
};
```

Clear refs only if they still belong to this effect. Reset visible text on selection. Depend on user ID and selected note; do not add reconnection/disconnected editing yet.

- [x] Run frontend test, lint, typecheck, build and post-build typecheck; record actual outputs and offline-shell limits in docs/issues/025-indexeddb.md and README.md.
- [x] Stage exact delivery files only; commit `feat: persist Yjs notes by user in IndexedDB (#25)`. Independent spec and quality reviews gate publication.

## Implementer handoff

Persistence, hydration ordering, cancellation and cleanup are implemented.
The editor step remains unchecked because y-indexeddb 9.0.12 does not propagate
database-open/read failures to whenSynced; the planned catch cannot guarantee
the storage-error message. Cleanup destroys the document on both resolution
and rejection of persistence.destroy(). See docs/issues/025-indexeddb.md.
Independent reviews and authenticated browser verification remain pending;
full offline acceptance also awaits #26/#30.
