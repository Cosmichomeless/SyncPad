import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteState } from '@syncpad/shared';
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

async function start(store: SyncStore) {
  const app = createSyncServer({ ...services(), syncStore: store, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = (app.server.address() as { port: number }).port;
  return { app, url: `ws://127.0.0.1:${port}/ws?noteId=123e4567-e89b-12d3-a456-426614174001` };
}

type SyncMessage = { type: string; update?: string; users?: Array<{ connectionId: string }> };

function messageOfType(client: WebSocket, type: string) {
  return new Promise<SyncMessage>((resolve) => {
    const listener = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as { type: string };
      if (message.type === type) { client.off('message', listener); resolve(message); }
    };
    client.on('message', listener);
  });
}

test('two clients converge and a restarted server restores content without stale presence', { timeout: 5000 }, async (t) => {
  const updates: Uint8Array[] = [];
  const store: SyncStore = {
    async load() { return updates.map((update) => new Uint8Array(update)); },
    async append(_noteId, update) { updates.push(new Uint8Array(update)); return true; },
  };
  const firstServer = await start(store);
  const options = { headers: { cookie: 'syncpad_session=session-token', origin: 'http://127.0.0.1:3000' } };
  const first = new WebSocket(firstServer.url, options);
  const second = new WebSocket(firstServer.url, options);
  t.after(() => { first.terminate(); second.terminate(); });
  const firstSync = messageOfType(first, 'sync');
  const secondSync = messageOfType(second, 'sync');
  await Promise.all([once(first, 'open'), once(second, 'open')]);
  await Promise.all([firstSync, secondSync]);
  const local = createNoteDocument();
  local.content.insert(0, 'persistido');
  first.send(JSON.stringify({ type: 'update', update: Buffer.from(encodeNoteState(local.doc)).toString('base64') }));
  const update = await messageOfType(second, 'update');
  assert.ok(update.update);
  const converged = createNoteDocument();
  applyNoteUpdate(converged.doc, Buffer.from(update.update, 'base64'));
  assert.equal(converged.content.toString(), 'persistido');
  await firstServer.app.close();

  const restarted = await start(store);
  const recovered = new WebSocket(restarted.url, options);
  t.after(() => { recovered.terminate(); void restarted.app.close(); });
  const recoveredSnapshot = messageOfType(recovered, 'sync');
  const recoveredAwareness = messageOfType(recovered, 'awareness');
  await once(recovered, 'open');
  const snapshot = await recoveredSnapshot;
  assert.ok(snapshot.update);
  const restored = createNoteDocument();
  applyNoteUpdate(restored.doc, Buffer.from(snapshot.update, 'base64'));
  assert.equal(restored.content.toString(), 'persistido');
  const awareness = await recoveredAwareness;
  assert.ok(awareness.users);
  assert.equal(awareness.users.length, 1);
});