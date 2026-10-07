import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_API_URL, DEFAULT_WS_URL, resolveApiUrl, resolveWsUrl } from '../src/lib/endpoints';

const https = { protocol: 'https:', host: 'syncpad-demo.onrender.com' };
const http = { protocol: 'http:', host: '127.0.0.1:3000' };

test('unset variables keep the local development servers', () => {
  assert.equal(resolveApiUrl(undefined), DEFAULT_API_URL);
  assert.equal(resolveWsUrl(undefined, https), DEFAULT_WS_URL);
});

test('an explicit URL is used as given, whatever the page is', () => {
  assert.equal(resolveApiUrl('https://api.example.com'), 'https://api.example.com');
  assert.equal(resolveWsUrl('wss://api.example.com/ws', http), 'wss://api.example.com/ws');
});

test('an empty API URL means the page origin (relative requests)', () => {
  assert.equal(resolveApiUrl(''), '');
  assert.equal(`${resolveApiUrl('')}/auth/csrf`, '/auth/csrf');
});

test('an empty WebSocket URL follows the page: https uses wss and http uses ws', () => {
  assert.equal(resolveWsUrl('', https), 'wss://syncpad-demo.onrender.com/ws');
  assert.equal(resolveWsUrl('', http), 'ws://127.0.0.1:3000/ws');
});
