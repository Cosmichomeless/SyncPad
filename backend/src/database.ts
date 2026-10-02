import { Pool } from 'pg';

export function createDatabasePool(databaseUrl: string) {
  return new Pool({ connectionString: databaseUrl });
}

export async function assertDatabaseConnection(databaseUrl: string) {
  const pool = createDatabasePool(databaseUrl);
  try {
    await pool.query('SELECT 1');
  } finally {
    await pool.end();
  }
}