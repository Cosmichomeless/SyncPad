import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';

const workspaceId = '123e4567-e89b-12d3-a456-426614174000' as never;
const noteId = '123e4567-e89b-12d3-a456-426614174001' as never;
const note = { id: noteId, workspaceId, title: 'Plan', updatedAt: '2026-10-02T00:00:00.000Z', createdBy: 'user-1' as never };

async function fixture() {
  const auth: AuthService = {
    async register() { return { id: 'user-1' as never, email: 'person@example.com' }; },
    async authenticate() { return { id: 'user-1' as never, email: 'person@example.com' }; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token === 'session-token' ? { id: 'user-1' as never, email: 'person@example.com' } : null; },
    async invalidateSession() { },
  };
  const notes: NoteService = {
    async create(userId) { return userId === 'user-1' ? note : null; },
    async listForUser(userId) { return userId === 'user-1' ? [note] : null; },
    async rename(userId) { return userId === 'user-1' ? { ...note, title: 'Renamed' } : null; },
    async delete(userId) { return userId === 'user-1'; },
    async canAccess(userId) { return userId === 'user-1'; },
  };
  const app = createSyncServer({ auth, notes, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, url: `http://127.0.0.1:${(app.server.address() as { port: number }).port}` };
}

test('member can create, list, rename and delete notes', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const csrf = await fetch(url + '/auth/csrf');
  const csrfToken = (await csrf.json() as { csrfToken: string }).csrfToken;
  const csrfCookie = csrf.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const headers = { cookie: `syncpad_session=session-token; ${csrfCookie}`, 'x-csrf-token': csrfToken };
  const created = await fetch(url + '/workspaces/' + workspaceId + '/notes', {
    method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Plan' }),
  });
  assert.equal(created.status, 201);
  assert.equal((await (await fetch(url + '/workspaces/' + workspaceId + '/notes', { headers })).json()).notes.length, 1);
  const renamed = await fetch(url + '/notes/' + noteId, {
    method: 'PATCH', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Renamed' }),
  });
  assert.equal(renamed.status, 200);
  assert.equal((await fetch(url + '/notes/' + noteId, { method: 'DELETE', headers })).status, 204);
});

test('unauthenticated note access is rejected', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  assert.equal((await fetch(url + '/workspaces/' + workspaceId + '/notes')).status, 401);
  assert.equal((await fetch(url + '/notes/' + noteId, { method: 'DELETE' })).status, 401);
});