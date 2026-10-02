import { createServer } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocketServer } from 'ws';

export function createSyncServer() {
  const sockets = new Set<Socket>();
  const server = createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ status: 'ok' }));
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
    if (closing || req.url !== '/ws') {
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
