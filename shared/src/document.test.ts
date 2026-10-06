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
  NoteContentError,
  NoteSchemaError,
  readSchemaVersion,
} from './document.js';
import { ALLOWED_LINK_PROTOCOLS, MAX_LINK_LENGTH, sanitizeLinkUrl } from './rich-text-policy.js';

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

test('formatted text (bold, links) is an additive change: still a valid schema v1 update', () => {
  const author = createNoteDocument();
  author.content.insert(0, 'hola mundo');
  author.content.format(0, 4, { bold: true });
  author.content.format(5, 5, { link: 'https://example.com/' });
  const server = createNoteDocument();
  assert.doesNotThrow(() => assertValidNoteUpdate(server.doc, encodeNoteState(author.doc)));
  applyNoteUpdate(server.doc, encodeNoteState(author.doc));
  assert.equal(server.content.toString(), 'hola mundo');
  assert.equal(readSchemaVersion(server.doc), DOCUMENT_SCHEMA_VERSION);
});

const fresh = () => createNoteDocument();
const update = (author: ReturnType<typeof createNoteDocument>) => encodeNoteState(author.doc);

test('the server refuses hostile or unknown text attributes but keeps allowed formatting', () => {
  const hostile: [string, (note: ReturnType<typeof createNoteDocument>) => void][] = [
    ['javascript: link', (n) => n.content.format(0, 4, { link: 'javascript:alert(1)' })],
    ['mixed-case javascript: link', (n) => n.content.format(0, 4, { link: 'JaVa\nScRiPt:alert(1)' })],
    ['data: link', (n) => n.content.format(0, 4, { link: 'data:text/html,<script>alert(1)</script>' })],
    ['link with credentials', (n) => n.content.format(0, 4, { link: 'https://user:pass@example.com/' })],
    ['non-string link', (n) => n.content.format(0, 4, { link: { href: 'https://example.com' } })],
    ['overlong link', (n) => n.content.format(0, 4, { link: `https://example.com/${'a'.repeat(3000)}` })],
    ['unknown attribute', (n) => n.content.format(0, 4, { onclick: 'alert(1)' })],
    ['style attribute', (n) => n.content.format(0, 4, { style: 'position:fixed' })],
    ['non-boolean bold', (n) => n.content.format(0, 4, { bold: 'yes' })],
    ['hostile attribute on inserted text', (n) => n.content.insert(4, ' extra', { link: 'javascript:alert(1)' })],
    ['embedded object', (n) => n.content.insertEmbed(2, { image: 'x' })],
  ];
  for (const [label, mutate] of hostile) {
    const server = fresh();
    server.content.insert(0, 'hola mundo');
    const author = fresh();
    applyNoteUpdate(author.doc, encodeNoteState(server.doc));
    const before = encodeNoteStateVector(author.doc);
    mutate(author);
    assert.throws(() => assertValidNoteUpdate(server.doc, encodeNoteStateSince(author.doc, before)), NoteContentError, label);
    assert.equal(server.content.toString(), 'hola mundo', `${label}: the server document is untouched`);
  }

  const good = fresh();
  good.content.insert(0, 'hola mundo');
  good.content.format(0, 4, { bold: true });
  good.content.format(5, 5, { link: 'https://example.com/ruta?q=1', bold: true });
  good.content.format(5, 5, { link: null });
  assert.doesNotThrow(() => assertValidNoteUpdate(fresh().doc, update(good)));
});

test('a hostile mark that is already in the stored history does not lock the note', () => {
  const legacy = fresh();
  legacy.content.insert(0, 'viejo');
  legacy.content.format(0, 5, { onclick: 'alert(1)' });
  const server = fresh();
  applyNoteUpdate(server.doc, update(legacy)); // history written before the policy existed
  const typed = fresh();
  applyNoteUpdate(typed.doc, update(server));
  const before = encodeNoteStateVector(typed.doc);
  typed.content.insert(0, 'nuevo ', {}); // plain text elsewhere
  typed.content.format(0, 5, { bold: true });
  assert.doesNotThrow(() => assertValidNoteUpdate(server.doc, encodeNoteStateSince(typed.doc, before)));
});

test('the link policy and its frontend copy stay in sync', () => {
  const source = readFileSync(new URL('../../frontend/src/lib/rich-text.ts', import.meta.url), 'utf8');
  assert.match(source, new RegExp(`const MAX_LINK_LENGTH = ${MAX_LINK_LENGTH};`));
  const protocols = ALLOWED_LINK_PROTOCOLS.map((protocol) => `'${protocol}'`).join(', ');
  assert.match(source, new RegExp(`new Set\\(\\[${protocols}\\]\\)`));
  assert.equal(sanitizeLinkUrl('HTTPS://Example.com'), 'https://example.com/');
  assert.equal(sanitizeLinkUrl('javascript:alert(1)'), null);
});
