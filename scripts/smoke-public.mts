// Smoke test for the PUBLIC deployment (docs/deployment.md, #68). One URL in, one verdict out:
//   cd backend && npx tsx ../scripts/smoke-public.mts https://<service>.onrender.com
// It wakes a sleeping free-tier service (up to 150 s), then checks what only the real HTTPS
// origin can show: the session cookie is Secure + HttpOnly + SameSite=Lax, the WebSocket runs
// over wss, an edit reaches a second browser, the text is still there after every socket was
// closed and a fresh browser logged in, and a foreign Origin is refused.
// Local rehearsal: run deploy/Dockerfile without COOKIE_SECURE=false and pass http://127.0.0.1:<port>.
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { applyNoteUpdate, createNoteDocument, encodeNoteState, NOTE_CONTENT_NAME } from '../shared/src/index.js';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const WebSocket = require('ws') as typeof import('ws').WebSocket;

const base = (process.argv[2] ?? process.env.SYNCPAD_PUBLIC_URL ?? '').replace(/\/$/, '');
if (!/^https?:\/\//.test(base)) {
  console.error('usage: smoke-public.mts <https://public-url>');
  process.exit(2);
}
const origin = new URL(base).origin;
const wsUrl = base.replace(/^http/, 'ws') + '/ws';
const secureExpected = base.startsWith('https://');

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
  if (!ok) failures++;
}
function finish(): never {
  console.log(failures === 0 ? 'OK' : `${failures} check(s) failed`);
  process.exit(failures === 0 ? 0 : 1);
}

class Browser {
  private cookies = new Map<string, string>();
  rawCookies: string[] = [];

  private store(response: Response) {
    for (const line of response.headers.getSetCookie()) {
      this.rawCookies.push(line);
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
    const response = await fetch(base + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    this.store(response);
    return response;
  }
  async login(email: string, password: string, register: boolean) {
    this.store(await fetch(base + '/auth/csrf', { headers: { origin } }));
    const response = await this.request('POST', register ? '/auth/register' : '/auth/login', { email, password });
    if (!response.ok) { check(register ? 'register' : 'login', false, `HTTP ${response.status}`); finish(); }
  }
}

type Message = { type: string; update?: string };
type Socket = InstanceType<typeof WebSocket>;

function nextMessage(socket: Socket, type: string): Promise<Message> {
  return new Promise((resolve) => {
    const onMessage = (raw: unknown) => {
      const message = JSON.parse(String(raw)) as Message;
      if (message.type === type) { socket.off('message', onMessage); resolve(message); }
    };
    socket.on('message', onMessage);
  });
}

function connect(browser: Browser, noteId: string, headers: Record<string, string> = {}) {
  return new Promise<{ socket: Socket; sync: Message }>((resolve, reject) => {
    const socket = new WebSocket(`${wsUrl}?noteId=${noteId}`, { headers: { origin, cookie: browser.cookieHeader, ...headers } });
    void nextMessage(socket, 'sync').then((sync) => resolve({ socket, sync }));
    socket.once('error', reject);
    socket.once('unexpected-response', (_request, response) => reject(new Error('HTTP ' + response.statusCode)));
  });
}

function textOf(update?: string) {
  const doc = createNoteDocument();
  applyNoteUpdate(doc.doc, Buffer.from(update ?? '', 'base64'));
  return doc.doc.getText(NOTE_CONTENT_NAME).toString();
}

setTimeout(() => { console.error('FAIL: timed out after 240 s'); process.exit(1); }, 240_000).unref();

// 1. Wake the service: a sleeping Render instance answers only after about a minute.
const started = Date.now();
let healthy = false;
while (Date.now() - started < 150_000) {
  try {
    const response = await fetch(base + '/health', { signal: AbortSignal.timeout(10_000) });
    if (response.ok) { healthy = true; break; }
  } catch { /* still waking up */ }
  await new Promise((resolve) => setTimeout(resolve, 3_000));
}
check('/health answers', healthy, `${Math.round((Date.now() - started) / 1000)} s${Date.now() - started > 10_000 ? ' (cold start)' : ''}`);
if (!healthy) finish();

const page = await fetch(base);
check('the web app is served from the same origin', page.ok && (await page.text()).includes('auth-shell'));

// 2. Account and cookies.
const email = `smoke-${randomUUID()}@example.test`;
const password = 'smoke-test-password';
const first = new Browser();
await first.login(email, password, true);
const session = first.rawCookies.find((line) => line.startsWith('syncpad_session='));
check('session cookie is HttpOnly', /;\s*HttpOnly/i.test(session ?? ''));
check('session cookie is SameSite=Lax', /;\s*SameSite=Lax/i.test(session ?? ''));
check(secureExpected ? 'session cookie is Secure' : 'session cookie is Secure (http: header still checked)', /;\s*Secure/i.test(session ?? ''));

// 3. Two browsers, one note, over wss when the URL is https.
const second = new Browser();
await second.login(email, password, false);
const workspace = ((await (await first.request('POST', '/workspaces', { name: 'Smoke' })).json()) as { workspace: { id: string } }).workspace;
const note = ((await (await first.request('POST', `/workspaces/${workspace.id}/notes`, { title: 'Smoke note' })).json()) as { note: { id: string } }).note;

const a = await connect(first, note.id);
const b = await connect(second, note.id);
check(`WebSocket connects over ${wsUrl.split(':')[0]}`, true);
const local = createNoteDocument();
const expected = 'hello from the public smoke';
local.content.insert(0, expected);
const incoming = nextMessage(b.socket, 'update');
const acknowledged = nextMessage(a.socket, 'ack');
a.socket.send(JSON.stringify({ type: 'update', requestId: randomUUID(), update: Buffer.from(encodeNoteState(local.doc)).toString('base64') }));
await acknowledged;
check('edit acknowledged as stored', true);
check('edit reaches the second browser', textOf((await incoming).update) === expected);

// 4. Persistence: everything closed, a brand-new browser reads the note back.
a.socket.close();
b.socket.close();
await new Promise((resolve) => setTimeout(resolve, 500));
const third = new Browser();
await third.login(email, password, false);
const reopened = await connect(third, note.id);
check('the text survives a full disconnect and a new login', textOf(reopened.sync.update) === expected);
reopened.socket.close();

// 5. A page from another site cannot open the socket.
let refused = '';
try { (await connect(first, note.id, { origin: 'https://evil.example' })).socket.close(); } catch (error) { refused = (error as Error).message; }
check('a foreign Origin is refused', refused === 'HTTP 403', refused || 'connected');

finish();
