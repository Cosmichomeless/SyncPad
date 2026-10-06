import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNoteUpdate, encodeNoteState, encodeNoteStateSince, encodeNoteStateVector } from './document.js';
import { assertConverged, createPeer, createServer, deliver, forkPeer, permutations, reconnect, settle, type Peer } from './testing/convergence.js';

const BASE = 'Lista de compras:\n- leche\n- pan\n- huevos\n';

/** Three clients that all synced once, then each edited a different part while offline. */
function offlineBranches() {
  const origin = createPeer('origin');
  origin.content.insert(0, BASE);
  const base = encodeNoteState(origin.doc);
  const clients = ['A', 'B', 'C'].map((name) => createPeer(name, base));
  const [a, b, c] = clients as [Peer, Peer, Peer];
  a.content.insert(a.content.toString().indexOf('- pan'), '- cafe\n'); // inserta en medio
  b.content.delete(b.content.toString().indexOf('- leche'), '- leche\n'.length); // borra una línea
  c.content.insert(c.content.length, '- queso\n'); // añade al final
  return { base, clients };
}

test('three divergent offline branches converge for every reconnection order', () => {
  const results = new Set<string>();
  for (const order of permutations([0, 1, 2])) {
    const { base, clients } = offlineBranches();
    const server = createServer(base);
    for (const index of order) reconnect(clients[index] as Peer, server);
    // Reconnection order must not leave anyone behind: a second handshake brings late joiners up to date.
    for (const client of clients) reconnect(client, server);
    assertConverged([server, ...clients], `order ${order.join('>')}`);
    results.add(server.content.toString());
  }
  // Different clients draw different clientIDs in each run, so the merged text is checked per run
  // for content; here we only require that each order lost nothing.
  for (const text of results) {
    assert.ok(text.includes('- cafe') && text.includes('- queso'), text);
    assert.ok(!text.includes('- leche'), text);
    assert.ok(text.includes('- pan') && text.includes('- huevos'), text);
  }
});

test('the merged text is identical for every delivery order of the same three updates', () => {
  const { base, clients } = offlineBranches();
  const baseVector = encodeNoteStateVector(createPeer('probe', base).doc);
  const updates = clients.map((client) => encodeNoteStateSince(client.doc, baseVector));
  const texts = permutations([0, 1, 2]).map((order) => {
    const receiver = createPeer('receiver', base);
    for (const index of order) applyNoteUpdate(receiver.doc, updates[index] as Uint8Array);
    return receiver.content.toString();
  });
  assert.equal(new Set(texts).size, 1, `orders produced different text: ${JSON.stringify([...new Set(texts)])}`);
  assert.equal(texts[0], 'Lista de compras:\n- cafe\n- pan\n- huevos\n- queso\n');
});

test('duplicated and re-ordered delivery of the same updates does not change the result', () => {
  const { base, clients } = offlineBranches();
  const baseVector = encodeNoteStateVector(createPeer('probe', base).doc);
  const updates = clients.map((client) => encodeNoteStateSince(client.doc, baseVector));
  const once = createPeer('once', base);
  for (const update of updates) applyNoteUpdate(once.doc, update);
  const noisy = createPeer('noisy', base);
  for (const update of [...updates, ...updates.slice().reverse(), updates[1] as Uint8Array, updates[0] as Uint8Array]) {
    applyNoteUpdate(noisy.doc, update);
  }
  assert.equal(noisy.content.toString(), once.content.toString());
});

test('two clients that edit the same line offline both keep their words after reconnecting', () => {
  const origin = createPeer('origin');
  origin.content.insert(0, 'titulo: borrador');
  const base = encodeNoteState(origin.doc);
  const a = createPeer('A', base);
  const b = createPeer('B', base);
  const server = createServer(base);
  a.content.delete(8, 'borrador'.length);
  a.content.insert(8, 'plan semanal');
  b.content.delete(8, 'borrador'.length);
  b.content.insert(8, 'revision');
  reconnect(b, server);
  reconnect(a, server);
  reconnect(b, server);
  assertConverged([server, a, b]);
  const text = server.content.toString();
  assert.ok(text.startsWith('titulo: '), text);
  assert.ok(text.includes('plan semanal') && text.includes('revision'), text);
  assert.ok(!text.includes('borrador'), text);
});

test('a client that reconnects with no changes just receives what it missed', () => {
  const { base, clients } = offlineBranches();
  const idle = createPeer('idle', base);
  const server = createServer(base);
  for (const client of clients) reconnect(client, server);
  reconnect(idle, server);
  for (const client of clients) reconnect(client, server); // live broadcast in production; a second handshake here
  assertConverged([server, idle, ...clients]);
  assert.ok(idle.content.toString().includes('- queso'));
});

test('settle() leaves every pair in the same Yjs state after a full mesh exchange', () => {
  const { clients } = offlineBranches();
  settle(clients);
  assertConverged(clients);
  deliver(clients[0] as Peer, clients[1] as Peer);
  assertConverged(clients);
});

test('a fresh client forked after the merge starts from the merged document', () => {
  const { base, clients } = offlineBranches();
  const server = createServer(base);
  for (const client of clients) reconnect(client, server);
  for (const client of clients) reconnect(client, server);
  const late = forkPeer('late', server);
  assert.equal(late.content.toString(), server.content.toString());
});
