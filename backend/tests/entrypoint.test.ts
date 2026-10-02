import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import test from 'node:test';
import WebSocket from 'ws';

const entry = process.env.SYNCPAD_TEST_BUILT === '1'
  ? ['dist/index.js'] : ['--import', 'tsx', 'src/index.ts'];

test('executable serves HTTP/WS and exits cleanly on SIGTERM', { timeout: 6000 }, async (t) => {
  const reservation = createServer();
  reservation.listen(0, '127.0.0.1');
  await once(reservation, 'listening');
  const port = (reservation.address() as AddressInfo).port;
  await new Promise<void>((resolve) => reservation.close(() => resolve()));
  const child = spawn(process.execPath, entry, {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => { if (child.exitCode === null) child.kill('SIGKILL'); });
  const exited = once(child, 'exit');
  let output = '';
  const ready = new Promise<void>((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
      if (output.includes('SyncPad listening')) resolve();
    });
    child.once('error', reject);
    child.once('exit', (code) => reject(new Error('Exited before ready: ' + code)));
  });
  await ready;
  assert.deepEqual(await (await fetch('http://127.0.0.1:' + port + '/health')).json(), { status: 'ok' });
  const client = new WebSocket('ws://127.0.0.1:' + port + '/ws');
  t.after(() => client.terminate());
  await once(client, 'open');
  const closed = once(client, 'close');
  child.kill('SIGTERM');
  assert.equal((await closed)[0], 1001);
  assert.equal((await exited)[0], 0);
});

test('invalid executable configuration fails without exposing values', { timeout: 3000 }, async () => {
  const child = spawn(process.execPath, entry, { env: { ...process.env, PORT: 'private-invalid-value' } });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const [code] = await once(child, 'close');
  assert.equal(code, 1);
  assert.match(stderr, /PORT/);
  assert.doesNotMatch(stderr, /private-invalid-value/);
});
