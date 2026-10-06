import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import type { ServerSyncMessage } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const noteId = '123e4567-e89b-12d3-a456-426614174001';
const origin = 'http://127.0.0.1:3000';
const headers = { cookie: 'syncpad_session=session-token', origin };

/** A note service whose delete() mirrors PostgreSQL: the row and its persisted updates disappear together. */
async function start(t: TestContext) {
  const state = { deleted: false, updates: [] as Uint8Array[] };
  const auth: AuthService = {
    async register() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async authenticate() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token === 'session-token' ? { id: 'user-1' as never, email: 'one@example.com' } : null; },
    async invalidateSession() {},
  };
  const notes: NoteService = {
    async create() { return null; },
    async listForUser() { return []; },
    async rename() { return null; },
    async delete(userId) {
      if (userId !== 'user-1' || state.deleted) return false;
      state.deleted = true;
      state.updates = [];
      return true;
    },
    async canAccess(userId) { return userId === 'user-1' && !state.deleted; },
  };
  const syncStore: SyncStore = {
    async load() { return state.updates.map((update) => new Uint8Array(update)); },
    async append(_id, update) {
      if (state.deleted) throw new Error('foreign key violation');
      state.updates.push(new Uint8Array(update));
      return true;
    },
  };
  const app = createSyncServer({ auth, notes, syncStore, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { state, http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws?noteId=${noteId}` };
}

function connect(t: TestContext, url: string) {
  const socket = new WebSocket(url, { headers });
  const messages: ServerSyncMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as ServerSyncMessage));
  t.after(() => socket.terminate());
  return { socket, messages, opened: once(socket, 'open') };
}

function deleteNote(http: string, csrf = 'csrf-token') {
  return fetch(`${http}/notes/${noteId}`, {
    method: 'DELETE',
    headers: { ...headers, 'x-csrf-token': csrf, cookie: `${headers.cookie}; syncpad_csrf=csrf-token` },
  });
}

test('deleting a note tells connected clients the deletion is final and closes them', { timeout: 4000 }, async (t) => {
  const { http, ws } = await start(t);
  const client = connect(t, ws);
  await client.opened;
  const closed = once(client.socket, 'close');

  assert.equal((await deleteNote(http)).status, 204);

  const [code] = await closed;
  assert.equal(code, 4404);
  assert.deepEqual(client.messages.find((message) => message.type === 'sync-error'), { type: 'sync-error', code: 'note-deleted', retryable: false });
});

test('a client that was offline during the deletion cannot reconnect or recreate the note', { timeout: 4000 }, async (t) => {
  const { http, ws, state } = await start(t);
  assert.equal((await deleteNote(http)).status, 204);

  const returning = new WebSocket(ws, { headers });
  t.after(() => returning.terminate());
  const [error] = await once(returning, 'error');
  assert.match(error.message, /Unexpected server response: 403/);
  assert.equal(state.deleted, true);
  assert.deepEqual(state.updates, [], 'persisted updates stay retired');
});

test('a rejected delete leaves the room and its clients untouched', { timeout: 4000 }, async (t) => {
  const { http, ws } = await start(t);
  const client = connect(t, ws);
  await client.opened;
  let closedEarly = false;
  client.socket.on('close', () => { closedEarly = true; });

  assert.equal((await deleteNote(http, 'wrong-token')).status, 403);
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(closedEarly, false);
  assert.equal(client.socket.readyState, WebSocket.OPEN);
});

test('deleting twice reports not found without disturbing anything', { timeout: 4000 }, async (t) => {
  const { http } = await start(t);
  assert.equal((await deleteNote(http)).status, 204);
  assert.equal((await deleteNote(http)).status, 404);
});
