import assert from 'node:assert/strict';
import test from 'node:test';
import { renderToStaticMarkup } from 'react-dom/server';
import * as Y from 'yjs';
import RichPreview from '../src/app/rich-preview';
import { applyEditorUpdate, applyLocalTextEdit, assertCompatibleUpdate, createEditorDocument, encodeEditorState, encodeEditorStateSince, encodeEditorStateVector, undoLocalEdit, type EditorDocument } from '../src/lib/note-document';
import { readBlocks, removeLink, sanitizeLinkUrl, setLink, toggleBold, toggleList } from '../src/lib/rich-text';

function fork(source: EditorDocument) {
  const document = createEditorDocument();
  applyEditorUpdate(document.doc, encodeEditorState(source.doc));
  return document;
}

function exchange(a: EditorDocument, b: EditorDocument) {
  applyEditorUpdate(b.doc, encodeEditorStateSince(a.doc, encodeEditorStateVector(b.doc)));
  applyEditorUpdate(a.doc, encodeEditorStateSince(b.doc, encodeEditorStateVector(a.doc)));
}

const text = (document: EditorDocument) => document.content.toString();
const html = (document: EditorDocument) => renderToStaticMarkup(<RichPreview blocks={readBlocks(document.content)} />);

test('bold syncs between clients and does not change the plain text', () => {
  const a = createEditorDocument();
  applyLocalTextEdit(a, 'hola mundo');
  const b = fork(a);
  assert.equal(toggleBold(a, 5, 10), true);
  exchange(a, b);
  assert.equal(text(b), 'hola mundo');
  assert.match(html(b), /hola <strong>mundo<\/strong>|<span>hola <\/span><span><strong>mundo<\/strong><\/span>/);
  assert.deepEqual(b.content.toDelta(), [{ insert: 'hola ' }, { insert: 'mundo', attributes: { bold: true } }]);
});

test('bold toggles off only when the whole selection is already bold', () => {
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'abcdef');
  toggleBold(doc, 0, 3);
  toggleBold(doc, 0, 6); // partly bold → bolds everything
  assert.deepEqual(doc.content.toDelta(), [{ insert: 'abcdef', attributes: { bold: true } }]);
  toggleBold(doc, 2, 4); // fully bold → unbolds that range
  assert.deepEqual(doc.content.toDelta(), [
    { insert: 'ab', attributes: { bold: true } },
    { insert: 'cd' },
    { insert: 'ef', attributes: { bold: true } },
  ]);
});

test('an empty selection formats nothing', () => {
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'abc');
  assert.equal(toggleBold(doc, 1, 1), false);
  assert.equal(setLink(doc, 1, 1, 'https://example.com'), false);
  assert.deepEqual(doc.content.toDelta(), [{ insert: 'abc' }]);
});

test('a selection never splits an emoji', () => {
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'a😀b');
  toggleBold(doc, 2, 3); // lands inside the surrogate pair
  assert.deepEqual(doc.content.toDelta(), [{ insert: 'a' }, { insert: '😀', attributes: { bold: true } }, { insert: 'b' }]);
});

test('links sync, normalise and can be removed', () => {
  const a = createEditorDocument();
  applyLocalTextEdit(a, 'visita example');
  const b = fork(a);
  assert.equal(setLink(a, 7, 14, ' https://example.com '), true);
  exchange(a, b);
  assert.match(html(b), /<a href="https:\/\/example\.com\/" target="_blank" rel="noopener noreferrer nofollow">example<\/a>/);
  removeLink(b, 7, 14);
  exchange(a, b);
  assert.doesNotMatch(html(a), /<a /);
  assert.equal(text(a), 'visita example');
});

test('only http, https and mailto links are accepted', () => {
  for (const bad of ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'java\nscript:alert(1)', ' \tjavascript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', 'file:///etc/passwd', '//evil.example', '/relative', 'example.com', 'https://user:pass@example.com', '', 'https://' + 'a'.repeat(3000)]) {
    assert.equal(sanitizeLinkUrl(bad), null, bad);
  }
  assert.equal(sanitizeLinkUrl('http://example.com/a?b=c'), 'http://example.com/a?b=c');
  assert.equal(sanitizeLinkUrl('mailto:hola@example.com'), 'mailto:hola@example.com');
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'texto');
  assert.equal(setLink(doc, 0, 5, 'javascript:alert(1)'), false);
  assert.deepEqual(doc.content.toDelta(), [{ insert: 'texto' }]);
});

