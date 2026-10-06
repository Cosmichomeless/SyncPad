import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateSince, encodeNoteStateVector } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import type { SyncLimits } from '../src/limits.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const NOTE_URL = 'noteId=123e4567-e89b-12d3-a456-426614174001';
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

function memoryStore(initial: Uint8Array[] = []) {
  const updates = [...initial];
  const counts = { loads: 0 };
  const store: SyncStore = {
    async load() { counts.loads++; await new Promise((resolve) => setTimeout(resolve, 20)); return [...updates]; },
    async append(_noteId, update) { updates.push(update); return true; },
  };
  return { store, counts };
}

async function start(t: TestContext, store: SyncStore, limits: Partial<SyncLimits>) {
  const app = createSyncServer({ ...services(), syncStore: store, limits, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return `ws://127.0.0.1:${port}/ws?${NOTE_URL}`;
}

type Message = { type: string; requestId?: string; update?: string; code?: string; retryable?: boolean };

function messages(client: WebSocket) {
  const seen: Message[] = [];
  client.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
  return seen;
}

async function waitFor(condition: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

/** Opens a client and completes the handshake with the given state vector, returning the sync reply. */
async function handshake(t: TestContext, url: string, stateVector: Uint8Array, wsOptions: WebSocket.ClientOptions = {}) {
  const client = new WebSocket(url, { ...options, ...wsOptions });
  t.after(() => client.terminate());
  const seen = messages(client);
  await once(client, 'open');
  client.send(JSON.stringify({ type: 'sync-request', requestId: 'hs', stateVector: Buffer.from(stateVector).toString('base64') }));
  await waitFor(() => seen.some((message) => message.type === 'sync' && message.requestId === 'hs'));
  return { client, seen, reply: seen.find((message) => message.type === 'sync' && message.requestId === 'hs')! };
}

test('a client that never answers pings is terminated and its slot freed', async (t) => {
  const { store } = memoryStore();
  const url = await start(t, store, { heartbeatMs: 50 });
  // autoPong off simulates a half-open connection: the TCP socket is up but nothing answers.
  const { client } = await handshake(t, url, encodeNoteStateVector(createNoteDocument().doc), { autoPong: false });
  const closed = once(client, 'close');
  await Promise.race([closed, new Promise((_, reject) => setTimeout(() => reject(new Error('dead client was not dropped')), 2000))]);
});

test('a healthy client survives many heartbeat rounds', async (t) => {
  const { store } = memoryStore();
  const url = await start(t, store, { heartbeatMs: 30 });
  const { client } = await handshake(t, url, encodeNoteStateVector(createNoteDocument().doc));
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(client.readyState, WebSocket.OPEN);
});

test('a connection over its message allowance is cut off without disturbing its neighbours', async (t) => {
  const { store } = memoryStore();
  const url = await start(t, store, { heartbeatMs: 0, messagesPerSecond: 1, messageBurst: 5 });
  const vector = encodeNoteStateVector(createNoteDocument().doc);
  const flooder = await handshake(t, url, vector);
  const neighbour = await handshake(t, url, vector);
  const closed = once(flooder.client, 'close');
  for (let index = 0; index < 20; index++) flooder.client.send(JSON.stringify({ type: 'awareness', cursor: null }));
  const [code] = await closed;
  assert.equal(code, 1008);
  const error = flooder.seen.find((message) => message.type === 'sync-error');
  assert.equal(error?.code, 'rate-limited');
  assert.equal(error?.retryable, true);
  assert.equal(neighbour.client.readyState, WebSocket.OPEN);
});

test('a reconnect burst loads the note once and every client converges', async (t) => {
  const author = createNoteDocument();
  author.content.insert(0, 'shared history');
  const { store, counts } = memoryStore([encodeNoteState(author.doc)]);
  const url = await start(t, store, { heartbeatMs: 0 });
  const vector = encodeNoteStateVector(createNoteDocument().doc);
  const clients = await Promise.all(Array.from({ length: 40 }, () => handshake(t, url, vector)));
  assert.equal(counts.loads, 1);
  for (const { reply } of clients) {
    const replica = createNoteDocument();
    applyNoteUpdate(replica.doc, Uint8Array.from(Buffer.from(reply.update!, 'base64')));
    assert.equal(replica.content.toString(), 'shared history');
  }
});

test('a stale client receives only what it is missing', async (t) => {
  const author = createNoteDocument();
  author.content.insert(0, 'x'.repeat(5000));
  const fullHistory = encodeNoteState(author.doc);
  const { store } = memoryStore([fullHistory]);
  const url = await start(t, store, { heartbeatMs: 0 });

  const stale = createNoteDocument();
  applyNoteUpdate(stale.doc, fullHistory);
  const staleVector = encodeNoteStateVector(stale.doc);
  const current = await handshake(t, url, staleVector);
  assert.ok(Buffer.from(current.reply.update!, 'base64').length < 50, 'an up-to-date client gets an empty diff');

  author.content.insert(author.content.length, ' + one more edit');
  const delta = encodeNoteStateSince(author.doc, staleVector);
  const writer = await handshake(t, url, encodeNoteStateVector(author.doc));
  writer.client.send(JSON.stringify({ type: 'update', requestId: 'up', update: Buffer.from(delta).toString('base64') }));
  await waitFor(() => writer.seen.some((message) => message.type === 'ack'));

  const behind = await handshake(t, url, staleVector);
  const received = Buffer.from(behind.reply.update!, 'base64').length;
  assert.ok(received < 200, `a client one edit behind received ${received} bytes`);
  const replica = createNoteDocument();
  applyNoteUpdate(replica.doc, fullHistory);
  applyNoteUpdate(replica.doc, Uint8Array.from(Buffer.from(behind.reply.update!, 'base64')));
  assert.equal(replica.content.toString(), author.content.toString());
});
