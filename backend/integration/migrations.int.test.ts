import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createCleanDatabase, migrateAgain } from './harness.js';

const MIGRATIONS = fileURLToPath(new URL('../migrations/', import.meta.url));

test('a clean database is migrated from nothing and the schema is complete', async (t) => {
  const db = await createCleanDatabase(t);
  const files = (await readdir(MIGRATIONS)).filter((file) => file.endsWith('.sql')).sort();
  assert.equal(db.migrationOutput, `Applied ${files.length} migration(s)`);

  const applied = await db.pool.query<{ version: string }>('SELECT version FROM public.schema_migrations ORDER BY version');
  assert.deepEqual(applied.rows.map((row) => row.version), files);

  const tables = await db.pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'syncpad' ORDER BY table_name`,
  );
  assert.deepEqual(
    tables.rows.map((row) => row.table_name),
    ['invitations', 'memberships', 'note_snapshots', 'note_updates', 'notes', 'sessions', 'users', 'workspaces'],
  );
});

test('migrating again is harmless: the stored data and the application tables survive', async (t) => {
  const db = await createCleanDatabase(t);
  await db.pool.query(`INSERT INTO syncpad.users (email, password_hash) VALUES ('keep@example.com', 'x')`);
  await migrateAgain(db.url);
  await migrateAgain(db.url);
  const users = await db.pool.query(`SELECT 1 FROM syncpad.users WHERE email = 'keep@example.com'`);
  assert.equal(users.rowCount, 1);
  const tables = await db.pool.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'syncpad' ORDER BY table_name`,
  );
  assert.equal(tables.rowCount, 8);
});

test('the migration log is a single table and a second run applies nothing', async (t) => {
  const db = await createCleanDatabase(t);
  const files = (await readdir(MIGRATIONS)).filter((file) => file.endsWith('.sql'));
  assert.equal(await migrateAgain(db.url), 'Applied 0 migration(s)');
  assert.equal(await migrateAgain(db.url), 'Applied 0 migration(s)');
  const logs = await db.pool.query<{ table_schema: string }>(
    `SELECT table_schema FROM information_schema.tables WHERE table_name = 'schema_migrations'`,
  );
  assert.deepEqual(logs.rows.map((row) => row.table_schema), ['public']);
  const applied = await db.pool.query('SELECT version FROM public.schema_migrations');
  assert.equal(applied.rowCount, files.length);
});

test('the schema enforces what the application relies on', async (t) => {
  const { pool } = await createCleanDatabase(t);
  const user = await pool.query<{ id: string }>(`INSERT INTO syncpad.users (email, password_hash) VALUES ('Ada@Example.com', 'x') RETURNING id`);
  await assert.rejects(
    pool.query(`INSERT INTO syncpad.users (email, password_hash) VALUES ('ada@example.com', 'x')`),
    { code: '23505' },
    'emails are unique regardless of case',
  );
  const workspace = await pool.query<{ id: string }>(`INSERT INTO syncpad.workspaces (name, created_by) VALUES ('w', $1) RETURNING id`, [user.rows[0].id]);
  await assert.rejects(
    pool.query(`INSERT INTO syncpad.memberships (workspace_id, user_id, role) VALUES ($1, $2, 'ADMIN')`, [workspace.rows[0].id, user.rows[0].id]),
    { code: '23514' },
    'only OWNER and MEMBER exist',
  );
  await assert.rejects(
    pool.query(`INSERT INTO syncpad.notes (workspace_id, title, created_by) VALUES ($1, '   ', $2)`, [workspace.rows[0].id, user.rows[0].id]),
    { code: '23514' },
    'a blank title is refused',
  );
});

test('deleting a note really removes its stored updates and snapshot', async (t) => {
  const { pool } = await createCleanDatabase(t);
  const user = await pool.query<{ id: string }>(`INSERT INTO syncpad.users (email, password_hash) VALUES ('a@example.com', 'x') RETURNING id`);
  const workspace = await pool.query<{ id: string }>(`INSERT INTO syncpad.workspaces (name, created_by) VALUES ('w', $1) RETURNING id`, [user.rows[0].id]);
  const note = await pool.query<{ id: string }>(`INSERT INTO syncpad.notes (workspace_id, title, created_by) VALUES ($1, 'n', $2) RETURNING id`, [workspace.rows[0].id, user.rows[0].id]);
  const noteId = note.rows[0].id;
  await pool.query(`INSERT INTO syncpad.note_updates (note_id, update_hash, update_data) VALUES ($1, 'h', '\\x01')`, [noteId]);
  await assert.rejects(
    pool.query(`INSERT INTO syncpad.note_updates (note_id, update_hash, update_data) VALUES ($1, 'h', '\\x01')`, [noteId]),
    { code: '23505' },
    'the same update cannot be stored twice',
  );
  await pool.query(`INSERT INTO syncpad.note_snapshots (note_id, covers_update_id, state, update_count) VALUES ($1, 1, '\\x01', 1)`, [noteId]);

  await pool.query('DELETE FROM syncpad.notes WHERE id = $1', [noteId]);
  for (const table of ['note_updates', 'note_snapshots']) {
    const left = await pool.query(`SELECT 1 FROM syncpad.${table} WHERE note_id = $1`, [noteId]);
    assert.equal(left.rowCount, 0, `${table} rows are retired with their note`);
  }
});
