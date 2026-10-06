# Accessible synchronization status Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expose truthful offline/reconnecting/syncing/up-to-date states and manual retry without losing edits (#29).

**Architecture:** Render controller state from #28 in a small accessible component; retry calls the existing controller and does not create a document. Connection state and storage errors remain separate.

**Tech Stack:** React/TypeScript, existing note-sync controller, node:test.

## Global Constraints

- Preserve original user CSS/backend-test changes.
- Up-to-date requires durable matching acknowledgement, not socket open/send.
- Retrying never clears/recreates Yjs content or persistence.

## [S1] Requirements

Mostrar offline, reconectando, sincronizando y al día.
- El indicador refleja transiciones reales de conexión.
- Un fallo persistente ofrece una acción de reintento sin borrar cambios.

### Task 1: Accessible controller-driven status

**Covers:** [S1].

**Files:** Create `frontend/src/app/note-sync-status.tsx`, `frontend/tests/sync-status.test.tsx`, `docs/issues/029-sync-status.md`. Modify page.tsx, README.md and note-sync tests only where needed for retry evidence.

**Interfaces:**

```tsx
type NoteSyncStatusProps = { state: SyncState; retry: () => void };
const labels: Record<SyncState, string> = {
  offline: 'Sin conexión',
  reconnecting: 'Reconectando',
  syncing: 'Sincronizando',
  'up-to-date': 'Al día',
};
export default function NoteSyncStatus({ state, retry }: NoteSyncStatusProps) {
  return <div>
    <p role="status" aria-live="polite" aria-atomic="true">{labels[state]}</p>
    {state !== 'up-to-date' && <button type="button" onClick={retry}
      disabled={state === 'offline'}>Reintentar conexión</button>}
  </div>;
}
```

- [ ] Write render tests for every exact Spanish label/live-region semantics and retry availability/disabled-offline behavior. Controller tests assert persistent failure retains text, manual retry cancels old backoff, old socket callbacks cannot mark the new connection up-to-date, and ack after newer edit remains syncing. Run RED for missing UI behavior; no new production test-only methods.
- [ ] Implement component with actual SyncState type import and integrate next to note title. Decorative status dot aria-hidden; avoid competing live indicators. Retry delegates to current controller handle only; retain text/doc/persistence. Existing storage/API alerts remain separate.
- [ ] Run frontend tests/lint/typecheck/buildpostbuild/postbuildtypecheck. Main browser verifies real connection transitions and persistent outage/manual retry with exact text retained; record only actual evidence.
- [ ] Commit scoped files `feat: show truthful sync status and retry (#29)`; independent reviews before publication/closure.
