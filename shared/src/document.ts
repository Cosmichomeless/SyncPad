import * as Y from 'yjs';

export const DOCUMENT_SCHEMA_VERSION = 1 as const;
export const NOTE_ROOT_NAME = 'note';
export const NOTE_CONTENT_NAME = 'content';

export type NoteDocument = {
  doc: Y.Doc;
  root: Y.Map<unknown>;
  content: Y.Text;
};

export function createNoteDocument(): NoteDocument {
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>(NOTE_ROOT_NAME);
  root.set('schemaVersion', DOCUMENT_SCHEMA_VERSION);
  const content = doc.getText(NOTE_CONTENT_NAME);
  return { doc, root, content };
}

export function assertNoteDocument(doc: Y.Doc) {
  const root = doc.getMap<unknown>(NOTE_ROOT_NAME);
  if (root.get('schemaVersion') !== DOCUMENT_SCHEMA_VERSION) {
    throw new Error('Unsupported note document schema version');
  }
  doc.getText(NOTE_CONTENT_NAME);
  return root;
}

export function encodeNoteState(doc: Y.Doc) {
  assertNoteDocument(doc);
  return Y.encodeStateAsUpdate(doc);
}

export function encodeNoteStateSince(doc: Y.Doc, stateVector: Uint8Array) {
  assertNoteDocument(doc);
  return Y.encodeStateAsUpdate(doc, stateVector);
}

export function applyNoteUpdate(doc: Y.Doc, update: Uint8Array) {
  Y.applyUpdate(doc, update);
  assertNoteDocument(doc);
}