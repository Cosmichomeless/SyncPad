import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { applyEditorUpdate, applyLocalTextEdit, createEditorDocument, encodeEditorState, type EditorDocument } from '../src/lib/note-document';
import { createNoteSync, type SyncState } from '../src/lib/note-sync';

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const unb64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(condition: () => boolean, label: string, timeout = 1500) {
  const deadline = Date.now() + timeout;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for ${label}`);
    await sleep(5);
  }
}

type Sent = { type: string; requestId?: string; update?: string; stateVector?: string };

class FakeSocket {
  readyState = 0;
  sent: Sent[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onSend: ((message: Sent) => void) | null = null;
  closedByClient = false;
  constructor(readonly url: string) {}
  send(data: string) {
    const message = JSON.parse(data) as Sent;
    this.sent.push(message);
    this.onSend?.(message);
  }
  close() {
    if (this.readyState === 3) return;
    this.closedByClient = true;
    this.readyState = 3;
    queueMicrotask(() => this.onclose?.());
  }
  open() { this.readyState = 1; this.onopen?.(); }
  receive(message: object) { this.onmessage?.({ data: JSON.stringify(message) }); }
  drop() { this.readyState = 3; this.onclose?.(); }
}

/** A tiny in-memory server that speaks the real Yjs protocol with a real Y.Doc. */
class FakeServer {
  doc = new Y.Doc();
  holdAcks = false;
  held: (() => void)[] = [];
  attach(socket: FakeSocket) {
    socket.onSend = (message) => {
      queueMicrotask(() => {
        if (message.type === 'sync-request') {
          const since = message.stateVector ? unb64(message.stateVector) : undefined;
          socket.receive({ type: 'sync', requestId: message.requestId, update: b64(Y.encodeStateAsUpdate(this.doc, since)), stateVector: b64(Y.encodeStateVector(this.doc)) });
        } else if (message.type === 'update' && message.update) {
          Y.applyUpdate(this.doc, unb64(message.update));
          const ack = () => socket.receive({ type: 'ack', requestId: message.requestId });
          if (this.holdAcks) this.held.push(ack); else ack();
        }
      });
    };
  }
  releaseAcks() { for (const ack of this.held.splice(0)) ack(); }
  text() { return this.doc.getText('content').toString(); }
}

function harness(options: { server?: FakeServer; document?: EditorDocument; online?: boolean; timing?: { initialDelayMs?: number; maxDelayMs?: number; deadlineMs?: number } } = {}) {
  const document = options.document ?? createEditorDocument();
  const sockets: FakeSocket[] = [];
  const states: SyncState[] = [];
  const pending: boolean[] = [];
  const errors: string[] = [];
  const listeners = new Map<string, Set<() => void>>();
  const events = {
    addEventListener: (type: string, listener: EventListenerOrEventListenerObject) => { (listeners.get(type) ?? listeners.set(type, new Set()).get(type)!).add(listener as () => void); },
    removeEventListener: (type: string, listener: EventListenerOrEventListenerObject) => { listeners.get(type)?.delete(listener as () => void); },
  };
  const network = { online: options.online ?? true };
  const emit = (type: 'online' | 'offline') => { network.online = type === 'online'; for (const listener of [...(listeners.get(type) ?? [])]) listener(); };
  const sync = createNoteSync({
    document,
    url: 'ws://test/ws?noteId=n1',
    onState: (state) => states.push(state),
    onPending: (value) => pending.push(value),
    onError: (message) => errors.push(message),
    online: () => network.online,
    events,
    timing: { initialDelayMs: 10, maxDelayMs: 40, deadlineMs: 80, ...options.timing },
    socketFactory: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      options.server?.attach(socket);
      return socket as unknown as WebSocket;
    },
  });
  const current = () => sockets[sockets.length - 1];
  return { document, sync, sockets, states, pending, errors, emit, current, network, listeners, state: () => states[states.length - 1] };
}

function text(document: EditorDocument) { return document.content.toString(); }

test('only an acknowledged reconciliation reports up-to-date', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  assert.equal(h.state(), 'reconnecting');
  h.current().open();
  assert.equal(h.state(), 'syncing');
  assert.equal(h.current().sent[0].type, 'sync-request');
  assert.ok(h.current().sent[0].requestId && h.current().sent[0].stateVector);
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  assert.equal(h.current().sent.filter((message) => message.type === 'update').length, 1);
  h.sync.destroy();
});

test('divergent offline branches converge including deletions', async () => {
  const server = new FakeServer();
  server.doc.getText('content').insert(0, 'base compartida final');
  const h = harness({ server, online: false });
  assert.equal(h.sockets.length, 0);
  assert.equal(h.state(), 'offline');
  // Local branch (before it ever met the server's text): shares history through a snapshot.
  applyEditorUpdate(h.document.doc, Y.encodeStateAsUpdate(server.doc));
  server.doc.getText('content').insert(0, 'PRIMERO ');
  const at = text(h.document).indexOf(' final');
  applyLocalTextEdit(h.document, text(h.document).replace(' final', ' + offline'));
  assert.equal(at > 0, true);
  h.emit('online');
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  assert.equal(text(h.document), 'PRIMERO base compartida + offline');
  assert.equal(server.text(), text(h.document));
  h.sync.destroy();
});

test('repeating the handshake never duplicates content', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  applyLocalTextEdit(h.document, 'una sola vez');
  for (let round = 0; round < 3; round++) {
    h.current().open();
    await until(() => h.state() === 'up-to-date', `up-to-date round ${round}`);
    h.current().drop();
    await until(() => h.sockets.length === round + 2, `reconnect ${round}`);
  }
  assert.equal(text(h.document), 'una sola vez');
  assert.equal(server.text(), 'una sola vez');
  h.sync.destroy();
});

test('edits made while an upload is in flight stay pending and upload next', async () => {
  const server = new FakeServer();
  server.holdAcks = true;
  const h = harness({ server });
  h.current().open();
  await until(() => server.held.length === 1, 'first upload');
  applyLocalTextEdit(h.document, 'durante el vuelo');
  assert.equal(h.pending[h.pending.length - 1], true);
  server.releaseAcks(); // acknowledges the handshake upload only
  await until(() => h.current().sent.filter((message) => message.type === 'update').length === 2, 'second upload');
  assert.notEqual(h.state(), 'up-to-date');
  server.holdAcks = false;
  server.releaseAcks();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  assert.equal(server.text(), 'durante el vuelo');
  assert.equal(h.pending[h.pending.length - 1], false);
  h.sync.destroy();
});

test('a delete-only change is uploaded and acknowledged', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  applyLocalTextEdit(h.document, 'borrar esto');
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'first sync');
  applyLocalTextEdit(h.document, '');
  assert.equal(h.pending[h.pending.length - 1], true);
  await until(() => h.state() === 'up-to-date' && h.pending[h.pending.length - 1] === false, 'delete acknowledged');
  assert.equal(server.text(), '');
  h.sync.destroy();
});

test('after a reload the persisted state must still be reconciled before up-to-date', async () => {
  const server = new FakeServer();
  server.holdAcks = true;
  const persisted = createEditorDocument();
  applyEditorUpdate(persisted.doc, encodeEditorState((() => { const d = createEditorDocument(); d.content.insert(0, 'guardado antes de recargar'); return d.doc; })()));
  const h = harness({ server, document: persisted });
  h.current().open();
  await until(() => server.held.length === 1, 'reconciliation upload');
  assert.equal(h.state(), 'syncing');
  server.holdAcks = false;
  server.releaseAcks();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  assert.equal(server.text(), 'guardado antes de recargar');
  h.sync.destroy();
});

test('an unsolicited initial snapshot is applied but does not complete the handshake', async () => {
  const h = harness();
  h.current().open();
  const remote = createEditorDocument();
  remote.content.insert(0, 'del servidor');
  h.current().receive({ type: 'sync', update: b64(encodeEditorState(remote.doc)), stateVector: b64(Y.encodeStateVector(remote.doc)) });
  assert.equal(text(h.document), 'del servidor');
  assert.equal(h.state(), 'syncing');
  assert.equal(h.current().sent.filter((message) => message.type === 'update').length, 0);
  h.sync.destroy();
});

test('remote updates do not count as pending local work', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  const remote = createEditorDocument();
  remote.content.insert(0, 'de otro cliente');
  h.current().receive({ type: 'update', update: b64(encodeEditorState(remote.doc)) });
  assert.equal(text(h.document), 'de otro cliente');
  assert.equal(h.state(), 'up-to-date');
  assert.equal(h.pending.includes(true), false);
  h.sync.destroy();
});

test('callbacks of a replaced socket are ignored', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  const first = h.current();
  h.sync.retry();
  const second = h.current();
  assert.notEqual(first, second);
  const stale = createEditorDocument();
  stale.content.insert(0, 'obsoleto');
  first.receive({ type: 'update', update: b64(encodeEditorState(stale.doc)) });
  first.receive({ type: 'sync', requestId: first.sent[0]?.requestId, update: b64(encodeEditorState(stale.doc)), stateVector: b64(Y.encodeStateVector(stale.doc)) });
  first.drop();
  assert.equal(text(h.document), '');
  await sleep(40);
  assert.equal(h.sockets.length, 2);
  second.open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  h.sync.destroy();
});

test('a dropped socket reconnects with the same document and keeps local edits', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'first sync');
  h.current().drop();
  assert.equal(h.state(), 'reconnecting');
  applyLocalTextEdit(h.document, 'escrito sin red');
  assert.equal(h.pending[h.pending.length - 1], true);
  await until(() => h.sockets.length === 2, 'reconnect');
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'resynced');
  assert.equal(server.text(), 'escrito sin red');
  h.sync.destroy();
});

test('a silent server trips the handshake deadline and a new socket is opened', async () => {
  const h = harness();
  h.current().open();
  await until(() => h.sockets.length === 2, 'reconnect after deadline', 600);
  assert.equal(h.sockets[0].closedByClient, true);
  assert.equal(h.state(), 'reconnecting');
  h.sync.destroy();
});

test('a missing ack trips the deadline and the change is uploaded again', async () => {
  const server = new FakeServer();
  server.holdAcks = true;
  const h = harness({ server });
  applyLocalTextEdit(h.document, 'sin ack');
  h.current().open();
  await until(() => h.sockets.length === 2, 'reconnect after ack deadline', 600);
  server.holdAcks = false;
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  assert.equal(server.text(), 'sin ack');
  h.sync.destroy();
});

test('offline and online events close the transport and reconnect immediately', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  h.emit('offline');
  assert.equal(h.state(), 'offline');
  assert.equal(h.sockets[0].closedByClient, true);
  applyLocalTextEdit(h.document, 'sin conexion');
  assert.equal(h.pending[h.pending.length - 1], true);
  await sleep(60);
  assert.equal(h.sockets.length, 1);
  h.emit('online');
  assert.equal(h.sockets.length, 2);
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  assert.equal(server.text(), 'sin conexion');
  h.sync.destroy();
});

test('a non-retryable error stops automatic retries until retry() is called', async () => {
  const h = harness();
  h.current().open();
  h.current().receive({ type: 'sync-error', requestId: h.current().sent[0].requestId, code: 'invalid-message', retryable: false });
  assert.equal(h.errors.length, 1);
  assert.equal(h.state(), 'offline');
  await sleep(100);
  assert.equal(h.sockets.length, 1);
  applyLocalTextEdit(h.document, 'conservado');
  h.sync.retry();
  assert.equal(h.sockets.length, 2);
  assert.equal(text(h.document), 'conservado');
  h.sync.destroy();
});

test('a retryable storage error reconnects without losing local changes', async () => {
  const h = harness();
  applyLocalTextEdit(h.document, 'no se pierde');
  h.current().open();
  h.current().receive({ type: 'sync-error', requestId: h.current().sent[0].requestId, code: 'persistence-unavailable', retryable: true });
  await until(() => h.sockets.length === 2, 'reconnect');
  assert.equal(text(h.document), 'no se pierde');
  assert.equal(h.errors.length, 0);
  h.sync.destroy();
});

test('destroy cancels timers and listeners, closes the socket and keeps the document usable', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  h.current().drop();
  h.sync.destroy();
  const emitted = h.states.length;
  assert.equal([...h.listeners.values()].every((set) => set.size === 0), true);
  await sleep(80);
  assert.equal(h.sockets.length, 1);
  applyLocalTextEdit(h.document, 'despues de destruir');
  assert.equal(h.states.length, emitted);
  assert.equal(text(h.document), 'despues de destruir');
});
