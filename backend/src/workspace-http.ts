import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from './auth.js';
import { getSessionToken } from './auth-http.js';
import { hasValidCsrf } from './security.js';
import { isWorkspaceId, type WorkspaceService } from './workspaces.js';

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readName(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || typeof (body as { name?: unknown }).name !== 'string') {
    throw new Error('Workspace name is required');
  }
  return (body as { name: string }).name;
}

export async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: AuthService,
  workspaces: WorkspaceService,
) {
  const path = request.url?.split('?')[0] ?? '';
  if (!path.startsWith('/workspaces')) return false;
  const parts = path.split('/').filter(Boolean);
  if (parts.length > 2) {
    sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Not found' } });
    return true;
  }
  const token = getSessionToken(request);
  const user = token ? await auth.getUserBySession(token) : null;
  if (!user) {
    sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    return true;
  }

  if (parts.length === 1 && request.method === 'POST') {
    if (!hasValidCsrf(request)) {
      sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
      return true;
    }
    try {
      const workspace = await workspaces.create(user.id, await readName(request));
      sendJson(response, 201, { workspace });
    } catch {
      sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Invalid workspace name' } });
    }
    return true;
  }

  if (parts.length === 1 && request.method === 'GET') {
    sendJson(response, 200, { workspaces: await workspaces.listForUser(user.id) });
    return true;
  }

  if (parts.length === 2 && request.method === 'GET') {
    if (!isWorkspaceId(parts[1])) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
      return true;
    }
    const workspace = await workspaces.getForUser(user.id, parts[1]);
    if (!workspace) sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
    else sendJson(response, 200, { workspace });
    return true;
  }

  sendJson(response, 405, { error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  return true;
}