import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateVector } from '@syncpad/shared';
import type { ServerSyncMessage } from '@syncpad/shared';
import { createFutureNote, EMPTY_STATE_VECTOR } from '../../shared/src/testing/future-schema.js';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const noteId = '123e4567-e89b-12d3-a456-426614174002';
const origin = 'http://127.0.0.1:3000';
const headers = { cookie: 'syncpad_session=session-token', origin };
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

async function start(t: TestContext, initial: Uint8Array[] = []) {
  const stored = [...initial];
  const auth: AuthService = {
    async register() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async authenticate() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token === 'session-token' ? { id: 'user-1' as never, email: 'one@example.com' } : null; },
    async invalidateSession() {},
  };
  const notes: NoteService = {
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; },
    async canAccess() { return true; },
  };
  const syncStore: SyncStore = {
    async load() { return stored.map((update) => new Uint8Array(update)); },
    async append(_id, update) { stored.push(new Uint8Array(update)); return true; },
  };
  const app = createSyncServer({ auth, notes, syncStore, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { stored, ws: `ws://127.0.0.1:${port}/ws?noteId=${noteId}` };
}

function connect(t: TestContext, url: string) {
  const socket = new WebSocket(url, { headers });
  const messages: ServerSyncMessage[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as ServerSyncMessage));
  t.after(() => socket.terminate());
  return { socket, messages, opened: once(socket, 'open') };
}

test('an update from a newer schema is refused as incompatible, not stored, and the room keeps v1', { timeout: 4000 }, async (t) => {
  const seed = createNoteDocument();
  seed.content.insert(0, 'texto v1');
  const { ws, stored } = await start(t, [encodeNoteState(seed.doc)]);

  const reader = connect(t, ws);
  await reader.opened;
  const newer = connect(t, ws);
  await newer.opened;

  const future = createFutureNote(2, encodeNoteState(seed.doc));
  const closed = once(newer.socket, 'close');
  newer.socket.send(JSON.stringify({ type: 'update', requestId: 'up-1', update: b64(future.encodeSince(encodeNoteStateVector(seed.doc))) }));

  const [code] = await closed;
  assert.equal(code, 1003);
  assert.deepEqual(newer.messages.find((message) => message.type === 'sync-error'), { type: 'sync-error', requestId: 'up-1', code: 'incompatible-schema', retryable: false });
  assert.equal(newer.messages.some((message) => message.type === 'ack'), false);
  assert.equal(stored.length, 1, 'nothing from the newer schema was made durable');
  assert.equal(reader.messages.some((message) => message.type === 'update'), false, 'other clients never see it');

  // The room is still healthy for v1 clients.
  const fresh = connect(t, ws);
  await fresh.opened;
  fresh.socket.send(JSON.stringify({ type: 'sync-request', requestId: 'sync-1', stateVector: b64(EMPTY_STATE_VECTOR) }));
  await new Promise((resolve) => setTimeout(resolve, 100));
  const sync = fresh.messages.filter((message) => message.type === 'sync').at(-1);
  assert.ok(sync && sync.type === 'sync');
  const copy = createNoteDocument();
  applyNoteUpdate(copy.doc, Buffer.from(sync.update, 'base64'));
  assert.equal(copy.content.toString(), 'texto v1');
});

test('stored history in a newer schema is reported as incompatible instead of a retryable storage outage', { timeout: 4000 }, async (t) => {
  const { ws } = await start(t, [createFutureNote(2).encodeState()]);
  const client = connect(t, ws);
  const closed = once(client.socket, 'close');
  const [code] = await closed;
  assert.equal(code, 1011);
  assert.deepEqual(client.messages.find((message) => message.type === 'sync-error'), { type: 'sync-error', code: 'incompatible-schema', retryable: false });
});

test('garbage that is not a schema problem is still an invalid message', { timeout: 4000 }, async (t) => {
  const { ws } = await start(t);
  const client = connect(t, ws);
  await client.opened;
  const closed = once(client.socket, 'close');
  client.socket.send(JSON.stringify({ type: 'update', requestId: 'bad-1', update: b64(new Uint8Array([255, 255, 255])) }));
  await closed;
  assert.deepEqual(client.messages.find((message) => message.type === 'sync-error'), { type: 'sync-error', requestId: 'bad-1', code: 'invalid-message', retryable: false });
});
