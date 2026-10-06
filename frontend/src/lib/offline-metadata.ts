import type { NoteSummary, WorkspaceSummary } from '@syncpad/shared';
import { isCurrentIdentity, subscribeOfflineIdentity, type OfflineIdentity } from './offline-session';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('syncpad.offline-metadata.v1', 2);
    request.onupgradeneeded = () => {
      // 'orphans' (v2) holds notes deleted on the server whose local copy is still recoverable.
      for (const name of ['workspaces', 'notes', 'visited', 'orphans']) {
        if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
      }
    };
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Almacenamiento bloqueado'));
  });
}
async function transaction<T>(mode: IDBTransactionMode, run: (tx: IDBTransaction, result: (value: T) => void) => void, identity?: OfflineIdentity): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    if (identity && !isCurrentIdentity(identity)) { db.close(); reject(new Error('Identidad obsoleta')); return; }
    const tx = db.transaction(['workspaces', 'notes', 'visited', 'orphans'], mode);
    let value: T;
    let stop = () => {};
    let aborted = false;
    const guard = () => {
      if (aborted) return false;
      if (identity && !isCurrentIdentity(identity)) { aborted = true; tx.abort(); return false; }
      return true;
    };
    if (identity && typeof window.addEventListener === 'function') stop = subscribeOfflineIdentity(() => { guard(); });
    tx.oncomplete = () => { stop(); db.close(); if (identity && !isCurrentIdentity(identity)) reject(new Error('Identidad obsoleta')); else resolve(value); };
    tx.onerror = tx.onabort = () => { stop(); db.close(); reject(tx.error ?? new Error('Transacción cancelada')); };
    try { run(tx, result => { if (guard()) value = result; }); }
    catch (cause) { tx.abort(); stop(); db.close(); reject(cause); }
  });
}
function read<T>(store: string, key: IDBValidKey): Promise<T | null> {
  return transaction('readonly', (tx, result) => { const request = tx.objectStore(store).get(key); request.onsuccess = () => result(request.result ?? null); });
}
export const readWorkspaces = (userId: string) => read<WorkspaceSummary[]>('workspaces', userId);
export const readNotes = (userId: string, workspaceId: string) => read<NoteSummary[]>('notes', [userId, workspaceId]);
export async function readVisitedNoteIds(userId: string): Promise<string[]> {
  return transaction('readonly', (tx, result) => {
    const request = tx.objectStore('visited').getAllKeys(IDBKeyRange.bound([userId], [userId, []]));
    request.onsuccess = () => result(request.result.map(key => (key as string[])[2]));
  });
}
export function writeWorkspaces(identity: OfflineIdentity, rows: WorkspaceSummary[]): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    const previous = tx.objectStore('workspaces').get(identity.user.id);
    previous.onsuccess = () => {
      for (const workspace of previous.result as WorkspaceSummary[] ?? []) {
        if (rows.some(row => row.id === workspace.id)) continue;
        tx.objectStore('notes').delete([identity.user.id, workspace.id]);
        tx.objectStore('visited').delete(IDBKeyRange.bound([identity.user.id, workspace.id], [identity.user.id, workspace.id, []]));
      }
      const request = tx.objectStore('workspaces').put(rows, identity.user.id);
      request.onsuccess = () => result();
    };
  }, identity);
}
/**
 * Replaces a workspace's note list with the server's authoritative one. A note the user had
 * visited that is no longer listed was deleted: it leaves the list and the offline cache but
 * its summary moves to the orphans so the local copy stays recoverable.
 */
export function writeNotes(identity: OfflineIdentity, workspaceId: string, rows: NoteSummary[]): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    const previous = tx.objectStore('notes').get([identity.user.id, workspaceId]);
    previous.onsuccess = () => {
      const before = (previous.result as NoteSummary[] | undefined) ?? [];
      tx.objectStore('notes').put(rows, [identity.user.id, workspaceId]);
      const cursor = tx.objectStore('visited').openCursor(IDBKeyRange.bound([identity.user.id, workspaceId], [identity.user.id, workspaceId, []]));
      cursor.onsuccess = () => {
        const entry = cursor.result;
        if (!entry) { result(); return; }
        const noteId = (entry.key as string[])[2];
        if (!rows.some(row => row.id === noteId)) {
          const summary = before.find(row => row.id === noteId) ?? { id: noteId, workspaceId, title: 'Nota eliminada', updatedAt: new Date().toISOString() } as NoteSummary;
          tx.objectStore('orphans').put(summary, [identity.user.id, workspaceId, noteId]);
          entry.delete();
        }
        entry.continue();
      };
    };
  }, identity);
}
/** Local, immediate counterpart of writeNotes for a note found deleted while it is open. */
export function retireNote(identity: OfflineIdentity, note: NoteSummary): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    const key = [identity.user.id, note.workspaceId];
    const list = tx.objectStore('notes').get(key);
    list.onsuccess = () => {
      if (list.result) tx.objectStore('notes').put((list.result as NoteSummary[]).filter(row => row.id !== note.id), key);
      tx.objectStore('visited').delete([...key, note.id]);
      const write = tx.objectStore('orphans').put(note, [...key, note.id]);
      write.onsuccess = () => result();
    };
  }, identity);
}
export function readOrphans(userId: string, workspaceId: string): Promise<NoteSummary[]> {
  return transaction('readonly', (tx, result) => {
    const request = tx.objectStore('orphans').getAll(IDBKeyRange.bound([userId, workspaceId], [userId, workspaceId, []]));
    request.onsuccess = () => result(request.result as NoteSummary[]);
  });
}
export function discardOrphan(userId: string, note: NoteSummary): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    const request = tx.objectStore('orphans').delete([userId, note.workspaceId, note.id]);
    request.onsuccess = () => result();
  });
}
export function markVisited(identity: OfflineIdentity, note: NoteSummary): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    const request = tx.objectStore('notes').get([identity.user.id, note.workspaceId]);
    request.onsuccess = () => {
      if (!(request.result as NoteSummary[] | undefined)?.some(row => row.id === note.id)) { result(); return; }
      const write = tx.objectStore('visited').put(true, [identity.user.id, note.workspaceId, note.id]);
      write.onsuccess = () => result();
    };
  }, identity);
}
export function removeWorkspace(userId: string, workspaceId: string): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    const request = tx.objectStore('workspaces').get(userId);
    request.onsuccess = () => { if (request.result) tx.objectStore('workspaces').put((request.result as WorkspaceSummary[]).filter(row => row.id !== workspaceId), userId); result(); };
    tx.objectStore('notes').delete([userId, workspaceId]);
    tx.objectStore('visited').delete(IDBKeyRange.bound([userId, workspaceId], [userId, workspaceId, []]));
  });
}
export function clearUserMetadata(userId: string): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    tx.objectStore('workspaces').delete(userId);
    for (const store of ['notes', 'visited', 'orphans']) tx.objectStore(store).delete(IDBKeyRange.bound([userId], [userId, []]));
    result();
  });
}
