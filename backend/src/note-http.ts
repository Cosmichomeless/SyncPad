import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthService } from './auth.js';
import { getSessionToken } from './auth-http.js';
import { hasValidCsrf } from './security.js';
import { isNoteId, type NoteService } from './notes.js';
import { isWorkspaceId } from './workspaces.js';

function sendJson(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

async function readTitle(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16 * 1024) throw new Error('Request body is too large');
    chunks.push(buffer);
  }
  const body: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).title !== 'string') {
    throw new Error('title is required');
  }
  return (body as { title: string }).title;
}

export async function handleNoteRequest(
  request: IncomingMessage,
  response: ServerResponse,
  auth: AuthService,
  notes: NoteService,
) {
  const path = request.url?.split('?')[0] ?? '';
  if (!path.startsWith('/workspaces/') && !path.startsWith('/notes/')) return false;
  const parts = path.split('/').filter(Boolean);
  const token = getSessionToken(request);
  const user = token ? await auth.getUserBySession(token) : null;
  if (!user) {
    sendJson(response, 401, { error: { code: 'UNAUTHENTICATED', message: 'Authentication required' } });
    return true;
  }

  if (parts[0] === 'workspaces' && parts.length === 3 && parts[2] === 'notes') {
    if (!isWorkspaceId(parts[1])) {
      sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
      return true;
    }
    if (request.method === 'GET') {
      const workspaceNotes = await notes.listForUser(user.id, parts[1]);
      if (!workspaceNotes) sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
      else sendJson(response, 200, { notes: workspaceNotes });
      return true;
    }
    if (request.method === 'POST') {
      if (!hasValidCsrf(request)) {
        sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
        return true;
      }
      try {
        const note = await notes.create(user.id, parts[1], await readTitle(request));
        if (!note) sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Workspace not found' } });
        else sendJson(response, 201, { note });
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Invalid note title' } });
      }
      return true;
    }
  }

  if (parts[0] === 'notes' && parts.length === 2 && isNoteId(parts[1])) {
    if (request.method === 'PATCH') {
      if (!hasValidCsrf(request)) {
        sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
        return true;
      }
      try {
        const note = await notes.rename(user.id, parts[1], await readTitle(request));
        if (!note) sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Note not found' } });
        else sendJson(response, 200, { note });
      } catch {
        sendJson(response, 400, { error: { code: 'INVALID_REQUEST', message: 'Invalid note title' } });
      }
      return true;
    }
    if (request.method === 'DELETE') {
      if (!hasValidCsrf(request)) {
        sendJson(response, 403, { error: { code: 'CSRF_REQUIRED', message: 'Valid CSRF token required' } });
        return true;
      }
      if (!(await notes.delete(user.id, parts[1]))) sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Note not found' } });
      else response.writeHead(204).end();
      return true;
    }
  }

  sendJson(response, 404, { error: { code: 'NOT_FOUND', message: 'Note not found' } });
  return true;
}