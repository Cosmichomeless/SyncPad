import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNoteDocument, encodeNoteState } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

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

async function start(store: SyncStore, snapshotEvery: number) {
  const app = createSyncServer({ ...services(), syncStore: store, snapshotEvery, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = (app.server.address() as { port: number }).port;
  return { app, url: `ws://127.0.0.1:${port}/ws?noteId=123e4567-e89b-12d3-a456-426614174001` };
}

const options = { headers: { cookie: 'syncpad_session=session-token', origin: 'http://127.0.0.1:3000' } };

function nextMessage(client: WebSocket, matches: (message: { type: string; requestId?: string }) => boolean) {
  return new Promise<void>((resolve) => {
    const listener = (raw: WebSocket.RawData) => {
      if (matches(JSON.parse(raw.toString()))) { client.off('message', listener); resolve(); }
    };
    client.on('message', listener);
  });
}

async function connect(t: TestContext, url: string) {
  const client = new WebSocket(url, options);
  t.after(() => client.terminate());
  const synced = nextMessage(client, (message) => message.type === 'sync');
  await once(client, 'open');
  await synced;
  return client;
}

async function saveEdits(client: WebSocket, count: number) {
  const author = createNoteDocument();
  for (let index = 0; index < count; index++) {
    author.content.insert(author.content.length, `edit ${index} `);
    const requestId = `up-${index}`;
    const acked = nextMessage(client, (message) => message.type === 'ack' && message.requestId === requestId);
    client.send(JSON.stringify({ type: 'update', requestId, update: Buffer.from(encodeNoteState(author.doc)).toString('base64') }));
    await acked;
  }
}

function recordingStore(snapshot: SyncStore['snapshot']) {
  const calls: Array<{ noteId: string; minUpdates: number }> = [];
  const compactions: string[] = [];
  const store: SyncStore = {
    async load() { return []; },
    async append() { return true; },
    async snapshot(noteId, minUpdates) {
      calls.push({ noteId, minUpdates });
      return snapshot!(noteId, minUpdates);
    },
    async compact(noteId) { compactions.push(noteId); return 0; },
  };
  return { store, calls, compactions };
}

test('the server asks the store for a snapshot on load and then every snapshotEvery persisted updates', { timeout: 5000 }, async (t) => {
  const { store, calls } = recordingStore(async () => true);
  const { app, url } = await start(store, 3);
  t.after(() => void app.close());
  const client = await connect(t, url);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1, 'one check when the room first loads');
  assert.equal(calls[0].minUpdates, 3);

  await saveEdits(client, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 1, 'below the threshold nothing is asked');
  await saveEdits(client, 1);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls.length, 2, 'the third persisted update triggers a check');
});

test('a failing snapshot never breaks saving', { timeout: 5000 }, async (t) => {
  const { store, calls } = recordingStore(async () => { throw new Error('disk full'); });
  const { app, url } = await start(store, 1);
  t.after(() => void app.close());
  const client = await connect(t, url);
  await saveEdits(client, 3);
  assert.ok(calls.length >= 3);
});

test('compaction runs only after a snapshot was actually written', { timeout: 5000 }, async (t) => {
  let written = false;
  const { store, calls, compactions } = recordingStore(async () => { written = !written; return written; });
  const { app, url } = await start(store, 1);
  t.after(() => void app.close());
  const client = await connect(t, url);
  await saveEdits(client, 2);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.ok(calls.length >= 3);
  // Calls alternate written / not written, so compaction follows exactly the written ones.
  assert.equal(compactions.length, Math.ceil(calls.length / 2));
});
