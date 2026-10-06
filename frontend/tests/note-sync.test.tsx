import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { applyEditorUpdate, applyLocalTextEdit, createEditorDocument, encodeEditorState, type EditorDocument } from '../src/lib/note-document';
import { createNoteSync, type NoteProbe, type SyncState } from '../src/lib/note-sync';

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
  onclose: ((event?: { code: number }) => void) | null = null;
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
  drop(code?: number) { this.readyState = 3; this.onclose?.(code === undefined ? undefined : { code }); }
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

function harness(options: { server?: FakeServer; document?: EditorDocument; online?: boolean; probe?: () => Promise<NoteProbe>; timing?: { initialDelayMs?: number; maxDelayMs?: number; deadlineMs?: number } } = {}) {
  const document = options.document ?? createEditorDocument();
  const sockets: FakeSocket[] = [];
  const states: SyncState[] = [];
  const pending: boolean[] = [];
  const errors: string[] = [];
  const gone: number[] = [];
  const incompatible: number[] = [];
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
    onGone: () => gone.push(Date.now()),
    onIncompatible: () => incompatible.push(Date.now()),
    probe: options.probe,
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
  return { document, sync, sockets, states, pending, errors, gone, incompatible, emit, current, network, listeners, state: () => states[states.length - 1] };
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

test('manual retry cancels the pending backoff instead of racing it', async () => {
  const server = new FakeServer();
  const h = harness({ server, timing: { initialDelayMs: 60, maxDelayMs: 60 } });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  h.current().drop();
  assert.equal(h.sockets.length, 1);
  h.sync.retry();
  assert.equal(h.sockets.length, 2);
  await sleep(150);
  assert.equal(h.sockets.length, 2, 'the cancelled backoff timer must not open a third socket');
  h.sync.destroy();
});

test('a persistent failure keeps the text and a successful retry returns to up-to-date', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  applyLocalTextEdit(h.document, 'texto que no se borra');
  h.current().open();
  h.current().receive({ type: 'sync-error', requestId: h.current().sent[0].requestId, code: 'persistence-unavailable', retryable: false });
  assert.equal(h.state(), 'offline');
  assert.equal(text(h.document), 'texto que no se borra');
  h.sync.retry();
  assert.equal(text(h.document), 'texto que no se borra');
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date after retry');
  assert.equal(server.text(), 'texto que no se borra');
  h.sync.destroy();
});

test('an ack for an older upload never reports up-to-date while a newer edit is unsaved', async () => {
  const server = new FakeServer();
  server.holdAcks = true;
  const h = harness({ server });
  h.current().open();
  await until(() => server.held.length === 1, 'handshake upload');
  applyLocalTextEdit(h.document, 'edicion mas nueva');
  server.releaseAcks();
  await until(() => server.held.length === 1, 'second upload held');
  assert.equal(h.state(), 'syncing');
  assert.equal(h.pending[h.pending.length - 1], true);
  server.holdAcks = false;
  server.releaseAcks();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  h.sync.destroy();
});

test('a note-deleted error stops syncing for good and keeps the unsynced text', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  applyLocalTextEdit(h.document, 'cambio que nunca llegara');
  h.current().receive({ type: 'sync-error', code: 'note-deleted', retryable: false });
  assert.equal(h.gone.length, 1);
  assert.equal(h.state(), 'offline');
  assert.equal(h.errors.length, 0, 'deletion is not reported as a generic sync failure');
  assert.equal(text(h.document), 'cambio que nunca llegara');
  const sockets = h.sockets.length;
  h.sync.retry();
  h.emit('online');
  await sleep(60);
  assert.equal(h.sockets.length, sockets, 'a deleted note is never reconnected');
  assert.equal(h.gone.length, 1);
  h.sync.destroy();
});

test('the 4404 close code is enough even if the error message was lost', async () => {
  const h = harness({ server: new FakeServer() });
  h.current().open();
  h.current().drop(4404);
  assert.equal(h.gone.length, 1);
  await sleep(60);
  assert.equal(h.sockets.length, 1);
  h.sync.destroy();
});

test('a connection that never opens is probed, and a deleted note stops the retries', async () => {
  let probes = 0;
  const h = harness({ probe: async () => { probes++; return 'gone'; } });
  applyLocalTextEdit(h.document, 'editado sin red');
  h.current().drop();
  await until(() => h.gone.length === 1, 'gone after probe');
  assert.equal(probes, 1);
  assert.equal(h.state(), 'offline');
  assert.equal(text(h.document), 'editado sin red');
  const sockets = h.sockets.length;
  await sleep(80);
  assert.equal(h.sockets.length, sockets, 'no reconnect after the note is known to be gone');
  h.sync.destroy();
});

