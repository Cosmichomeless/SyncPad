// Smoke test for a running stack (Docker Compose or local): two "browsers" (two separate
// sessions of one account) open the same note over WebSocket and one edit reaches the other.
//
// Run from backend/ so tsx and ws resolve:
//   cd backend && npx tsx ../scripts/smoke-stack.mts [--wait-close]
//
// Environment: SYNCPAD_API_URL (default http://127.0.0.1:3001), SYNCPAD_WS_URL (default derived
// from the API URL), SYNCPAD_ORIGIN (default http://127.0.0.1:3000, must equal the backend CORS_ORIGIN),
// SYNCPAD_WEB_URL (optional: also check that the frontend answers).
// --wait-close keeps the first socket open and prints the close code (graceful shutdown check).
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, NOTE_CONTENT_NAME } from '../shared/src/index.js';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const WebSocket = require('ws') as typeof import('ws').WebSocket;

const apiUrl = (process.env.SYNCPAD_API_URL ?? 'http://127.0.0.1:3001').replace(/\/$/, '');
const wsUrl = process.env.SYNCPAD_WS_URL ?? apiUrl.replace(/^http/, 'ws') + '/ws';
const origin = process.env.SYNCPAD_ORIGIN ?? 'http://127.0.0.1:3000';
const webUrl = process.env.SYNCPAD_WEB_URL;
const waitClose = process.argv.includes('--wait-close');

function fail(message: string): never {
  console.error('FAIL: ' + message);
  process.exit(1);
}

/** A tiny cookie-jar client: one instance behaves like one browser. */
class Browser {
  private cookies = new Map<string, string>();

  private store(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      const [pair] = line.split(';');
      const index = pair.indexOf('=');
      this.cookies.set(pair.slice(0, index), pair.slice(index + 1));
    }
  }

  get cookieHeader() {
    return [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ');
  }

  async request(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { origin, cookie: this.cookieHeader };
    if (method !== 'GET') {
      headers['x-csrf-token'] = decodeURIComponent(this.cookies.get('syncpad_csrf') ?? '');
      headers['content-type'] = 'application/json';
    }
    const response = await fetch(apiUrl + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.store(response);
    return response;
  }

  async login(email: string, password: string, register: boolean) {
    this.store(await fetch(apiUrl + '/auth/csrf', { headers: { origin } }));
    const response = await this.request('POST', register ? '/auth/register' : '/auth/login', { email, password });
    if (!response.ok) fail(`${register ? 'register' : 'login'} returned ${response.status}`);
  }
}

type Socket = InstanceType<typeof WebSocket>;

/** Resolves once the socket is open and the server's initial `sync` message arrived (listening starts before `open`). */
function connect(browser: Browser, noteId: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}?noteId=${noteId}`, { headers: { origin, cookie: browser.cookieHeader } });
    void nextMessage(socket, 'sync').then(() => resolve(socket));
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => reject(new Error('WebSocket rejected with HTTP ' + response.statusCode)));
  });
}

function nextMessage(socket: Socket, type: string): Promise<{ type: string; update?: string }> {
  return new Promise((resolve) => {
    const onMessage = (raw: unknown) => {
      const message = JSON.parse(String(raw)) as { type: string; update?: string };
      if (message.type === type) { socket.off('message', onMessage); resolve(message); }
    };
    socket.on('message', onMessage);
  });
}

const deadline = setTimeout(() => fail('timed out'), 20_000);

const health = await fetch(apiUrl + '/health');
if (!health.ok) fail('/health returned ' + health.status);
console.log('health:', JSON.stringify(await health.json()));

if (webUrl) {
  const page = await fetch(webUrl);
  if (!page.ok || !(await page.text()).includes('auth-shell')) fail('frontend did not serve the login shell');
  console.log('frontend: login shell served');
}

const email = `smoke-${randomUUID()}@example.test`;
const password = 'smoke-test-password';
const first = new Browser();
await first.login(email, password, true);
const second = new Browser();
await second.login(email, password, false);

const workspace = ((await (await first.request('POST', '/workspaces', { name: 'Smoke' })).json()) as { workspace: { id: string } }).workspace;
const note = ((await (await first.request('POST', `/workspaces/${workspace.id}/notes`, { title: 'Smoke note' })).json()) as { note: { id: string } }).note;

const socketA = await connect(first, note.id);
const socketB = await connect(second, note.id);

const local = createNoteDocument();
local.content.insert(0, 'hello from browser A');
const requestId = randomUUID();
const incoming = nextMessage(socketB, 'update');
const acknowledged = nextMessage(socketA, 'ack');
socketA.send(JSON.stringify({ type: 'update', requestId, update: Buffer.from(encodeNoteState(local.doc)).toString('base64') }));
await acknowledged;
const update = await incoming;

const remote = createNoteDocument();
applyNoteUpdate(remote.doc, Buffer.from(update.update ?? '', 'base64'));
const text = remote.doc.getText(NOTE_CONTENT_NAME).toString();
if (text !== 'hello from browser A') fail('browser B saw ' + JSON.stringify(text));
console.log('edit: browser A -> persisted (ack) -> browser B received', JSON.stringify(text));
clearTimeout(deadline);

if (waitClose) {
  socketA.on('close', (code, reason) => {
    console.log(`close: code=${code} reason=${reason.toString()}`);
    process.exit(0);
  });
  console.log('ready: waiting for the server to close the connection');
} else {
  socketA.close();
  socketB.close();
  console.log('OK');
}
