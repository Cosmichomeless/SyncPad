import type { NoteSummary, WorkspaceSummary } from '@syncpad/shared';
import { isCurrentIdentity, subscribeOfflineIdentity, type OfflineIdentity } from './offline-session';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('syncpad.offline-metadata.v1', 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('workspaces');
      request.result.createObjectStore('notes');
      request.result.createObjectStore('visited');
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
    const tx = db.transaction(['workspaces', 'notes', 'visited'], mode);
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
export function writeNotes(identity: OfflineIdentity, workspaceId: string, rows: NoteSummary[]): Promise<void> {
  return transaction('readwrite', (tx, result) => {
    tx.objectStore('notes').put(rows, [identity.user.id, workspaceId]);
    const cursor = tx.objectStore('visited').openCursor(IDBKeyRange.bound([identity.user.id, workspaceId], [identity.user.id, workspaceId, []]));
    cursor.onsuccess = () => { const entry = cursor.result; if (!entry) { result(); return; } if (!rows.some(row => row.id === (entry.key as string[])[2])) entry.delete(); entry.continue(); };
  }, identity);
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
    for (const store of ['notes', 'visited']) tx.objectStore(store).delete(IDBKeyRange.bound([userId], [userId, []]));
    result();
  });
}
