import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';

const noteId = '123e4567-e89b-12d3-a456-426614174001';

async function fixture() {
  const auth: AuthService = {
    async register() { return { id: 'user-1' as never, email: 'person@example.com' }; },
    async authenticate() { return { id: 'user-1' as never, email: 'person@example.com' }; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token === 'session-token' ? { id: 'user-1' as never, email: 'person@example.com' } : null; },
    async invalidateSession() {},
  };
  const notes: NoteService = {
    async create() { return null; },
    async listForUser() { return []; },
    async rename() { return null; },
    async delete() { return false; },
    async canAccess(userId) { return userId === 'user-1'; },
  };
  const app = createSyncServer({ auth, notes, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, url: `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws?noteId=${noteId}` };
}

test('authorized member can upgrade a WebSocket room', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const client = new WebSocket(url, { headers: { cookie: 'syncpad_session=session-token', origin: 'http://127.0.0.1:3000' } });
  t.after(() => client.terminate());
  await once(client, 'open');
  await app.close();
});

test('anonymous room upgrades are rejected before content handling', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const client = new WebSocket(url, { headers: { origin: 'http://127.0.0.1:3000' } });
  t.after(() => client.terminate());
  const [error] = await once(client, 'error');
  assert.match(error.message, /Unexpected server response: 401/);
});