import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
// @ts-expect-error -- the ws typings live in backend/node_modules/@types, out of this package's reach
import WebSocket from '../../backend/node_modules/ws';
import type { AuthService } from '../../backend/src/auth';
import type { NoteService } from '../../backend/src/notes';
import { createSyncServer } from '../../backend/src/server';
import { loadSecurityConfig } from '../../backend/src/security';
import type { SyncStore } from '../../backend/src/sync-store';
import { applyLocalTextEdit, createEditorDocument, type EditorDocument } from '../src/lib/note-document';
import { createNoteSync, type NoteSyncHandle } from '../src/lib/note-sync';

/**
 * #46: real clients (createNoteSync) against the real sync server, which is stopped and started
 * again on the same port while they edit. Only the store survives, like PostgreSQL would.
 */

const NOTE_ID = '123e4567-e89b-12d3-a456-426614174001';
const ORIGIN = 'http://127.0.0.1:3000';

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

function memoryStore() {
  const updates: Uint8Array[] = [];
  const store: SyncStore = {
    async load() { return updates.map((update) => new Uint8Array(update)); },
    async append(_noteId, update) {
      if (updates.some((known) => Buffer.from(known).equals(Buffer.from(update)))) return false;
      updates.push(new Uint8Array(update));
      return true;
    },
  };
  return { store, updates };
}

async function startServer(store: SyncStore, port = 0) {
  const app = createSyncServer({ auth, notes, syncStore: store, security: loadSecurityConfig({} as NodeJS.ProcessEnv) });
  app.server.listen(port, '127.0.0.1');
  await once(app.server, 'listening');
  return { app, port: (app.server.address() as AddressInfo).port };
}

function connectClient(port: number) {
  const document = createEditorDocument();
  const errors: string[] = [];
  const sync: NoteSyncHandle = createNoteSync({
    document,
    url: `ws://127.0.0.1:${port}/ws?noteId=${NOTE_ID}`,
    onState: () => {},
    onError: (message) => errors.push(message),
    online: () => true,
    events: new EventTarget(),
    timing: { initialDelayMs: 20, maxDelayMs: 100, deadlineMs: 2000 },
    socketFactory: (url) => new WebSocket(url, { headers: { cookie: 'syncpad_session=session-token', origin: ORIGIN } }) as unknown as globalThis.WebSocket,
  });
  return { document, sync, errors };
}

async function until(condition: () => boolean, what: string, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail(`timed out waiting for ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const text = (document: EditorDocument) => document.content.toString();
const occurrences = (haystack: string, needle: string) => haystack.split(needle).length - 1;

test('clients reconnect after a server restart, keep persisted edits and converge without duplicates', { timeout: 20_000 }, async (t) => {
  const { store } = memoryStore();
  const first = await startServer(store);
  const a = connectClient(first.port);
  const b = connectClient(first.port);
  t.after(() => { a.sync.destroy(); b.sync.destroy(); });

  applyLocalTextEdit(a.document, 'base');
  await until(() => text(b.document) === 'base', 'B to receive the first edit');

  // A edits and the server goes away before that edit is necessarily acknowledged; B edits during the outage.
  applyLocalTextEdit(a.document, 'base-A');
  await first.app.close();
  applyLocalTextEdit(b.document, 'B-' + text(b.document));

  const second = await startServer(store, first.port);
  t.after(() => second.app.close());

  await until(() => text(a.document) === text(b.document) && text(a.document).length > 'base'.length + 2, 'both clients to converge', 10_000);
  const merged = text(a.document);
  assert.equal(merged, 'B-base-A', 'every edit survives exactly once');
  assert.equal(occurrences(merged, 'base'), 1);
  assert.deepEqual([...a.errors, ...b.errors], []);

  // The restarted server itself holds the merged note: a client that arrives later gets it from the store.
  const late = connectClient(second.port);
  t.after(() => late.sync.destroy());
  await until(() => text(late.document) === merged, 'a new client to load the persisted note');
});

test('a second restart in a row still converges (the first recovery leaves nothing stale behind)', { timeout: 20_000 }, async (t) => {
  const { store } = memoryStore();
  let server = await startServer(store);
  const port = server.port;
  const a = connectClient(port);
  const b = connectClient(port);
  t.after(() => { a.sync.destroy(); b.sync.destroy(); });

  applyLocalTextEdit(a.document, 'uno');
  await until(() => text(b.document) === 'uno', 'initial sync');
  for (const [round, writer] of [['dos', b], ['tres', a]] as const) {
    await server.app.close();
    applyLocalTextEdit(writer.document, `${text(writer.document)} ${round}`);
    server = await startServer(store, port);
    await until(() => text(a.document) === text(b.document) && text(a.document).includes(round), `round ${round}`, 10_000);
  }
  t.after(() => server.app.close());
  assert.equal(text(a.document), 'uno dos tres');
  assert.equal(text(b.document), 'uno dos tres');
});
