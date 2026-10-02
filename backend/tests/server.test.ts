import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AddressInfo } from 'node:net';
import WebSocket from 'ws';
import { createSyncServer } from '../src/server.js';

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const app = createSyncServer();
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const port = (app.server.address() as AddressInfo).port;
  return { ...app, http: 'http://127.0.0.1:' + port, ws: 'ws://127.0.0.1:' + port };
}
test('GET /health returns JSON health status', { timeout: 3000 }, async (t) => {
  const app = await fixture(t);
  const res = await fetch(app.http + '/health');
  assert.equal(res.status, 200);
  assert.ok(res.headers.get('content-type')?.includes('application/json'));
  assert.deepEqual(await res.json(), { status: 'ok' });
});
test('unknown route returns 404', { timeout: 3000 }, async (t) => {
  const app = await fixture(t);
  assert.equal((await fetch(app.http + '/missing')).status, 404);
});
test('/ws accepts a real connection and shutdown closes it', { timeout: 4000 }, async (t) => {
  const app = await fixture(t);
  const client = new WebSocket(app.ws + '/ws');
  t.after(async () => { client.terminate(); });
  await once(client, 'open');
  const disconnected = once(client, 'close');
  await app.close();
  const [code] = await disconnected;
  assert.equal(code, 1001);
  assert.equal(app.server.listening, false);
});
test('other websocket paths are rejected', { timeout: 3000 }, async (t) => {
  const app = await fixture(t);
  const client = new WebSocket(app.ws + '/other');
  t.after(async () => { client.terminate(); });
  const [error] = await once(client, 'error');
  assert.match(error.message, /Unexpected server response: 404/);
});
