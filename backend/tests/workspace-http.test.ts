import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AuthService } from '../src/auth.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { WorkspaceService } from '../src/workspaces.js';

const user = { id: 'user-1' as never, email: 'person@example.com' };
const workspace = { id: '123e4567-e89b-12d3-a456-426614174000' as never, name: 'Team', updatedAt: '2026-10-02T00:00:00.000Z', createdBy: user.id };

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
    async invite() { return { workspaceId: workspace.id, email: 'member@example.com', token: 'invite-token' }; },
    async acceptInvitation() { return workspace.id; },
    async removeMember() { },
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
  assert.equal((await fetch(url + '/workspaces/' + workspace.id + '/members/user-2', { method: 'DELETE', headers })).status, 204);
});