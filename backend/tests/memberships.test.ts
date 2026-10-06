import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceService, InvitationConflictError, WorkspaceMembershipError } from '../src/workspaces.js';

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
test('a still-valid pending invitation is not replaced silently, an expired one is refreshed in place', async () => {
  const db = database([]);
  const service = createWorkspaceService(db);
  // No row inserted/updated and the caller is not an OWNER: the generic permission error.
  await assert.rejects(() => service.invite('workspace-1' as never, 'member-1' as never, 'a@example.com'), /Only an OWNER/);
  assert.match(db.calls[0], /ON CONFLICT \(workspace_id, lower\(invited_email\)\) WHERE accepted_at IS NULL/);
  assert.match(db.calls[0], /WHERE syncpad\.invitations\.expires_at <= now\(\)/);
});

test('an owner whose invitation conflicts with a live one is told to revoke it first', async () => {
  const calls: string[] = [];
  const service = createWorkspaceService({
    async query<T>(query: string) {
      calls.push(query);
      // INSERT (conflict, no row) → owner check (is owner) → already-a-member check (not a member).
      return { rows: (calls.length === 1 || calls.length === 3 ? [] : [{ '?column?': 1 }]) as T[] } as never;
    },
  });
  await assert.rejects(() => service.invite('workspace-1' as never, 'owner-1' as never, 'a@example.com'), (error: unknown) => error instanceof InvitationConflictError && error.code === 'INVITATION_PENDING');
});

test('inviting someone who is already a member is reported as such, not as a pending invitation', async () => {
  const service = createWorkspaceService({
    async query<T>(query: string) {
      // The INSERT inserts nothing; the owner check and the member check both find a row.
      return { rows: (/INSERT/.test(query) ? [] : [{ '?column?': 1 }]) as T[] } as never;
    },
  });
  await assert.rejects(() => service.invite('workspace-1' as never, 'owner-1' as never, 'a@example.com'), (error: unknown) => error instanceof InvitationConflictError && error.code === 'ALREADY_MEMBER');
});

test('member listing is membership-scoped and reports not-a-member as null', async () => {
  const none = createWorkspaceService(database([]));
  assert.equal(await none.listMembers('workspace-1' as never, 'stranger' as never), null);

  const db = database([
    { user_id: 'u1', email: 'owner@example.com', role: 'OWNER', created_at: '2026-10-01T00:00:00.000Z' },
    { user_id: 'u2', email: 'member@example.com', role: 'MEMBER', created_at: new Date('2026-10-02T00:00:00.000Z') },
  ]);
  const members = await createWorkspaceService(db).listMembers('workspace-1' as never, 'u1' as never);
  assert.deepEqual(members?.map((member) => [member.email, member.role, member.joinedAt]), [
    ['owner@example.com', 'OWNER', '2026-10-01T00:00:00.000Z'],
    ['member@example.com', 'MEMBER', '2026-10-02T00:00:00.000Z'],
  ]);
  assert.match(db.calls[0], /viewer\.user_id = \$2/);
});

test('invitation listing and revocation are owner-only and never expose the token hash', async () => {
  const denied = createWorkspaceService(database([]));
  await assert.rejects(() => denied.listInvitations('workspace-1' as never, 'member-1' as never), WorkspaceMembershipError);
  await assert.rejects(() => denied.revokeInvitation('workspace-1' as never, 'member-1' as never, 'inv-1'), WorkspaceMembershipError);

  const calls: string[] = [];
  const past = new Date(Date.now() - 1000).toISOString();
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const service = createWorkspaceService({
    async query<T>(query: string) {
      calls.push(query);
      if (/FROM syncpad\.invitations/.test(query)) {
        return { rows: [{ id: 'i1', invited_email: 'a@example.com', expires_at: future }, { id: 'i2', invited_email: 'b@example.com', expires_at: past }] as T[] } as never;
      }
      return { rows: [{ ok: 1 }] as T[] } as never;
    },
  });
  const pending = await service.listInvitations('workspace-1' as never, 'owner-1' as never);
  assert.deepEqual(pending.map((invitation) => [invitation.email, invitation.expired]), [['a@example.com', false], ['b@example.com', true]]);
  assert.ok(pending.every((invitation) => !('token' in invitation) && !('token_hash' in invitation)));
  assert.doesNotMatch(calls.at(-1)!, /token_hash/);

  const revoking = database([{ id: 'i1' }]);
  await createWorkspaceService(revoking).revokeInvitation('workspace-1' as never, 'owner-1' as never, 'i1');
  assert.match(revoking.calls[0], /DELETE FROM syncpad\.invitations/);
  assert.match(revoking.calls[0], /actor\.role = 'OWNER'/);
  assert.match(revoking.calls[0], /accepted_at IS NULL/);
});
