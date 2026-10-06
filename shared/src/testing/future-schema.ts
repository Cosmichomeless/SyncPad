import * as Y from 'yjs';
import { applyNoteUpdate, createNoteDocument, type NoteDocument } from '../document.js';

/**
 * Stands in for an editor built after a schema bump: same structure, `schemaVersion` raised. It
 * encodes with raw Yjs because the checked encoders in `document.ts` (rightly) refuse v2 state.
 */
export type FutureNote = NoteDocument & {
  encodeState(): Uint8Array;
  encodeSince(vector: Uint8Array): Uint8Array;
};

export function createFutureNote(version: number, base?: Uint8Array): FutureNote {
  const note = createNoteDocument();
  if (base) applyNoteUpdate(note.doc, base);
  note.root.set('schemaVersion', version);
  note.content.insert(0, `v${version}: `);
  return {
    ...note,
    encodeState: () => Y.encodeStateAsUpdate(note.doc),
    encodeSince: (vector) => Y.encodeStateAsUpdate(note.doc, vector),
  };
}

/** A state vector that claims to know nothing, i.e. what a brand-new replica sends. */
export const EMPTY_STATE_VECTOR = Y.encodeStateVector(new Y.Doc());
