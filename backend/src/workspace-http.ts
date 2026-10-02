import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from './auth.js';
import { getSessionToken } from './auth-http.js';
import { hasValidCsrf } from './security.js';
import { isWorkspaceId, type WorkspaceService } from './workspaces.js';

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readField(request: IncomingMessage, field: string) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>)[field] !== 'string') {
    throw new Error(`${field} is required`);
  }
  return (body as Record<string, string>)[field];
}

export async function handleWorkspaceRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: AuthService,
  workspaces: WorkspaceService,
) {
  const path = request.url?.split('?')[0] ?? '';
  if (!path.startsWith('/workspaces') && !path.startsWith('/invitations')) return false;
  const parts = path.split('/').filter(Boolean);
  const token = getSessionToken(request);
  const user = token ? await auth.getUserBySession(token) : null;
  if (!user) {
    sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    return true;
  }

  if (parts[0] === 'invitations' && parts.length === 3 && parts[2] === 'accept' && request.method === 'POST') {
    if (!hasValidCsrf(request)) {
      sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
      return true;
    }
    try {
      const workspaceId = await workspaces.acceptInvitation(parts[1], user.id, user.email);
      sendJson(response, 200, { workspaceId });
    } catch (error) {
      sendJson(response, 400, { error: { code: 'INVITATION_INVALID', message: error instanceof Error ? error.message : 'Invitation is invalid' } });
    }
    return true;
  }

  if (parts[0] === 'workspaces' && parts.length === 3 && parts[2] === 'invitations' && request.method === 'POST') {
    if (!hasValidCsrf(request)) {
      sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
      return true;
    }
    if (!isWorkspaceId(parts[1])) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
      return true;
    }
    try {
      const invitation = await workspaces.invite(parts[1], user.id, await readField(request, 'email'));
      sendJson(response, 201, { invitation });
    } catch (error) {
      const forbidden = error instanceof Error && error.message.includes('OWNER');
      sendJson(response, forbidden ? 403 : 400, { error: { code: forbidden ? 'FORBIDDEN' : 'INVALID_REQUEST', message: error instanceof Error ? error.message : 'Invalid invitation' } });
    }
    return true;
  }

  if (parts[0] === 'workspaces' && parts.length === 4 && parts[2] === 'members' && request.method === 'DELETE') {
    if (!hasValidCsrf(request)) {
      sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
      return true;
    }
    if (!isWorkspaceId(parts[1])) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
      return true;
    }
    try {
      await workspaces.removeMember(parts[1], user.id, parts[3] as never);
      response.writeHead(204).end();
    } catch (error) {
      sendJson(response, 403, { error: { code: 'FORBIDDEN', message: error instanceof Error ? error.message : 'Member cannot be removed' } });
    }
    return true;
  }

  if (parts.length === 1 && request.method === 'POST') {
    if (!hasValidCsrf(request)) {
      sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
      return true;
    }
    try {
      const workspace = await workspaces.create(user.id, await readField(request, 'name'));
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