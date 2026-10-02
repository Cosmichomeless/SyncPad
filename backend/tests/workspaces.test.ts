import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceService, WorkspaceNameError } from '../src/workspaces.js';

function fakeDatabase(rows: unknown[]) {
  const calls: Array<{ query: string; values?: unknown[] }> = [];
  return {
    calls,
    async query<T>(query: string, values?: unknown[]) {
      calls.push({ query, values });
        const selectedRows = values?.[0] === 'user-2' ? [] : rows;
      const result: { rows: T[] } = { rows: selectedRows as T[] };
      return result as never;
    },
  };
}

test('workspace creation query assigns the creator as OWNER', async () => {
  const database = fakeDatabase([{ id: 'workspace-1', name: 'Team', updated_at: '2026-10-02T00:00:00.000Z', created_by: 'user-1' }]);
  const service = createWorkspaceService(database);
  const workspace = await service.create('user-1' as never, ' Team ');
  assert.equal(workspace.name, 'Team');
  assert.match(database.calls[0].query, /'OWNER'/);
  assert.deepEqual(database.calls[0].values, ['Team', 'user-1']);
});

test('workspace names are validated before querying the database', async () => {
  const database = fakeDatabase([]);
  const service = createWorkspaceService(database);
  await assert.rejects(() => service.create('user-1' as never, '   '), WorkspaceNameError);
  assert.equal(database.calls.length, 0);
});

test('workspace listing and detail are membership-scoped', async () => {
  const rows = [{ id: 'workspace-1', name: 'Team', updated_at: '2026-10-02T00:00:00.000Z', created_by: 'user-1' }];
  const database = fakeDatabase(rows);
  const service = createWorkspaceService(database);
  assert.equal((await service.listForUser('user-1' as never)).length, 1);
  assert.equal((await service.getForUser('user-2' as never, 'workspace-1' as never)), null);
  assert.equal(database.calls.every(({ query }) => query.includes('memberships.user_id')), true);
});