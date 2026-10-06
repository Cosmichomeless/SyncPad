import assert from 'node:assert/strict';
import test from 'node:test';
import * as Y from 'yjs';
import { applyEditorUpdate, applyLocalTextEdit, createEditorDocument, encodeEditorState, encodeEditorStateSince, encodeEditorStateVector, type EditorDocument } from '../src/lib/note-document';

// These drive the same function the textarea uses (a diff of the whole value), not raw Y.Text calls.

function fork(source: EditorDocument) {
  const document = createEditorDocument();
  applyEditorUpdate(document.doc, encodeEditorState(source.doc));
  return document;
}

function exchange(a: EditorDocument, b: EditorDocument) {
  applyEditorUpdate(b.doc, encodeEditorStateSince(a.doc, encodeEditorStateVector(b.doc)));
  applyEditorUpdate(a.doc, encodeEditorStateSince(b.doc, encodeEditorStateVector(a.doc)));
}

function pair(base: string) {
  const origin = createEditorDocument();
  applyLocalTextEdit(origin, base);
  return { a: fork(origin), b: fork(origin) };
}

const sameState = (a: EditorDocument, b: EditorDocument) => Y.equalSnapshots(Y.snapshot(a.doc), Y.snapshot(b.doc));

test('textarea edits in two clients at once converge without losing either change', () => {
  const { a, b } = pair('hola mundo');
  applyLocalTextEdit(a, 'hola mundo!');
  applyLocalTextEdit(b, 'Hola mundo');
  exchange(a, b);
  assert.equal(a.content.toString(), 'Hola mundo!');
  assert.equal(b.content.toString(), 'Hola mundo!');
  assert.ok(sameState(a, b));
});

test('whole-value replacement in one client does not erase a concurrent insertion elsewhere', () => {
  const { a, b } = pair('primera linea\nsegunda linea');
  applyLocalTextEdit(a, 'primera linea\nsegunda linea editada');
  applyLocalTextEdit(b, 'cabecera\nprimera linea\nsegunda linea');
  exchange(a, b);
  assert.equal(a.content.toString(), 'cabecera\nprimera linea\nsegunda linea editada');
  assert.equal(b.content.toString(), a.content.toString());
});

test('both clients deleting different words keep each other\'s deletion', () => {
  const { a, b } = pair('uno dos tres cuatro');
  applyLocalTextEdit(a, 'uno tres cuatro');
  applyLocalTextEdit(b, 'uno dos tres');
  exchange(a, b);
  assert.equal(a.content.toString(), 'uno tres');
  assert.equal(b.content.toString(), 'uno tres');
});

test('concurrent emoji insertions never produce a lone surrogate', () => {
  const { a, b } = pair('ab');
  applyLocalTextEdit(a, 'a😀b');
  applyLocalTextEdit(b, 'a🎉b');
  exchange(a, b);
  const merged = a.content.toString();
  assert.equal(merged, b.content.toString());
  assert.ok(merged.includes('😀') && merged.includes('🎉'), merged);
  assert.equal(merged.isWellFormed(), true);
});
