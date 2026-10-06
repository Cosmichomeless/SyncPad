import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNoteDocument, encodeNoteState } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import type { SyncLimits } from '../src/limits.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';
import type { WorkspaceService } from '../src/workspaces.js';

const NOTE = '123e4567-e89b-12d3-a456-426614174001';
const WORKSPACE = '123e4567-e89b-12d3-a456-426614174099';
const ALICE = { id: '123e4567-e89b-12d3-a456-4266141740a1' as never, email: 'alice@example.com' };
const BOB = { id: '123e4567-e89b-12d3-a456-4266141740b2' as never, email: 'bob@example.com' };

/** Two users and a note: whoever is in `members` may open it, exactly as the memberships table would say. */
async function start(t: TestContext, limits: Partial<SyncLimits>) {
  const sessions = new Map([['alice-session', ALICE], ['bob-session', BOB]]);
  const members = new Set<string>([ALICE.id, BOB.id]);
  const failures = { access: false };
  const auth: AuthService = {
    async register() { return ALICE; }, async authenticate() { return ALICE; }, async createSession() { return 'alice-session'; },
    async getUserBySession(token) { return sessions.get(token) ?? null; },
    async invalidateSession(token) { sessions.delete(token); },
  };
  const notes: NoteService = {
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; },
    async canAccess(userId) {
      if (failures.access) throw new Error('database unavailable');
      return members.has(userId);
    },
  };
  const workspaces = {
    async removeMember(_workspaceId: string, _ownerId: string, memberId: string) { members.delete(memberId); },
  } as unknown as WorkspaceService;
  const stored: Uint8Array[] = [];
  const store: SyncStore = { async load() { return [...stored]; }, async append(_id, update) { stored.push(update); return true; } };
  const app = createSyncServer({ auth, notes, workspaces, syncStore: store, limits: { heartbeatMs: 0, ...limits }, security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { http: `http://127.0.0.1:${port}`, ws: `ws://127.0.0.1:${port}/ws?noteId=${NOTE}`, members, failures, stored };
}

type Message = { type: string; requestId?: string; code?: string; retryable?: boolean };

async function waitFor(condition: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function joinSynced(t: TestContext, url: string, session: string) {
  const client = new WebSocket(url, { headers: { cookie: `syncpad_session=${session}`, origin: 'http://127.0.0.1:3000' } });
  t.after(() => client.terminate());
  const seen: Message[] = [];
  client.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
  const closed = new Promise<number>((resolve) => client.once('close', (code) => resolve(code)));
  await once(client, 'open');
  await waitFor(() => seen.some((message) => message.type === 'sync'));
  return { client, seen, closed };
}

function edit(text: string) {
  const author = createNoteDocument();
  author.content.insert(0, text);
  return Buffer.from(encodeNoteState(author.doc)).toString('base64');
}

async function csrf(http: string) {
  const response = await fetch(`${http}/auth/csrf`);
  const token = ((await response.json()) as { csrfToken: string }).csrfToken;
  return { token, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? '' };
}

test('a member removed through the API is cut off at once and stops receiving the note', async (t) => {
  // The recheck interval is far too long to matter: the cut-off comes from the removal itself.
  const { http, ws, members } = await start(t, { permissionRecheckMs: 600_000 });
  const alice = await joinSynced(t, ws, 'alice-session');
  const bob = await joinSynced(t, ws, 'bob-session');

  const { token, cookie } = await csrf(http);
  const removal = await fetch(`${http}/workspaces/${WORKSPACE}/members/${BOB.id}`, {
    method: 'DELETE',
    headers: { cookie: `syncpad_session=alice-session; ${cookie}`, 'x-csrf-token': token },
  });
  assert.equal(removal.status, 204);
  assert.equal(members.has(BOB.id), false);

  assert.equal(await bob.closed, 4403);
  assert.equal(bob.seen.at(-1)?.code, 'access-revoked');
  assert.equal(bob.seen.at(-1)?.retryable, false);

  const before = bob.seen.length;
  alice.client.send(JSON.stringify({ type: 'update', requestId: 'after', update: edit('secreto') }));
  await waitFor(() => alice.seen.some((message) => message.requestId === 'after'));
  assert.equal(bob.seen.length, before, 'nothing reaches a removed member');
  assert.equal(alice.client.readyState, WebSocket.OPEN, 'other members are unaffected');
});

test('a user who lost access cannot publish an update, even by a known note id', async (t) => {
  const { ws, members, stored } = await start(t, { permissionRecheckMs: 1 });
  const alice = await joinSynced(t, ws, 'alice-session');
  const bob = await joinSynced(t, ws, 'bob-session');

  members.delete(BOB.id); // revoked behind the server's back (no HTTP hook)
  await new Promise((resolve) => setTimeout(resolve, 5));
  bob.client.send(JSON.stringify({ type: 'update', requestId: 'sneak', update: edit('intruso') }));

  assert.equal(await bob.closed, 4403);
  assert.equal(stored.length, 0, 'the update was neither stored nor applied');
  assert.equal(bob.seen.some((message) => message.type === 'ack'), false);
  assert.equal(alice.seen.some((message) => message.type === 'update'), false, 'no one else saw it');
});

test('an idle connection is cut by the periodic recheck without sending anything', async (t) => {
  const { ws, members } = await start(t, { permissionRecheckMs: 50 });
  const bob = await joinSynced(t, ws, 'bob-session');
  members.delete(BOB.id);
  assert.equal(await bob.closed, 4403);
  assert.equal(bob.seen.at(-1)?.code, 'access-revoked');
});

test('logging out cuts every socket that session holds', async (t) => {
  const { http, ws } = await start(t, { permissionRecheckMs: 600_000 });
  const alice = await joinSynced(t, ws, 'alice-session');
  const bob = await joinSynced(t, ws, 'bob-session');

  const { token, cookie } = await csrf(http);
  const logout = await fetch(`${http}/auth/logout`, { method: 'POST', headers: { cookie: `syncpad_session=bob-session; ${cookie}`, 'x-csrf-token': token } });
  assert.equal(logout.status, 204);

  assert.equal(await bob.closed, 4403);
  assert.equal(alice.client.readyState, WebSocket.OPEN);
});

test('when access cannot be checked the update is refused, not assumed', async (t) => {
  const { ws, failures, stored } = await start(t, { permissionRecheckMs: 1 });
  const bob = await joinSynced(t, ws, 'bob-session');
  failures.access = true;
  await new Promise((resolve) => setTimeout(resolve, 5));
  bob.client.send(JSON.stringify({ type: 'update', requestId: 'unknown', update: edit('quizá') }));

  assert.equal(await bob.closed, 1011);
  assert.equal(stored.length, 0);
  const error = bob.seen.find((message) => message.type === 'sync-error');
  assert.equal(error?.code, 'persistence-unavailable');
  assert.equal(error?.retryable, true, 'a transient failure is retried; it is not a revocation');
});

test('a member who keeps access is never disturbed by rechecks', async (t) => {
  const { ws, stored } = await start(t, { permissionRecheckMs: 20 });
  const bob = await joinSynced(t, ws, 'bob-session');
  await new Promise((resolve) => setTimeout(resolve, 150));
  bob.client.send(JSON.stringify({ type: 'update', requestId: 'fine', update: edit('sigo aquí') }));
  await waitFor(() => bob.seen.some((message) => message.type === 'ack' && message.requestId === 'fine'));
  assert.equal(stored.length, 1);
  assert.equal(bob.client.readyState, WebSocket.OPEN);
});
