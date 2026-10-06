import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

test('the first migration creates the application schema', async () => {
  const migrationPath = fileURLToPath(new URL('../migrations/001-foundation.sql', import.meta.url));
  assert.match(await readFile(migrationPath, 'utf8'), /CREATE SCHEMA IF NOT EXISTS syncpad/);
});

test('persisted updates are retired with their note by the foreign key cascade', async () => {
  const migrationPath = fileURLToPath(new URL('../migrations/007-note-updates.sql', import.meta.url));
  assert.match(await readFile(migrationPath, 'utf8'), /note_id uuid NOT NULL REFERENCES syncpad\.notes\(id\) ON DELETE CASCADE/);
});

test('snapshots are one derived row per note and are retired with it', async () => {
  const migrationPath = fileURLToPath(new URL('../migrations/008-note-snapshots.sql', import.meta.url));
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /note_id uuid PRIMARY KEY REFERENCES syncpad\.notes\(id\) ON DELETE CASCADE/);
  assert.doesNotMatch(sql, /DELETE FROM syncpad\.note_updates/);
});
