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
test('CORS preflight permits note mutations only from the configured origin', { timeout: 3000 }, async (t) => {
  const origin = 'http://127.0.0.1:3000';
  const app = createSyncServer({ security: { corsOrigin: origin, cookieSecure: false, cookieSameSite: 'Lax' } });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  t.after(() => app.close());
  const url = 'http://127.0.0.1:' + (app.server.address() as AddressInfo).port + '/notes/123e4567-e89b-12d3-a456-426614174001';
  for (const method of ['PATCH', 'DELETE']) {
    const response = await fetch(url, { method: 'OPTIONS', headers: { origin, 'access-control-request-method': method, 'access-control-request-headers': 'content-type,x-csrf-token' } });
    assert.equal(response.status, 204);
    assert.equal(response.headers.get('access-control-allow-origin'), origin);
    assert.equal(response.headers.get('access-control-allow-credentials'), 'true');
    assert.ok(response.headers.get('access-control-allow-methods')?.split(',').includes(method));
  }
  const denied = await fetch(url, { method: 'OPTIONS', headers: { origin: 'https://untrusted.example', 'access-control-request-method': 'PATCH' } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get('access-control-allow-origin'), null);
});
