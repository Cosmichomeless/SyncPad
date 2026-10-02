import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { loadConfig } from './config.js';
import { createDatabasePool } from './database.js';

export async function runMigrations(
  databaseUrl: string,
  migrationDirectory = fileURLToPath(new URL('../migrations/', import.meta.url)),
) {
  const pool = createDatabasePool(databaseUrl);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version text PRIMARY KEY,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    const applied = await client.query<{ version: string }>('SELECT version FROM schema_migrations');
    const appliedVersions = new Set(applied.rows.map((row) => row.version));
    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith('.sql'))
      .sort();
    for (const file of files) {
      if (appliedVersions.has(file)) continue;
      const sql = await readFile(resolve(migrationDirectory, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    }
    await client.query('COMMIT');
    return files.length - appliedVersions.size;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

try {
  const { databaseUrl } = loadConfig(process.env);
  const applied = await runMigrations(databaseUrl);
  console.log(`Applied ${applied} migration(s)`);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Migration failed');
  process.exitCode = 1;
}