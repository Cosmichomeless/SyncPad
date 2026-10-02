import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type SameSite = 'Lax' | 'Strict' | 'None';

export type SecurityConfig = {
  corsOrigin: string;
  cookieSecure: boolean;
  cookieSameSite: SameSite;
};

export function loadSecurityConfig(env: NodeJS.ProcessEnv): SecurityConfig {
  const corsOrigin = env.CORS_ORIGIN ?? 'http://127.0.0.1:3000';
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(corsOrigin);
    if ((parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') || parsedOrigin.pathname !== '/') {
      throw new Error('invalid origin');
    }
  } catch {
    throw new Error('CORS_ORIGIN must be an HTTP or HTTPS origin');
  }
  const rawSecure = env.COOKIE_SECURE;
  const cookieSecure = rawSecure === undefined ? env.NODE_ENV === 'production' : rawSecure === 'true';
  if (rawSecure !== undefined && rawSecure !== 'true' && rawSecure !== 'false') {
    throw new Error('COOKIE_SECURE must be true or false');
  }
  const rawSameSite = env.COOKIE_SAME_SITE ?? 'Lax';
  if (rawSameSite !== 'Lax' && rawSameSite !== 'Strict' && rawSameSite !== 'None') {
    throw new Error('COOKIE_SAME_SITE must be Lax, Strict or None');
  }
  if (rawSameSite === 'None' && !cookieSecure) throw new Error('COOKIE_SAME_SITE=None requires COOKIE_SECURE=true');
  return { corsOrigin: parsedOrigin.origin, cookieSecure, cookieSameSite: rawSameSite };
}

export function isAllowedOrigin(origin: string | undefined, config: SecurityConfig) {
  return origin === undefined || origin === config.corsOrigin;
}

export function applyCors(response: ServerResponse, origin: string | undefined, config: SecurityConfig) {
  if (origin === config.corsOrigin) {
    response.setHeader('access-control-allow-origin', config.corsOrigin);
    response.setHeader('access-control-allow-credentials', 'true');
    response.setHeader('vary', 'Origin');
  }
}

export function cookieAttributes(config: SecurityConfig, httpOnly: boolean) {
  return `${httpOnly ? ' HttpOnly;' : ''} Path=/; SameSite=${config.cookieSameSite}${config.cookieSecure ? '; Secure' : ''}`;
}

export function createCsrfToken() {
  return randomBytes(32).toString('base64url');
}

export function csrfCookie(token: string, config: SecurityConfig) {
  return `syncpad_csrf=${encodeURIComponent(token)};${cookieAttributes(config, false)}`;
}

export function hasValidCsrf(request: IncomingMessage) {
  const headerToken = request.headers['x-csrf-token'];
  const cookieToken = request.headers.cookie?.split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('syncpad_csrf='))
    ?.slice('syncpad_csrf='.length);
  if (typeof headerToken !== 'string' || !cookieToken) return false;
  const expected = Buffer.from(decodeURIComponent(cookieToken));
  const received = Buffer.from(headerToken);
  return expected.length === received.length && timingSafeEqual(expected, received);
}

export function rejectCors(response: ServerResponse) {
  response.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify({ error: { code: 'ORIGIN_NOT_ALLOWED', message: 'Origin is not allowed' } }));
}