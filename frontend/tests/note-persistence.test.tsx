import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
import { IDBDatabase, IDBObjectStore } from 'fake-indexeddb';
import * as Y from 'yjs';
import { createEditorDocument } from '../src/lib/note-document';
import { noteStorageKey, persistNote } from '../src/lib/note-persistence';

test('restores a visited note without network', async () => {
  const first = createEditorDocument();
  const saved = persistNote('restore-user', 'restore-note', first.doc);
  await saved.whenSynced;
  first.content.insert(0, 'offline content');
  await saved.destroy();
  first.doc.destroy();
  const second = createEditorDocument();
  const restored = persistNote('restore-user', 'restore-note', second.doc);
  await restored.whenSynced;
  assert.equal(second.content.toString(), 'offline content');
  await restored.destroy();
  second.doc.destroy();
});

async function save(userId: string, noteId: string, content: string) {
  const document = createEditorDocument();
  const persistence = persistNote(userId, noteId, document.doc);
  try {
    await persistence.whenSynced;
    document.content.insert(0, content);
  } finally {
    await persistence.destroy();
    document.doc.destroy();
  }
}

async function restore(userId: string, noteId: string) {
  const document = createEditorDocument();
  const persistence = persistNote(userId, noteId, document.doc);
  try {
    await persistence.whenSynced;
    return document.content.toString();
  } finally {
    await persistence.destroy();
    document.doc.destroy();
  }
}

test('isolates two users sharing a note ID', async () => {
  await save('alice', 'shared-note', 'Alice content');
  await save('bob', 'shared-note', 'Bob content');
  assert.equal(await restore('alice', 'shared-note'), 'Alice content');
  assert.equal(await restore('bob', 'shared-note'), 'Bob content');
});

test('isolates two notes belonging to one user', async () => {
  await save('owner', 'note-one', 'First note');
  await save('owner', 'note-two', 'Second note');
  assert.equal(await restore('owner', 'note-one'), 'First note');
  assert.equal(await restore('owner', 'note-two'), 'Second note');
});

test('storage keys encode user and note IDs unambiguously', () => {
  const pairs = [['a:b', 'c'], ['a', 'b:c'], ['', ':'], [':', ''], ['a"', 'b'], ['a', '"b']];
  const keys = pairs.map(([userId, noteId]) => noteStorageKey(userId, noteId));
  assert.equal(new Set(keys).size, pairs.length);
  for (const [index, key] of keys.entries()) {
    assert.ok(key.startsWith('syncpad:note:'));
    assert.deepEqual(JSON.parse(key.slice('syncpad:note:'.length)), pairs[index]);
  }
});

test('repeated hydration does not duplicate content', async () => {
  await save('repeat-user', 'repeat-note', 'Once only');
  for (let attempt = 0; attempt < 3; attempt++) {
    assert.equal(await restore('repeat-user', 'repeat-note'), 'Once only');
  }
});

test('destroying persistence before hydration does not apply stale content', async () => {
  await save('cancel-user', 'cancel-note', 'Stale content');
  const document = createEditorDocument();
  const persistence = persistNote('cancel-user', 'cancel-note', document.doc);
  await persistence.destroy();
  assert.equal(document.content.toString(), '');
  document.doc.destroy();
});

test('rejects hydration when the IndexedDB factory cannot open storage', { timeout: 1000 }, async (t) => {
  const open = indexedDB.open.bind(indexedDB);
  t.mock.method(indexedDB, 'open', (name: string) => {
    const request = open(name);
    request.addEventListener('upgradeneeded', () => request.transaction!.abort());
    return request;
  });
  const document = createEditorDocument();
  const persistence = persistNote('failure-user', 'open-failure', document.doc);
  await assert.rejects(persistence.whenSynced);
  await persistence.destroy();
  document.doc.destroy();
});

test('rejects hydration when reading stored updates fails', { timeout: 1000 }, async (t) => {
  t.mock.method(IDBObjectStore.prototype, 'getAll', () => { throw new DOMException('Read denied', 'SecurityError'); });
  const document = createEditorDocument();
  const persistence = persistNote('failure-user', 'read-failure', document.doc);
  await assert.rejects(persistence.whenSynced, /Read denied/);
  await persistence.destroy();
  document.doc.destroy();
});

test('rejects hydration when IndexedDB is unavailable', async (t) => {
  t.mock.method(indexedDB, 'open', () => { throw new DOMException('Storage unavailable', 'SecurityError'); });
  const document = createEditorDocument();
  const persistence = persistNote('failure-user', 'unavailable', document.doc);
  await assert.rejects(persistence.whenSynced);
  await persistence.destroy();
  document.doc.destroy();
});

test('cancelled opens close the database and settle hydration without applying updates', async (t) => {
  await save('cancel-user', 'close-note', 'Do not apply');
  const close = t.mock.method(IDBDatabase.prototype, 'close');
  const document = createEditorDocument();
  const persistence = persistNote('cancel-user', 'close-note', document.doc);
  await persistence.destroy();
  await persistence.whenSynced;
  assert.equal(close.mock.callCount(), 1);
  assert.equal(document.content.toString(), '');
  document.content.insert(0, 'Not saved');
  document.doc.destroy();
  t.mock.restoreAll();
  assert.equal(await restore('cancel-user', 'close-note'), 'Do not apply');
});

