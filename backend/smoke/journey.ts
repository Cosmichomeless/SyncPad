import assert from 'node:assert/strict';
import { Account, ORIGIN, Replica, uniqueEmail, upgradeRefusal, waitFor, type Endpoint } from '../integration/client.js';

/**
 * A quick multi-client journey against a running SyncPad: two people share a note, edit it from two
 * connections and must see each other's changes. It only talks to the public HTTP and WebSocket API,
 * so it works the same against a local backend, a Compose stack or a deployed one. Every run uses
 * fresh accounts, so it needs no clean database, and it leaves no connections open.
 *
 *   SMOKE_API_URL  where the backend listens (default http://127.0.0.1:3001)
 *   SMOKE_ORIGIN   the backend's CORS_ORIGIN (default http://127.0.0.1:3000)
 *   SMOKE_WAIT_MS  how long to wait for /health to answer (default 30000)
 */
const api = (process.env.SMOKE_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const endpoint: Endpoint = {
  http: api,
  ws: (noteId) => `${api.replace(/^http/, 'ws')}/ws?noteId=${noteId}`,
  origin: process.env.SMOKE_ORIGIN ?? ORIGIN,
};
const waitMs = Number(process.env.SMOKE_WAIT_MS ?? 30000);

const cleanups: Array<() => void> = [];
const scope = { after: (fn: () => void) => void cleanups.push(fn) };

let step = 0;
const ok = (message: string) => console.log(`ok ${++step} - ${message}`);

async function waitForHealth() {
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      if ((await fetch(`${api}/health`)).status === 200) return;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) assert.fail(`${api}/health did not answer within ${waitMs} ms`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

async function journey() {
  await waitForHealth();
  ok(`the backend answers /health at ${api}`);

  const stamp = Date.now().toString(36);
  const alice = await Account.register(endpoint, uniqueEmail(`smoke-alice-${stamp}`));
  const bob = await Account.register(endpoint, uniqueEmail(`smoke-bob-${stamp}`));
  const stranger = await Account.register(endpoint, uniqueEmail(`smoke-stranger-${stamp}`));
  ok('three accounts registered');

  const workspaceId = await alice.createWorkspace('Smoke');
  const noteId = await alice.createNote(workspaceId, 'Smoke note');
  ok('the first account created a workspace and a note');

  assert.equal(await upgradeRefusal(endpoint.ws(noteId), { cookie: bob.sessionCookie, origin: endpoint.origin! }), 403, 'a non-member is refused');
  await alice.invite(workspaceId, bob);
  ok('the second account was refused until it accepted an invitation');

  const first = await Replica.join(scope, endpoint, noteId, alice);
  const second = await Replica.join(scope, endpoint, noteId, bob);
  ok('two clients are connected to the same note');

  assert.equal((await first.type('hola ')).type, 'ack');
  await second.waitForText('hola ');
  assert.equal((await second.type('mundo')).type, 'ack');
  await first.waitForText('hola mundo');
  ok('an edit from each client reached the other: both read "hola mundo"');

  const late = await Replica.join(scope, endpoint, noteId, alice);
  assert.equal(late.text, 'hola mundo');
  ok('a third connection received the saved note from the server');

  assert.equal(await upgradeRefusal(endpoint.ws(noteId), { cookie: stranger.sessionCookie, origin: endpoint.origin! }), 403, 'an unrelated account is refused');
  ok('an unrelated account cannot connect to the note');

  await waitFor(() => first.isOpen && second.isOpen && late.isOpen, 'the clients to still be connected');
}

try {
  await journey();
  console.log(`smoke passed (${step} checks)`);
} catch (error) {
  console.error(`smoke FAILED after ${step} checks: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  for (const cleanup of cleanups) cleanup();
}
