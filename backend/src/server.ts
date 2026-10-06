import { createServer } from 'node:http';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import type { AwarenessCursor, AwarenessUser, ClientSyncMessage, HealthResponse, ServerSyncMessage } from '@syncpad/shared';
import { applyNoteUpdate, assertValidNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateSince, encodeNoteStateVector, isNoteSchemaError } from '@syncpad/shared';
import type { NoteId, UserId } from '@syncpad/shared';
import { handleAuthRequest } from './auth-http.js';
import type { AuthService } from './auth.js';
import type { AuthUser } from './auth.js';
import { applyCors, isAllowedOrigin, rejectCors, type SecurityConfig } from './security.js';
import { handleWorkspaceRequest } from './workspace-http.js';
import type { WorkspaceService } from './workspaces.js';
import { handleNoteRequest } from './note-http.js';
import type { NoteService } from './notes.js';
import { isNoteId } from './notes.js';
import type { SyncStore } from './sync-store.js';
import { silentLogger, type Logger } from './logger.js';
import { createMetrics, type Metrics } from './metrics.js';
import { createRateLimiter, DEFAULT_LIMITS, type LimitEvent, type SyncLimits } from './limits.js';

function cookieValue(header: string | undefined, name: string) {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1);
}

function rejectUpgrade(socket: Duplex, status: number) {
  socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`);
}

type NoteRoom = {
  document: ReturnType<typeof createNoteDocument>;
  clients: Map<WebSocket, AwarenessUser>;
  /** Serializes snapshots and updates so a snapshot never overtakes an append in flight. */
  queue: Promise<void>;
  /** Updates persisted through this room since the store was last asked for a snapshot. */
  sinceSnapshotCheck: number;
};

type RevokeReason = 'recheck' | 'member-removed' | 'logout';
/** One authenticated connection, with what is needed to ask again whether it may still be there. */
type Guard = { userId: UserId; token: string; noteId: NoteId; checkedAt: number; revoke(reason: RevokeReason): void };

function enqueue(room: NoteRoom, task: () => Promise<void>) {
  const run = room.queue.then(task);
  room.queue = run.catch(() => {});
  return run;
}

/** Stored updates a note accumulates before the store folds them into a snapshot. */
const DEFAULT_SNAPSHOT_EVERY = 100;
const MAX_REQUEST_ID_LENGTH = 128;
const MAX_CURSOR_LENGTH = 256;

/** A cursor is two short base64 strings or nothing; anything else is a malformed message. */
function parseCursor(value: unknown): AwarenessCursor | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object') throw new Error('invalid cursor');
  const { anchor, head } = value as Record<string, unknown>;
  const valid = (part: unknown): part is string => typeof part === 'string' && part.length > 0 && part.length <= MAX_CURSOR_LENGTH && /^[A-Za-z0-9+/]+={0,2}$/.test(part);
  if (!valid(anchor) || !valid(head)) throw new Error('invalid cursor');
  return { anchor, head };
}

function encode(data: Uint8Array) {
  return Buffer.from(data).toString('base64');
}

/** Constant-time check of an `Authorization: Bearer` header. */
function bearerMatches(header: string | undefined, token: string) {
  const expected = Buffer.from(`Bearer ${token}`);
  const given = Buffer.from(header ?? '');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

function decode(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function createSyncServer(options: { auth?: AuthService; security?: SecurityConfig; workspaces?: WorkspaceService; notes?: NoteService; syncStore?: SyncStore; snapshotEvery?: number; limits?: Partial<SyncLimits>; onLimit?: (event: LimitEvent) => void; logger?: Logger; metrics?: Metrics; metricsToken?: string } = {}) {
  const limits: SyncLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const logger = options.logger ?? silentLogger;
  const metrics = options.metrics ?? createMetrics();
  metrics.describe('syncpad_connections_total', 'WebSocket connections accepted into a note room');
  metrics.describe('syncpad_reconnects_total', 'Connections by a user to a note shortly after losing a previous one');
  metrics.describe('syncpad_sync_errors_total', 'sync-error messages sent to clients, by code');
  metrics.describe('syncpad_limit_hits_total', 'Times a size or load limit fired, by limit');
  metrics.describe('syncpad_connection_closes_total', 'Closed room connections, by WebSocket close code');
  metrics.describe('syncpad_updates_total', 'Client updates, by outcome');
  metrics.describe('syncpad_update_persist_ms', 'Milliseconds from receiving an update to acknowledging it');
  metrics.describe('syncpad_note_chars', 'Note length in characters after each accepted update');
  const onLimit = (event: LimitEvent) => {
    metrics.inc('syncpad_limit_hits_total', { limit: event.limit });
    logger.warn('sync limit hit', { ...event });
    try { options.onLimit?.(event); } catch { /* reporting must never break sync */ }
  };
  /** When a user last lost a connection to a note: a new one soon after is a reconnect, not a new visit. */
  const recentDisconnects = new Map<string, number>();
  const RECONNECT_WINDOW_MS = 5 * 60_000;
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    const origin = req.headers.origin;
    if (options.security && !isAllowedOrigin(origin, options.security)) {
      rejectCors(res);
      return;
    }
    if (options.security) {
      applyCors(res, origin, options.security);
      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS',
          'access-control-allow-headers': 'content-type,x-csrf-token',
        }).end();
        return;
      }
    }
    if (options.auth && req.url?.startsWith('/auth/')) {
      void handleAuthRequest(req, res, options.auth, options.security ?? {
        corsOrigin: 'http://127.0.0.1:3000',
        cookieSecure: false,
        cookieSameSite: 'Lax',
      }, (token) => revalidate((guard) => guard.token === token, 'logout')).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (options.auth && options.notes && ((req.url?.startsWith('/workspaces/') && req.url?.includes('/notes')) || req.url?.startsWith('/notes/'))) {
      void handleNoteRequest(req, res, options.auth, options.notes, (noteId) => retireRoom(noteId)).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (options.auth && options.workspaces && (req.url?.startsWith('/workspaces') || req.url?.startsWith('/invitations'))) {
      void handleWorkspaceRequest(req, res, options.auth, options.workspaces, (memberId) => revalidate((guard) => guard.userId === memberId, 'member-removed')).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (req.method === 'GET' && req.url === '/health') {
      const response: HealthResponse = { status: 'ok' };
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify(response));
      return;
    }
    // Off unless a token is configured, so a default deployment never exposes it.
    if (req.method === 'GET' && req.url === '/metrics' && options.metricsToken && bearerMatches(req.headers.authorization, options.metricsToken)) {
      res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4', 'cache-control': 'no-store' });
      res.end(metrics.render());
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxMessageBytes, perMessageDeflate: false });
  const snapshotEvery = Math.max(1, options.snapshotEvery ?? DEFAULT_SNAPSHOT_EVERY);
  const rooms = new Map<string, Promise<NoteRoom>>();
  metrics.gauge('syncpad_connections_current', () => wss.clients.size);
  metrics.gauge('syncpad_rooms_current', () => rooms.size);
  /** Asks the store to fold stored updates into a snapshot. Best effort: the update log stays authoritative. */
  const scheduleSnapshot = (noteId: NoteId, room: NoteRoom) => {
    const store = options.syncStore;
    if (!store?.snapshot) return;
    room.sinceSnapshotCheck = 0;
    void enqueue(room, async () => {
      try {
        // Only a snapshot that was just written makes older updates redundant.
        if (await store.snapshot!(noteId, snapshotEvery)) await store.compact?.(noteId);
      } catch { /* best effort: the update log stays complete */ }
    });
  };
  const getRoom = (noteId: NoteId) => {
    let room = rooms.get(noteId);
    if (!room) {
      room = (async () => {
        const created: NoteRoom = { document: createNoteDocument(), clients: new Map(), queue: Promise.resolve(), sinceSnapshotCheck: 0 };
        if (options.syncStore) {
          for (const update of await options.syncStore.load(noteId)) applyNoteUpdate(created.document.doc, update);
          // A long history left by a previous process is compacted into a snapshot on first load.
          scheduleSnapshot(noteId, created);
        }
        return created;
      })();
      rooms.set(noteId, room);
      // A failed load must not be cached: the next connection retries it.
      const loading = room;
      loading.catch(() => { if (rooms.get(noteId) === loading) rooms.delete(noteId); });
    }
    return room;
  };
  /** Drops the in-memory room of a deleted note and tells its clients the deletion is final. */
  const retireRoom = async (noteId: string) => {
    const loading = rooms.get(noteId as NoteId);
    rooms.delete(noteId as NoteId);
    const room = await loading?.catch(() => undefined);
    if (!room) return;
    const payload = JSON.stringify({ type: 'sync-error', code: 'note-deleted', retryable: false } satisfies ServerSyncMessage);
    for (const client of room.clients.keys()) {
      if (client.readyState === client.OPEN) client.send(payload);
      client.close(4404, 'Note deleted');
    }
    room.clients.clear();
  };
  /** Live connections whose right to be there is rechecked: on a timer, per message, and when HTTP revokes something. */
  const guards = new Set<Guard>();
  /** Is the session still the same user's, and does that user still belong to the note's workspace? */
  const stillAllowed = async (guard: Guard) => {
    const user = await options.auth!.getUserBySession(guard.token);
    const allowed = user?.id === guard.userId && (await options.notes!.canAccess(guard.userId, guard.noteId));
    guard.checkedAt = Date.now();
    return allowed;
  };
  const revalidate = (matches: (guard: Guard) => boolean, reason: RevokeReason) => {
    for (const guard of [...guards]) {
      if (!matches(guard)) continue;
      // An error here proves nothing: the next message or sweep asks again.
      void stillAllowed(guard).then((allowed) => { if (!allowed) guard.revoke(reason); }, () => {});
    }
  };
  const permissionSweep = setInterval(() => {
    const cutoff = Date.now() - limits.permissionRecheckMs;
    revalidate((guard) => guard.checkedAt <= cutoff, 'recheck');
  }, limits.permissionRecheckMs);
  permissionSweep.unref();
  let closing: Promise<void> | undefined;
  /** A socket that has not answered the last ping is dead (or hung) and is dropped, freeing its room slot. */
  const liveness = new WeakMap<WebSocket, boolean>();
  const heartbeat = limits.heartbeatMs > 0 ? setInterval(() => {
    for (const client of wss.clients) {
      if (liveness.get(client) === false) { client.terminate(); continue; }
      liveness.set(client, false);
      try { client.ping(); } catch { client.terminate(); }
    }
  }, limits.heartbeatMs) : undefined;
  heartbeat?.unref();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    void (async () => {
      if (closing || (options.security && !isAllowedOrigin(req.headers.origin, options.security))) {
        rejectUpgrade(socket, 403);
        return;
      }
      if (req.url?.split('?')[0] !== '/ws') {
        socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
        return;
      }
      let roomUser: AuthUser | null = null;
      let sessionToken = '';
      if (options.auth && options.notes) {
        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
        const noteId = url.searchParams.get('noteId');
        const token = cookieValue(req.headers.cookie, 'syncpad_session');
        if (!token || !noteId || !isNoteId(noteId)) {
          rejectUpgrade(socket, 401);
          return;
        }
        sessionToken = decodeURIComponent(token);
        roomUser = await options.auth.getUserBySession(sessionToken);
        if (!roomUser) {
          rejectUpgrade(socket, 401);
          return;
        }
        if (!(await options.notes.canAccess(roomUser.id, noteId))) {
          rejectUpgrade(socket, 403);
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, (client) => {
        client.on('error', () => client.terminate());
        liveness.set(client, true);
        client.on('pong', () => liveness.set(client, true));
        if (!options.auth || !options.notes) return;
        const noteIdValue = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('noteId');
        const noteId = noteIdValue && isNoteId(noteIdValue) ? noteIdValue : undefined;
        if (!noteId) {
          client.close(1008, 'noteId is required');
          return;
        }
        const connectionId = randomUUID();
        const participant: AwarenessUser = { connectionId, userId: roomUser?.id ?? 'anonymous', email: roomUser?.email ?? 'anonymous' };
        let revoked = false;
        let joinedRoom: NoteRoom | undefined;
        const send = (message: ServerSyncMessage) => {
          if (revoked) return;
          if (message.type === 'sync-error') {
            metrics.inc('syncpad_sync_errors_total', { code: message.code });
            logger.warn('sync error sent', { roomId: noteId, connectionId, code: message.code, retryable: message.retryable });
          }
          if (client.readyState === client.OPEN) client.send(JSON.stringify(message));
        };
        const broadcastAwareness = (room: NoteRoom) => {
          const users = [...room.clients.values()];
          for (const [peer, who] of room.clients) {
            if (peer.readyState === peer.OPEN) peer.send(JSON.stringify({ type: 'awareness', users, self: who.connectionId } satisfies ServerSyncMessage));
          }
        };
        const guard: Guard = {
          userId: roomUser!.id,
          token: sessionToken,
          noteId,
          checkedAt: Date.now(),
          revoke: (reason) => {
            if (revoked) return;
            revoked = true;
            guards.delete(guard);
            // Out of the room first and synchronously, so nothing more is broadcast to a socket that lost access.
            if (joinedRoom?.clients.delete(client)) broadcastAwareness(joinedRoom);
            metrics.inc('syncpad_access_revoked_total', { reason });
            logger.warn('ws access revoked', { roomId: noteId, connectionId, userId: participant.userId, reason });
            if (client.readyState === client.OPEN) {
              client.send(JSON.stringify({ type: 'sync-error', code: 'access-revoked', retryable: false } satisfies ServerSyncMessage));
              client.close(4403, 'Access revoked');
            }
          },
        };
        guards.add(guard);
        const snapshot = (room: NoteRoom, requestId?: string, since?: Uint8Array): ServerSyncMessage => ({
          type: 'sync',
          ...(requestId ? { requestId } : {}),
          update: encode(since ? encodeNoteStateSince(room.document.doc, since) : encodeNoteState(room.document.doc)),
          stateVector: encode(encodeNoteStateVector(room.document.doc)),
        });
        const persistUpdate = async (room: NoteRoom, update: Uint8Array, encoded: string, requestId?: string) => {
          if (revoked) return; // queued before access was lost: neither stored nor broadcast
          const started = performance.now();
          const { contentLength } = assertValidNoteUpdate(room.document.doc, update);
          // Only growth is refused, so a note already over a lowered limit can still be shortened.
          if (contentLength > limits.maxNoteChars && contentLength > room.document.content.length) {
            onLimit({ limit: 'note-size', noteId, chars: contentLength, max: limits.maxNoteChars });
            metrics.inc('syncpad_updates_total', { outcome: 'rejected' });
            send({ type: 'sync-error', ...(requestId ? { requestId } : {}), code: 'note-too-large', retryable: false });
            return;
          }
          if (options.syncStore) {
            try {
              await options.syncStore.append(noteId, update);
            } catch {
              metrics.inc('syncpad_updates_total', { outcome: 'failed' });
              send({ type: 'sync-error', ...(requestId ? { requestId } : {}), code: 'persistence-unavailable', retryable: true });
              return;
            }
          }
          applyNoteUpdate(room.document.doc, update);
          metrics.inc('syncpad_updates_total', { outcome: 'accepted' });
          metrics.observe('syncpad_note_chars', contentLength, [100, 1_000, 10_000, 50_000, 100_000, 250_000, 500_000]);
          metrics.observe('syncpad_update_persist_ms', performance.now() - started);
          if (options.syncStore && ++room.sinceSnapshotCheck >= snapshotEvery) scheduleSnapshot(noteId, room);
          const payload = JSON.stringify({ type: 'update', update: encoded });
          for (const [peer] of room.clients) if (peer !== client && peer.readyState === peer.OPEN) peer.send(payload);
          if (!requestId) return;
          // Without a durable store the update is live but must not be reported as saved.
          if (options.syncStore) send({ type: 'ack', requestId });
          else send({ type: 'sync-error', requestId, code: 'persistence-unavailable', retryable: false });
        };
        const awarenessAllowance = createRateLimiter(limits.awarenessPerSecond, limits.awarenessPerSecond * 2);
        const handle = async (room: NoteRoom, raw: WebSocket.RawData) => {
          if (revoked) return;
          if (Date.now() - guard.checkedAt >= limits.permissionRecheckMs) {
            let allowed: boolean;
            try {
              allowed = await stillAllowed(guard);
            } catch {
              // Access that cannot be proven is not assumed: nothing is applied and the client retries.
              send({ type: 'sync-error', code: 'persistence-unavailable', retryable: true });
              client.close(1011, 'Access check unavailable');
              return;
            }
            if (!allowed) {
              guard.revoke('recheck');
              return;
            }
          }
          let requestId: string | undefined;
          try {
            const message = JSON.parse(raw.toString()) as ClientSyncMessage;
            if ('requestId' in message && message.requestId !== undefined) {
              if (typeof message.requestId !== 'string' || message.requestId.length > MAX_REQUEST_ID_LENGTH) throw new Error('invalid requestId');
              requestId = message.requestId;
            }
            if (message.type === 'sync-request') {
              const since = message.stateVector ? decode(message.stateVector) : undefined;
              await enqueue(room, async () => send(snapshot(room, requestId, since)));
            } else if (message.type === 'update') {
              if (typeof message.update !== 'string') throw new Error('update must be a string');
              const update = decode(message.update);
              await enqueue(room, () => persistUpdate(room, update, message.update, requestId));
            } else if (message.type === 'awareness') {
              // Presence is ephemeral and chatty: over its own allowance it is dropped and the socket stays up.
              if (!awarenessAllowance.take()) { onLimit({ limit: 'awareness-rate', noteId }); return; }
              // `cursor` absent keeps the current one (legacy ping); null clears it.
              if ('cursor' in message) participant.cursor = parseCursor(message.cursor);
              broadcastAwareness(room);
            }
          } catch (error) {
            // A well-formed update from a different schema generation is not garbage: say so, so the client can stop cleanly.
            const incompatible = isNoteSchemaError(error);
            metrics.inc('syncpad_updates_total', { outcome: incompatible ? 'incompatible' : 'invalid' });
            send({ type: 'sync-error', ...(requestId ? { requestId } : {}), code: incompatible ? 'incompatible-schema' : 'invalid-message', retryable: false });
            client.close(1003, incompatible ? 'Incompatible schema version' : 'Invalid sync message');
          }
        };
        let closed = false;
        let joinedAt: number | undefined;
        // Listeners are attached before the room loads so an eager handshake is queued, not dropped.
        let ready: Promise<NoteRoom | undefined> = getRoom(noteId).then(async (room) => {
          if (closed || revoked) return undefined;
          if (room.clients.size >= limits.maxClientsPerRoom) {
            onLimit({ limit: 'room-full', noteId, max: limits.maxClientsPerRoom });
            send({ type: 'sync-error', code: 'room-full', retryable: true });
            client.close(1013, 'Room is full');
            return undefined;
          }
          room.clients.set(client, participant);
          joinedRoom = room;
          joinedAt = Date.now();
          metrics.inc('syncpad_connections_total');
          const lostAt = recentDisconnects.get(`${noteId}:${participant.userId}`);
          const reconnect = lostAt !== undefined && joinedAt - lostAt < RECONNECT_WINDOW_MS;
          if (reconnect) metrics.inc('syncpad_reconnects_total');
          logger.info('ws connected', { roomId: noteId, connectionId, userId: participant.userId, reconnect, clients: room.clients.size });
          await enqueue(room, async () => send(snapshot(room)));
          broadcastAwareness(room);
          return room;
        }, (error: unknown) => {
          // Stored history this build cannot read (e.g. after a rollback) must not be retried or overwritten.
          if (isNoteSchemaError(error)) {
            send({ type: 'sync-error', code: 'incompatible-schema', retryable: false });
            client.close(1011, 'Incompatible schema version');
            return undefined;
          }
          send({ type: 'sync-error', code: 'persistence-unavailable', retryable: true });
          client.close(1011, 'Note storage unavailable');
          return undefined;
        });
        const allowance = createRateLimiter(limits.messagesPerSecond, limits.messageBurst);
        client.on('message', (raw) => {
          if (!allowance.take()) {
            onLimit({ limit: 'rate', noteId });
            // Past its allowance the connection is cut before any work is queued; the client backs off and reconnects.
            if (client.readyState === client.OPEN) {
              client.send(JSON.stringify({ type: 'sync-error', code: 'rate-limited', retryable: true } satisfies ServerSyncMessage));
              client.close(1008, 'Rate limit exceeded');
            }
            return;
          }
          ready = ready.then(async (room) => {
            if (room) await handle(room, raw);
            return room;
          });
        });
        client.once('close', (code) => {
          closed = true;
          guards.delete(guard);
          metrics.inc('syncpad_connection_closes_total', { code });
          if (joinedAt !== undefined) {
            const now = Date.now();
            recentDisconnects.set(`${noteId}:${participant.userId}`, now);
            if (recentDisconnects.size > 1000) for (const [key, at] of recentDisconnects) if (now - at >= RECONNECT_WINDOW_MS) recentDisconnects.delete(key);
            logger.info('ws closed', { roomId: noteId, connectionId, code, durationMs: now - joinedAt });
          }
          void ready.then((room) => {
            if (!room) return;
            room.clients.delete(client);
            broadcastAwareness(room);
          });
        });
      });
    })().catch(() => rejectUpgrade(socket, 403));
  });
  function close(): Promise<void> {
    clearInterval(heartbeat);
    clearInterval(permissionSweep);
    closing ??= new Promise<void>((resolve, reject) => {
      const deadline = setTimeout(() => {
        for (const client of wss.clients) client.terminate();
        for (const socket of sockets) socket.destroy();
      }, 1000);
      deadline.unref();
      for (const client of wss.clients) client.close(1001, 'Server shutting down');
      const httpClosed = new Promise<void>((done, fail) => {
        server.close((error) => {
          if (error && (error as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') fail(error);
          else done();
        });
      });
      const wsClosed = new Promise<void>((done) => wss.close(() => done()));
      Promise.all([httpClosed, wsClosed]).then(() => {
        clearTimeout(deadline);
        resolve();
      }, (error) => {
        clearTimeout(deadline);
        reject(error);
      });
    });
    return closing;
  }
  return { server, close };
}
