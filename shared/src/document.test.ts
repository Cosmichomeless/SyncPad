import assert from 'node:assert/strict';
import test from 'node:test';
import { applyNoteUpdate, assertNoteDocument, createNoteDocument, DOCUMENT_SCHEMA_VERSION, encodeNoteState } from './document.js';

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