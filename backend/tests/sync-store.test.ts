import assert from 'node:assert/strict';
import test from 'node:test';
import { createPostgresSyncStore } from '../src/sync-store.js';

test('PostgreSQL sync store loads ordered updates and deduplicates inserts', async () => {
  const calls: Array<{ query: string; values?: unknown[] }> = [];
  const database = {
    async query<T>(query: string, values?: unknown[]) {
      calls.push({ query, values });
      if (query.startsWith('SELECT')) {
        const result: { rows: T[] } = { rows: [{ update_data: Buffer.from([1, 2]) }] as T[] };
        return result as never;
      }
      return { rowCount: 1, rows: [] } as never;
    },
  };
  const store = createPostgresSyncStore(database);
  assert.deepEqual(await store.load('note-1' as never), [new Uint8Array([1, 2])]);
  assert.equal(await store.append('note-1' as never, new Uint8Array([3, 4])), true);
  assert.match(calls[1].query, /ON CONFLICT/);
  assert.equal((calls[1].values?.[2] as Buffer).equals(Buffer.from([3, 4])), true);
});