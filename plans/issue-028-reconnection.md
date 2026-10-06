# Missed-update reconnection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge offline local changes and missed remote changes on reconnection, without duplication (#28), and support truthful synchronization states (#29).

**Architecture:** Correlate state-vector handshakes and uploads with request IDs. Server validates, persists, applies and acknowledges in a room-serialized queue. A client controller retains one document across transport failures and tracks local mutation revisions, including deletions.

**Tech Stack:** TypeScript, Yjs, WebSocket, existing PostgreSQL sync store, node:test.

## Global Constraints

- Preserve user dirty files and exclude them from commits.
- Socket open/send and local IndexedDB hydration do not imply durable server synchronization.
- Acknowledgement comes after successful append; duplicate append result false is success, not failure.
- Additive optional message fields retain compatibility with current protocol/legacy tests.
- No production services or unrelated metrics/security refactors.

## [S1] Requirements #28

Usar estado Yjs para intercambiar cambios pendientes y remotos al volver la red.
- Ambos lados conservan sus cambios tras reconectar.
- Repetir el handshake no duplica contenido.

## [S2] State support for #29

Mostrar offline, reconectando, sincronizando y al día.
- El indicador refleja transiciones reales de conexión.
- Un fallo persistente ofrece una acción de reintento sin borrar cambios.

### Task 1: Durable correlated handshake and retained-document controller

**Covers:** [S1], [S2] controller state foundation; #29 supplies final accessible UI/retry evidence.

**Files:** Modify shared/src/index.ts, shared/src/document.ts and document.test.ts; backend/src/server.ts; create backend/tests/ws-reconnection.test.ts (avoid original dirty ws-sync.test.ts); create frontend/src/lib/note-sync.ts, frontend/tests/note-sync.test.tsx; modify frontend/src/lib/note-document.ts and page.tsx; docs/issues/028-reconnection.md, README.md.

**Interfaces:**

```ts
type ClientSyncMessage =
  | { type: 'sync-request'; requestId?: string; stateVector?: string }
  | { type: 'update'; requestId?: string; update: string }
  | { type: 'awareness' };
type ServerSyncMessage =
  | { type: 'sync'; requestId?: string; update: string; stateVector: string }
  | { type: 'update'; update: string }
  | { type: 'ack'; requestId: string }
  | { type: 'sync-error'; requestId?: string; code: 'persistence-unavailable' | 'invalid-message'; retryable: boolean };
encodeNoteStateVector(document: Y.Doc): Uint8Array;
encodeEditorStateVector(document: Y.Doc): Uint8Array;
encodeEditorStateSince(document: Y.Doc, vector: Uint8Array): Uint8Array;
type SyncState = 'offline' | 'reconnecting' | 'syncing' | 'up-to-date';
type NoteSyncHandle = { retry(): void; destroy(): void };
createNoteSync(options: {
  document: EditorDocument;
  url: string;
  onState(state: SyncState): void;
  onError(message: string): void;
  online?: () => boolean;
  events?: Pick<EventTarget, 'addEventListener' | 'removeEventListener'>;
  socketFactory?: (url: string) => WebSocket;
}): NoteSyncHandle;
```

Controller owns socket, retry/deadline timers, request ID and revision tracking.
Default platform dependencies use browser navigator/window/WebSocket only when
the controller is created inside the effect. Injected dependencies isolate the
platform boundary in tests, not the Yjs/handshake logic. destroy never destroys
the document/persistence. Tests use real Yjs and exercise messages/state results,
not the existence of mocks.

- [ ] Write failing backend tests: two divergent insert/delete branches converge after reconnect; repeated correlated handshake preserves content; delayed append prevents ack/broadcast/snapshots; failed append does not contaminate room state and allows retry; duplicate append permits ack; eager handshake during room loading is processed. Write client tests for edit during flight, delete-only pending, stale socket callbacks, reconnect lifetime, timeout/retry and cleanup. Run RED.
- [ ] Add state-vector helpers, applyEditorUpdate origin option and additive wire types, preserving awareness. Assert duplicate Yjs update application and deletion preservation in shared tests.
- [ ] Add per-room recovered promise tail. Register socket listeners before asynchronous room loading. Queue initial/requested snapshots and updates in order. Evict failed room-load promise so retry can reload. For updates validate against temporary cloned document, await append, then apply live/broadcast/ack. Storage failure sends correlated sync-error, not invalid-message; no failed update enters live room. Handle each queue failure without poisoning future operations. Correlated uploads without configured syncStore cannot return durable ack.
- [ ] Implement client handshake after local hydration: send local vector with requestId; accept only matching correlated response as handshake completion, apply remote updates using remote origin; compute local diff against server returned vector; send one upload with requestId and captured localRevision. Only its matching ack advances acknowledged revision; edits during flight remain pending and upload next. Unsolicited initial sync can be applied but cannot confirm the handshake. After reload always require an acknowledged reconciliation, including delete-only changes.
- [ ] Retain Y.Doc/persistence across socket failures. Use capped exponential backoff (500ms to10s) and acknowledgement/handshake deadlines; reset backoff on successful sync, not socket open. Ignore stale callbacks with generation and socket identity. Offline event closes transport and retains local edits. Manual retry resets timer and connects immediately when online. Cleanup cancels every retry/deadline/online listener. Invalid/protocol/access failures are not silently converted to transport retries.
- [ ] Integrate page with controller and translate states to Spanish; keep local-first editing and pending text. Metadata refresh cannot recreate selected document/controller; lifetime depends on user/note IDs. Never label up-to-date while local edits remain unacknowledged. Storage warning stays independent of transport state.
- [ ] Run narrow tests, shared tests, backend full tests/lint/typecheck/build and frontend tests/lint/typecheck/build/postbuild typecheck. Existing built backend packaging defect is documented in #59, not silently claimed fixed. Browser controller verifies two clients, disconnect/edit/reconnect and exact convergence. Record actual checks and residual limits.
- [ ] Commit owned files only `feat: reconcile offline Yjs changes on reconnect (#28)`; independent spec then quality review before publication.
