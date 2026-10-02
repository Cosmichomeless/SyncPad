import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthService, hashPassword, verifyPassword, type SqlExecutor } from '../src/auth.js';

function fakeDatabase(rows: unknown[] = []): SqlExecutor & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async query(text) {
      calls.push(text);
      return { rows } as never;
    },
  };
}

test('password hashes are salted and only verify the original password', async () => {
  const first = await hashPassword('correct horse battery staple');
  const second = await hashPassword('correct horse battery staple');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('correct horse battery staple', first), true);
  assert.equal(await verifyPassword('wrong password', first), false);
  assert.equal(first.startsWith('scrypt$'), true);
});

test('invalid credentials do not authenticate or create a session', async () => {
  const database = fakeDatabase([]);
  const auth = createAuthService(database);
  assert.equal(await auth.authenticate('missing@example.com', 'password'), null);
  assert.equal(database.calls.some((query) => query.includes('INSERT INTO syncpad.sessions')), false);
});

test('session lookup and invalidation use a hashed token', async () => {
  const database = fakeDatabase([{ id: 'user-1', email: 'user@example.com' }]);
  const auth = createAuthService(database);
  const token = await auth.createSession('user-1' as never);
  assert.ok(token.length > 20);
  assert.equal(await auth.getUserBySession(token) !== null, true);
  await auth.invalidateSession(token);
  assert.equal(database.calls.some((query) => query.includes('revoked_at = now()')), true);
  assert.equal(database.calls.some((query) => query.includes('token_hash')), true);
});