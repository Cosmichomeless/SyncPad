import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNoteDocument, encodeNoteState, encodeNoteStateVector } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import type { LimitEvent, SyncLimits } from '../src/limits.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const options = { headers: { cookie: 'syncpad_session=session-token', origin: 'http://127.0.0.1:3000' } };

function services() {
  const auth: AuthService = {
    async register() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async authenticate() { return { id: 'user-1' as never, email: 'one@example.com' }; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token ? { id: 'user-1' as never, email: 'one@example.com' } : null; },
    async invalidateSession() {},
  };
  const notes: NoteService = {
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; }, async canAccess() { return true; },
  };
  return { auth, notes };
}

function memoryStore() {
  const updates: Uint8Array[] = [];
  const store: SyncStore = {
    async load() { return [...updates]; },
    async append(_noteId, update) { updates.push(update); return true; },
  };
  return { store, updates };
}

async function start(t: TestContext, limits: Partial<SyncLimits>) {
  const { store, updates } = memoryStore();
  const events: LimitEvent[] = [];
  const app = createSyncServer({ ...services(), syncStore: store, limits: { heartbeatMs: 0, ...limits }, onLimit: (event) => events.push(event), security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { url: `ws://127.0.0.1:${port}/ws?noteId=123e4567-e89b-12d3-a456-426614174001`, events, updates };
}

type Message = { type: string; requestId?: string; code?: string; retryable?: boolean; users?: unknown[] };

async function waitFor(condition: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function join(t: TestContext, url: string) {
  const client = new WebSocket(url, options);
  t.after(() => client.terminate());
  const seen: Message[] = [];
  client.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
  const closed = new Promise<number>((resolve) => client.once('close', (code) => resolve(code)));
  await once(client, 'open');
  return { client, seen, closed };
}

async function joinSynced(t: TestContext, url: string) {
  const joined = await join(t, url);
  await waitFor(() => joined.seen.some((message) => message.type === 'sync'));
  return joined;
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

test('an update that would grow the note past the limit is rejected and not stored', async (t) => {
  const { url, events, updates } = await start(t, { maxNoteChars: 100 });
  const { client, seen } = await joinSynced(t, url);
  const author = createNoteDocument();

  author.content.insert(0, 'a'.repeat(100));
  client.send(JSON.stringify({ type: 'update', requestId: 'fits', update: base64(encodeNoteState(author.doc)) }));
  await waitFor(() => seen.some((message) => message.type === 'ack' && message.requestId === 'fits'));

  author.content.insert(100, 'b');
  client.send(JSON.stringify({ type: 'update', requestId: 'big', update: base64(encodeNoteState(author.doc)) }));
  await waitFor(() => seen.some((message) => message.requestId === 'big'));
  const rejection = seen.find((message) => message.requestId === 'big');
  assert.equal(rejection?.type, 'sync-error');
  assert.equal(rejection?.code, 'note-too-large');
  assert.equal(rejection?.retryable, false);
  assert.equal(updates.length, 1);
  assert.deepEqual(events, [{ limit: 'note-size', noteId: '123e4567-e89b-12d3-a456-426614174001', chars: 101, max: 100 }]);
});

test('shortening a note at the limit is never refused', async (t) => {
  const { url } = await start(t, { maxNoteChars: 100 });
  const { client, seen } = await joinSynced(t, url);
  const author = createNoteDocument();
  author.content.insert(0, 'a'.repeat(100));
  client.send(JSON.stringify({ type: 'update', requestId: 'one', update: base64(encodeNoteState(author.doc)) }));
  await waitFor(() => seen.some((message) => message.requestId === 'one'));
  author.content.delete(0, 50);
  client.send(JSON.stringify({ type: 'update', requestId: 'two', update: base64(encodeNoteState(author.doc)) }));
  await waitFor(() => seen.some((message) => message.requestId === 'two'));
  assert.equal(seen.find((message) => message.requestId === 'two')?.type, 'ack');
});

test('a full room turns away the next connection with a retryable error and recovers when someone leaves', async (t) => {
  const { url, events } = await start(t, { maxClientsPerRoom: 2 });
  const first = await joinSynced(t, url);
  await joinSynced(t, url);
  const third = await join(t, url);
  assert.equal(await third.closed, 1013);
  const error = third.seen.find((message) => message.type === 'sync-error');
  assert.equal(error?.code, 'room-full');
  assert.equal(error?.retryable, true);
  assert.equal(events.at(-1)?.limit, 'room-full');

  first.client.close();
  await first.closed;
  const retry = await joinSynced(t, url);
  assert.equal(retry.client.readyState, WebSocket.OPEN);
});

test('presence over its own allowance is dropped without closing the socket', async (t) => {
  const { url, events } = await start(t, { awarenessPerSecond: 1, messageBurst: 1000, messagesPerSecond: 1000 });
  const { client, seen } = await joinSynced(t, url);
  for (let index = 0; index < 30; index++) client.send(JSON.stringify({ type: 'awareness', cursor: null }));
  await waitFor(() => events.some((event) => event.limit === 'awareness-rate'));
  assert.equal(client.readyState, WebSocket.OPEN);
  // Real work still goes through afterwards.
  client.send(JSON.stringify({ type: 'sync-request', requestId: 'after', stateVector: base64(encodeNoteStateVector(createNoteDocument().doc)) }));
  await waitFor(() => seen.some((message) => message.requestId === 'after'));
});

test('a message over the size limit closes that connection with 1009', async (t) => {
  const { url } = await start(t, { maxMessageBytes: 2048 });
  const { client, closed } = await joinSynced(t, url);
  client.send(JSON.stringify({ type: 'update', requestId: 'huge', update: 'A'.repeat(4096) }));
  assert.equal(await closed, 1009);
});
