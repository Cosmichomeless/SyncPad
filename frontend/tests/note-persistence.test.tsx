import 'fake-indexeddb/auto';
import assert from 'node:assert/strict';
import test from 'node:test';
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
