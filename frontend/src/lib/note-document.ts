import * as Y from 'yjs';

const DOCUMENT_SCHEMA_VERSION = 1;

export type EditorDocument = {
  doc: Y.Doc;
  content: Y.Text;
};

export function createEditorDocument(): EditorDocument {
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>('note');
  root.set('schemaVersion', DOCUMENT_SCHEMA_VERSION);
  return { doc, content: doc.getText('content') };
}

export function applyEditorUpdate(document: Y.Doc, update: Uint8Array) {
  Y.applyUpdate(document, update);
}

export function encodeEditorState(document: Y.Doc) {
  return Y.encodeStateAsUpdate(document);
}

export const LOCAL_EDIT_ORIGIN = Symbol('syncpad.local-edit');

const isHighSurrogate = (code: number) => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number) => code >= 0xdc00 && code <= 0xdfff;

/**
 * Applies the difference between the current text and `next` as one minimal
 * splice, so characters outside the edited span keep their CRDT identity.
 * Y.Text indices are UTF-16 code units; the span never splits a surrogate pair.
 */
export function applyLocalTextEdit(document: EditorDocument, next: string): boolean {
  const before = document.content.toString();
  if (before === next) return false;
  let start = 0;
  while (start < before.length && start < next.length && before[start] === next[start]) start++;
  if (start > 0 && isHighSurrogate(before.charCodeAt(start - 1))) start--;
  let endBefore = before.length;
  let endNext = next.length;
  while (endBefore > start && endNext > start && before[endBefore - 1] === next[endNext - 1]) {
    endBefore--; endNext--;
  }
  if (endBefore < before.length && isLowSurrogate(before.charCodeAt(endBefore))) { endBefore++; endNext++; }
  document.doc.transact(() => {
    if (endBefore > start) document.content.delete(start, endBefore - start);
    if (endNext > start) document.content.insert(start, next.slice(start, endNext));
  }, LOCAL_EDIT_ORIGIN);
  return true;
}
