import type * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';

export function noteStorageKey(userId: string, noteId: string): string {
  return 'syncpad:note:' + JSON.stringify([userId, noteId]);
}

export function persistNote(userId: string, noteId: string, doc: Y.Doc): IndexeddbPersistence {
  return new IndexeddbPersistence(noteStorageKey(userId, noteId), doc);
}
