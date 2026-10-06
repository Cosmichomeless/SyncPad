import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AuthService } from '../src/auth.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import { InvitationConflictError, type WorkspaceService } from '../src/workspaces.js';

const user = { id: 'user-1' as never, email: 'person@example.com' };
const workspace = { id: '123e4567-e89b-12d3-a456-426614174000' as never, name: 'Team', updatedAt: '2026-10-02T00:00:00.000Z', role: 'OWNER' as const, createdBy: user.id };
const memberId = '223e4567-e89b-12d3-a456-426614174111';
const invitationId = '323e4567-e89b-12d3-a456-426614174222';

function fixture() {
  const auth: AuthService = {
    async register() { return user; },
    async authenticate() { return user; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token === 'session-token' ? user : null; },
    async invalidateSession() { },
  };
  const workspaces: WorkspaceService = {
    async create() { return workspace; },
    async listForUser(userId) { return userId === user.id ? [workspace] : []; },
    async getForUser(userId, workspaceId) { return userId === user.id && workspaceId === workspace.id ? workspace : null; },
    async invite(_workspaceId, _ownerId, email) {
      if (email === 'taken@example.com') throw new InvitationConflictError('ALREADY_MEMBER', 'That person is already a member of this workspace');
      return { workspaceId: workspace.id, email: 'member@example.com', token: 'invite-token' };
    },
    async acceptInvitation() { return workspace.id; },
    async removeMember() { },
    async listMembers(workspaceId, userId) {
      return workspaceId === workspace.id && userId === user.id ? [{ userId: user.id, email: user.email, role: 'OWNER', joinedAt: '2026-10-02T00:00:00.000Z' }] : null;
    },
    async listInvitations() { return [{ id: invitationId, email: 'member@example.com', expiresAt: '2026-10-09T00:00:00.000Z', expired: false }]; },
    async revokeInvitation(_workspaceId, _ownerId, id) { if (id !== invitationId) throw new Error('Only an OWNER can revoke a pending invitation'); },
  };
  const app = createSyncServer({ auth, workspaces, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  return once(app.server, 'listening').then(() => ({ app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` }));
}

test('authenticated users can create, list and open their workspaces', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const csrf = await fetch(url + '/auth/csrf');
  const csrfToken = (await csrf.json() as { csrfToken: string }).csrfToken;
  const csrfCookie = csrf.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const headers = { cookie: `syncpad_session=session-token; ${csrfCookie}`, 'x-csrf-token': csrfToken };
  const created = await fetch(url + '/workspaces', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Team' }) });
  assert.equal(created.status, 201);
  assert.deepEqual(await created.json(), { workspace });
  assert.equal((await (await fetch(url + '/workspaces', { headers })).json()).workspaces.length, 1);
  assert.equal((await fetch(url + '/workspaces/' + workspace.id, { headers })).status, 200);
});

test('unauthenticated users cannot list or open workspaces', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  assert.equal((await fetch(url + '/workspaces')).status, 401);
  assert.equal((await fetch(url + '/workspaces/not-a-uuid')).status, 401);
});

test('workspace owner can invite, accept and remove members through HTTP', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const csrf = await fetch(url + '/auth/csrf');
  const csrfToken = (await csrf.json() as { csrfToken: string }).csrfToken;
  const csrfCookie = csrf.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const headers = { cookie: `syncpad_session=session-token; ${csrfCookie}`, 'x-csrf-token': csrfToken };
  const invite = await fetch(url + '/workspaces/' + workspace.id + '/invitations', {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'member@example.com' }),
  });
  assert.equal(invite.status, 201);
  assert.equal((await invite.json()).invitation.token, 'invite-token');
  assert.equal((await fetch(url + '/invitations/invite-token/accept', { method: 'POST', headers })).status, 200);
  assert.equal((await fetch(url + '/workspaces/' + workspace.id + '/members/' + memberId, { method: 'DELETE', headers })).status, 204);
});

test('members and pending invitations can be listed and revoked, with identifiers validated', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const csrf = await fetch(url + '/auth/csrf');
  const csrfToken = (await csrf.json() as { csrfToken: string }).csrfToken;
  const csrfCookie = csrf.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const headers = { cookie: `syncpad_session=session-token; ${csrfCookie}`, 'x-csrf-token': csrfToken };
  const base = url + '/workspaces/' + workspace.id;

  const members = await (await fetch(base + '/members', { headers })).json() as { members: { email: string; role: string }[] };
  assert.deepEqual(members.members.map((member) => [member.email, member.role]), [[user.email, 'OWNER']]);
  assert.equal((await fetch(url + '/workspaces/not-a-uuid/members', { headers })).status, 404);
  assert.equal((await fetch(url + '/workspaces/423e4567-e89b-12d3-a456-426614174333/members', { headers })).status, 404);

  const pending = await (await fetch(base + '/invitations', { headers })).json() as { invitations: Record<string, unknown>[] };
  assert.equal(pending.invitations.length, 1);
  assert.equal('token' in pending.invitations[0], false, 'the invite token must never be listed');

  assert.equal((await fetch(base + '/invitations/' + invitationId, { method: 'DELETE', headers: { cookie: headers.cookie } })).status, 403, 'CSRF is required');
  assert.equal((await fetch(base + '/invitations/' + invitationId, { method: 'DELETE', headers })).status, 204);
  assert.equal((await fetch(base + '/invitations/not-a-uuid', { method: 'DELETE', headers })).status, 403);
  assert.equal((await fetch(base + '/members/not-a-uuid', { method: 'DELETE', headers })).status, 403);

  const conflict = await fetch(base + '/invitations', { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ email: 'taken@example.com' }) });
  assert.equal(conflict.status, 409);
  assert.equal(((await conflict.json()) as { error: { code: string } }).error.code, 'ALREADY_MEMBER');
});