test('an unknown or failing probe keeps retrying instead of declaring the note gone', async () => {
  const answers: (NoteProbe | Error)[] = ['unknown', new Error('network'), 'present'];
  let probes = 0;
  const h = harness({ probe: async () => { const answer = answers[probes++]; if (answer instanceof Error) throw answer; return answer; } });
  for (let round = 0; round < 3; round++) {
    const count = h.sockets.length;
    h.current().drop();
    await until(() => h.sockets.length === count + 1, `reconnect ${round + 1}`);
  }
  assert.equal(probes, 3);
  assert.equal(h.gone.length, 0);
  assert.equal(h.state(), 'reconnecting');
  h.sync.destroy();
});

test('a drop after a successful open is a transport failure and is not probed', async () => {
  let probes = 0;
  const h = harness({ server: new FakeServer(), probe: async () => { probes++; return 'gone'; } });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  h.current().drop();
  await until(() => h.sockets.length === 2, 'reconnect');
  assert.equal(probes, 0);
  assert.equal(h.gone.length, 0);
  h.sync.destroy();
});

test('without a network the probe is not asked', async () => {
  let probes = 0;
  const h = harness({ online: false, probe: async () => { probes++; return 'gone'; } });
  await sleep(40);
  assert.equal(probes, 0);
  assert.equal(h.gone.length, 0);
  h.sync.destroy();
});

/** What a client built after a schema bump would send for a note whose current state is `base`. */
function futureUpdate(base: Uint8Array, version = 2) {
  const future = new Y.Doc();
  Y.applyUpdate(future, base);
  future.getMap<unknown>('note').set('schemaVersion', version);
  future.getText('content').insert(0, `v${version}: `);
  return Y.encodeStateAsUpdate(future, Y.encodeStateVector(new Y.Doc()));
}

test('a handshake answer in a newer schema is refused before it touches the document', async () => {
  const document = createEditorDocument();
  applyLocalTextEdit(document, 'mi texto local');
  const before = encodeEditorState(document.doc);
  const server = new FakeServer();
  Y.applyUpdate(server.doc, futureUpdate(encodeEditorState(createEditorDocument().doc)));
  const h = harness({ server, document });
  h.current().open();
  await until(() => h.incompatible.length === 1, 'incompatible');
  assert.deepEqual(encodeEditorState(document.doc), before, 'document untouched');
  assert.equal(text(document), 'mi texto local');
  assert.equal(h.state(), 'offline');
  assert.equal(h.errors.length, 0);
  await sleep(120);
  assert.equal(h.sockets.length, 1, 'no reconnection attempts');
  assert.equal(h.current().sent.some((message) => message.type === 'update'), false, 'local edits are never uploaded to a schema we cannot read');
  h.sync.destroy();
});

test('a live update in a newer schema stops syncing without being applied', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  applyLocalTextEdit(h.document, 'antes');
  await until(() => h.state() === 'up-to-date' && server.text() === 'antes', 'saved');
  const before = encodeEditorState(h.document.doc);
  h.current().receive({ type: 'update', update: b64(futureUpdate(encodeEditorState(h.document.doc))) });
  assert.equal(h.incompatible.length, 1);
  assert.deepEqual(encodeEditorState(h.document.doc), before);
  applyLocalTextEdit(h.document, 'antes y después');
  assert.equal(h.sockets.length, 1);
  assert.equal(h.pending[h.pending.length - 1], true, 'the edit stays pending on this device');
  assert.equal(text(h.document), 'antes y después');
  h.sync.destroy();
});

test('an incompatible-schema error from the server is final and keeps the text', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  applyLocalTextEdit(h.document, 'cambios locales');
  h.current().receive({ type: 'sync-error', code: 'incompatible-schema', retryable: false });
  assert.equal(h.incompatible.length, 1);
  assert.equal(h.state(), 'offline');
  await sleep(120);
  assert.equal(h.sockets.length, 1);
  h.sync.retry();
  assert.equal(h.sockets.length, 1, 'retry cannot help until the app is updated');
  assert.equal(text(h.document), 'cambios locales');
  h.sync.destroy();
});

test('compatible remote updates keep applying normally', async () => {
  const server = new FakeServer();
  const h = harness({ server });
  h.current().open();
  await until(() => h.state() === 'up-to-date', 'up-to-date');
  const remote = createEditorDocument();
  Y.applyUpdate(remote.doc, encodeEditorState(h.document.doc));
  applyLocalTextEdit(remote, 'desde otro cliente');
  h.current().receive({ type: 'update', update: b64(encodeEditorState(remote.doc)) });
  assert.equal(text(h.document), 'desde otro cliente');
  assert.equal(h.incompatible.length, 0);
  h.sync.destroy();
});
