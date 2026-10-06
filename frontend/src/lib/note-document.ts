import * as Y from 'yjs';

// Mirrors shared/src/document.ts (a second Yjs copy would break if the frontend imported it); a test keeps them equal.
const DOCUMENT_SCHEMA_VERSION = 1;
/** Every replica writes the initial version under this client id so they all create the same Yjs item. */
const BOOTSTRAP_CLIENT_ID = 0;

export type EditorDocument = {
  doc: Y.Doc;
  content: Y.Text;
};

/** The state this build is asked to apply declares a schema version it cannot read. */
export class NoteSchemaError extends Error {
  constructor(readonly found: unknown) {
    super('Unsupported note document schema version');
    this.name = 'NoteSchemaError';
  }
}

export function createEditorDocument(): EditorDocument {
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>('note');
  const clientID = doc.clientID;
  doc.clientID = BOOTSTRAP_CLIENT_ID;
  root.set('schemaVersion', DOCUMENT_SCHEMA_VERSION);
  doc.clientID = clientID;
  return { doc, content: doc.getText('content') };
}

/**
 * Throws NoteSchemaError when applying `update` on top of `document` would leave a schema version
 * this build does not understand. The document itself is never touched: the update is tried on a copy.
 */
export function assertCompatibleUpdate(document: Y.Doc, update: Uint8Array) {
  const trial = new Y.Doc();
  try {
    Y.applyUpdate(trial, Y.encodeStateAsUpdate(document));
    Y.applyUpdate(trial, update);
    const found = trial.getMap<unknown>('note').get('schemaVersion');
    if (found !== DOCUMENT_SCHEMA_VERSION) throw new NoteSchemaError(found);
  } finally {
    trial.destroy();
  }
}

export const LOCAL_EDIT_ORIGIN = Symbol('syncpad.local-edit');
/** Origin for updates that arrive from the server; they never count as pending local work. */
export const REMOTE_ORIGIN = Symbol('syncpad.remote');

export function applyEditorUpdate(document: Y.Doc, update: Uint8Array, origin?: unknown) {
  Y.applyUpdate(document, update, origin);
}

export function encodeEditorState(document: Y.Doc) {
  return Y.encodeStateAsUpdate(document);
}

export function encodeEditorStateVector(document: Y.Doc) {
  return Y.encodeStateVector(document);
}

/** Everything the holder of `vector` is missing, including the delete set. */
export function encodeEditorStateSince(document: Y.Doc, vector: Uint8Array) {
  return Y.encodeStateAsUpdate(document, vector);
}

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
