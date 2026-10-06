import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { Account, createCleanDatabase, Replica, startStack, uniqueEmail, waitFor } from './harness.js';

async function setup(t: TestContext, options: { snapshotEvery?: number; retentionMs?: number } = {}) {
  const db = await createCleanDatabase(t);
  const stack = await startStack(t, db.url, options);
  const alice = await Account.register(stack, uniqueEmail('alice'));
  const workspaceId = await alice.createWorkspace('Equipo');
  const noteId = await alice.createNote(workspaceId, 'Acta');
  return { db, stack, alice, workspaceId, noteId };
}

const count = async (db: { pool: import('pg').Pool }, table: 'note_updates' | 'note_snapshots', noteId: string) =>
  Number((await db.pool.query(`SELECT count(*) FROM syncpad.${table} WHERE note_id = $1`, [noteId])).rows[0].count);

test('two clients converge through the server and every accepted update is stored once', async (t) => {
  const { db, stack, alice, workspaceId, noteId } = await setup(t);
  const bob = await Account.register(stack, uniqueEmail('bob'));
  await alice.invite(workspaceId, bob);
  const first = await Replica.join(t, stack, noteId, alice);
  const second = await Replica.join(t, stack, noteId, bob);

  // Concurrent edits: neither has seen the other's change when it sends its own.
  const [a, b] = await Promise.all([first.type('A'), second.type('B')]);
  assert.equal(a.type, 'ack');
  assert.equal(b.type, 'ack');
  await waitFor(() => first.text.length === 2 && first.text === second.text, 'both replicas to converge');
  assert.deepEqual([...first.text].sort(), ['A', 'B']);
  assert.equal(await count(db, 'note_updates', noteId), 2);

  // Re-sending a stored update (a client replaying its queue) is acknowledged but not stored again.
  const replay = first.seen.find((frame) => frame.type === 'ack')!;
  assert.ok(replay);
  const stored = await db.pool.query<{ update_data: Buffer }>('SELECT update_data FROM syncpad.note_updates WHERE note_id = $1 ORDER BY id LIMIT 1', [noteId]);
  assert.equal((await first.send(stored.rows[0].update_data.toString('base64'))).type, 'ack');
  assert.equal(await count(db, 'note_updates', noteId), 2);
});

test('a restarted server rebuilds the note from what PostgreSQL holds', async (t) => {
  const { db, stack, alice, noteId } = await setup(t);
  const author = await Replica.join(t, stack, noteId, alice);
  await author.type('uno ');
  await author.type('dos ');
  await author.type('tres');
  await stack.stop();
  assert.equal(await author.closed, 1001);

  const restarted = await startStack(t, db.url);
  // Sessions live in the database too, so the same cookie still works against the new process.
  const reader = await Replica.join(t, restarted, noteId, alice);
  assert.equal(reader.text, 'uno dos tres');
  await reader.type(' y cuatro');

  const late = await Replica.join(t, restarted, noteId, alice);
  assert.equal(late.text, 'uno dos tres y cuatro');
});

test('a note is rebuilt from its snapshot plus the updates after it, once compaction removed the rest', async (t) => {
  // retentionMs 0: updates a snapshot contains are deleted at once, so the snapshot is the only copy.
  const { db, stack, alice, noteId } = await setup(t, { snapshotEvery: 3, retentionMs: 0 });
  const author = await Replica.join(t, stack, noteId, alice);
  for (const word of ['a', 'b', 'c', 'd', 'e', 'f', 'g']) await author.type(word);
  await waitFor(async () => (await count(db, 'note_snapshots', noteId)) === 1, 'a snapshot to be written');
  await waitFor(async () => (await count(db, 'note_updates', noteId)) < 7, 'compaction to remove covered updates');
  await stack.stop();

  const remaining = await count(db, 'note_updates', noteId);
  assert.ok(remaining < 7, `compaction left ${remaining} of 7 updates`);
  const restarted = await startStack(t, db.url);
  const reader = await Replica.join(t, restarted, noteId, alice);
  assert.equal(reader.text, 'abcdefg');
});

test('a snapshot is derived data: discarding it loses nothing while the updates are kept', async (t) => {
  const { db, stack, alice, noteId } = await setup(t, { snapshotEvery: 2 });
  const author = await Replica.join(t, stack, noteId, alice);
  for (const word of ['x', 'y', 'z']) await author.type(word);
  await waitFor(async () => (await count(db, 'note_snapshots', noteId)) === 1, 'a snapshot to be written');
  await stack.stop();
  assert.equal(await count(db, 'note_updates', noteId), 3, 'the default retention window keeps the updates');

  await db.pool.query('DELETE FROM syncpad.note_snapshots WHERE note_id = $1', [noteId]);
  const restarted = await startStack(t, db.url);
  const reader = await Replica.join(t, restarted, noteId, alice);
  assert.equal(reader.text, 'xyz');
});

test('a different note in the same database never sees this note\'s history', async (t) => {
  const { stack, alice, workspaceId, noteId } = await setup(t);
  const other = await alice.createNote(workspaceId, 'Otra');
  const author = await Replica.join(t, stack, noteId, alice);
  await author.type('solo aquí');
  const neighbour = await Replica.join(t, stack, other, alice);
  assert.equal(neighbour.text, '');
});
