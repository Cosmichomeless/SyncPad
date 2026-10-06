/**
 * Where the browser finds the API and the WebSocket. `NEXT_PUBLIC_*` values are inlined at build
 * time, so each can be:
 * - unset: the local development servers on 127.0.0.1:3001;
 * - a URL: a backend on another origin (the Docker Compose stack);
 * - empty: the same origin as the page, which is how the single-origin deployment is built
 *   (cookies stay first-party and the WebSocket scheme follows the page's: https → wss).
 */
export const DEFAULT_API_URL = 'http://127.0.0.1:3001';
export const DEFAULT_WS_URL = 'ws://127.0.0.1:3001/ws';

export function resolveApiUrl(configured: string | undefined): string {
  return configured ?? DEFAULT_API_URL;
}

export function resolveWsUrl(configured: string | undefined, page: { protocol: string; host: string }): string {
  if (configured === undefined) return DEFAULT_WS_URL;
  if (configured !== '') return configured;
  return `${page.protocol === 'https:' ? 'wss:' : 'ws:'}//${page.host}/ws`;
}
