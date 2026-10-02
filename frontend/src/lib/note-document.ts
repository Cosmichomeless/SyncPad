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