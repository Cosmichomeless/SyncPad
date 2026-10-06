import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { promisify } from 'node:util';
import { Account, createCleanDatabase, createEmptyDatabase, migrateAgain, Replica, startStack, uniqueEmail, waitFor } from './harness.js';
import { PASSWORD } from './client.js';

const run = promisify(execFile);
const ROOT = fileURLToPath(new URL('../../', import.meta.url));

/** The real scripts, exactly as an operator runs them. They need Docker for the pinned client tools. */
function script(name: string, databaseUrl: string, ...args: string[]) {
  return run('sh', [`scripts/${name}.sh`, ...args], { cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl } });
}

test('a backup restored into an empty database brings back the account, the note and its history', async (t) => {
  const source = await createCleanDatabase(t);
  const original = await startStack(t, source.url, { snapshotEvery: 2 });
  const alice = await Account.register(original, uniqueEmail('alice'));
  const workspaceId = await alice.createWorkspace('Equipo de producto');
  const noteId = await alice.createNote(workspaceId, 'Acta de muestra');
  const writer = await Replica.join(t, original, noteId, alice);
  assert.equal((await writer.type('Decisión: ')).type, 'ack');
  assert.equal((await writer.type('desplegar sin coste.')).type, 'ack');
  const expected = 'Decisión: desplegar sin coste.';
  await waitFor(
    async () => Number((await source.pool.query('SELECT count(*) FROM syncpad.note_snapshots WHERE note_id = $1', [noteId])).rows[0].count) === 1,
    'the snapshot taken after two updates',
  );

  const directory = await mkdtemp(join(tmpdir(), 'syncpad-backup-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const file = join(directory, 'backup.sql');
  await script('backup', source.url, file);
  assert.ok((await stat(file)).size > 0);
  assert.equal((await stat(file)).mode & 0o077, 0, 'readable only by its owner');
  const dump = await readFile(file, 'utf8');
  assert.match(dump, /PostgreSQL database dump complete/);

  // The original server goes away (the host is lost); everything comes from the file.
  await original.stop();
  const target = await createEmptyDatabase(t);
  const restored = await script('restore', target.url, file);
  assert.match(restored.stdout, /1 notes, 2 updates, 1 snapshots/);

  // Restoring over data that exists is refused rather than mixing two histories.
  await assert.rejects(script('restore', target.url, file), /already has a syncpad schema/);

  // The ledger came with it, so migrating the restored database has nothing left to apply.
  assert.match(await migrateAgain(target.url), /Applied 0 migration\(s\)/);

  const revived = await startStack(t, target.url);
  const reader = await Replica.join(t, revived, noteId, alice);
  await reader.waitForText(expected);
  assert.equal(
    (await target.pool.query('SELECT title FROM syncpad.notes WHERE id = $1', [noteId])).rows[0].title,
    'Acta de muestra',
  );

  // The password hash came back too: a fresh login works against the restored database.
  const csrf = await fetch(`${revived.http}/auth/csrf`);
  const { csrfToken } = (await csrf.json()) as { csrfToken: string };
  const cookie = (csrf.headers.getSetCookie() ?? []).map((value) => value.split(';', 1)[0]).join('; ');
  const login = await fetch(`${revived.http}/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ email: alice.email, password: PASSWORD }),
  });
  assert.equal(login.status, 200);

  // And the restored note keeps accepting edits, appended to the history that was restored.
  assert.equal((await reader.type(' Fin.')).type, 'ack');
  assert.equal(
    Number((await target.pool.query('SELECT count(*) FROM syncpad.note_updates WHERE note_id = $1', [noteId])).rows[0].count),
    3,
  );
});

test('a backup that cannot be read as a database is not mistaken for a good one', async (t) => {
  const missing = await createEmptyDatabase(t);
  await assert.rejects(script('restore', missing.url, '/nonexistent/backup.sql'), /no such backup/);
});
