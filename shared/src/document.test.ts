import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNoteUpdate, assertNoteDocument, createNoteDocument, DOCUMENT_SCHEMA_VERSION, encodeNoteState, encodeNoteStateSince, encodeNoteStateVector } from './document.js';

test('two note documents initialize and converge on the same versioned structure', () => {
  const first = createNoteDocument();
  const second = createNoteDocument();
  first.content.insert(0, 'Hola');
  applyNoteUpdate(second.doc, encodeNoteState(first.doc));
  assert.equal(first.root.get('schemaVersion'), DOCUMENT_SCHEMA_VERSION);
  assert.equal(second.root.get('schemaVersion'), DOCUMENT_SCHEMA_VERSION);
  assert.equal(second.content.toString(), 'Hola');
  assert.doesNotThrow(() => assertNoteDocument(second.doc));
});

test('unsupported document schema versions are rejected', () => {
  const document = createNoteDocument();
  document.root.set('schemaVersion', 999);
  assert.throws(() => assertNoteDocument(document.doc), /Unsupported note document schema/);
});

test('state vector diffs let divergent branches converge, including deletions', () => {
  const base = createNoteDocument();
  base.content.insert(0, 'compartido final');
  const left = createNoteDocument();
  const right = createNoteDocument();
  applyNoteUpdate(left.doc, encodeNoteState(base.doc));
  applyNoteUpdate(right.doc, encodeNoteState(base.doc));
  left.content.insert(0, 'L ');
  right.content.delete(right.content.toString().indexOf(' final'), ' final'.length);
  applyNoteUpdate(right.doc, encodeNoteStateSince(left.doc, encodeNoteStateVector(right.doc)));
  applyNoteUpdate(left.doc, encodeNoteStateSince(right.doc, encodeNoteStateVector(left.doc)));
  assert.equal(left.content.toString(), 'L compartido');
  assert.equal(right.content.toString(), 'L compartido');
});

test('applying the same update twice does not duplicate content', () => {
  const source = createNoteDocument();
  source.content.insert(0, 'una vez');
  const update = encodeNoteState(source.doc);
  const target = createNoteDocument();
  applyNoteUpdate(target.doc, update);
  applyNoteUpdate(target.doc, update);
  assert.equal(target.content.toString(), 'una vez');
});
