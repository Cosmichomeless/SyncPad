import * as Y from 'yjs';

export function noteStorageKey(userId: string, noteId: string): string {
  return 'syncpad:note:' + JSON.stringify([userId, noteId]);
}

export interface NotePersistence {
  whenSynced: Promise<void>;
  destroy(): Promise<void>;
}

function openDatabase(name: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('updates', { autoIncrement: true });
      request.result.createObjectStore('custom');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

function transact<T>(db: IDBDatabase, mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const transaction = db.transaction('updates', mode);
    let request: IDBRequest<T>;
    let failure: unknown;
    transaction.oncomplete = () => resolve(request.result);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new DOMException('Transaction aborted', 'AbortError'));
    try {
      request = action(transaction.objectStore('updates'));
    } catch (error) {
      failure = error;
      transaction.abort();
    }
  });
}

export function persistNote(userId: string, noteId: string, doc: Y.Doc, onError: (error: unknown) => void = () => {}): NotePersistence {
  let cancelled = false;
  let db: IDBDatabase | null = null;
  let pending = Promise.resolve();
  let closing: Promise<void> | undefined;
  const storeUpdate = (update: Uint8Array) => {
    pending = pending.then(() => transact(db!, 'readwrite', (store) => store.add(update))).then(() => {}, onError);
  };
  const whenSynced = (async () => {
    db = await openDatabase(noteStorageKey(userId, noteId));
    if (cancelled) {
      db.close();
      db = null;
      return;
    }
    try {
      const updates = await transact(db, 'readonly', (store) => store.getAll());
      if (cancelled) return;
      Y.transact(doc, () => {
        for (const update of updates) Y.applyUpdate(doc, update);
      });
      storeUpdate(Y.encodeStateAsUpdate(doc));
      doc.on('update', storeUpdate);
    } catch (error) {
      db.close();
      db = null;
      throw error;
    }
  })();
  // Keep cancellation safe even if the caller only waits for destroy().
  void whenSynced.catch(() => {});
  return {
    whenSynced,
    destroy() {
      cancelled = true;
      doc.off('update', storeUpdate);
      closing ??= (async () => {
        await whenSynced.catch(() => {});
        await pending;
        db?.close();
        db = null;
      })();
      return closing;
    },
  };
}
