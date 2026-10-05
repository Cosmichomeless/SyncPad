# Offline identity and navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore visited-note navigation offline without leaking another account's data (#30 and acceptance integration for #25/#26).

**Architecture:** Cache authenticated identity without credentials and user-scoped metadata in browser storage. Transport failure alone permits local fallback. Explicit denial invalidates access. Generation tokens protect against stale requests, and storage events lock other tabs on logout. Metadata refresh must never recreate the selected Yjs document.

**Tech Stack:** Next/React/TypeScript, native IndexedDB/localStorage, node:test/fake-indexeddb, real-browser verification.

## Global Constraints

- Preserve original dirty files; never persist passwords/session tokens or cache private HTTP responses.
- Offline identity is a local convenience, never server authorization. Server permissions remain authoritative on reconnect.
- Logout locks local UI immediately, even when remote revocation is unavailable; require explicit login to unlock rather than silently restoring an existing cookie.
- Keep isolated Yjs documents after logout to avoid destroying unsynced edits; this is isolation, not secure erasure on shared devices.

## [S1] Requirements #30

Conservar títulos y navegación necesarios para encontrar notas offline.
- Las notas visitadas aparecen en navegación sin red.
- Al reconectar se actualiza metadata sin sobrescribir edición local.

## [S2] Integration requirements #25/#26

- Una nota visitada vuelve a abrir tras recargar offline.
- Los datos locales están separados por usuario y nota.
- La interfaz y notas ya visitadas se pueden abrir offline.
- El caché no muestra datos de una cuenta anterior tras logout.

### Task 1: Identity-gated navigation recovery

**Covers:** [S1], [S2].

**Files:** Create `frontend/src/lib/api-request.ts`, `frontend/src/lib/offline-session.ts`, `frontend/src/lib/offline-metadata.ts`, their `.test.tsx` files, `docs/issues/030-offline-navigation.md`. Modify page.tsx, README.md and #25/#26 evidence documents.

**Interfaces:**

```ts
class HttpError extends Error { status: number; }
class NetworkError extends Error {}
request<T>(path: string, init?: RequestInit): Promise<T>;
type OfflineIdentity = { user: { id: string; email: string }; generation: string };
readOfflineIdentity(): OfflineIdentity | null;
establishOfflineIdentity(user: OfflineIdentity['user']): OfflineIdentity;
invalidateOfflineIdentity(): void;
subscribeOfflineIdentity(listener: (value: OfflineIdentity | null) => void): () => void;
isCurrentIdentity(identity: OfflineIdentity): boolean;
readWorkspaces(userId: string): Promise<WorkspaceSummary[] | null>;
writeWorkspaces(identity: OfflineIdentity, rows: WorkspaceSummary[]): Promise<void>;
readNotes(userId: string, workspaceId: string): Promise<NoteSummary[] | null>;
writeNotes(identity: OfflineIdentity, workspaceId: string, rows: NoteSummary[]): Promise<void>;
markVisited(identity: OfflineIdentity, note: NoteSummary): Promise<void>;
readVisitedNoteIds(userId: string): Promise<string[]>;
removeWorkspace(userId: string, workspaceId: string): Promise<void>;
clearUserMetadata(userId: string): Promise<void>;
```

- [x] Write failing tests first: transport rejection creates NetworkError; 401/403/404/500 remain HttpError even if response JSON malformed; CSRF denial prevents mutation; identity establish/invalidate/change events; generation mismatch rejects late writes; metadata isolated by user/workspace; cached-empty list differs from cache miss; visited-note filtering; logout lock survives reload. Run RED.
- [x] Move existing request behavior to api-request.ts with classified errors; fetch transport wrapper only wraps fetch rejection, not parse or HTTP errors. Never fallback on arbitrary Error.
- [x] Implement localStorage identity plus explicit durable logout marker. Guard storage exceptions. `invalidateOfflineIdentity` replaces record with a locked generation, not mere deletion, so later /auth/me cookie cannot unlock without explicit login. `storage` listeners publish account changes to other tabs.
- [x] Implement native IDB metadata store, user/workspace tuple keys and visited IDs. Transactions must settle on complete/error/abort and reject errors. Recheck identity generation before commit and before UI publication. Writes from stale generations cannot overwrite new identity's metadata.
- [x] Integrate page without broad refactor: authenticate network first; offline fallback only after transport failure and only if identity not locked. Always validate identity/current generation on asynchronous completion. Explicit /auth/me 401 locks/clears UI. List transport failures read user-scoped metadata. Only visited-note IDs appear offline. Cache successful metadata, mark visited after note hydration.
- [x] On logout immediately invalidate identity, clear user/workspace/notes/selected content and close selected socket; then attempt remote logout. Handle offline remote failure with Spanish explanation, not unhandled rejection. Other tabs must lock too.
- [x] On online event revalidate identity and refresh current workspace/list, preserving selected IDs rather than choosing first. Explicit removed/inaccessible resources disappear and their cached metadata is purged so a later offline load cannot resurrect known-revoked access. Resource 403/404 clears that selection; session 401 locks all private UI. No cache fallback for denied requests. Revalidation only updates summaries, never Y.Doc. Editor effect dependencies must use user ID and note ID, not refreshed object identity.
- [ ] Tests GREEN, lint, typecheck, build, post-build typecheck. Browser controller checks production offline reload, account switch, two-tab logout, denied requests, and reconnection metadata refresh with unchanged content. Record actual evidence, no unrun claims.
- [ ] Commit owned files only `feat: restore user-scoped note navigation offline (#30)`. Independent spec then quality review gates publication and acceptance closure.

## Implementation evidence (2026-10-05)

Implemented Task1 helpers/page and documentation. Added production snapshots
`isOfflineIdentityLocked()` and `readOfflineGeneration()` to distinguish a
fresh profile from a durable logout lock and reject stale auth completions.
Frontend 52/52 tests and backend 54/54 tests pass; both modules lint/typecheck/
build pass, including frontend postbuild and post-build typecheck. The first
RED run failed on absent helper modules; subsequent targeted assertion REDs
covered generation/storage/transaction/revocation races before their fixes.

Browser acceptance and independent spec/quality reviews remain for the main
controller. No new UI/browser acceptance is claimed and #25/#26/#30 remain
open. Details: `docs/issues/030-offline-navigation.md`.
