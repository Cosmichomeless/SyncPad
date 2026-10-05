const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

export class HttpError extends Error {
  constructor(public status: number, message = 'No se pudo completar la operación') { super(message); this.name = 'HttpError'; }
}
export class NetworkError extends Error {
  constructor(cause: unknown) { super('No se pudo conectar con el servidor', { cause }); this.name = 'NetworkError'; }
}
export function shouldHandleRequestFailure(cause: unknown, currentSelection: boolean): boolean {
  return currentSelection || (cause instanceof HttpError && [401, 403, 404].includes(cause.status));
}
async function transport(path: string, init: RequestInit): Promise<Response> {
  try { return await fetch(API_URL + path, { ...init, credentials: 'include', cache: 'no-store' }); }
  catch (cause) { throw new NetworkError(cause); }
}
async function body<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let message: string | undefined;
    try { message = (await response.json())?.error?.message; } catch { /* HTTP status remains authoritative even without JSON. */ }
    throw new HttpError(response.status, message);
  }
  return response.status === 204 ? undefined as T : await response.json() as T;
}
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('content-type', 'application/json');
  if (init.method && !['GET', 'HEAD'].includes(init.method.toUpperCase())) {
    const csrf = await body<{ csrfToken: string }>(await transport('/auth/csrf', {}));
    headers.set('x-csrf-token', csrf.csrfToken);
  }
  return body<T>(await transport(path, { ...init, headers }));
}
