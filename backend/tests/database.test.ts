import assert from 'node:assert/strict';
import test from 'node:test';
import { createDatabasePool } from '../src/database.js';

test('an idle connection dropped by the database does not crash the process', async () => {
  const pool = createDatabasePool('postgres://syncpad:syncpad@127.0.0.1:1/syncpad');
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (message: string) => { warnings.push(message); };
  try {
    // Managed PostgreSQL closes idle sockets when it suspends compute; pg reports it as a pool `error`.
    assert.equal(pool.emit('error', new Error('terminating connection due to administrator command')), true, 'a listener must exist');
  } finally {
    console.warn = original;
    await pool.end();
  }
  assert.match(warnings[0], /Idle database connection dropped: terminating connection/);
});
