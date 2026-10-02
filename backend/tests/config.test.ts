import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';
import { loadSecurityConfig } from '../src/security.js';

test('configuration defaults to loopback and port 3001', () => {
  assert.deepEqual(loadConfig({}), {
    host: '127.0.0.1',
    port: 3001,
    databaseUrl: 'postgres://syncpad:syncpad@127.0.0.1:5432/syncpad',
  });
});
test('configuration accepts explicit host and valid port', () => {
  assert.deepEqual(loadConfig({
    HOST: 'localhost',
    PORT: '4321',
    DATABASE_URL: 'postgresql://user:password@localhost:5432/example',
  }), {
    host: 'localhost',
    port: 4321,
    databaseUrl: 'postgresql://user:password@localhost:5432/example',
  });
});
for (const port of ['', '0', '-1', '65536', '1.5', '12junk', 'Infinity', ' 3001']) {
  test('configuration rejects invalid PORT ' + JSON.stringify(port), () => {
    assert.throws(() => loadConfig({ PORT: port }), /PORT/);
  });
}
test('configuration rejects an empty host', () => {
  assert.throws(() => loadConfig({ HOST: '  ' }), /HOST/);
});

test('security configuration defaults to local CORS and non-secure cookies', () => {
  assert.deepEqual(loadSecurityConfig({}), {
    corsOrigin: 'http://127.0.0.1:3000',
    cookieSecure: false,
    cookieSameSite: 'Lax',
  });
});

test('security configuration enables secure cookies in production', () => {
  assert.equal(loadSecurityConfig({ NODE_ENV: 'production', CORS_ORIGIN: 'https://syncpad.example' }).cookieSecure, true);
});
for (const databaseUrl of ['', 'http://localhost/db', 'not-a-url']) {
  test('configuration rejects invalid DATABASE_URL ' + JSON.stringify(databaseUrl), () => {
    assert.throws(() => loadConfig({ DATABASE_URL: databaseUrl }), /DATABASE_URL/);
  });
}
