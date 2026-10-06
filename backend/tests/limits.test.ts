import assert from 'node:assert/strict';
import test from 'node:test';
import { createRateLimiter, DEFAULT_LIMITS, loadLimits } from '../src/limits.js';

test('limits default when the environment is silent', () => {
  assert.deepEqual(loadLimits({}), DEFAULT_LIMITS);
  assert.deepEqual(loadLimits({ SYNC_MAX_NOTE_CHARS: '' }), DEFAULT_LIMITS);
});

test('limits can be overridden from the environment', () => {
  const limits = loadLimits({ SYNC_MAX_NOTE_CHARS: '1000', SYNC_MAX_CLIENTS_PER_ROOM: '3', SYNC_HEARTBEAT_MS: '0' });
  assert.equal(limits.maxNoteChars, 1000);
  assert.equal(limits.maxClientsPerRoom, 3);
  assert.equal(limits.heartbeatMs, 0);
  assert.equal(limits.messagesPerSecond, DEFAULT_LIMITS.messagesPerSecond);
});

test('invalid limits fail startup naming the variable', () => {
  for (const [name, value] of [['SYNC_MAX_NOTE_CHARS', '0'], ['SYNC_MAX_NOTE_CHARS', '-5'], ['SYNC_MAX_CLIENTS_PER_ROOM', 'many'], ['SYNC_MAX_MESSAGE_BYTES', '10'], ['SYNC_MESSAGE_BURST', '1.5']]) {
    assert.throws(() => loadLimits({ [name]: value }), new RegExp(name));
  }
});

test('the token bucket allows a burst, then refills at the sustained rate', () => {
  let now = 0;
  const limiter = createRateLimiter(2, 3, () => now);
  assert.deepEqual([limiter.take(), limiter.take(), limiter.take(), limiter.take()], [true, true, true, false]);
  now += 500; // one token back
  assert.deepEqual([limiter.take(), limiter.take()], [true, false]);
  now += 60_000; // never exceeds the burst
  assert.deepEqual([limiter.take(), limiter.take(), limiter.take(), limiter.take()], [true, true, true, false]);
});