test('hostile attributes written by another client never reach the page', () => {
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'click <script>alert(1)</script> aquí');
  // Bypass the safe API: this is what a malicious or broken client could put in the shared document.
  doc.doc.transact(() => {
    doc.content.format(0, 5, { link: 'javascript:alert(1)', onclick: 'alert(1)', bold: 'yes' });
    doc.content.format(6, 8, { link: { href: 'x' }, style: 'x' });
  });
  const markup = html(doc);
  assert.doesNotMatch(markup, /javascript:/i);
  assert.doesNotMatch(markup, /onclick|style=|<a /);
  assert.doesNotMatch(markup, /<strong>/);
  // Runs are separate <span>s, so compare the escaped text once the wrappers are gone.
  assert.ok(markup.replace(/<\/?span>/g, '').includes('&lt;script&gt;alert(1)&lt;/script&gt;'), markup);
  assert.doesNotMatch(markup, /<script/i);
});

test('lists: toggling adds and removes markers on every selected line', () => {
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'uno\ndos\ntres');
  toggleList(doc, 0, 7); // lines 1 and 2
  assert.equal(text(doc), '- uno\n- dos\ntres');
  toggleList(doc, 0, 100); // every line, some already listed → completes the list
  assert.equal(text(doc), '- uno\n- dos\n- tres');
  toggleList(doc, 0, 100);
  assert.equal(text(doc), 'uno\ndos\ntres');
});

test('lists render as <ul> and keep marks inside items', () => {
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'intro\n- pan\n- leche\nfin');
  toggleBold(doc, 12, 15); // "pan"? index of "pan" in the text
  const blocks = readBlocks(doc.content);
  assert.deepEqual(blocks.map((block) => block.type), ['paragraph', 'list', 'paragraph']);
  const markup = html(doc);
  assert.match(markup, /<ul><li>/);
  assert.equal((markup.match(/<li>/g) ?? []).length, 2);
  assert.ok(!markup.includes('- '), markup);
});

test('a list item toggled while another client types keeps both edits', () => {
  const a = createEditorDocument();
  applyLocalTextEdit(a, 'uno\ndos');
  const b = fork(a);
  toggleList(a, 0, 3);
  applyLocalTextEdit(b, 'uno\ndos y tres');
  exchange(a, b);
  assert.equal(text(a), text(b));
  assert.equal(text(a), '- uno\ndos y tres');
});

test('plain-text edits keep the marks of the characters they do not touch', () => {
  const doc = createEditorDocument();
  applyLocalTextEdit(doc, 'hola mundo');
  toggleBold(doc, 5, 10);
  applyLocalTextEdit(doc, 'hola, mundo');
  assert.deepEqual(doc.content.toDelta(), [{ insert: 'hola, ' }, { insert: 'mundo', attributes: { bold: true } }]);
});

test('concurrent formatting and typing converge to the same document', () => {
  const a = createEditorDocument();
  applyLocalTextEdit(a, 'hola mundo');
  const b = fork(a);
  toggleBold(a, 0, 4);
  applyLocalTextEdit(b, 'hola querido mundo');
  setLink(b, 5, 12, 'https://example.com');
  exchange(a, b);
  assert.deepEqual(a.content.toDelta(), b.content.toDelta());
  assert.equal(text(a), 'hola querido mundo');
  assert.ok(Y.encodeStateAsUpdate(a.doc).length > 0);
});

test('undo reverts a local format change without touching remote text', () => {
  const a = createEditorDocument();
  applyLocalTextEdit(a, 'hola mundo');
  a.history.stopCapturing();
  const b = fork(a);
  toggleBold(a, 0, 4);
  a.history.stopCapturing();
  applyLocalTextEdit(b, 'hola mundo!');
  exchange(a, b);
  assert.equal(undoLocalEdit(a), true);
  assert.deepEqual(a.content.toDelta(), [{ insert: 'hola mundo!' }]);
});

test('formatted documents stay valid schema v1 and old builds read the same plain text', () => {
  const a = createEditorDocument();
  applyLocalTextEdit(a, 'hola mundo');
  toggleBold(a, 0, 4);
  setLink(a, 5, 10, 'https://example.com');
  const fresh = createEditorDocument();
  assert.doesNotThrow(() => assertCompatibleUpdate(fresh.doc, encodeEditorState(a.doc)));
  // A build that never heard of marks sees only characters.
  const legacy = new Y.Doc();
  Y.applyUpdate(legacy, encodeEditorState(a.doc));
  assert.equal(legacy.getText('content').toString(), 'hola mundo');
  assert.equal(legacy.getMap('note').get('schemaVersion'), 1);
});
