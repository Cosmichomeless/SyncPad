import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { applyEditorUpdate, applyLocalTextEdit, createEditorDocument, encodeEditorState, LOCAL_EDIT_ORIGIN } from '../src/lib/note-document';
import { persistNote } from '../src/lib/note-persistence';

function documentWith(text: string) {
  const document = createEditorDocument();
  document.content.insert(0, text);
  return document;
}

function edit(from: string, to: string) {
  const document = documentWith(from);
  const changed = applyLocalTextEdit(document, to);
  assert.equal(document.content.toString(), to);
  return { document, changed };
}

test('reports no change for identical text', () => {
  const document = documentWith('hola');
  let updates = 0;
  document.doc.on('update', () => { updates++; });
  assert.equal(applyLocalTextEdit(document, 'hola'), false);
  assert.equal(updates, 0);
});

test('applies insertion, deletion and replacement', () => {
  assert.equal(edit('hola mundo', 'hola bello mundo').changed, true);
  assert.equal(edit('hola bello mundo', 'hola mundo').changed, true);
  assert.equal(edit('hola mundo', 'hola cosmos').changed, true);
  assert.equal(edit('', 'nuevo').changed, true);
  assert.equal(edit('borrar', '').changed, true);
});

test('tags the transaction with the local origin', () => {
  const document = documentWith('abc');
  const origins: unknown[] = [];
  document.doc.on('update', (_update: Uint8Array, origin: unknown) => origins.push(origin));
  applyLocalTextEdit(document, 'abXc');
  assert.deepEqual(origins, [LOCAL_EDIT_ORIGIN]);
});

test('keeps CRDT identities of unaffected characters', () => {
  const document = documentWith('hola mundo');
  const mundo = Y.createRelativePositionFromTypeIndex(document.content, 7);
  const hola = Y.createRelativePositionFromTypeIndex(document.content, 2);
  applyLocalTextEdit(document, 'hola querido mundo');
  const resolve = (position: Y.RelativePosition) => Y.createAbsolutePositionFromRelativePosition(position, document.doc)?.index;
  assert.equal(resolve(hola), 2);
  assert.equal(resolve(mundo), 15);
});

test('local edit emits only the changed span, not the whole text', () => {
  const document = documentWith('x'.repeat(5000));
  const updates: Uint8Array[] = [];
  document.doc.on('update', (update: Uint8Array) => updates.push(update));
  applyLocalTextEdit(document, `${'x'.repeat(2500)}y${'x'.repeat(2500)}`);
  assert.equal(updates.length, 1);
  assert.ok(updates[0].length < 100, `update was ${updates[0].length} bytes`);
});

test('handles Unicode without splitting surrogate pairs', () => {
  assert.equal(edit('a😀b', 'a😁b').document.content.toString(), 'a😁b');
  assert.equal(edit('😀', '😁').document.content.toString(), '😁');
  assert.equal(edit('a😀', 'a😀😀').document.content.toString(), 'a😀😀');
  assert.equal(edit('😀😀', '😀').document.content.toString(), '😀');
  assert.equal(edit('ñandú', 'ñandúes').document.content.toString(), 'ñandúes');
  const encoded = encodeEditorState(edit('a😀b', 'a😁b').document.doc);
  const copy = createEditorDocument();
  applyEditorUpdate(copy.doc, encoded);
  assert.equal(copy.content.toString(), 'a😁b');
});

test('two documents editing different places converge', () => {
  const a = documentWith('inicio medio fin');
  const b = createEditorDocument();
  applyEditorUpdate(b.doc, encodeEditorState(a.doc));
  applyLocalTextEdit(a, 'INICIO medio fin');
  applyLocalTextEdit(b, 'inicio medio FIN');
  applyEditorUpdate(a.doc, encodeEditorState(b.doc));
  applyEditorUpdate(b.doc, encodeEditorState(a.doc));
  assert.equal(a.content.toString(), 'INICIO medio FIN');
  assert.equal(b.content.toString(), 'INICIO medio FIN');
});

test('edits made with no socket persist and reopen exactly', async () => {
  const first = createEditorDocument();
  const saved = persistNote('local-user', 'local-note', first.doc);
  await saved.whenSynced;
  applyLocalTextEdit(first, 'escrito sin red');
  applyLocalTextEdit(first, 'escrito sin red ni servidor');
  await saved.destroy();
  first.doc.destroy();
  const second = createEditorDocument();
  const restored = persistNote('local-user', 'local-note', second.doc);
  await restored.whenSynced;
  assert.equal(second.content.toString(), 'escrito sin red ni servidor');
  await restored.destroy();
  second.doc.destroy();
});
