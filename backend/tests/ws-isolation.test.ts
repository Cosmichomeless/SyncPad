import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateVector } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const ALICE_NOTE = '123e4567-e89b-12d3-a456-426614174001';
const BOB_NOTE = '123e4567-e89b-12d3-a456-426614174002';
const ALICE = { id: '123e4567-e89b-12d3-a456-4266141740a1' as never, email: 'alice@example.com' };
const BOB = { id: '123e4567-e89b-12d3-a456-4266141740b2' as never, email: 'bob@example.com' };

/** Two users, each the only member of their own note, sharing one server process and one room cache. */
async function start(t: TestContext) {
  const sessions = new Map([['alice-session', ALICE], ['bob-session', BOB]]);
  const owners = new Map<string, string>([[ALICE_NOTE, ALICE.id], [BOB_NOTE, BOB.id]]);
  const auth: AuthService = {
    async register() { return ALICE; }, async authenticate() { return ALICE; }, async createSession() { return 'alice-session'; },
    async getUserBySession(token) { return sessions.get(token) ?? null; },
    async invalidateSession(token) { sessions.delete(token); },
  };
  const notes: NoteService = {
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; },
    async canAccess(userId, noteId) { return owners.get(noteId) === userId; },
  };
  const stored = new Map<string, Uint8Array[]>();
  const store: SyncStore = {
    async load(noteId) { return [...(stored.get(noteId) ?? [])]; },
    async append(noteId, update) { stored.set(noteId, [...(stored.get(noteId) ?? []), update]); return true; },
  };
  const app = createSyncServer({ auth, notes, syncStore: store, limits: { heartbeatMs: 0 }, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { http: `http://127.0.0.1:${port}`, url: (noteId: string) => `ws://127.0.0.1:${port}/ws?noteId=${noteId}`, stored };
}

type Message = { type: string; update?: string; requestId?: string; users?: unknown[] };

async function waitFor(condition: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function join(t: TestContext, url: string, session: string) {
  const client = new WebSocket(url, { headers: { cookie: `syncpad_session=${session}`, origin: 'http://127.0.0.1:3000' } });
  t.after(() => client.terminate());
  const seen: Message[] = [];
  client.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
  await once(client, 'open');
  const emptyVector = Buffer.from(encodeNoteStateVector(createNoteDocument().doc)).toString('base64');
  client.send(JSON.stringify({ type: 'sync-request', requestId: 'hello', stateVector: emptyVector }));
  await waitFor(() => seen.some((message) => message.type === 'sync' && message.requestId === 'hello'));
  return { client, seen };
}

function textOf(messages: Message[]) {
  const note = createNoteDocument();
  for (const message of messages) if (message.update) applyNoteUpdate(note.doc, Buffer.from(message.update, 'base64'));
  return note.content.toString();
}

async function rejection(url: string, session?: string) {
  const client = new WebSocket(url, { headers: { ...(session ? { cookie: `syncpad_session=${session}` } : {}), origin: 'http://127.0.0.1:3000' } });
  const [error] = (await once(client, 'error')) as [Error];
  client.terminate();
  return error.message;
}

test('a user cannot join another user\'s note, even while its room is live and cached', async (t) => {
  const { url } = await start(t);
  const alice = await join(t, url(ALICE_NOTE), 'alice-session');
  const author = createNoteDocument();
  author.content.insert(0, 'secreto de Alice');
  alice.client.send(JSON.stringify({ type: 'update', requestId: 'u1', update: Buffer.from(encodeNoteState(author.doc)).toString('base64') }));
  await waitFor(() => alice.seen.some((message) => message.type === 'ack'));

  assert.match(await rejection(url(ALICE_NOTE), 'bob-session'), /Unexpected server response: 403/);
  assert.match(await rejection(url(ALICE_NOTE)), /Unexpected server response: 401/);
});

test('after logout the old token opens nothing, even for a note whose history is stored', async (t) => {
  const { url, http } = await start(t);
  const alice = await join(t, url(ALICE_NOTE), 'alice-session');
  const author = createNoteDocument();
  author.content.insert(0, 'historial guardado');
  alice.client.send(JSON.stringify({ type: 'update', requestId: 'u1', update: Buffer.from(encodeNoteState(author.doc)).toString('base64') }));
  await waitFor(() => alice.seen.some((message) => message.type === 'ack'));
  const closed = new Promise<number>((resolve) => alice.client.once('close', (code) => resolve(code)));

  const csrf = await fetch(`${http}/auth/csrf`);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const cookie = csrf.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const logout = await fetch(`${http}/auth/logout`, { method: 'POST', headers: { cookie: `syncpad_session=alice-session; ${cookie}`, 'x-csrf-token': csrfToken } });
  assert.equal(logout.status, 204);

  assert.equal(await closed, 4403, 'the live socket of the closed session is cut');
  assert.match(await rejection(url(ALICE_NOTE), 'alice-session'), /Unexpected server response: 401/);
});

test('notes served by one server never share content, history or presence', async (t) => {
  const { url, stored } = await start(t);
  const alice = await join(t, url(ALICE_NOTE), 'alice-session');
  const bob = await join(t, url(BOB_NOTE), 'bob-session');

  const author = createNoteDocument();
  author.content.insert(0, 'solo para la nota de Alice');
  alice.client.send(JSON.stringify({ type: 'update', requestId: 'u1', update: Buffer.from(encodeNoteState(author.doc)).toString('base64') }));
  await waitFor(() => alice.seen.some((message) => message.type === 'ack'));
  await new Promise((resolve) => setTimeout(resolve, 100));

  assert.equal(textOf(bob.seen), '', 'Bob never receives content of a note he is not in');
  assert.equal(bob.seen.some((message) => message.type === 'update'), false);
  assert.equal(stored.has(BOB_NOTE), false, 'nothing is persisted under the other note');
  assert.equal(stored.get(ALICE_NOTE)?.length, 1);
  for (const message of bob.seen.filter((entry) => entry.type === 'awareness')) assert.equal(message.users?.length, 1, 'only Bob is present in his room');

  // A new connection to Bob's note starts from Bob's history, not from a room cached for Alice.
  const bobAgain = await join(t, url(BOB_NOTE), 'bob-session');
  assert.equal(textOf(bobAgain.seen), '');
});
