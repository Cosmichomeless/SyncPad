import assert from 'node:assert/strict';
import test from 'node:test';
import { SYNC_PROTOCOL_VERSION } from './index.js';

test('the sync protocol has an explicit version', () => {
  assert.equal(SYNC_PROTOCOL_VERSION, 1);
});