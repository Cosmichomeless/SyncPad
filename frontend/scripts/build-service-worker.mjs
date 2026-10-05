import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {{ html: string, assets: string[], version: string }} options */
export function generateServiceWorker({ html, assets, version }) {
  // The root currently prerenders the login form; authenticated state is client-only.
  if (!html.startsWith('<!DOCTYPE html>') || !html.includes('auth-shell') || html.includes('workspace-shell')) {
    throw new Error('Expected the anonymous, prerendered SyncPad login shell');
  }
  for (const asset of assets) {
    if (!/^\/_next\/static\/[A-Za-z0-9_./-]+$/.test(asset) || asset.split('/').some((part) => part === '.' || part === '..')) {
      throw new Error(`Not an immutable same-origin build asset: ${asset}`);
    }
  }
  return `const cacheName = ${JSON.stringify('syncpad-shell-' + version)};
const shellPath = '/offline-shell.html';
const assets = ${JSON.stringify(assets)};
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
`;
}

/** @param {string} directory @returns {Promise<string[]>} */
async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = await Promise.all(entries.map(async (entry) => {
    const filename = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(filename) : [filename];
  }));
  return paths.flat();
}

async function build() {
  const manifest = JSON.parse(await readFile('.next/prerender-manifest.json', 'utf8'));
  if (manifest.routes['/']?.initialRevalidateSeconds !== false || manifest.dynamicRoutes['/']) {
    throw new Error('Root must be statically prerendered without revalidation');
  }
  const html = await readFile('.next/server/app/index.html', 'utf8');
  const version = (await readFile('.next/BUILD_ID', 'utf8')).trim();
  const assets = (await walk('.next/static')).map((filename) => '/_next/static/' + path.relative('.next/static', filename).split(path.sep).join('/')).sort();
  const worker = generateServiceWorker({ html, assets, version });
  await mkdir('public', { recursive: true });
  await writeFile('public/offline-shell.html', html);
  await writeFile('public/sw.js', worker);
  console.log(`Generated anonymous shell ${version} with ${assets.length} static assets`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await build();
}
