# Disconnected local editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make typing local-first, preserving text and displaying pending changes while disconnected (#27).

**Architecture:** Compute the minimal replacement span between textarea strings and apply that transaction to Y.Text before checking network connectivity. Persistence observes the resulting document as in #25. A pending flag indicates disconnected changes; confirmed synchronization states will be implemented in #28/#29.

**Tech Stack:** Yjs, React/TypeScript, node:test/fake-indexeddb.

## Global Constraints

- Preserve original user changes and limit edits to this delivery.
- Never treat socket.send as durable server acknowledgement.
- Never replace the entire Y.Text on each keystroke: retain unchanged CRDT identities for concurrent editing.

## [S1] Requirements

Aplicar cada edición al documento local antes de respuesta del servidor.
- Escribir funciona durante desconexión.
- La UI indica que hay cambios pendientes sin perder el texto.

### Task 1: Local-first incremental text edits

**Covers:** [S1].

**Files:** Modify `frontend/src/lib/note-document.ts`, `frontend/src/app/page.tsx`; create `frontend/tests/local-editing.test.tsx`, `docs/issues/027-local-editing.md`; update README.md.

**Interfaces:** `applyLocalTextEdit(document: EditorDocument, next: string): boolean`; returns whether content changed, transaction origin exported `LOCAL_EDIT_ORIGIN`. Existing persistence writes resulting updates; reconnect behavior remains #28.

- [ ] Write tests first for insertion/deletion/replacement/unchanged/Unicode, retained unaffected character identities, two docs editing different locations then merging, edits with no network/socket, exact reopen via #25 persistence. Run RED.
- [ ] Implement minimal splice using longest common UTF-16 prefix/suffix (Y.Text indices use UTF-16):

```ts
const before = document.content.toString();
if (before === next) return false;
let start = 0;
while (start < before.length && start < next.length && before[start] === next[start]) start++;
let endBefore = before.length;
let endNext = next.length;
while (endBefore > start && endNext > start && before[endBefore - 1] === next[endNext - 1]) {
  endBefore--; endNext--;
}
document.doc.transact(() => {
  document.content.delete(start, endBefore - start);
  document.content.insert(start, next.slice(start, endNext));
}, LOCAL_EDIT_ORIGIN);
return true;
```

Guard splice boundaries against splitting surrogate pairs when comparing different Unicode characters; extend boundary appropriately and test emoji edits.

- [ ] Integrate editContent: require hydrated document only (track readiness), apply local transaction and render text immediately; mark pending independently of socket availability. If socket OPEN send existing update payload, but do not label server-confirmed state. Display accessible Spanish pending text, preserve text on socket close. Disable textarea during hydration/storage failure to avoid lost pre-hydration edits. Clear pending only at safe note lifecycle boundary; acknowledgements belong to #28.
- [ ] Run tests/lint/typecheck/build/post-build typecheck. Main browser verifies blocked-network typing, persistence during selection/reopen, pending status and no text loss. Record limitations: full reload awaits #26/#30 and bidirectional synchronization awaits #28.
- [ ] Commit owned files only `feat: edit notes locally while disconnected (#27)`; independent spec/quality review before publication.
