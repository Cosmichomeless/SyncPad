import assert from 'node:assert/strict';
import { test } from 'node:test';
import 'fake-indexeddb/auto';
import type { NoteSummary, WorkspaceSummary } from '@syncpad/shared';
import { establishOfflineIdentity, invalidateOfflineIdentity } from '../src/lib/offline-session';
import { clearUserMetadata, markVisited, readNotes, readVisitedNoteIds, readWorkspaces, removeWorkspace, writeNotes, writeWorkspaces } from '../src/lib/offline-metadata';
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'window', { value: { localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } } });
const workspace = { id: 'w', name: 'Workspace', updatedAt: '2026-01-01' } as WorkspaceSummary;
const note = { id: 'n', workspaceId: 'w', title: 'Visited', updatedAt: '2026-01-01' } as NoteSummary;
test('metadata isolates users and workspaces, distinguishes empty from miss, and tracks visits', async () => {
  const a = establishOfflineIdentity({ id: 'a', email: 'a@example.test' });
  assert.equal(await readWorkspaces('a'), null);
  await writeWorkspaces(a, []);
  assert.deepEqual(await readWorkspaces('a'), []);
  await writeWorkspaces(a, [workspace]);
  await writeNotes(a, 'w', [note, { ...note, id: 'unvisited' } as NoteSummary]);
  await markVisited(a, note);
  assert.deepEqual(await readVisitedNoteIds('a'), ['n']);
  const visited = await readVisitedNoteIds('a');
  assert.deepEqual((await readNotes('a', 'w'))?.filter(row => visited.includes(row.id)), [note]);
  assert.equal(await readNotes('a', 'other'), null);
  assert.equal(await readWorkspaces('b'), null);
  assert.deepEqual(await readVisitedNoteIds('b'), []);
  await removeWorkspace('a', 'w');
  assert.deepEqual(await readWorkspaces('a'), []);
  assert.equal(await readNotes('a', 'w'), null);
  assert.deepEqual(await readVisitedNoteIds('a'), []);
  await clearUserMetadata('a');
  assert.equal(await readWorkspaces('a'), null);
});
test('stale generations reject writes including logout during database open', async () => {
  const a = establishOfflineIdentity({ id: 'a', email: 'a@example.test' });
  const pending = writeWorkspaces(a, [workspace]);
  invalidateOfflineIdentity();
  await assert.rejects(pending);
  const b = establishOfflineIdentity({ id: 'b', email: 'b@example.test' });
  await writeWorkspaces(b, []);
  await assert.rejects(writeNotes(a, 'w', [note]));
  await assert.rejects(markVisited(a, note));
  assert.deepEqual(await readWorkspaces('b'), []);
});
test('authoritative note removal purges visits and late hydration cannot resurrect a removed note', async () => {
  const identity = establishOfflineIdentity({ id: 'revoked', email: 'revoked@example.test' });
  await writeNotes(identity, 'w', [note]);
  await markVisited(identity, note);
  await writeNotes(identity, 'w', []);
  assert.deepEqual(await readVisitedNoteIds(identity.user.id), []);
  await markVisited(identity, note);
  assert.deepEqual(await readVisitedNoteIds(identity.user.id), []);
});
test('authoritative workspace removal atomically purges its notes and visits', async () => {
  const identity = establishOfflineIdentity({ id: 'removed-workspace', email: 'removed@example.test' });
  await writeWorkspaces(identity, [workspace]);
  await writeNotes(identity, 'w', [note]);
  await markVisited(identity, note);
  await writeWorkspaces(identity, []);
  assert.equal(await readNotes(identity.user.id, 'w'), null);
  assert.deepEqual(await readVisitedNoteIds(identity.user.id), []);
});
test('transaction abort after request success rejects rather than claiming persistence', async () => {
  const identity = establishOfflineIdentity({ id: 'abort', email: 'abort@example.test' });
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try { await assert.rejects(writeWorkspaces(identity, [workspace])); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.equal(await readWorkspaces(identity.user.id), null);
});
test('identity invalidation after write request success aborts before commit', async () => {
  const identity = establishOfflineIdentity({ id: 'late', email: 'late@example.test' });
  const original = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => invalidateOfflineIdentity());
    return request;
  };
  try { await assert.rejects(writeWorkspaces(identity, [workspace])); }
  finally { IDBObjectStore.prototype.put = original; }
  assert.equal(await readWorkspaces(identity.user.id), null);
});
test('same-user new login generation cannot be overwritten by the previous login', async () => {
  const old = establishOfflineIdentity({ id: 'same', email: 'same@example.test' });
  const current = establishOfflineIdentity(old.user);
  await writeWorkspaces(current, []);
  await assert.rejects(writeWorkspaces(old, [workspace]));
  assert.deepEqual(await readWorkspaces(current.user.id), []);
});
test('database opening failures reject without claiming a cache miss', async () => {
  const original = indexedDB.open;
  indexedDB.open = () => { throw new Error('storage unavailable'); };
  try { await assert.rejects(readWorkspaces('a'), /storage unavailable/); }
  finally { indexedDB.open = original; }
});
test('aborted reads reject instead of publishing request results', async () => {
  const original = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (...args) {
    const request = original.apply(this, args);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  };
  try { await assert.rejects(readWorkspaces('a')); }
  finally { IDBObjectStore.prototype.get = original; }
});