test('reports aborted writes and drains them before closing without unhandled rejection', async (t) => {
  const errors: unknown[] = [];
  const document = createEditorDocument();
  const persistence = persistNote('failure-user', 'write-abort', document.doc, (error) => errors.push(error));
  await persistence.whenSynced;
  t.mock.method(IDBObjectStore.prototype, 'add', function (this: IDBObjectStore) {
    this.transaction.abort();
    throw new DOMException('Write aborted', 'AbortError');
  });
  document.content.insert(0, 'Lost write');
  await persistence.destroy();
  assert.equal(errors.length, 1);
  document.doc.destroy();
  t.mock.restoreAll();
  assert.equal(await restore('failure-user', 'write-abort'), '');
});

test('reports asynchronous transaction aborts rather than treating request success as persisted', async (t) => {
  const errors: unknown[] = [];
  const document = createEditorDocument();
  const persistence = persistNote('failure-user', 'async-abort', document.doc, (error) => errors.push(error));
  await persistence.whenSynced;
  const add = IDBObjectStore.prototype.add;
  t.mock.method(IDBObjectStore.prototype, 'add', function (this: IDBObjectStore, value: unknown) {
    const request = add.call(this, value);
    request.addEventListener('success', () => this.transaction.abort());
    return request;
  });
  document.content.insert(0, 'Not committed');
  await persistence.destroy();
  assert.equal(errors.length, 1);
  document.doc.destroy();
  t.mock.restoreAll();
  assert.equal(await restore('failure-user', 'async-abort'), '');
});

test('cancellation during a read waits for the transaction and skips hydration', async (t) => {
  await save('cancel-user', 'read-note', 'Stale read');
  const getAll = IDBObjectStore.prototype.getAll;
  const document = createEditorDocument();
  const persistence = persistNote('cancel-user', 'read-note', document.doc);
  let closing: Promise<void> | undefined;
  t.mock.method(IDBObjectStore.prototype, 'getAll', function (this: IDBObjectStore) {
    const request = getAll.call(this);
    request.addEventListener('success', () => { closing = persistence.destroy(); });
    return request;
  });
  await persistence.whenSynced;
  await closing;
  assert.equal(document.content.toString(), '');
  document.doc.destroy();
});

test('drains a queue of exact edits before destroy closes storage', async () => {
  const document = createEditorDocument();
  const persistence = persistNote('queue-user', 'queue-note', document.doc);
  await persistence.whenSynced;
  for (let index = 0; index < 30; index++) {
    document.content.delete(0, document.content.length);
    document.content.insert(0, `Exact final content ${index} 🙂`);
  }
  const closing = persistence.destroy();
  assert.equal(persistence.destroy(), closing);
  await closing;
  assert.equal(await restore('queue-user', 'queue-note'), document.content.toString());
  document.doc.destroy();
});

test('immediate same-key reopen restores all edits before awaiting destruction', async () => {
  const first = createEditorDocument();
  const saved = persistNote('immediate-user', 'immediate-note', first.doc);
  await saved.whenSynced;
  for (let index = 0; index < 30; index++) {
    first.content.delete(0, first.content.length);
    first.content.insert(0, `Exact final content ${index} 🙂`);
  }
  const closing = saved.destroy();
  const second = createEditorDocument();
  const reopened = persistNote('immediate-user', 'immediate-note', second.doc);
  try {
    await reopened.whenSynced;
    assert.equal(second.content.toString(), 'Exact final content 29 🙂');
    await closing;
    assert.equal(second.content.toString(), 'Exact final content 29 🙂');
  } finally {
    await closing;
    await reopened.destroy();
    first.doc.destroy();
    second.doc.destroy();
  }
});

test('rapid repeated same-key reopen preserves each latest edit without awaiting old drains', async () => {
  let document = createEditorDocument();
  let persistence = persistNote('rapid-user', 'rapid-note', document.doc);
  const drains: Promise<void>[] = [];
  try {
    await persistence.whenSynced;
    for (let attempt = 0; attempt < 5; attempt++) {
      document.content.delete(0, document.content.length);
      document.content.insert(0, `Latest ${attempt} 🙂`);
      const previous = document;
      drains.push(persistence.destroy().then(() => previous.doc.destroy()));
      document = createEditorDocument();
      persistence = persistNote('rapid-user', 'rapid-note', document.doc);
      await persistence.whenSynced;
      assert.equal(document.content.toString(), `Latest ${attempt} 🙂`);
    }
  } finally {
    await Promise.all(drains);
    await persistence.destroy();
    document.doc.destroy();
  }
});

test('rejects malformed persisted Yjs updates and closes storage', async (t) => {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(noteStorageKey('failure-user', 'malformed-note'));
    request.onupgradeneeded = () => {
      request.result.createObjectStore('updates', { autoIncrement: true });
      request.result.createObjectStore('custom');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('updates', 'readwrite');
      transaction.objectStore('updates').add(new Uint8Array([0]));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
  const document = createEditorDocument();
  const close = t.mock.method(IDBDatabase.prototype, 'close');
  const persistence = persistNote('failure-user', 'malformed-note', document.doc);
  await assert.rejects(persistence.whenSynced);
  await persistence.destroy();
  assert.equal(close.mock.callCount(), 1);
  document.doc.destroy();
});

test('reads the existing y-indexeddb version-one updates schema', async () => {
  const document = createEditorDocument();
  document.content.insert(0, 'Legacy content');
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.open(noteStorageKey('legacy-user', 'legacy-note'), 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore('updates', { autoIncrement: true });
      request.result.createObjectStore('custom');
    };
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('updates', 'readwrite');
      transaction.objectStore('updates').add(Y.encodeStateAsUpdate(document.doc));
      transaction.oncomplete = () => { db.close(); resolve(); };
      transaction.onabort = () => { db.close(); reject(transaction.error); };
    };
  });
  document.doc.destroy();
  assert.equal(await restore('legacy-user', 'legacy-note'), 'Legacy content');
});
