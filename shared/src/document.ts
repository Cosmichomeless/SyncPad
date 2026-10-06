import * as Y from 'yjs';

export const DOCUMENT_SCHEMA_VERSION = 1 as const;
export const NOTE_ROOT_NAME = 'note';
export const NOTE_CONTENT_NAME = 'content';

/**
 * Clientid under which every document writes its initial `schemaVersion`. All replicas then create
 * the *same* Yjs item, so merging them never produces concurrent writes to the version key whose
 * winner would depend on random client ids (see docs/issues/035-schema-versions.md).
 */
const BOOTSTRAP_CLIENT_ID = 0;

export type NoteDocument = {
  doc: Y.Doc;
  root: Y.Map<unknown>;
  content: Y.Text;
};

/** The document (or update) uses a schema version this build does not understand. */
export class NoteSchemaError extends Error {
  readonly code = 'NOTE_SCHEMA_UNSUPPORTED';
  constructor(readonly found: unknown) {
    super('Unsupported note document schema version');
    this.name = 'NoteSchemaError';
  }
}

export const isNoteSchemaError = (error: unknown): error is NoteSchemaError =>
  error instanceof NoteSchemaError || (error instanceof Error && (error as { code?: unknown }).code === 'NOTE_SCHEMA_UNSUPPORTED');

export function createNoteDocument(): NoteDocument {
  const doc = new Y.Doc();
  const root = doc.getMap<unknown>(NOTE_ROOT_NAME);
  const clientID = doc.clientID;
  doc.clientID = BOOTSTRAP_CLIENT_ID;
  root.set('schemaVersion', DOCUMENT_SCHEMA_VERSION);
  doc.clientID = clientID;
  const content = doc.getText(NOTE_CONTENT_NAME);
  return { doc, root, content };
}

/** The version the document currently declares, or `undefined` if none was ever written. */
export function readSchemaVersion(doc: Y.Doc): unknown {
  return doc.getMap<unknown>(NOTE_ROOT_NAME).get('schemaVersion');
}

export function assertNoteDocument(doc: Y.Doc) {
  const root = doc.getMap<unknown>(NOTE_ROOT_NAME);
  const found = root.get('schemaVersion');
  if (found !== DOCUMENT_SCHEMA_VERSION) throw new NoteSchemaError(found);
  doc.getText(NOTE_CONTENT_NAME);
  return root;
}

export function encodeNoteState(doc: Y.Doc) {
  assertNoteDocument(doc);
  return Y.encodeStateAsUpdate(doc);
}

export function encodeNoteStateVector(doc: Y.Doc) {
  assertNoteDocument(doc);
  return Y.encodeStateVector(doc);
}

export function encodeNoteStateSince(doc: Y.Doc, stateVector: Uint8Array) {
  assertNoteDocument(doc);
  return Y.encodeStateAsUpdate(doc, stateVector);
}

export function applyNoteUpdate(doc: Y.Doc, update: Uint8Array) {
  Y.applyUpdate(doc, update);
  assertNoteDocument(doc);
}

/**
 * Checks that `update` applies cleanly on top of `doc` and keeps the note
 * schema valid, without touching `doc`. Used before an update is made durable.
 */
export function assertValidNoteUpdate(doc: Y.Doc, update: Uint8Array) {
  const trial = new Y.Doc();
  try {
    Y.applyUpdate(trial, Y.encodeStateAsUpdate(doc));
    applyNoteUpdate(trial, update);
  } finally {
    trial.destroy();
  }
}
