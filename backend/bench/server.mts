// Child process of run.mts: a real sync server, isolated so its memory and CPU can be read on their own.
import { once } from 'node:events';
import type { AuthService } from '../src/auth.js';
import { createDatabasePool } from '../src/database.js';
import type { NoteService } from '../src/notes.js';
import { loadSecurityConfig } from '../src/security.js';
import { createSyncServer } from '../src/server.js';
import { createPostgresSyncStore, type SyncStore } from '../src/sync-store.js';

const databaseUrl = process.env.BENCH_DATABASE_URL;
const user = { id: 'bench-user' as never, email: 'bench@example.com' };
const auth: AuthService = {
  async register() { return user; }, async authenticate() { return user; }, async createSession() { return 'bench'; },
  async getUserBySession(token) { return token ? user : null; }, async invalidateSession() {},
};
const notes: NoteService = {
  async create() { return null; }, async listForUser() { return []; }, async rename() { return null; }, async delete() { return false; }, async canAccess() { return true; },
};
const memory = new Map<string, Uint8Array[]>();
const memoryStore: SyncStore = {
  async load(noteId) { return [...(memory.get(noteId) ?? [])]; },
  async append(noteId, update) { memory.set(noteId, [...(memory.get(noteId) ?? []), update]); return true; },
};
const pool = databaseUrl ? createDatabasePool(databaseUrl) : undefined;

const app = createSyncServer({
  auth, notes, security: loadSecurityConfig({}),
  syncStore: pool ? createPostgresSyncStore(pool, { retentionMs: 0 }) : memoryStore,
  // Sustained typing is far below these; the bench measures the server, not its guard rails.
  limits: { messagesPerSecond: 10_000, messageBurst: 10_000, awarenessPerSecond: 10_000, maxClientsPerRoom: 10_000 },
});
app.server.listen(0, '127.0.0.1');
await once(app.server, 'listening');
const send = process.send!.bind(process);
send({ type: 'ready', port: (app.server.address() as { port: number }).port });
process.on('message', (message: { type: string }) => {
  if (message.type === 'stats') send({ type: 'stats', memory: process.memoryUsage(), cpu: process.cpuUsage() });
  if (message.type === 'stop') void app.close().then(() => pool?.end()).then(() => process.exit(0));
});
