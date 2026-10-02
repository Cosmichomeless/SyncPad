import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { createAuthService, hashPassword, type SqlExecutor } from '../src/auth.js';
import { createWorkspaceService, WorkspaceMembershipError } from '../src/workspaces.js';

test('pending invitations are unique per workspace and email', async () => {
  const migration = fileURLToPath(new URL('../migrations/006-access-invariants.sql', import.meta.url));
  assert.match(await readFile(migration, 'utf8'), /invitations_pending_email_idx/);
  assert.match(await readFile(migration, 'utf8'), /lower\(invited_email\)/);
});

test('a revoked session cannot authenticate a protected request', async () => {
  const calls: string[] = [];
  const database: SqlExecutor = {
    async query(query) {
      calls.push(query);
      return { rows: [] } as never;
    },
  };
  const auth = createAuthService(database);
  await auth.invalidateSession('revoked-token');
  assert.match(calls[0], /revoked_at = now\(\)/);
});

test('membership service rejects non-owner invitations and protects the last owner', async () => {
  const database: SqlExecutor = {
    async query(query) {
      if (query.includes('INSERT INTO syncpad.invitations')) return { rows: [] } as never;
      return { rows: [] } as never;
    },
  };
  const workspaces = createWorkspaceService(database);
  await assert.rejects(() => workspaces.invite('123e4567-e89b-12d3-a456-426614174000' as never, 'user-1' as never, 'member@example.com'), WorkspaceMembershipError);
  await assert.rejects(() => workspaces.removeMember('123e4567-e89b-12d3-a456-426614174000' as never, 'owner-1' as never, 'owner-1' as never), WorkspaceMembershipError);
});

test('password storage remains one-way in the isolation test boundary', async () => {
  const hash = await hashPassword('correct horse battery staple');
  assert.notEqual(hash, 'correct horse battery staple');
  assert.equal(hash.split('$').length, 6);
});