import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import type { AuthService } from '../src/auth.js';
import { createSyncServer } from '../src/server.js';
import { loadSecurityConfig } from '../src/security.js';

function fakeAuth(): AuthService {
  let validToken = 'session-token';
  const user = { id: 'user-1' as never, email: 'person@example.com' };
  return {
    async register() { return user; },
    async authenticate(_email, password) { return password === 'correct-password' ? user : null; },
    async createSession() { return validToken; },
    async getUserBySession(token) { return token === validToken ? user : null; },
    async invalidateSession() { validToken = ''; },
  };
}

async function fixture() {
  const app = createSyncServer({ auth: fakeAuth(), security: loadSecurityConfig({}) });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address() as { port: number };
  return { app, url: `http://127.0.0.1:${address.port}` };
}

test('register, current user and logout use the session cookie', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const csrf = await fetch(url + '/auth/csrf');
  const csrfToken = (await csrf.json() as { csrfToken: string }).csrfToken;
  const csrfCookie = csrf.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const register = await fetch(url + '/auth/register', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: csrfCookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ email: 'person@example.com', password: 'correct-password' }),
  });
  assert.equal(register.status, 201);
  const cookie = register.headers.get('set-cookie');
  assert.match(cookie ?? '', /syncpad_session=session-token/);
  assert.deepEqual(await register.json(), { user: { id: 'user-1', email: 'person@example.com' } });

  const current = await fetch(url + '/auth/me', { headers: { cookie: cookie ?? '' } });
  assert.equal(current.status, 200);
  const logout = await fetch(url + '/auth/logout', {
    method: 'POST',
    headers: { cookie: `${cookie?.split(';', 1)[0]}; ${csrfCookie}`, 'x-csrf-token': csrfToken },
  });
  assert.equal(logout.status, 204);
  const afterLogout = await fetch(url + '/auth/me', { headers: { cookie: cookie ?? '' } });
  assert.equal(afterLogout.status, 401);
});

test('invalid login does not return a session cookie', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const csrf = await fetch(url + '/auth/csrf');
  const csrfToken = (await csrf.json() as { csrfToken: string }).csrfToken;
  const csrfCookie = csrf.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
  const response = await fetch(url + '/auth/login', {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: csrfCookie, 'x-csrf-token': csrfToken },
    body: JSON.stringify({ email: 'person@example.com', password: 'wrong-password' }),
  });
  assert.equal(response.status, 401);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('mutating requests require CSRF and mismatched origins are rejected', { timeout: 3000 }, async (t) => {
  const { app, url } = await fixture();
  t.after(() => app.close());
  const missingCsrf = await fetch(url + '/auth/logout', { method: 'POST' });
  assert.equal(missingCsrf.status, 403);
  const forbiddenOrigin = await fetch(url + '/auth/csrf', { headers: { origin: 'https://attacker.example' } });
  assert.equal(forbiddenOrigin.status, 403);
});