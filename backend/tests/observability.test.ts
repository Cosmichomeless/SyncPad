import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { createNoteDocument, encodeNoteState } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import { createLogger } from '../src/logger.js';
import { createMetrics } from '../src/metrics.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const NOTE_ID = '123e4567-e89b-12d3-a456-426614174001';
const options = { headers: { cookie: 'syncpad_session=session-token', origin: 'http://127.0.0.1:3000' } };

function services() {
  const auth: AuthService = {
    async register() { return { id: 'user-1' as never, email: 'private@example.com' }; },
    async authenticate() { return { id: 'user-1' as never, email: 'private@example.com' }; },
    async createSession() { return 'session-token'; },
    async getUserBySession(token) { return token ? { id: 'user-1' as never, email: 'private@example.com' } : null; },
    async invalidateSession() {},
  };
  const notes: NoteService = {
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; }, async canAccess() { return true; },
  };
  return { auth, notes };
}

async function start(t: TestContext, extra: { metricsToken?: string; maxNoteChars?: number } = {}) {
  const lines: string[] = [];
  const metrics = createMetrics();
  const updates: Uint8Array[] = [];
  const store: SyncStore = { async load() { return [...updates]; }, async append(_id, update) { updates.push(update); return true; } };
  const app = createSyncServer({
    ...services(), syncStore: store, security: loadSecurityConfig({}), metrics, metricsToken: extra.metricsToken,
    logger: createLogger((line) => lines.push(line)), limits: { heartbeatMs: 0, ...(extra.maxNoteChars ? { maxNoteChars: extra.maxNoteChars } : {}) },
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { port, url: `ws://127.0.0.1:${port}/ws?noteId=${NOTE_ID}`, lines, metrics };
}

type Message = { type: string; requestId?: string };

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
  await once(client, 'open');
  await waitFor(() => seen.some((message) => message.type === 'sync'));
  return { client, seen };
}

async function save(client: WebSocket, seen: Message[], text: string, requestId: string) {
  const author = createNoteDocument();
  author.content.insert(0, text);
  client.send(JSON.stringify({ type: 'update', requestId, update: Buffer.from(encodeNoteState(author.doc)).toString('base64') }));
  await waitFor(() => seen.some((message) => message.requestId === requestId));
}

test('logs identify the room and connection but never carry content, emails or tokens', async (t) => {
  const { url, lines } = await start(t);
  const { client, seen } = await join(t, url);
  await save(client, seen, 'TOP-SECRET-NOTE-BODY', 'up-1');
  client.close();
  await waitFor(() => lines.some((line) => line.includes('ws closed')));

  const entries = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
  const connected = entries.find((entry) => entry.msg === 'ws connected');
  const closed = entries.find((entry) => entry.msg === 'ws closed');
  assert.equal(connected?.roomId, NOTE_ID);
  assert.match(String(connected?.connectionId), /^[0-9a-f-]{36}$/);
  assert.equal(closed?.connectionId, connected?.connectionId);
  assert.equal(closed?.code, 1005);
  assert.equal(typeof closed?.durationMs, 'number');
  const everything = lines.join('\n');
  for (const secret of ['TOP-SECRET-NOTE-BODY', 'private@example.com', 'session-token']) assert.ok(!everything.includes(secret), `log leaked ${secret}`);
});

test('metrics count connections, reconnects, accepted updates and sync errors', async (t) => {
  const { url, metrics } = await start(t, { maxNoteChars: 10 });
  const first = await join(t, url);
  await save(first.client, first.seen, 'hello', 'ok');
  await save(first.client, first.seen, 'x'.repeat(50), 'big');
  assert.equal(metrics.counter('syncpad_sync_errors_total', { code: 'note-too-large' }), 1);
  assert.equal(metrics.counter('syncpad_updates_total', { outcome: 'accepted' }), 1);
  assert.equal(metrics.counter('syncpad_updates_total', { outcome: 'rejected' }), 1);
  assert.equal(metrics.histogram('syncpad_update_persist_ms')?.count, 1);
  assert.equal(metrics.counter('syncpad_reconnects_total'), 0);

  first.client.close();
  await waitFor(() => metrics.counter('syncpad_connection_closes_total', { code: 1005 }) === 1);
  await join(t, url);
  assert.equal(metrics.counter('syncpad_connections_total'), 2);
  assert.equal(metrics.counter('syncpad_reconnects_total'), 1);

  const text = metrics.render();
  assert.match(text, /syncpad_sync_errors_total\{code="note-too-large"\} 1/);
  assert.match(text, /syncpad_connections_current 1/);
  assert.match(text, /syncpad_rooms_current 1/);
  assert.match(text, /syncpad_update_persist_ms_bucket\{le="\+Inf"\} 1/);
  assert.match(text, /# TYPE syncpad_reconnects_total counter/);
});

test('/metrics is hidden unless a token is configured and presented', async (t) => {
  const open = await start(t);
  assert.equal((await fetch(`http://127.0.0.1:${open.port}/metrics`)).status, 404);
  assert.equal((await fetch(`http://127.0.0.1:${open.port}/metrics`, { headers: { authorization: 'Bearer anything' } })).status, 404);

  const guarded = await start(t, { metricsToken: 'scrape-secret' });
  const base = `http://127.0.0.1:${guarded.port}/metrics`;
  assert.equal((await fetch(base)).status, 404);
  assert.equal((await fetch(base, { headers: { authorization: 'Bearer wrong' } })).status, 404);
  const ok = await fetch(base, { headers: { authorization: 'Bearer scrape-secret' } });
  assert.equal(ok.status, 200);
  assert.match(ok.headers.get('content-type') ?? '', /text\/plain/);
  assert.match(await ok.text(), /syncpad_connections_current 0/);
});

test('the logger writes one JSON line per event and its reserved keys cannot be overwritten', () => {
  const lines: string[] = [];
  const logger = createLogger((line) => lines.push(line), () => new Date('2026-01-02T03:04:05.000Z'));
  logger.warn('hello', { roomId: 'r1', level: 'info', msg: 'forged', ts: 'never' });
  assert.deepEqual(JSON.parse(lines[0]), { roomId: 'r1', ts: '2026-01-02T03:04:05.000Z', level: 'warn', msg: 'hello' });
  assert.doesNotThrow(() => createLogger(() => { throw new Error('disk full'); }).error('still fine'));
});
