import assert from 'node:assert/strict';
import test from 'node:test';
import { createNoteService, NoteTitleError } from '../src/notes.js';

function database(rows: unknown[]) {
    const calls: Array<{ query: string; values?: unknown[] }> = [];
    return {
        calls,
        async query<T>(query: string, values?: unknown[]) {
            calls.push({ query, values });
            const result: { rows: T[] } = { rows: rows as T[] };
            return result as never;
        },
    };
}

test('note creation is membership-scoped and titles are normalized', async () => {
    const db = database([{ id: 'note-1', workspace_id: 'workspace-1', title: 'Plan', created_by: 'user-1', updated_at: '2026-10-02T00:00:00.000Z' }]);
    const service = createNoteService(db);
    const note = await service.create('user-1' as never, 'workspace-1' as never, ' Plan ');
    assert.equal(note?.title, 'Plan');
    assert.match(db.calls[0].query, /memberships/);
    assert.deepEqual(db.calls[0].values, ['workspace-1', 'user-1', 'Plan']);
});

test('empty note titles are rejected before querying', async () => {
    const db = database([]);
    const service = createNoteService(db);
    await assert.rejects(() => service.create('user-1' as never, 'workspace-1' as never, '  '), NoteTitleError);
    assert.equal(db.calls.length, 0);
});

test('listing orders by workspace update time and mutations check membership', async () => {
    const db = database([]);
    const service = createNoteService(db);
    await service.listForUser('user-1' as never, 'workspace-1' as never);
    await service.rename('user-1' as never, 'note-1' as never, 'Renamed');
    await service.delete('user-1' as never, 'note-1' as never);
    assert.match(db.calls[0].query, /ORDER BY notes\.updated_at DESC/);
    assert.equal(db.calls.slice(1).every(({ query }) => query.includes('memberships')), true);
});