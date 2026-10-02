import assert from 'node:assert/strict';
import test from 'node:test';
import { SYNC_PROTOCOL_VERSION } from '@syncpad/shared';

test('backend consumes the shared sync protocol version', () => {
  assert.equal(SYNC_PROTOCOL_VERSION, 1);
});