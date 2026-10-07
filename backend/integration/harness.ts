import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestContext } from 'node:test';
import pg from 'pg';
import { ORIGIN, type Endpoint } from './client.js';
import { createAuthService } from '../src/auth.js';
import { createDatabasePool } from '../src/database.js';
import type { SyncLimits } from '../src/limits.js';
import { createNoteService } from '../src/notes.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';
import { createPostgresSyncStore } from '../src/sync-store.js';
import { createWorkspaceService } from '../src/workspaces.js';

const run = promisify(execFile);

/** Same default as e2e: the `syncpad-dev-pg` container. Only used to create and drop throwaway databases. */
export const ADMIN_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://syncpad:syncpad@127.0.0.1:55432/syncpad';

const cleanups = new WeakMap<TestContext, Array<() => Promise<unknown>>>();

/** Runs in reverse order of registration, so a stack is stopped before the database it uses is dropped. */
function cleanupAfter(t: TestContext, cleanup: () => Promise<unknown>) {
  let pending = cleanups.get(t);
  if (!pending) {
    const list: Array<() => Promise<unknown>> = pending = [];
    cleanups.set(t, list);
    t.after(async () => {
      for (const run of list.reverse()) await run();
    });
  }
  pending.push(cleanup);
}

const BACKEND = fileURLToPath(new URL('..', import.meta.url));
const TSX = fileURLToPath(new URL('../node_modules/.bin/tsx', import.meta.url));

function withDatabase(url: string, name: string) {
  const parsed = new URL(url);
  parsed.pathname = `/${name}`;
  return parsed.toString();
}

export type CleanDatabase = {
  url: string;
  /** For assertions on what was really stored; the servers under test use their own pools. */
  pool: pg.Pool;
  /** What `npm run migrate` printed when it built the schema. */
  migrationOutput: string;
};

/** A database with nothing in it, dropped when the test ends: the target of a restore. */
export async function createEmptyDatabase(t: TestContext): Promise<Omit<CleanDatabase, 'migrationOutput'>> {
  const name = `syncpad_it_${process.pid}_${randomBytes(4).toString('hex')}`;
  const admin = new pg.Client({ connectionString: ADMIN_DATABASE_URL });
  try {
    await admin.connect();
  } catch (error) {
    throw new Error(
      `PostgreSQL is not reachable at ${ADMIN_DATABASE_URL}. Start it (docker compose up -d --wait postgres) or set DATABASE_URL. ${(error as Error).message}`,
    );
  }
  await admin.query(`CREATE DATABASE ${name}`);
  const url = withDatabase(ADMIN_DATABASE_URL, name);
  const pool = new pg.Pool({ connectionString: url, max: 4 });
  cleanupAfter(t, async () => {
    await pool.end();
    // `pool.end()` resolves before its sockets are fully closed; forcing the drop in that window
    // kills a connection mid-goodbye and surfaces as an uncaught "administrator command" error.
    for (let attempt = 0; attempt < 100; attempt++) {
      const { rows } = await admin.query('SELECT count(*)::int AS open FROM pg_stat_activity WHERE datname = $1', [name]);
      if (rows[0].open === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });
  return { url, pool };
}

/**
 * A database that did not exist a moment ago, migrated by the real `migrate` entry point and
 * dropped when the test ends. Nothing a test does can see or disturb the developer's own data.
 */
export async function createCleanDatabase(t: TestContext): Promise<CleanDatabase> {
  const database = await createEmptyDatabase(t);
  return { ...database, migrationOutput: await migrateAgain(database.url) };
}

export async function migrateAgain(databaseUrl: string) {
  const migrated = await run(TSX, ['src/migrate.ts'], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: databaseUrl } });
  return migrated.stdout.trim();
}

export type Stack = Endpoint & {
  /** Closes the server and its database pool, as a deploy or a crash would end the process. */
  stop(): Promise<void>;
};

/**
 * The complete server (HTTP API, WebSocket rooms, real services) over a real pool. Starting a second
 * stack on the same database is a restart: no room, session or cache survives in memory.
 */
export async function startStack(
  t: TestContext,
  databaseUrl: string,
  options: { limits?: Partial<SyncLimits>; snapshotEvery?: number; retentionMs?: number } = {},
): Promise<Stack> {
  const pool = createDatabasePool(databaseUrl);
  const app = createSyncServer({
    auth: createAuthService(pool),
    workspaces: createWorkspaceService(pool),
    notes: createNoteService(pool),
    syncStore: createPostgresSyncStore(pool, { retentionMs: options.retentionMs }),
    snapshotEvery: options.snapshotEvery,
    limits: { heartbeatMs: 0, ...options.limits },
    security: loadSecurityConfig({ CORS_ORIGIN: ORIGIN }),
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const port = (app.server.address() as { port: number }).port;
  let stopped: Promise<void> | undefined;
  const stop = () => stopped ??= app.close().then(() => pool.end());
  cleanupAfter(t, stop);
  return { http: `http://127.0.0.1:${port}`, ws: (noteId) => `ws://127.0.0.1:${port}/ws?noteId=${noteId}`, stop };
}

export { Account, Replica, uniqueEmail, upgradeRefusal, waitFor, type Frame } from './client.js';
