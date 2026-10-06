import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNoteUpdate, encodeNoteState, encodeNoteStateSince, encodeNoteStateVector } from './document.js';
import { assertConverged, createPeer, exchange, forkPeer, sameYjsState } from './testing/convergence.js';

function pair(base: string) {
  const origin = createPeer('origin');
  origin.content.insert(0, base);
  return { a: forkPeer('A', origin), b: forkPeer('B', origin) };
}

test('simultaneous inserts at the same position keep both insertions and converge', () => {
  const { a, b } = pair('hola mundo');
  a.content.insert(4, ' querido');
  b.content.insert(4, ' amigo');
  exchange(a, b);
  assertConverged([a, b]);
  const merged = a.content.toString();
  assert.ok(merged.includes(' querido') && merged.includes(' amigo'), merged);
  assert.equal(merged.length, 'hola mundo'.length + ' querido'.length + ' amigo'.length);
});

test('the order in which the same two updates arrive does not change the result', () => {
  const origin = createPeer('origin');
  origin.content.insert(0, 'hola mundo');
  const base = encodeNoteState(origin.doc);
  const a = createPeer('A', base);
  const b = createPeer('B', base);
  a.content.insert(4, ' A');
  b.content.insert(4, ' B');
  const fromA = encodeNoteStateSince(a.doc, encodeNoteStateVector(origin.doc));
  const fromB = encodeNoteStateSince(b.doc, encodeNoteStateVector(origin.doc));

  const aThenB = createPeer('AB', base);
  applyNoteUpdate(aThenB.doc, fromA);
  applyNoteUpdate(aThenB.doc, fromB);
  const bThenA = createPeer('BA', base);
  applyNoteUpdate(bThenA.doc, fromB);
  applyNoteUpdate(bThenA.doc, fromA);

  // Same visible result for both arrival orders; the structural comparison needs one exchange
  // because each fresh peer also holds its own (identical-valued) local schemaVersion item.
  assert.equal(aThenB.content.toString(), bThenA.content.toString());
  exchange(aThenB, bThenA);
  assertConverged([aThenB, bThenA]);
  assert.ok(aThenB.content.toString().includes(' A') && aThenB.content.toString().includes(' B'));
});

test('an insertion inside a range another client deletes survives the deletion', () => {
  const { a, b } = pair('uno dos tres');
  a.content.delete(4, 4); // "dos "
  b.content.insert(6, 'X'); // inside "dos"
  exchange(a, b);
  assertConverged([a, b]);
  assert.ok(a.content.toString().includes('X'), a.content.toString());
  assert.ok(!a.content.toString().includes('do'), a.content.toString());
});

test('deleting the same range on both clients deletes it once', () => {
  const { a, b } = pair('abcdef');
  a.content.delete(1, 3);
  b.content.delete(1, 3);
  exchange(a, b);
  assertConverged([a, b]);
  assert.equal(a.content.toString(), 'aef');
});

test('overlapping deletions remove the union of both ranges and nothing else', () => {
  const { a, b } = pair('0123456789');
  a.content.delete(2, 4); // 2..5
  b.content.delete(4, 4); // 4..7
  exchange(a, b);
  assertConverged([a, b]);
  assert.equal(a.content.toString(), '01' + '89');
});

test('replacing the same word concurrently keeps both replacements (no last-write-wins)', () => {
  const { a, b } = pair('el gato negro');
  a.content.delete(3, 4);
  a.content.insert(3, 'perro');
  b.content.delete(3, 4);
  b.content.insert(3, 'loro');
  exchange(a, b);
  assertConverged([a, b]);
  const merged = a.content.toString();
  assert.ok(merged.includes('perro') && merged.includes('loro'), merged);
  assert.ok(!merged.includes('gato'), merged);
});

test('interleaved typing by two clients is preserved character by character', () => {
  const { a, b } = pair('');
  for (const [index, char] of [...'AAAA'].entries()) a.content.insert(index, char);
  for (const [index, char] of [...'bbbb'].entries()) b.content.insert(index, char);
  exchange(a, b);
  assertConverged([a, b]);
  const merged = a.content.toString();
  assert.equal([...merged].filter((c) => c === 'A').length, 4);
  assert.equal([...merged].filter((c) => c === 'b').length, 4);
  // Yjs keeps each client's run contiguous: no character-level shuffling of A's own text.
  assert.ok(merged.includes('AAAA') && merged.includes('bbbb'), merged);
});

test('exchanging the same updates again is a no-op for the Yjs state', () => {
  const { a, b } = pair('base');
  a.content.insert(4, '!');
  b.content.insert(0, '>');
  exchange(a, b);
  const before = a.content.toString();
  exchange(a, b);
  exchange(b, a);
  assert.equal(a.content.toString(), before);
  assert.ok(sameYjsState(a, b));
});
