import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import type { HealthResponse } from '@syncpad/shared';
import { handleAuthRequest } from './auth-http.js';
import type { AuthService } from './auth.js';
import { applyCors, isAllowedOrigin, rejectCors, type SecurityConfig } from './security.js';
import { handleWorkspaceRequest } from './workspace-http.js';
import type { WorkspaceService } from './workspaces.js';

export function createSyncServer(options: { auth?: AuthService; security?: SecurityConfig; workspaces?: WorkspaceService } = {}) {
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
    if (options.auth && options.workspaces && req.url?.startsWith('/workspaces')) {
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
  let closing: Promise<void> | undefined;
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  server.on('upgrade', (req, socket, head) => {
    if (closing || req.url !== '/ws' || (options.security && !isAllowedOrigin(req.headers.origin, options.security))) {
      socket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    wss.handleUpgrade(req, socket, head, (client) => {
      // No messages are interpreted until the versioned sync protocol is added.
      client.on('error', () => client.terminate());
    });
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
