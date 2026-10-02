import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceService, WorkspaceMembershipError } from '../src/workspaces.js';

function database(rows: unknown[]) {
  const calls: string[] = [];
  return {
    calls,
    async query<T>(query: string) {
      calls.push(query);
      const result: { rows: T[] } = { rows: rows as T[] };
      return result as never;
    },
  };
}

test('invitation query is owner-scoped and returns a token only to the caller', async () => {
  const db = database([{ workspace_id: 'workspace-1' }]);
  const service = createWorkspaceService(db);
  const invitation = await service.invite('workspace-1' as never, 'owner-1' as never, 'Member@Example.com');
  assert.equal(invitation.email, 'member@example.com');
  assert.ok(invitation.token.length > 20);
  assert.match(db.calls[0], /role = 'OWNER'/);
  assert.match(db.calls[0], /token_hash/);
});

test('used or unauthorized invitations are rejected', async () => {
  const db = database([]);
  const service = createWorkspaceService(db);
  await assert.rejects(() => service.invite('workspace-1' as never, 'member-1' as never, 'member@example.com'), WorkspaceMembershipError);
  await assert.rejects(() => service.acceptInvitation('invalid', 'user-1' as never, 'member@example.com'), WorkspaceMembershipError);
});

test('removal query protects the last OWNER', async () => {
  const db = database([]);
  const service = createWorkspaceService(db);
  await assert.rejects(() => service.removeMember('workspace-1' as never, 'owner-1' as never, 'owner-1' as never), WorkspaceMembershipError);
  assert.match(db.calls[0], /count\(\*\).*role = 'OWNER'/s);
});