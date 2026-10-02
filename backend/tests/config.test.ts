import assert from 'node:assert/strict';
import test from 'node:test';
import { loadConfig } from '../src/config.js';

test('configuration defaults to loopback and port 3001', () => {
  assert.deepEqual(loadConfig({}), { host: '127.0.0.1', port: 3001 });
});
test('configuration accepts explicit host and valid port', () => {
  assert.deepEqual(loadConfig({ HOST: 'localhost', PORT: '4321' }), { host: 'localhost', port: 4321 });
});
for (const port of ['', '0', '-1', '65536', '1.5', '12junk', 'Infinity', ' 3001']) {
  test('configuration rejects invalid PORT ' + JSON.stringify(port), () => {
    assert.throws(() => loadConfig({ PORT: port }), /PORT/);
  });
}
test('configuration rejects an empty host', () => {
  assert.throws(() => loadConfig({ HOST: '  ' }), /HOST/);
});
