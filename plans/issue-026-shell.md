# Offline application shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Load the anonymous SyncPad application shell offline (#26 infrastructure).

**Architecture:** Generate a versioned service worker from Next production static output. Cache only anonymous root HTML and immutable same-origin static build assets. Private user identity and navigation restoration is delivered separately under #30, so #26 remains open until the full browser journey passes.

**Tech Stack:** Next.js production build, browser Service Worker/CacheStorage, node:test.

## Global Constraints

- Preserve original dirty backend tests, frontend next-env.d.ts and globals.css.
- Never cache API/auth/private or cross-origin responses, non-GET, RSC/Flight or errors.
- Never claim full note-offline acceptance until #30 is integrated and verified.

## [S1] Requirements

Permitir abrir rutas esenciales de SyncPad sin red.
- La interfaz y notas ya visitadas se pueden abrir offline.
- El caché no muestra datos de una cuenta anterior tras logout.

### Task 1: Anonymous shell cache

**Covers:** [S1] shell loading only. Private navigation/logout verification belongs to #30.

**Files:** Create `frontend/scripts/build-service-worker.mjs`, `frontend/src/app/service-worker-registration.tsx`, `frontend/tests/service-worker.test.tsx`, `docs/issues/026-app-shell.md`. Modify `frontend/src/app/layout.tsx`, frontend package.json, README.md and .gitignore for generated `frontend/public/sw.js` and `frontend/public/offline-shell.html`.

**Interfaces:** `generateServiceWorker({ html, assets, version }): string` exported from generator; assets are same-origin `/_next/static/` paths. Build reads `.next/server/app/index.html`, walks `.next/static`, writes anonymous `public/offline-shell.html` and generated `public/sw.js`. Build ID or HTML/assets content hash versions caches.

- [x] Write node tests executing generated worker in VM with event listeners and fake CacheStorage/fetch. Assert all precache entries are shell/static; API, auth, cross-origin, POST and RSC never call respondWith; only root document navigation falls back on fetch rejection, never HTTP 401/403/404/500. Assert old SyncPad shell caches are removed without touching unrelated caches.
- [x] Run frontend tests, observe RED before worker code.
- [x] Implement worker from these rules:

```js
const cacheName = 'syncpad-shell-' + version;
const shellPath = '/offline-shell.html';
const urls = [shellPath, ...assets];
self.addEventListener('install', event => {
  event.waitUntil(caches.open(cacheName).then(cache => cache.addAll(urls)));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(
    keys.filter(key => key.startsWith('syncpad-shell-') && key !== cacheName)
      .map(key => caches.delete(key))
  )).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.headers.has('RSC') || url.searchParams.has('_rsc')) return;
  if (request.mode === 'navigate' && url.pathname === '/' && !url.search) {
    event.respondWith(fetch(request).catch(() => caches.open(cacheName)
      .then(cache => cache.match(shellPath))
      .then(response => response || Response.error())));
    return;
  }
  if (assets.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(cacheName).then(cache => cache.match(url.pathname))
      .then(response => response || fetch(request)));
  }
});
```

Serialize constants into generated source, not global free variables. Ensure the copied shell is anonymous static HTML; generator fails if output missing/dynamic. Never cache live root/API responses. Use build ID as version and include all static build assets required by initial root.

- [x] Register in production only with a client component:

```tsx
export default function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV === 'production' && 'serviceWorker' in navigator) {
      void navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch(() => undefined);
    }
  }, []);
  return null;
}
```

Add imports and mount under layout body. Add package postbuild script invoking generator and ignore only generated files.

- [x] Run frontend tests, lint, typecheck, build and post-build typecheck. Main controller will verify worker control and offline reload using existing Playwright session against production start. Record actual evidence and limitations.
- [x] Commit only owned files with `feat: cache anonymous application shell offline (#26)`, no pushing/issue closure by implementer.
