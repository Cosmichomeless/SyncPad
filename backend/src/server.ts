import { createServer } from 'node:http';
import type { Duplex } from 'node:stream';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import type WebSocket from 'ws';
import type { HealthResponse } from '@syncpad/shared';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, encodeNoteStateSince } from '@syncpad/shared';
import type { NoteId } from '@syncpad/shared';
import { handleAuthRequest } from './auth-http.js';
import type { AuthService } from './auth.js';
import { applyCors, isAllowedOrigin, rejectCors, type SecurityConfig } from './security.js';
import { handleWorkspaceRequest } from './workspace-http.js';
import type { WorkspaceService } from './workspaces.js';
import { handleNoteRequest } from './note-http.js';
import type { NoteService } from './notes.js';
import { isNoteId } from './notes.js';
import type { SyncStore } from './sync-store.js';

function cookieValue(header: string | undefined, name: string) {
  return header?.split(';').map((part) => part.trim()).find((part) => part.startsWith(name + '='))?.slice(name.length + 1);
}

function rejectUpgrade(socket: Duplex, status: number) {
  socket.end(`HTTP/1.1 ${status} ${status === 401 ? 'Unauthorized' : 'Forbidden'}\r\nConnection: close\r\n\r\n`);
}

type RoomMessage =
  | { type: 'sync-request'; stateVector?: string }
  | { type: 'update'; update: string };

type NoteRoom = {
  document: ReturnType<typeof createNoteDocument>;
  clients: Set<WebSocket>;
};

function encode(data: Uint8Array) {
  return Buffer.from(data).toString('base64');
}

function decode(value: string) {
  return new Uint8Array(Buffer.from(value, 'base64'));
}

export function createSyncServer(options: { auth?: AuthService; security?: SecurityConfig; workspaces?: WorkspaceService; notes?: NoteService; syncStore?: SyncStore } = {}) {
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
          'access-control-allow-methods': 'GET,POST,OPTIONS',
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
      }).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (options.auth && options.notes && ((req.url?.startsWith('/workspaces/') && req.url?.includes('/notes')) || req.url?.startsWith('/notes/'))) {
      void handleNoteRequest(req, res, options.auth, options.notes).catch(() => {
        if (!res.headersSent) res.writeHead(500).end();
      });
      return;
    }
    if (options.auth && options.workspaces && (req.url?.startsWith('/workspaces') || req.url?.startsWith('/invitations'))) {
      void handleWorkspaceRequest(req, res, options.auth, options.workspaces).catch(() => {
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
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const rooms = new Map<string, Promise<NoteRoom>>();
  const getRoom = (noteId: NoteId) => {
    let room = rooms.get(noteId);
    if (!room) {
      room = (async () => {
        const created = { document: createNoteDocument(), clients: new Set<WebSocket>() };
        if (options.syncStore) {
          for (const update of await options.syncStore.load(noteId)) applyNoteUpdate(created.document.doc, update);
        }
        return created;
      })();
      rooms.set(noteId, room);
    }
    return room;
  };
  let closing: Promise<void> | undefined;
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
      if (options.auth && options.notes) {
        const url = new URL(req.url, `http://${req.headers.host ?? 'localhost'}`);
        const noteId = url.searchParams.get('noteId');
        const token = cookieValue(req.headers.cookie, 'syncpad_session');
        if (!token || !noteId || !isNoteId(noteId)) {
          rejectUpgrade(socket, 401);
          return;
        }
        const user = await options.auth.getUserBySession(decodeURIComponent(token));
        if (!user) {
          rejectUpgrade(socket, 401);
          return;
        }
        if (!(await options.notes.canAccess(user.id, noteId))) {
          rejectUpgrade(socket, 403);
          return;
        }
      }
      wss.handleUpgrade(req, socket, head, async (client) => {
        if (!options.auth || !options.notes) {
          client.on('error', () => client.terminate());
          return;
        }
        const noteIdValue = new URL(req.url ?? '/ws', `http://${req.headers.host ?? 'localhost'}`).searchParams.get('noteId');
        const noteId = noteIdValue && isNoteId(noteIdValue) ? noteIdValue : undefined;
        const room = noteId ? await getRoom(noteId) : undefined;
        if (!room) {
          client.close(1008, 'noteId is required');
          return;
        }
        room.clients.add(client);
        client.send(JSON.stringify({ type: 'sync', update: encode(encodeNoteState(room.document.doc)) }));
        client.on('message', async (raw) => {
          try {
            const message = JSON.parse(raw.toString()) as RoomMessage;
            if (message.type === 'sync-request') {
              const update = message.stateVector
                ? encodeNoteStateSince(room.document.doc, decode(message.stateVector))
                : encodeNoteState(room.document.doc);
              client.send(JSON.stringify({ type: 'sync', update: encode(update) }));
              return;
            }
            if (message.type === 'update') {
              const update = decode(message.update);
              applyNoteUpdate(room.document.doc, update);
              if (options.syncStore && noteId) await options.syncStore.append(noteId, update);
              const payload = JSON.stringify({ type: 'update', update: message.update });
              for (const peer of room.clients) if (peer !== client && peer.readyState === peer.OPEN) peer.send(payload);
            }
          } catch {
            client.close(1003, 'Invalid sync message');
          }
        });
        client.once('close', () => room.clients.delete(client));
        client.on('error', () => client.terminate());
      });
    })().catch(() => rejectUpgrade(socket, 403));
  });
  function close(): Promise<void> {
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
