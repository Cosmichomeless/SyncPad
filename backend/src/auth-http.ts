import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from './auth.js';

const SESSION_COOKIE = 'syncpad_session';
const MAX_BODY_BYTES = 16 * 1024;

function sendJson(response: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

function parseCookies(header: string | undefined) {
  const cookies = new Map<string, string>();
  for (const part of header?.split(';') ?? []) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    cookies.set(part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim()));
  }
  return cookies;
}

async function readJson(request: IncomingMessage): Promise<{ email?: unknown; password?: unknown }> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_BODY_BYTES) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!parsed || typeof parsed !== 'object') throw new Error('Request body must be a JSON object');
  return parsed as { email?: unknown; password?: unknown };
}

function sessionCookie(token: string) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax`;
}

function clearedSessionCookie() {
  return `${SESSION_COOKIE}=; Max-Age=0; HttpOnly; Path=/; SameSite=Lax`;
}

function userResponse(user: { id: string; email: string }) {
  return { user };
}

export async function handleAuthRequest(request: IncomingMessage, response: ServerResponse, auth: AuthService) {
  const path = request.url?.split('?')[0];
  if (!path?.startsWith('/auth/')) return false;

  if (path === '/auth/register' || path === '/auth/login') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
      return true;
    }
    try {
      const body = await readJson(request);
      if (typeof body.email !== 'string' || typeof body.password !== 'string') throw new Error('Invalid credentials');
      const user = path === '/auth/register'
        ? await auth.register(body.email, body.password)
        : await auth.authenticate(body.email, body.password);
      if (!user) {
        sendJson(response, 401, { error: { code: 'INVALID_CREDENTIALS', message: 'Invalid email or password' } });
        return true;
      }
      const token = await auth.createSession(user.id);
      sendJson(response, path === '/auth/register' ? 201 : 200, userResponse(user), {
        'set-cookie': sessionCookie(token),
      });
    } catch (error) {
      const duplicate = error instanceof Error && error.name === 'EmailAlreadyRegisteredError';
      sendJson(response, duplicate ? 409 : 400, {
        error: {
          code: duplicate ? 'EMAIL_ALREADY_REGISTERED' : 'INVALID_REQUEST',
          message: duplicate ? 'Email is already registered' : 'Invalid request',
        },
      });
    }
    return true;
  }

  if (path === '/auth/me') {
    if (request.method !== 'GET') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
      return true;
    }
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    const user = token ? await auth.getUserBySession(token) : null;
    if (!user) sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    else sendJson(response, 200, userResponse(user));
    return true;
  }

  if (path === '/auth/logout') {
    if (request.method !== 'POST') {
      sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
      return true;
    }
    const token = parseCookies(request.headers.cookie).get(SESSION_COOKIE);
    if (token) await auth.invalidateSession(token);
    response.writeHead(204, { 'set-cookie': clearedSessionCookie(), 'cache-control': 'no-store' });
    response.end();
    return true;
  }

  sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
  return true;
}