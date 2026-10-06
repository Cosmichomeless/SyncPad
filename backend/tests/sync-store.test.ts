import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateVector } from '@syncpad/shared';
import { createFutureNote } from '../../shared/src/testing/future-schema.js';
import type { SqlExecutor } from '../src/auth.js';
import { createPostgresSyncStore } from '../src/sync-store.js';

const NOTE = 'note-1' as never;

test('PostgreSQL sync store inserts deduplicated updates', async () => {
  const calls: Array<{ query: string; values?: unknown[] }> = [];
  const database = {
    async query(query: string, values?: unknown[]) {
      calls.push({ query, values });
      return { rowCount: 1, rows: [] } as never;
    },
  };
  const store = createPostgresSyncStore(database);
  assert.equal(await store.append(NOTE, new Uint8Array([3, 4])), true);
  assert.match(calls[0].query, /ON CONFLICT/);
  assert.equal((calls[0].values?.[2] as Buffer).equals(Buffer.from([3, 4])), true);
});

/** Just enough of the two note tables to run the store's real queries. */
function fakeDatabase() {
  const updates: Array<{ id: number; data: Buffer }> = [];
  let snapshot: { covers: number; state: Buffer } | null = null;
  let nextId = 1;
  const database: SqlExecutor = {
    async query(query: string, values: unknown[] = []) {
      if (query.includes('FROM syncpad.note_snapshots')) {
        return { rowCount: snapshot ? 1 : 0, rows: snapshot ? [{ covers_update_id: String(snapshot.covers), state: snapshot.state }] : [] } as never;
      }
      if (query.includes('FROM syncpad.note_updates')) {
        const rows = updates.filter((row) => row.id > Number(values[1])).map((row) => ({ id: String(row.id), update_data: row.data }));
        return { rowCount: rows.length, rows } as never;
      }
      if (query.startsWith('INSERT INTO syncpad.note_updates')) {
        updates.push({ id: nextId++, data: values[2] as Buffer });
        return { rowCount: 1, rows: [] } as never;
      }
      if (query.includes('INSERT INTO syncpad.note_snapshots')) {
        if (!snapshot || snapshot.covers < Number(values[1])) snapshot = { covers: Number(values[1]), state: values[2] as Buffer };
        return { rowCount: 1, rows: [] } as never;
      }
      throw new Error(`unexpected query: ${query}`);
    },
  };
  return { database, updates, snapshotOf: () => snapshot };
}

/** A client writing `count` separate edits; returns each incremental update. */
function edits(count: number) {
  const author = createNoteDocument();
  const produced: Uint8Array[] = [];
  author.doc.on('update', (update: Uint8Array) => produced.push(update));
  for (let index = 0; index < count; index++) author.content.insert(author.content.length, `line ${index}\n`);
  return { produced, final: author };
}

function rebuild(history: Uint8Array[]) {
  const target = createNoteDocument();
  for (const update of history) applyNoteUpdate(target.doc, update);
  return target;
}

test('a snapshot plus the later updates rebuilds exactly the state of the full replay', async () => {
  const { database, snapshotOf } = fakeDatabase();
  const store = createPostgresSyncStore(database);
  const { produced, final } = edits(12);
  for (const update of produced.slice(0, 8)) await store.append(NOTE, update);

  assert.equal(await store.snapshot!(NOTE, 8), true);
  assert.ok(snapshotOf());
  for (const update of produced.slice(8)) await store.append(NOTE, update);

  const history = await store.load(NOTE);
  assert.equal(history.length, 1 + 4, 'one snapshot and only the four later updates are replayed');
  const fromSnapshot = rebuild(history);
  const fromFullReplay = rebuild(produced);
  assert.equal(fromSnapshot.content.toString(), final.content.toString());
  assert.deepEqual(encodeNoteStateVector(fromSnapshot.doc), encodeNoteStateVector(fromFullReplay.doc));
  assert.deepEqual(encodeNoteState(fromSnapshot.doc), encodeNoteState(fromFullReplay.doc));
});

test('the snapshot keeps exactly the state it was taken at', async () => {
  const { database, snapshotOf } = fakeDatabase();
  const store = createPostgresSyncStore(database);
  const { produced } = edits(6);
  for (const update of produced) await store.append(NOTE, update);
  await store.snapshot!(NOTE, 1);

  const saved = rebuild([new Uint8Array(snapshotOf()!.state)]);
  assert.deepEqual(encodeNoteState(saved.doc), encodeNoteState(rebuild(produced).doc));
});

test('snapshots chain: a second one folds the previous snapshot with newer updates', async () => {
  const { database } = fakeDatabase();
  const store = createPostgresSyncStore(database);
  const { produced, final } = edits(10);
  for (const update of produced.slice(0, 4)) await store.append(NOTE, update);
  await store.snapshot!(NOTE, 1);
  for (const update of produced.slice(4)) await store.append(NOTE, update);
  assert.equal(await store.snapshot!(NOTE, 1), true);

  const history = await store.load(NOTE);
  assert.equal(history.length, 1, 'everything is folded into the snapshot');
  assert.equal(rebuild(history).content.toString(), final.content.toString());
});

test('no snapshot is written below the threshold or when nothing changed', async () => {
  const { database, snapshotOf } = fakeDatabase();
  const store = createPostgresSyncStore(database);
  assert.equal(await store.snapshot!(NOTE, 1), false, 'an empty note has nothing to fold');
  const { produced } = edits(3);
  for (const update of produced) await store.append(NOTE, update);
  assert.equal(await store.snapshot!(NOTE, 4), false);
  assert.equal(snapshotOf(), null);
  assert.equal(await store.snapshot!(NOTE, 3), true);
  assert.equal(await store.snapshot!(NOTE, 1), false, 'already covered');
});

test('a note whose stored history is unreadable is never snapshotted', async () => {
  const { database, snapshotOf } = fakeDatabase();
  const store = createPostgresSyncStore(database);
  await store.append(NOTE, createFutureNote(2).encodeState());
  await assert.rejects(store.snapshot!(NOTE, 1));
  assert.equal(snapshotOf(), null);
});
