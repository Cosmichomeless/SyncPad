import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';

const roomUrl = (port: number) => `ws://127.0.0.1:${port}/ws?noteId=123e4567-e89b-12d3-a456-426614174001`;

async function fixture() {
  const auth: AuthService = {
    async register() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async authenticate() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token ? { id: token as never, email: `${token}@example.com` } : null; },
    async invalidateSession() {},
  };
  const notes: NoteService = {
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; }, async canAccess() { return true; },
  };
  const app = createSyncServer({ auth, notes, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, port: (app.server.address() as { port: number }).port };
}

function waitForAwareness(client: WebSocket) {
  return new Promise<{ users: Array<{ connectionId: string }> }>((resolve) => {
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as { type: string; users?: Array<{ connectionId: string }> };
      if (message.type === 'awareness') { client.off('message', onMessage); resolve({ users: message.users ?? [] }); }
    };
    client.on('message', onMessage);
  });
}

test('awareness broadcasts joins and removes disconnected participants', { timeout: 4000 }, async (t) => {
  const { app, port } = await fixture();
  t.after(() => app.close());
  const headers = { origin: 'http://127.0.0.1:3000' };
  const first = new WebSocket(roomUrl(port), { headers: { ...headers, cookie: 'syncpad_session=one' } });
  const firstJoined = waitForAwareness(first);
  await once(first, 'open');
  await firstJoined;
  const joined = waitForAwareness(first);
  const second = new WebSocket(roomUrl(port), { headers: { ...headers, cookie: 'syncpad_session=two' } });
  await once(second, 'open');
  assert.equal((await joined).users.length, 2);
  const left = waitForAwareness(first);
  second.close();
  assert.equal((await left).users.length, 1);
  first.terminate();
});