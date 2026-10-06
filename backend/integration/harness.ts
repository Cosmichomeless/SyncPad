import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { TestContext } from 'node:test';
import pg from 'pg';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteStateSince, encodeNoteStateVector } from '@syncpad/shared';
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
export const ORIGIN = 'http://127.0.0.1:3000';
export const PASSWORD = 'password-123';

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

/**
 * A database that did not exist a moment ago, migrated by the real `migrate` entry point and
 * dropped when the test ends. Nothing a test does can see or disturb the developer's own data.
 */
export async function createCleanDatabase(t: TestContext): Promise<CleanDatabase> {
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
    await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
    await admin.end();
  });
  const migrated = await run(TSX, ['src/migrate.ts'], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: url } });
  return { url, pool, migrationOutput: migrated.stdout.trim() };
}

export async function migrateAgain(databaseUrl: string) {
  const migrated = await run(TSX, ['src/migrate.ts'], { cwd: BACKEND, env: { ...process.env, DATABASE_URL: databaseUrl } });
  return migrated.stdout.trim();
}

export type Stack = {
  http: string;
  /** WebSocket URL of one note's room. */
  ws(noteId: string): string;
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

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field

/** A signed-in user with the cookies a browser would hold, talking to the HTTP API. */
export class Account {
  constructor(
    readonly stack: Stack,
    readonly id: string,
    readonly email: string,
    private session: string,
    private csrfCookie: string,
    private csrfToken: string,
  ) {}

  get sessionCookie() { return this.session; }

  static async register(stack: Stack, email: string) {
    const csrf = await fetchCsrf(stack.http);
    const response = await fetch(`${stack.http}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: csrf.cookie, 'x-csrf-token': csrf.token },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(response.status, 201, 'registration succeeds');
    const session = response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    assert.match(session, /^syncpad_session=/);
    const body = (await response.json()) as { user: { id: string; email: string } };
    return new Account(stack, body.user.id, body.user.email, session, csrf.cookie, csrf.token);
  }

  async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const response = await fetch(`${this.stack.http}${path}`, {
      method,
      headers: { cookie: `${this.session}; ${this.csrfCookie}`, 'x-csrf-token': this.csrfToken, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Json) : {} };
  }

  async createWorkspace(name: string) {
    const { status, body } = await this.request('POST', '/workspaces', { name });
    assert.equal(status, 201);
    return body.workspace.id as string;
  }

  async createNote(workspaceId: string, title: string) {
    const { status, body } = await this.request('POST', `/workspaces/${workspaceId}/notes`, { title });
    assert.equal(status, 201);
    return body.note.id as string;
  }

  /** Invites `guest` and has them accept, exactly as the two people would through the UI. */
  async invite(workspaceId: string, guest: Account) {
    const invited = await this.request('POST', `/workspaces/${workspaceId}/invitations`, { email: guest.email });
    assert.equal(invited.status, 201);
    const accepted = await guest.request('POST', `/invitations/${invited.body.invitation.token}/accept`);
    assert.equal(accepted.status, 200);
  }
}

async function fetchCsrf(http: string) {
  const response = await fetch(`${http}/auth/csrf`);
  const token = ((await response.json()) as { csrfToken: string }).csrfToken;
  return { token, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? '' };
}

let counter = 0;
export const uniqueEmail = (prefix: string) => `${prefix}-${process.pid}-${++counter}@example.com`;

export async function waitFor(condition: () => boolean | Promise<boolean>, label: string, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** The HTTP status the server answers a WebSocket upgrade with when it refuses it. */
export async function upgradeRefusal(url: string, headers: Record<string, string>) {
  const client = new WebSocket(url, { headers: { origin: ORIGIN, ...headers } });
  const [, response] = (await once(client, 'unexpected-response')) as [unknown, IncomingMessage];
  client.on('error', () => {}); // terminating a socket that never upgraded reports an error
  client.terminate();
  return response.statusCode;
}

export type Frame = { type: string; requestId?: string; update?: string; code?: string; retryable?: boolean; users?: unknown[] };

/** One connected client with its own copy of the note, kept in step with what the server sends. */
export class Replica {
  readonly doc = createNoteDocument();
  readonly seen: Frame[] = [];
  readonly closed: Promise<number>;
  private requests = 0;

  private constructor(readonly client: WebSocket) {
    this.closed = new Promise((resolve) => client.once('close', (code) => resolve(code)));
    client.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      this.seen.push(frame);
      if ((frame.type === 'sync' || frame.type === 'update') && frame.update) applyNoteUpdate(this.doc.doc, Buffer.from(frame.update, 'base64'));
    });
  }

  /** Connects with the account's session and resolves once the room's first state has arrived. */
  static async join(t: TestContext, stack: Stack, noteId: string, account: Account) {
    const client = new WebSocket(stack.ws(noteId), { headers: { cookie: account.sessionCookie, origin: ORIGIN } });
    cleanupAfter(t, async () => client.terminate());
    const replica = new Replica(client);
    await once(client, 'open');
    await waitFor(() => replica.seen.some((frame) => frame.type === 'sync'), 'the first sync frame');
    return replica;
  }

  get text() { return this.doc.content.toString(); }

  get isOpen() { return this.client.readyState === WebSocket.OPEN; }

  /** Appends text locally and sends only that change; resolves with the server's verdict for the request. */
  async type(text: string) {
    const before = encodeNoteStateVector(this.doc.doc);
    this.doc.content.insert(this.doc.content.length, text);
    return this.send(Buffer.from(encodeNoteStateSince(this.doc.doc, before)).toString('base64'));
  }

  async send(update: string) {
    const requestId = `r${++this.requests}`;
    this.client.send(JSON.stringify({ type: 'update', requestId, update }));
    await waitFor(() => this.seen.some((frame) => frame.requestId === requestId), `the answer to ${requestId}`);
    return this.seen.find((frame) => frame.requestId === requestId)!;
  }

  async waitForText(expected: string) {
    await waitFor(() => this.text === expected, `the note to read ${JSON.stringify(expected)} (it reads ${JSON.stringify(this.text)})`);
  }
}
