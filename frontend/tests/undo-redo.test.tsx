import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { applyEditorUpdate, applyLocalTextEdit, createEditorDocument, encodeEditorState, encodeEditorStateSince, encodeEditorStateVector, redoLocalEdit, undoLocalEdit, type EditorDocument } from '../src/lib/note-document';

// Undo/redo must only ever touch what this replica typed. Edits are driven through
// applyLocalTextEdit (what the textarea calls) and then closed into separate undo steps.

function fork(source: EditorDocument) {
  const document = createEditorDocument();
  applyEditorUpdate(document.doc, encodeEditorState(source.doc));
  return document;
}

function exchange(a: EditorDocument, b: EditorDocument) {
  applyEditorUpdate(b.doc, encodeEditorStateSince(a.doc, encodeEditorStateVector(b.doc)));
  applyEditorUpdate(a.doc, encodeEditorStateSince(b.doc, encodeEditorStateVector(a.doc)));
}

/** Types and closes the undo step, as a pause between keystrokes would. */
function type(document: EditorDocument, value: string) {
  applyLocalTextEdit(document, value);
  document.history.stopCapturing();
}

const text = (document: EditorDocument) => document.content.toString();

test('undo reverts the latest own edit and redo brings it back', () => {
  const doc = createEditorDocument();
  type(doc, 'hola');
  type(doc, 'hola mundo');
  assert.equal(undoLocalEdit(doc), true);
  assert.equal(text(doc), 'hola');
  assert.equal(undoLocalEdit(doc), true);
  assert.equal(text(doc), '');
  assert.equal(redoLocalEdit(doc), true);
  assert.equal(text(doc), 'hola');
  assert.equal(redoLocalEdit(doc), true);
  assert.equal(text(doc), 'hola mundo');
});

test('undo of a deletion restores the deleted text', () => {
  const doc = createEditorDocument();
  type(doc, 'abc def ghi');
  type(doc, 'abc ghi');
  undoLocalEdit(doc);
  assert.equal(text(doc), 'abc def ghi');
});

test('undo with nothing to undo is a no-op', () => {
  const doc = createEditorDocument();
  assert.equal(undoLocalEdit(doc), false);
  assert.equal(redoLocalEdit(doc), false);
  assert.equal(text(doc), '');
});

test('undo keeps what another participant wrote, wherever it landed', () => {
  const a = createEditorDocument();
  type(a, 'base');
  const b = fork(a);
  type(a, 'base + de A');
  type(b, 'inicio de B | base');
  exchange(a, b);
  assert.equal(text(a), 'inicio de B | base + de A');
  assert.equal(text(b), text(a));

  assert.equal(undoLocalEdit(a), true);
  assert.equal(text(a), 'inicio de B | base');
  exchange(a, b);
  assert.equal(text(b), 'inicio de B | base');

  assert.equal(undoLocalEdit(b), true);
  exchange(a, b);
  assert.equal(text(a), 'base');
  assert.equal(text(b), 'base');
});

test('a remote edit made after my edit survives my undo and does not become undoable for me', () => {
  const a = createEditorDocument();
  const b = fork(a);
  type(a, 'mio');
  exchange(a, b);
  applyLocalTextEdit(b, 'mio y de B');
  exchange(a, b);
  assert.equal(text(a), 'mio y de B');

  undoLocalEdit(a);
  assert.equal(text(a), ' y de B');
  assert.equal(undoLocalEdit(a), false);
  assert.equal(text(a), ' y de B');
});

test('content that was restored or received is not part of the local history', () => {
  const origin = createEditorDocument();
  type(origin, 'texto restaurado');
  const restored = createEditorDocument();
  applyEditorUpdate(restored.doc, encodeEditorState(origin.doc)); // like IndexedDB or the server
  assert.equal(undoLocalEdit(restored), false);
  assert.equal(text(restored), 'texto restaurado');
  type(restored, 'texto restaurado!');
  undoLocalEdit(restored);
  assert.equal(text(restored), 'texto restaurado');
  assert.equal(undoLocalEdit(restored), false);
});

test('undo and redo are ordinary updates that converge in every replica', () => {
  const a = createEditorDocument();
  const b = fork(a);
  type(a, 'uno');
  type(a, 'uno dos');
  exchange(a, b);
  undoLocalEdit(a);
  exchange(a, b);
  assert.equal(text(b), 'uno');
  redoLocalEdit(a);
  exchange(a, b);
  assert.equal(text(b), 'uno dos');
  assert.ok(Y.equalSnapshots(Y.snapshot(a.doc), Y.snapshot(b.doc)));
});

test('a new edit after an undo clears the redo stack', () => {
  const doc = createEditorDocument();
  type(doc, 'a');
  type(doc, 'ab');
  undoLocalEdit(doc);
  type(doc, 'ac');
  assert.equal(redoLocalEdit(doc), false);
  assert.equal(text(doc), 'ac');
});
