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
type Presence = { users: Array<{ connectionId: string; userId: string; cursor?: { anchor: string; head: string } | null }>; self: string };

function nextAwareness(client: WebSocket, accept: (message: Presence) => boolean = () => true) {
  return new Promise<Presence>((resolve) => {
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as { type: string } & Presence;
      if (message.type === 'awareness' && accept(message)) { client.off('message', onMessage); resolve(message); }
    };
    client.on('message', onMessage);
  });
}

test('awareness relays ephemeral cursors, tells each client who it is, and drops them on disconnect', { timeout: 4000 }, async (t) => {
  const { app, port } = await fixture();
  t.after(() => app.close());
  const headers = { origin: 'http://127.0.0.1:3000' };
  const first = new WebSocket(roomUrl(port), { headers: { ...headers, cookie: 'syncpad_session=one' } });
  const firstJoined = nextAwareness(first);
  await once(first, 'open');
  const alone = await firstJoined;
  assert.equal(alone.users.length, 1);
  assert.equal(alone.self, alone.users[0].connectionId);

  const second = new WebSocket(roomUrl(port), { headers: { ...headers, cookie: 'syncpad_session=two' } });
  const secondJoined = nextAwareness(second);
  await once(second, 'open');
  const together = await secondJoined;
  assert.equal(together.users.length, 2);
  assert.notEqual(together.self, alone.self, 'each connection receives its own id');
  assert.equal(together.users.find((user) => user.connectionId === together.self)?.userId, 'two');

  const cursor = { anchor: 'AQID', head: 'AQIE' };
  const seen = nextAwareness(first, (message) => message.users.some((user) => user.cursor));
  second.send(JSON.stringify({ type: 'awareness', cursor }));
  const withCursor = await seen;
  assert.deepEqual(withCursor.users.find((user) => user.userId === 'two')?.cursor, cursor);
  assert.equal(withCursor.users.find((user) => user.userId === 'one')?.cursor ?? null, null);

  // A ping without `cursor` keeps it; null clears it.
  const kept = nextAwareness(first);
  second.send(JSON.stringify({ type: 'awareness' }));
  assert.deepEqual((await kept).users.find((user) => user.userId === 'two')?.cursor, cursor);
  const cleared = nextAwareness(first);
  second.send(JSON.stringify({ type: 'awareness', cursor: null }));
  assert.equal((await cleared).users.find((user) => user.userId === 'two')?.cursor ?? null, null);

  const left = nextAwareness(first);
  second.close();
  assert.equal((await left).users.length, 1);
  first.terminate();
});

test('a malformed cursor is rejected without poisoning the room', { timeout: 4000 }, async (t) => {
  const { app, port } = await fixture();
  t.after(() => app.close());
  const headers = { origin: 'http://127.0.0.1:3000' };
  for (const bad of [{ anchor: 'x', head: 5 }, 'text', { anchor: '<script>', head: 'AQID' }, { anchor: 'A'.repeat(300), head: 'AQID' }, { anchor: '', head: 'AQID' }]) {
    const client = new WebSocket(roomUrl(port), { headers: { ...headers, cookie: 'syncpad_session=one' } });
    const joined = nextAwareness(client);
    await once(client, 'open');
    await joined;
    const closed = once(client, 'close');
    client.send(JSON.stringify({ type: 'awareness', cursor: bad }));
    const [code] = await closed;
    assert.equal(code, 1003, `rejected ${JSON.stringify(bad).slice(0, 30)}`);
  }
});
