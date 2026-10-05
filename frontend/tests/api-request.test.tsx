import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { HttpError, NetworkError, request, shouldHandleRequestFailure } from '../src/lib/api-request';
const original = globalThis.fetch;
afterEach(() => { globalThis.fetch = original; });
test('only fetch transport rejection is a NetworkError', async () => {
  globalThis.fetch = async () => { throw new TypeError('offline'); };
  await assert.rejects(request('/auth/me'), NetworkError);
  globalThis.fetch = async () => new Response('invalid');
  await assert.rejects(request('/auth/me'), SyntaxError);
});
for (const status of [401, 403, 404, 500]) test(`malformed HTTP ${status} stays HttpError`, async () => {
  globalThis.fetch = async () => new Response('invalid', { status });
  await assert.rejects(request('/workspaces'), (error: unknown) => error instanceof HttpError && error.status === status);
});
test('CSRF denial prevents mutation', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('invalid', { status: 403 }); };
  await assert.rejects(request('/auth/logout', { method: 'POST' }), HttpError);
  assert.equal(calls, 1);
});
test('malformed successful CSRF JSON prevents mutation without offline classification', async () => {
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Response('invalid'); };
  await assert.rejects(request('/auth/logout', { method: 'POST' }), SyntaxError);
  assert.equal(calls, 1);
});
test('successful mutation uses credentials and CSRF, and never caches HTTP responses', async () => {
  const requests: RequestInit[] = [];
  globalThis.fetch = async (_url, init) => {
    requests.push(init!);
    return requests.length === 1 ? Response.json({ csrfToken: 'csrf' }) : new Response(null, { status: 204 });
  };
  assert.equal(await request('/auth/logout', { method: 'POST' }), undefined);
  assert.equal(new Headers(requests[1].headers).get('x-csrf-token'), 'csrf');
  assert.ok(requests.every(init => init.credentials === 'include' && init.cache === 'no-store'));
});

for (const status of [401, 403, 404]) test(`late HTTP ${status} is handled after navigation changes`, () => {
  assert.equal(shouldHandleRequestFailure(new HttpError(status), false), true);
});
test('stale ordinary failures do not affect the current navigation', () => {
  assert.equal(shouldHandleRequestFailure(new HttpError(500), false), false);
  assert.equal(shouldHandleRequestFailure(new NetworkError(new Error('offline')), false), false);
  assert.equal(shouldHandleRequestFailure(new Error('parse failure'), false), false);
});
test('current navigation handles its failures', () => {
  assert.equal(shouldHandleRequestFailure(new HttpError(500), true), true);
  assert.equal(shouldHandleRequestFailure(new NetworkError(new Error('offline')), true), true);
});
