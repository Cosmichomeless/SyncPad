import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteState } from '@syncpad/shared';
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
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; },
    async canAccess() { return true; },
  };
  const app = createSyncServer({ auth, notes, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, url: `ws://127.0.0.1:${(app.server.address() as { port: number }).port}/ws?noteId=${noteId}` };
}

function receive(client: WebSocket, expectedType: string) {
  return new Promise<{ type: string; update: string }>((resolve) => {
    const onMessage = (raw: WebSocket.RawData) => {
      const message = JSON.parse(raw.toString()) as { type: string; update: string };
      if (message.type === expectedType) { client.off('message', onMessage); resolve(message); }
    };
    client.on('message', onMessage);
  });
}

test('two clients exchange initial state and incremental updates', { timeout: 4000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const options = { headers: { cookie: 'syncpad_session=session-token', origin: 'http://127.0.0.1:3000' } };
  const first = new WebSocket(url, options);
  const second = new WebSocket(url, options);
  t.after(() => { first.terminate(); second.terminate(); });
  const firstSyncPromise = receive(first, 'sync');
  const secondSyncPromise = receive(second, 'sync');
  await Promise.all([once(first, 'open'), once(second, 'open')]);
  const firstSync = await firstSyncPromise;
  const secondSync = await secondSyncPromise;
  assert.equal(firstSync.type, 'sync');
  assert.equal(secondSync.type, 'sync');
  const local = createNoteDocument();
  local.content.insert(0, 'convergencia');
  first.send(JSON.stringify({ type: 'update', update: Buffer.from(encodeNoteState(local.doc)).toString('base64') }));
  const update = await receive(second, 'update');
  const remote = createNoteDocument();
  applyNoteUpdate(remote.doc, Buffer.from(update.update, 'base64'));
  assert.equal(remote.content.toString(), 'convergencia');
});