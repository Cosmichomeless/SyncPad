import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import {
  applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateSince, encodeNoteStateVector,
  type ServerSyncMessage,
} from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const noteId = '123e4567-e89b-12d3-a456-426614174001';
const headers = { cookie: 'syncpad_session=session-token', origin: 'http://127.0.0.1:3000' };

const b64 = (data: Uint8Array) => Buffer.from(data).toString('base64');
const unb64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => { open = resolve; });
  return { opened, open };
}

function memoryStore(overrides: Partial<SyncStore> = {}) {
  const updates: Uint8Array[] = [];
  const store: SyncStore = {
    async load() { return updates.map((update) => new Uint8Array(update)); },
    async append(_noteId, update) { updates.push(new Uint8Array(update)); return true; },
    ...overrides,
  };
  return { store, updates };
}

async function start(t: TestContext, store?: SyncStore) {
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
  const app = createSyncServer({ auth, notes, syncStore: store, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  return `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws?noteId=${noteId}`;
}

type Message = ServerSyncMessage | { type: 'awareness' };

function connect(t: TestContext, url: string) {
  const socket = new WebSocket(url, { headers });
  const messages: Message[] = [];
  socket.on('message', (raw) => messages.push(JSON.parse(raw.toString()) as Message));
  t.after(() => socket.terminate());
  const waitFor = async <T extends Message['type']>(type: T, match: (message: Extract<Message, { type: T }>) => boolean = () => true, timeout = 2000) => {
    const deadline = Date.now() + timeout;
    for (;;) {
      const found = messages.find((message): message is Extract<Message, { type: T }> => message.type === type && match(message as Extract<Message, { type: T }>));
      if (found) return found;
      if (Date.now() > deadline) throw new Error(`timed out waiting for ${type}`);
      await sleep(10);
    }
  };
  const send = (message: object) => socket.send(JSON.stringify(message));
  return { socket, messages, waitFor, send, opened: once(socket, 'open') };
}

/** Mirrors the client handshake: request with a state vector, apply, upload the diff, wait for ack. */
async function reconcile(client: ReturnType<typeof connect>, doc: ReturnType<typeof createNoteDocument>, id: string) {
  await client.opened;
  client.send({ type: 'sync-request', requestId: `${id}-sync`, stateVector: b64(encodeNoteStateVector(doc.doc)) });
  const sync = await client.waitFor('sync', (message) => message.requestId === `${id}-sync`);
  applyNoteUpdate(doc.doc, unb64(sync.update));
  client.send({ type: 'update', requestId: `${id}-up`, update: b64(encodeNoteStateSince(doc.doc, unb64(sync.stateVector))) });
  await client.waitFor('ack', (message) => message.requestId === `${id}-up`);
}

test('divergent offline branches converge after the handshake, including deletions', { timeout: 8000 }, async (t) => {
  const { store } = memoryStore();
  const url = await start(t, store);

  const first = createNoteDocument();
  first.content.insert(0, 'base compartida final');
  const firstClient = connect(t, url);
  await reconcile(firstClient, first, 'a1');

  const second = createNoteDocument();
  const secondClient = connect(t, url);
  await reconcile(secondClient, second, 'b1');
  assert.equal(second.content.toString(), 'base compartida final');
  secondClient.socket.close();
  await once(secondClient.socket, 'close');

  // While the second client is away both sides edit the same note.
  first.content.insert(0, 'PRIMERO ');
  firstClient.send({ type: 'update', requestId: 'a2', update: b64(encodeNoteStateSince(first.doc, encodeNoteStateVector(second.doc))) });
  await firstClient.waitFor('ack', (message) => message.requestId === 'a2');
  const finalAt = second.content.toString().indexOf(' final');
  second.content.delete(finalAt, ' final'.length);
  second.content.insert(second.content.length, ' + offline');

  const returning = connect(t, url);
  await reconcile(returning, second, 'b2');
  // The first client sees every broadcast, including the empty one from the earlier handshake.
  await sleep(50);
  for (const message of firstClient.messages) if (message.type === 'update') applyNoteUpdate(first.doc, unb64(message.update));
  assert.equal(second.content.toString(), 'PRIMERO base compartida + offline');
  assert.equal(first.content.toString(), second.content.toString());
});

test('repeating the handshake does not duplicate content', { timeout: 5000 }, async (t) => {
  const { store, updates } = memoryStore();
  const url = await start(t, store);
  const doc = createNoteDocument();
  doc.content.insert(0, 'una sola vez');
  for (const id of ['r1', 'r2', 'r3']) {
    const client = connect(t, url);
    await reconcile(client, doc, id);
    client.socket.close();
  }
  const fresh = createNoteDocument();
  const reader = connect(t, url);
  await reader.opened;
  reader.send({ type: 'sync-request', requestId: 'read' });
  applyNoteUpdate(fresh.doc, unb64((await reader.waitFor('sync', (message) => message.requestId === 'read')).update));
  assert.equal(fresh.content.toString(), 'una sola vez');
  assert.ok(updates.length >= 1);
});

test('a delayed append withholds ack, broadcast and snapshots until it is durable', { timeout: 5000 }, async (t) => {
  const append = gate();
  const { store } = memoryStore({ async append() { await append.opened; return true; } });
  const url = await start(t, store);
  const writer = connect(t, url);
  const peer = connect(t, url);
  await Promise.all([writer.opened, peer.opened]);
  await Promise.all([writer.waitFor('sync'), peer.waitFor('sync')]);

  const doc = createNoteDocument();
  doc.content.insert(0, 'todavía no durable');
  writer.send({ type: 'update', requestId: 'slow', update: b64(encodeNoteState(doc.doc)) });
  peer.send({ type: 'sync-request', requestId: 'snapshot' });
  await sleep(150);
  assert.equal(writer.messages.some((message) => message.type === 'ack'), false);
  assert.equal(peer.messages.some((message) => message.type === 'update'), false);
  assert.equal(peer.messages.some((message) => message.type === 'sync' && message.requestId === 'snapshot'), false);

  append.open();
  await writer.waitFor('ack', (message) => message.requestId === 'slow');
  await peer.waitFor('update');
  const snapshot = await peer.waitFor('sync', (message) => message.requestId === 'snapshot');
  const copy = createNoteDocument();
  applyNoteUpdate(copy.doc, unb64(snapshot.update));
  assert.equal(copy.content.toString(), 'todavía no durable');
});

test('a failed append reports a retryable error without contaminating the room', { timeout: 5000 }, async (t) => {
  let failures = 1;
  const { store } = memoryStore({ async append(id, update) {
    if (failures-- > 0) throw new Error('database unavailable');
    return memory.store.append(id, update);
  } });
  const memory = memoryStore();
  const url = await start(t, store);
  const writer = connect(t, url);
  const peer = connect(t, url);
  await Promise.all([writer.opened, peer.opened]);
  await Promise.all([writer.waitFor('sync'), peer.waitFor('sync')]);

  const doc = createNoteDocument();
  doc.content.insert(0, 'reintento');
  const update = b64(encodeNoteState(doc.doc));
  writer.send({ type: 'update', requestId: 'try-1', update });
  const failure = await writer.waitFor('sync-error', (message) => message.requestId === 'try-1');
  assert.deepEqual({ code: failure.code, retryable: failure.retryable }, { code: 'persistence-unavailable', retryable: true });
  assert.equal(writer.socket.readyState, WebSocket.OPEN);
  assert.equal(peer.messages.some((message) => message.type === 'update'), false);

  peer.send({ type: 'sync-request', requestId: 'empty' });
  const empty = createNoteDocument();
  applyNoteUpdate(empty.doc, unb64((await peer.waitFor('sync', (message) => message.requestId === 'empty')).update));
  assert.equal(empty.content.toString(), '');

  writer.send({ type: 'update', requestId: 'try-2', update });
  await writer.waitFor('ack', (message) => message.requestId === 'try-2');
  await peer.waitFor('update');
});

test('a duplicate append is a successful acknowledgement', { timeout: 4000 }, async (t) => {
  const { store } = memoryStore({ async append() { return false; } });
  const url = await start(t, store);
  const client = connect(t, url);
  await client.opened;
  const doc = createNoteDocument();
  doc.content.insert(0, 'ya guardado');
  client.send({ type: 'update', requestId: 'dup', update: b64(encodeNoteState(doc.doc)) });
  await client.waitFor('ack', (message) => message.requestId === 'dup');
});

test('an eager handshake sent while the room is still loading is processed', { timeout: 5000 }, async (t) => {
  const load = gate();
  const seeded = createNoteDocument();
  seeded.content.insert(0, 'del servidor');
  const { store } = memoryStore({ async load() { await load.opened; return [encodeNoteState(seeded.doc)]; } });
  const url = await start(t, store);
  const client = connect(t, url);
  await client.opened;
  client.send({ type: 'sync-request', requestId: 'eager', stateVector: b64(encodeNoteStateVector(createNoteDocument().doc)) });
  await sleep(100);
  load.open();
  const sync = await client.waitFor('sync', (message) => message.requestId === 'eager');
  const copy = createNoteDocument();
  applyNoteUpdate(copy.doc, unb64(sync.update));
  assert.equal(copy.content.toString(), 'del servidor');
  assert.ok(sync.stateVector.length > 0);
  await client.waitFor('sync', (message) => message.requestId === undefined);
});

test('a failed room load is reported and a later connection can retry it', { timeout: 5000 }, async (t) => {
  let attempts = 0;
  const seeded = createNoteDocument();
  seeded.content.insert(0, 'recuperado');
  const { store } = memoryStore({ async load() {
    if (attempts++ === 0) throw new Error('database unavailable');
    return [encodeNoteState(seeded.doc)];
  } });
  const url = await start(t, store);
  const failed = connect(t, url);
  await failed.opened;
  const failure = await failed.waitFor('sync-error');
  assert.deepEqual({ code: failure.code, retryable: failure.retryable }, { code: 'persistence-unavailable', retryable: true });

  const retry = connect(t, url);
  await retry.opened;
  const sync = await retry.waitFor('sync');
  const copy = createNoteDocument();
  applyNoteUpdate(copy.doc, unb64(sync.update));
  assert.equal(copy.content.toString(), 'recuperado');
});

test('a correlated upload without a sync store is never acknowledged as durable', { timeout: 4000 }, async (t) => {
  const url = await start(t);
  const client = connect(t, url);
  await client.opened;
  const doc = createNoteDocument();
  doc.content.insert(0, 'sin base de datos');
  client.send({ type: 'update', requestId: 'volatile', update: b64(encodeNoteState(doc.doc)) });
  const failure = await client.waitFor('sync-error', (message) => message.requestId === 'volatile');
  assert.equal(failure.retryable, false);
  assert.equal(client.messages.some((message) => message.type === 'ack'), false);
});

test('legacy uncorrelated updates are still applied and broadcast', { timeout: 4000 }, async (t) => {
  const { store } = memoryStore();
  const url = await start(t, store);
  const writer = connect(t, url);
  const peer = connect(t, url);
  await Promise.all([writer.opened, peer.opened]);
  await Promise.all([writer.waitFor('sync'), peer.waitFor('sync')]);
  const doc = createNoteDocument();
  doc.content.insert(0, 'legado');
  writer.send({ type: 'update', update: b64(encodeNoteState(doc.doc)) });
  await peer.waitFor('update');
  assert.equal(writer.messages.some((message) => message.type === 'ack'), false);
});
