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
