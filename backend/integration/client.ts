import assert from 'node:assert/strict';
import { once } from 'node:events';
import type { IncomingMessage } from 'node:http';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument, encodeNoteStateSince, encodeNoteStateVector } from '@syncpad/shared';

/** Same origin the default CORS config allows; the server refuses upgrades from any other. */
export const ORIGIN = 'http://127.0.0.1:3000';
export const PASSWORD = 'password-123';

/** Where a running server listens. Real servers, throwaway test stacks and the smoke command all look like this. */
export type Endpoint = {
  http: string;
  /** WebSocket URL of one note's room. */
  ws(noteId: string): string;
  /** Origin the server's CORS config allows (defaults to ORIGIN). */
  origin?: string;
};

/** The part of node:test's context the clients need to be cleaned up; the smoke command passes its own. */
export type Scope = { after(fn: () => void): void };

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- response bodies are asserted field by field

/** A signed-in user with the cookies a browser would hold, talking to the HTTP API. */
export class Account {
  constructor(
    readonly stack: Endpoint,
    readonly id: string,
    readonly email: string,
    private session: string,
    private csrfCookie: string,
    private csrfToken: string,
  ) {}

  get sessionCookie() { return this.session; }

  static async register(stack: Endpoint, email: string) {
    const csrf = await fetchCsrf(stack.http);
    const response = await fetch(`${stack.http}/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: csrf.cookie, 'x-csrf-token': csrf.token },
      body: JSON.stringify({ email, password: PASSWORD }),
    });
    assert.equal(response.status, 201, 'registration succeeds');
    const session = response.headers.get('set-cookie')?.split(';', 1)[0] ?? '';
    assert.match(session, /^syncpad_session=/);
    const body = (await response.json()) as { user: { id: string; email: string } };
    return new Account(stack, body.user.id, body.user.email, session, csrf.cookie, csrf.token);
  }

  async request(method: string, path: string, body?: unknown): Promise<{ status: number; body: Json }> {
    const response = await fetch(`${this.stack.http}${path}`, {
      method,
      headers: { cookie: `${this.session}; ${this.csrfCookie}`, 'x-csrf-token': this.csrfToken, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await response.text();
    return { status: response.status, body: text ? (JSON.parse(text) as Json) : {} };
  }

  async createWorkspace(name: string) {
    const { status, body } = await this.request('POST', '/workspaces', { name });
    assert.equal(status, 201);
    return body.workspace.id as string;
  }

  async createNote(workspaceId: string, title: string) {
    const { status, body } = await this.request('POST', `/workspaces/${workspaceId}/notes`, { title });
    assert.equal(status, 201);
    return body.note.id as string;
  }

  /** Invites `guest` and has them accept, exactly as the two people would through the UI. */
  async invite(workspaceId: string, guest: Account) {
    const invited = await this.request('POST', `/workspaces/${workspaceId}/invitations`, { email: guest.email });
    assert.equal(invited.status, 201);
    const accepted = await guest.request('POST', `/invitations/${invited.body.invitation.token}/accept`);
    assert.equal(accepted.status, 200);
  }
}

async function fetchCsrf(http: string) {
  const response = await fetch(`${http}/auth/csrf`);
  const token = ((await response.json()) as { csrfToken: string }).csrfToken;
  return { token, cookie: response.headers.get('set-cookie')?.split(';', 1)[0] ?? '' };
}

let counter = 0;
export const uniqueEmail = (prefix: string) => `${prefix}-${process.pid}-${++counter}@example.com`;

export async function waitFor(condition: () => boolean | Promise<boolean>, label: string, ms = 5000) {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) assert.fail(`Timed out waiting for ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
}

/** The HTTP status the server answers a WebSocket upgrade with when it refuses it. */
export async function upgradeRefusal(url: string, headers: Record<string, string>) {
  const client = new WebSocket(url, { headers: { origin: ORIGIN, ...headers } });
  const [, response] = (await once(client, 'unexpected-response')) as [unknown, IncomingMessage];
  client.on('error', () => {}); // terminating a socket that never upgraded reports an error
  client.terminate();
  return response.statusCode;
}

export type Frame = { type: string; requestId?: string; update?: string; code?: string; retryable?: boolean; users?: unknown[] };

/** One connected client with its own copy of the note, kept in step with what the server sends. */
export class Replica {
  readonly doc = createNoteDocument();
  readonly seen: Frame[] = [];
  readonly closed: Promise<number>;
  private requests = 0;

  private constructor(readonly client: WebSocket) {
    this.closed = new Promise((resolve) => client.once('close', (code) => resolve(code)));
    client.on('message', (raw) => {
      const frame = JSON.parse(raw.toString()) as Frame;
      this.seen.push(frame);
      if ((frame.type === 'sync' || frame.type === 'update') && frame.update) applyNoteUpdate(this.doc.doc, Buffer.from(frame.update, 'base64'));
    });
  }

  /** Connects with the account's session and resolves once the room's first state has arrived. */
  static async join(t: Scope, stack: Endpoint, noteId: string, account: Account) {
    const client = new WebSocket(stack.ws(noteId), { headers: { cookie: account.sessionCookie, origin: stack.origin ?? ORIGIN } });
    t.after(() => client.terminate());
    const replica = new Replica(client);
    await once(client, 'open');
    await waitFor(() => replica.seen.some((frame) => frame.type === 'sync'), 'the first sync frame');
    return replica;
  }

  get text() { return this.doc.content.toString(); }

  get isOpen() { return this.client.readyState === WebSocket.OPEN; }

  /** Appends text locally and sends only that change; resolves with the server's verdict for the request. */
  async type(text: string) {
    const before = encodeNoteStateVector(this.doc.doc);
    this.doc.content.insert(this.doc.content.length, text);
    return this.send(Buffer.from(encodeNoteStateSince(this.doc.doc, before)).toString('base64'));
  }

  async send(update: string) {
    const requestId = `r${++this.requests}`;
    this.client.send(JSON.stringify({ type: 'update', requestId, update }));
    await waitFor(() => this.seen.some((frame) => frame.requestId === requestId), `the answer to ${requestId}`);
    return this.seen.find((frame) => frame.requestId === requestId)!;
  }

  async waitForText(expected: string) {
    await waitFor(() => this.text === expected, `the note to read ${JSON.stringify(expected)} (it reads ${JSON.stringify(this.text)})`);
  }
}
