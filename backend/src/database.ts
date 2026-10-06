import { Pool } from 'pg';

export function createDatabasePool(databaseUrl: string) {
  const pool = new Pool({ connectionString: databaseUrl });
  // Managed PostgreSQL (e.g. Neon) closes idle connections when it suspends compute. An idle client
  // that errors is discarded by the pool and replaced on demand, but without a listener the
  // `error` event would be uncaught and end the process.
  pool.on('error', (error) => console.warn(`Idle database connection dropped: ${error.message}`));
  return pool;
}

export async function assertDatabaseConnection(databaseUrl: string) {
  const pool = createDatabasePool(databaseUrl);
  try {
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
}