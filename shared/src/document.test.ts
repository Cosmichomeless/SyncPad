import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import * as Y from 'yjs';
import {
  applyNoteUpdate,
  assertNoteDocument,
  assertValidNoteUpdate,
  createNoteDocument,
  DOCUMENT_SCHEMA_VERSION,
  encodeNoteState,
  encodeNoteStateSince,
  encodeNoteStateVector,
  isNoteSchemaError,
  NoteSchemaError,
  readSchemaVersion,
} from './document.js';

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

test('an unsupported version raises a typed error that carries what was found', () => {
  const document = createNoteDocument();
  document.root.set('schemaVersion', 2);
  assert.equal(readSchemaVersion(document.doc), 2);
  try {
    assertNoteDocument(document.doc);
    assert.fail('expected NoteSchemaError');
  } catch (error) {
    assert.ok(isNoteSchemaError(error));
    assert.ok(error instanceof NoteSchemaError);
    assert.equal(error.found, 2);
  }
  assert.equal(isNoteSchemaError(new Error('other')), false);
});

test('a document without any version is incompatible rather than assumed to be v1', () => {
  assert.throws(() => assertNoteDocument(new Y.Doc()), (error) => isNoteSchemaError(error) && (error as NoteSchemaError).found === undefined);
});

test('an update that would change the version is refused before the document is touched', () => {
  const server = createNoteDocument();
  server.content.insert(0, 'texto v1');
  const newer = createNoteDocument();
  applyNoteUpdate(newer.doc, encodeNoteState(server.doc));
  newer.root.set('schemaVersion', 2);
  newer.content.insert(0, 'v2: ');
  const before = encodeNoteState(server.doc);
  assert.throws(
    () => assertValidNoteUpdate(server.doc, encodeNoteStateSince(newer.doc, encodeNoteStateVector(server.doc))),
    (error) => isNoteSchemaError(error) && (error as NoteSchemaError).found === 2,
  );
  assert.deepEqual(encodeNoteState(server.doc), before);
  assert.equal(server.content.toString(), 'texto v1');
});

test('initial documents share one bootstrap item, so merging them never conflicts on the version key', () => {
  const a = createNoteDocument();
  const b = createNoteDocument();
  assert.notEqual(a.doc.clientID, 0);
  assert.notEqual(a.doc.clientID, b.doc.clientID);
  assert.deepEqual(encodeNoteState(a.doc), encodeNoteState(b.doc));
  // A migration that has seen the bootstrap item wins over it whatever the random client ids are.
  for (let attempt = 0; attempt < 20; attempt++) {
    const old = createNoteDocument();
    const migrated = createNoteDocument();
    migrated.root.set('schemaVersion', 2);
    Y.applyUpdate(old.doc, Y.encodeStateAsUpdate(migrated.doc, Y.encodeStateVector(old.doc)));
    assert.equal(readSchemaVersion(old.doc), 2);
  }
});

test('the frontend keeps its own copy of the schema version in sync with this one', () => {
  const source = readFileSync(new URL('../../frontend/src/lib/note-document.ts', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`const DOCUMENT_SCHEMA_VERSION = ${DOCUMENT_SCHEMA_VERSION};`));
});
