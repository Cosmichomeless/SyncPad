import assert from 'node:assert/strict';
import { once } from 'node:events';
import test, { type TestContext } from 'node:test';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateVector } from '@syncpad/shared';
import type { AuthService } from '../src/auth.js';
import { createLogger } from '../src/logger.js';
import { createMetrics } from '../src/metrics.js';
import type { NoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import type { SyncStore } from '../src/sync-store.js';

const SHARED_NOTE = '123e4567-e89b-12d3-a456-426614174001';
const OTHER_NOTE = '123e4567-e89b-12d3-a456-426614174002';
const USERS = {
  mallory: { id: '123e4567-e89b-12d3-a456-4266141740a1' as never, email: 'mallory@example.com' },
  carol: { id: '123e4567-e89b-12d3-a456-4266141740b2' as never, email: 'carol@example.com' },
  alice: { id: '123e4567-e89b-12d3-a456-4266141740c3' as never, email: 'alice@example.com' },
};
/** A recognisable piece of "private" text: it must never show up in a log line or a metric. */
const CANARY = 'CANARY-contenido-privado-7f3a';
const MAX_MESSAGE_BYTES = 8192;
const MAX_NOTE_CHARS = 2000;

/** Mallory and Carol share a note; Alice has another. One process, one room cache. */
async function start(t: TestContext) {
  const members = new Map<string, Set<string>>([[SHARED_NOTE, new Set([USERS.mallory.id, USERS.carol.id])], [OTHER_NOTE, new Set([USERS.alice.id])]]);
  const auth: AuthService = {
    async register() { return USERS.mallory; }, async authenticate() { return USERS.mallory; }, async createSession() { return 'mallory'; },
    async getUserBySession(token) { return USERS[token as keyof typeof USERS] ?? null; },
    async invalidateSession() {},
  };
  const notes: NoteService = {
    async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; },
    async canAccess(userId, noteId) { return members.get(noteId)?.has(userId) ?? false; },
  };
  const stored = new Map<string, Uint8Array[]>();
  const store: SyncStore = {
    async load(noteId) { return [...(stored.get(noteId) ?? [])]; },
    async append(noteId, update) { stored.set(noteId, [...(stored.get(noteId) ?? []), update]); return true; },
  };
  const lines: string[] = [];
  const metrics = createMetrics();
  const app = createSyncServer({
    auth, notes, syncStore: store, metrics, logger: createLogger((line) => lines.push(line)),
    limits: { heartbeatMs: 0, maxMessageBytes: MAX_MESSAGE_BYTES, maxNoteChars: MAX_NOTE_CHARS, messagesPerSecond: 10_000, messageBurst: 10_000 },
    security: loadSecurityConfig({}),
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as { port: number }).port;
  return { url: (noteId: string) => `ws://127.0.0.1:${port}/ws?noteId=${noteId}`, stored, lines, metrics };
}

type Message = { type: string; update?: string; requestId?: string; code?: string };

async function waitFor(condition: () => boolean, ms = 3000) {
  const deadline = Date.now() + ms;
  while (!condition()) {
    if (Date.now() > deadline) assert.fail('condition not met in time');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function join(t: TestContext, url: string, user: keyof typeof USERS) {
  const client = new WebSocket(url, { headers: { cookie: `syncpad_session=${user}`, origin: 'http://127.0.0.1:3000' } });
  t.after(() => client.terminate());
  const seen: Message[] = [];
  client.on('message', (raw) => seen.push(JSON.parse(raw.toString())));
  const closed = new Promise<number>((resolve) => client.once('close', (code) => resolve(code)));
  await once(client, 'open');
  client.send(JSON.stringify({ type: 'sync-request', requestId: 'hello', stateVector: Buffer.from(encodeNoteStateVector(createNoteDocument().doc)).toString('base64') }));
  await waitFor(() => seen.some((message) => message.type === 'sync' && message.requestId === 'hello'));
  return { client, seen, closed };
}

const base64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
function textUpdate(text: string) {
  const author = createNoteDocument();
  author.content.insert(0, text);
  return base64(encodeNoteState(author.doc));
}
function textOf(messages: Message[]) {
  const note = createNoteDocument();
  for (const message of messages) if (message.update) applyNoteUpdate(note.doc, Buffer.from(message.update, 'base64'));
  return note.content.toString();
}

/** What every hostile input must leave behind: bystanders connected and able to save, and nothing hostile stored. */
async function assertBystandersUnharmed(ctx: Awaited<ReturnType<typeof start>>, bystanders: Awaited<ReturnType<typeof join>>[], label: string) {
  for (const bystander of bystanders) assert.equal(bystander.client.readyState, WebSocket.OPEN, `${label}: a bystander was disconnected`);
  const marker = `vivo-${Math.random().toString(36).slice(2)}`;
  bystanders[0].client.send(JSON.stringify({ type: 'update', requestId: marker, update: textUpdate(marker) }));
  await waitFor(() => bystanders[0].seen.some((message) => message.type === 'ack' && message.requestId === marker));
  const persisted = [...ctx.stored.values()].flat();
  assert.deepEqual(persisted.length, 1, `${label}: only the bystander's own update is stored`);
  assert.equal(Buffer.from(persisted[0]).includes(CANARY), false);
}

/** A well-formed update whose text carries `attributes` — valid Yjs, forbidden content. */
function markedUpdate(attributes: Record<string, unknown>) {
  const author = createNoteDocument();
  author.content.insert(0, 'enlace ' + CANARY);
  author.content.format(0, 6, attributes);
  return base64(encodeNoteState(author.doc));
}

const HOSTILE: [string, string | Buffer][] = [
  ['empty text', ''],
  ['not JSON', 'esto no es json ' + CANARY],
  ['truncated JSON', '{"type":"update","update":"' + CANARY],
  ['JSON null', 'null'],
  ['JSON number', '42'],
  ['JSON string', JSON.stringify(CANARY)],
  ['JSON array', '[1,2,3]'],
  ['binary frame', Buffer.from([0xff, 0xfe, 0x00, 0x01, 0x80])],
  ['update without payload', JSON.stringify({ type: 'update', requestId: 'a' })],
  ['update that is not a string', JSON.stringify({ type: 'update', requestId: 'a', update: { nested: CANARY } })],
  ['update that is not Yjs', JSON.stringify({ type: 'update', requestId: 'a', update: base64(Buffer.from(CANARY)) })],
  ['update with random bytes', JSON.stringify({ type: 'update', requestId: 'a', update: base64(Uint8Array.from({ length: 200 }, (_, i) => (i * 37 + 11) % 256)) })],
  ['update that is truncated Yjs', JSON.stringify({ type: 'update', requestId: 'a', update: textUpdate(CANARY).slice(0, 12) })],
  ['link mark with a javascript: URL', JSON.stringify({ type: 'update', requestId: 'a', update: markedUpdate({ link: 'javascript:alert(1)' }) })],
  ['link mark with a data: URL', JSON.stringify({ type: 'update', requestId: 'a', update: markedUpdate({ link: 'data:text/html;base64,PHNjcmlwdD4=' }) })],
  ['unknown mark (onclick)', JSON.stringify({ type: 'update', requestId: 'a', update: markedUpdate({ onclick: 'alert(1)' }) })],
  ['state vector that is not Yjs', JSON.stringify({ type: 'sync-request', requestId: 'a', stateVector: base64(Buffer.from(CANARY)) })],
  ['requestId that is a number', JSON.stringify({ type: 'sync-request', requestId: 7 })],
  ['requestId that is an object', JSON.stringify({ type: 'update', requestId: { a: CANARY }, update: textUpdate('x') })],
  ['requestId that is far too long', JSON.stringify({ type: 'sync-request', requestId: 'r'.repeat(1000) })],
  ['cursor that is not an object', JSON.stringify({ type: 'awareness', cursor: CANARY })],
  ['cursor with invalid positions', JSON.stringify({ type: 'awareness', cursor: { anchor: '!!', head: CANARY } })],
  ['cursor with a huge position', JSON.stringify({ type: 'awareness', cursor: { anchor: 'A'.repeat(4000), head: 'A'.repeat(4000) } })],
];

for (const [label, payload] of HOSTILE) {
  test(`hostile input (${label}) closes only that connection and leaks nothing`, async (t) => {
    const ctx = await start(t);
    const mallory = await join(t, ctx.url(SHARED_NOTE), 'mallory');
    const carol = await join(t, ctx.url(SHARED_NOTE), 'carol');
    const alice = await join(t, ctx.url(OTHER_NOTE), 'alice');

    mallory.client.send(payload, { binary: Buffer.isBuffer(payload) });
    assert.equal(await mallory.closed, 1003, 'the offender is cut with "unsupported data"');
    assert.ok(mallory.seen.some((message) => message.type === 'sync-error' && message.code === 'invalid-message'), 'and told why');

    await assertBystandersUnharmed(ctx, [carol, alice], label);
    // Carol (same room) still receives live edits made after the attack; Alice's room is independent.
    const marker = `despues-${Math.random().toString(36).slice(2)}`;
    alice.client.send(JSON.stringify({ type: 'update', requestId: 'm', update: textUpdate(marker) }));
    await waitFor(() => alice.seen.some((message) => message.type === 'ack' && message.requestId === 'm'));
    assert.equal(textOf(carol.seen).includes(marker), false, 'rooms stay independent');

    const exposed = [...ctx.lines, ctx.metrics.render()].join('\n');
    assert.equal(exposed.includes(CANARY), false, 'private content reached the logs or metrics');
    assert.doesNotMatch(exposed, /\n\s+at\s|Error:|node_modules|\.ts:\d+/, 'a stack trace reached the logs or metrics');
  });
}

test('a frame over the size cap is refused by the transport and only its sender is dropped', async (t) => {
  const ctx = await start(t);
  const mallory = await join(t, ctx.url(SHARED_NOTE), 'mallory');
  const carol = await join(t, ctx.url(SHARED_NOTE), 'carol');
  mallory.client.send(JSON.stringify({ type: 'update', update: 'A'.repeat(MAX_MESSAGE_BYTES * 4) }));
  assert.equal(await mallory.closed, 1009);
  await assertBystandersUnharmed(ctx, [carol], 'oversized frame');
});

test('a valid update that would grow the note past its limit is refused without closing the room', async (t) => {
  const ctx = await start(t);
  const mallory = await join(t, ctx.url(SHARED_NOTE), 'mallory');
  const carol = await join(t, ctx.url(SHARED_NOTE), 'carol');
  mallory.client.send(JSON.stringify({ type: 'update', requestId: 'big', update: textUpdate(CANARY.repeat(200)) }));
  await waitFor(() => mallory.seen.some((message) => message.code === 'note-too-large'));
  assert.equal(textOf(carol.seen).length, 0);
  assert.equal(carol.client.readyState, WebSocket.OPEN);
  assert.equal(ctx.stored.size, 0);
  assert.equal([...ctx.lines, ctx.metrics.render()].join('\n').includes(CANARY), false);
});

test('seeded mutations of a valid update never crash the server or hurt other rooms', { timeout: 30_000 }, async (t) => {
  const ctx = await start(t);
  const carol = await join(t, ctx.url(SHARED_NOTE), 'carol');
  const alice = await join(t, ctx.url(OTHER_NOTE), 'alice');
  const original = Buffer.from(textUpdate('hola mundo ' + CANARY), 'base64');
  let seed = 0x2545f491;
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 0x100000000; };

  let refused = 0;
  for (let round = 0; round < 120; round++) {
    const mutated = Buffer.from(original);
    const flips = 1 + Math.floor(random() * 4);
    for (let i = 0; i < flips; i++) mutated[Math.floor(random() * mutated.length)] = Math.floor(random() * 256);
    const payload = random() < 0.3 ? mutated.subarray(0, 1 + Math.floor(random() * mutated.length)) : mutated;
    const attacker = await join(t, ctx.url(SHARED_NOTE), 'mallory');
    attacker.client.send(JSON.stringify({ type: 'update', requestId: 'fz', update: base64(payload) }));
    // Either the mutation is still a legal update (acked) or the sender is cut: never a hang, never a crash.
    await Promise.race([attacker.closed, waitFor(() => attacker.seen.some((message) => message.type === 'ack' || message.type === 'sync-error'))]);
    if (attacker.seen.some((message) => message.type === 'sync-error')) refused++;
    attacker.client.terminate();
  }
  assert.ok(refused > 0, 'the fuzzer should hit at least one invalid payload');
  assert.equal(carol.client.readyState, WebSocket.OPEN);
  assert.equal(alice.client.readyState, WebSocket.OPEN);
  const marker = 'sobrevive';
  alice.client.send(JSON.stringify({ type: 'update', requestId: 'm', update: textUpdate(marker) }));
  await waitFor(() => alice.seen.some((message) => message.type === 'ack' && message.requestId === 'm'));
  const exposed = [...ctx.lines, ctx.metrics.render()].join('\n');
  assert.equal(exposed.includes(CANARY), false);
  assert.doesNotMatch(exposed, /\n\s+at\s|Error:|node_modules/);
});
