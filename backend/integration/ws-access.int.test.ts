import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Account, createCleanDatabase, Replica, startStack, uniqueEmail, upgradeRefusal, waitFor } from './harness.js';

/** Alice owns a workspace with one note; everything runs on a freshly migrated database. */
async function setup(t: TestContext, limits = {}) {
  const db = await createCleanDatabase(t);
  const stack = await startStack(t, db.url, { limits });
  const alice = await Account.register(stack, uniqueEmail('alice'));
  const workspaceId = await alice.createWorkspace('Equipo');
  const noteId = await alice.createNote(workspaceId, 'Acta');
  return { db, stack, alice, workspaceId, noteId };
}

async function storedUpdates(pool: { query(sql: string, values?: unknown[]): Promise<{ rows: Array<{ count: string }> }> }, noteId: string) {
  return Number((await pool.query('SELECT count(*) FROM syncpad.note_updates WHERE note_id = $1', [noteId])).rows[0].count);
}

test('an authorized member connects, receives the note and saves a change', async (t) => {
  const { stack, alice, noteId, db } = await setup(t);
  const replica = await Replica.join(t, stack, noteId, alice);
  assert.equal(replica.seen.find((frame) => frame.type === 'sync')?.type, 'sync');
  assert.equal((await replica.type('hola')).type, 'ack');
  assert.equal(await storedUpdates(db.pool, noteId), 1);
});

test('connections without a right to the note are refused before any room exists', async (t) => {
  const { stack, noteId, db } = await setup(t);
  const stranger = await Account.register(stack, uniqueEmail('stranger'));
  const strangersNote = await stranger.createNote(await stranger.createWorkspace('Ajeno'), 'Privada');

  assert.equal(await upgradeRefusal(stack.ws(noteId), {}), 401, 'no cookie');
  assert.equal(await upgradeRefusal(stack.ws(noteId), { cookie: 'syncpad_session=not-a-real-session' }), 401, 'unknown session');
  assert.equal(await upgradeRefusal(stack.ws('not-a-uuid'), { cookie: stranger.sessionCookie }), 401, 'malformed note id');
  assert.equal(await upgradeRefusal(stack.ws(noteId), { cookie: stranger.sessionCookie }), 403, 'authenticated but not a member');
  assert.equal(await upgradeRefusal(stack.ws('123e4567-e89b-12d3-a456-426614174001'), { cookie: stranger.sessionCookie }), 403, 'note that does not exist');
  assert.equal(await upgradeRefusal(stack.ws(noteId), { cookie: stranger.sessionCookie, origin: 'https://evil.example' }), 403, 'foreign origin');
  assert.equal(await storedUpdates(db.pool, noteId), 0);
  assert.equal(await storedUpdates(db.pool, strangersNote), 0);
});

test('accepting an invitation is what opens the note, and removal closes it again', async (t) => {
  const { stack, alice, workspaceId, noteId } = await setup(t, { permissionRecheckMs: 600_000 });
  const bob = await Account.register(stack, uniqueEmail('bob'));
  assert.equal(await upgradeRefusal(stack.ws(noteId), { cookie: bob.sessionCookie }), 403, 'before the invitation');

  await alice.invite(workspaceId, bob);
  const first = await Replica.join(t, stack, noteId, alice);
  const second = await Replica.join(t, stack, noteId, bob);
  await first.type('compartido');
  await second.waitForText('compartido');

  const removal = await alice.request('DELETE', `/workspaces/${workspaceId}/members/${bob.id}`);
  assert.equal(removal.status, 204);
  assert.equal(await second.closed, 4403);
  assert.equal(second.seen.at(-1)?.code, 'access-revoked');
  assert.equal(first.isOpen, true, 'the owner is undisturbed');
  assert.equal(await upgradeRefusal(stack.ws(noteId), { cookie: bob.sessionCookie }), 403, 'cannot come back');
});

test('a membership deleted straight in the database stops that member from saving anything', async (t) => {
  const { stack, alice, workspaceId, noteId, db } = await setup(t, { permissionRecheckMs: 20 });
  const bob = await Account.register(stack, uniqueEmail('bob'));
  await alice.invite(workspaceId, bob);
  const watcher = await Replica.join(t, stack, noteId, alice);
  const intruder = await Replica.join(t, stack, noteId, bob);

  await db.pool.query('DELETE FROM syncpad.memberships WHERE workspace_id = $1 AND user_id = $2', [workspaceId, bob.id]);
  assert.equal(await intruder.closed, 4403, 'the periodic recheck found the revocation');
  assert.equal(await storedUpdates(db.pool, noteId), 0);

  // Whatever the evicted client still has in flight is never stored or shown to anyone.
  intruder.doc.content.insert(0, 'intruso');
  assert.equal(intruder.isOpen, false);
  await new Promise((resolve) => setTimeout(resolve, 100));
  assert.equal(watcher.text, '');
  assert.equal(await storedUpdates(db.pool, noteId), 0);
});

test('logging out and an expired session both end access', async (t) => {
  const { stack, alice, noteId, db } = await setup(t, { permissionRecheckMs: 600_000 });
  const live = await Replica.join(t, stack, noteId, alice);
  assert.equal((await alice.request('POST', '/auth/logout')).status, 204);
  assert.equal(await live.closed, 4403);
  assert.equal(await upgradeRefusal(stack.ws(noteId), { cookie: alice.sessionCookie }), 401, 'the revoked session is dead');

  const again = await Account.register(stack, uniqueEmail('again'));
  const own = await again.createNote(await again.createWorkspace('Otro'), 'Mía');
  await db.pool.query(`UPDATE syncpad.sessions SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [again.id]);
  assert.equal(await upgradeRefusal(stack.ws(own), { cookie: again.sessionCookie }), 401, 'the expired session is dead');
});

test('deleting a note tells its collaborators, erases its history and closes the door', async (t) => {
  const { stack, alice, noteId, db } = await setup(t);
  const replica = await Replica.join(t, stack, noteId, alice);
  await replica.type('efímera');
  assert.equal(await storedUpdates(db.pool, noteId), 1);

  assert.equal((await alice.request('DELETE', `/notes/${noteId}`)).status, 204);
  assert.equal(await replica.closed, 4404);
  assert.equal(replica.seen.some((frame) => frame.code === 'note-deleted' && frame.retryable === false), true);
  await waitFor(async () => (await storedUpdates(db.pool, noteId)) === 0, 'the cascade to erase the updates');
  assert.equal(await upgradeRefusal(stack.ws(noteId), { cookie: alice.sessionCookie }), 403);
});
