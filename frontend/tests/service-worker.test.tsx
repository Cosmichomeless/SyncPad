import assert from 'node:assert/strict';
import test, { before } from 'node:test';
import { runInNewContext } from 'node:vm';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

let generateServiceWorker: typeof import('../scripts/build-service-worker.mjs')['generateServiceWorker'];
before(async () => {
  ({ generateServiceWorker } = await import('../scripts/build-service-worker.mjs'));
});

const html = '<!DOCTYPE html><html><body><main class="shell auth-shell"><input type="password" /></main></body></html>';
const assets = ['/_next/static/chunks/app.js', '/_next/static/chunks/app.css'];
type WorkerRequest = { url: string; method: string; mode: string; headers: Headers };
type WorkerEvent = { request?: WorkerRequest; waitUntil?: (promise: Promise<unknown>) => void; respondWith?: (promise: Promise<Response>) => void };

function worker() {
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const entries = new Map<string, Map<string, Response>>();
  const precached: string[] = [];
  const fetched: WorkerRequest[] = [];
  let claimed = false;
  let network: (request: WorkerRequest) => Promise<Response> = async () => new Response('network');
  runInNewContext(generateServiceWorker({ html, assets, version: 'build-2' }), {
    URL, Response,
    self: {
      location: { origin: 'https://syncpad.test' },
      clients: { claim: async () => { claimed = true; } },
      addEventListener: (name: string, listener: (event: WorkerEvent) => void) => listeners.set(name, listener),
    },
    caches: {
      open: async (name: string) => {
        if (!entries.has(name)) entries.set(name, new Map());
        const cache = entries.get(name)!;
        return {
          addAll: async (urls: string[]) => {
            precached.push(...urls);
            for (const url of urls) cache.set(url, new Response(url === '/offline-shell.html' ? html : url));
          },
          match: async (path: string) => cache.get(path),
        };
      },
      keys: async () => [...entries.keys()],
      delete: async (name: string) => entries.delete(name),
    },
    fetch: (request: WorkerRequest) => { fetched.push(request); return network(request); },
  });
  return {
    entries, precached, fetched,
    get claimed() { return claimed; },
    setNetwork: (handler: typeof network) => { network = handler; },
    lifecycle: async (name: string) => {
      let pending: Promise<unknown> | undefined;
      listeners.get(name)!({ waitUntil: (promise) => { pending = promise; } });
      await pending;
    },
    request: (path: string, options: Partial<WorkerRequest> = {}) => {
      let response: Promise<Response> | undefined;
      listeners.get('fetch')!({
        request: { url: new URL(path, 'https://syncpad.test').href, method: 'GET', mode: 'navigate', headers: new Headers(), ...options },
        respondWith: (promise) => { assert.equal(response, undefined); response = promise; },
      });
      return response;
    },
  };
}

test('precaches only anonymous shell and declared immutable assets', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  assert.deepEqual(sw.precached, ['/offline-shell.html', ...assets]);
  assert.deepEqual([...sw.entries.keys()], ['syncpad-shell-build-2']);
});

test('ignores private, auth, cross-origin, non-GET, Flight and non-root requests', () => {
  const sw = worker();
  for (const path of ['/api/notes', '/auth/me', '/auth/logout', '/workspaces', '/notes/1', '/offline-shell.html', '/?private=1', '/?_rsc=abc', 'https://other.test/', 'https://other.test' + assets[0], '/_next/static/unknown.js', assets[0] + '?v=1']) {
    assert.equal(sw.request(path), undefined, path);
  }
  for (const path of ['/', ...assets]) {
    assert.equal(sw.request(path, { method: 'POST' }), undefined);
    assert.equal(sw.request(path, { headers: new Headers({ RSC: '1' }) }), undefined);
    assert.equal(sw.request(path + '?_rsc=abc'), undefined);
  }
  assert.equal(sw.request('/', { mode: 'cors' }), undefined);
  assert.equal(sw.fetched.length, 0);
  assert.equal(sw.entries.size, 0);
});

test('root navigation uses network without caching live responses', async () => {
  const sw = worker();
  const response = new Response('private live root');
  sw.setNetwork(async () => response);
  assert.equal(await sw.request('/'), response);
  assert.equal(sw.entries.size, 0);
});

test('root navigation falls back only on network rejection', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.setNetwork(async () => { throw new TypeError('offline'); });
  assert.equal(await (await sw.request('/'))!.text(), html);
  sw.entries.get('syncpad-shell-build-2')!.clear();
  assert.equal((await sw.request('/'))!.type, 'error');
});

test('HTTP errors never become anonymous fallback or cache writes', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  for (const status of [401, 403, 404, 500]) {
    const response = new Response('error', { status });
    sw.setNetwork(async () => response);
    assert.equal(await sw.request('/'), response);
    sw.entries.get('syncpad-shell-build-2')!.delete(assets[0]);
    assert.equal(await sw.request(assets[0], { mode: 'cors' }), response);
    assert.equal(sw.entries.get('syncpad-shell-build-2')!.has(assets[0]), false);
  }
});

test('static cache hits work offline and misses fetch without writing', async () => {
  const sw = worker();
  await sw.lifecycle('install');
  sw.setNetwork(async () => { throw new TypeError('offline'); });
  assert.equal(await (await sw.request(assets[0], { mode: 'cors' }))!.text(), assets[0]);
  assert.equal(sw.fetched.length, 0);
  sw.entries.get('syncpad-shell-build-2')!.delete(assets[0]);
  sw.setNetwork(async () => new Response('uncached'));
  assert.equal(await (await sw.request(assets[0], { mode: 'cors' }))!.text(), 'uncached');
  assert.equal(sw.entries.get('syncpad-shell-build-2')!.has(assets[0]), false);
});

test('activation removes only old SyncPad shell caches and claims clients', async () => {
  const sw = worker();
  for (const name of ['syncpad-shell-build-1', 'syncpad-shell-build-2', 'another-app', 'syncpad-notes']) sw.entries.set(name, new Map());
  await sw.lifecycle('activate');
  assert.deepEqual([...sw.entries.keys()], ['syncpad-shell-build-2', 'another-app', 'syncpad-notes']);
  assert.equal(sw.claimed, true);
});

test('generator rejects non-anonymous HTML and assets outside immutable build paths', () => {
  for (const invalid of ['', '<html>private</html>', html.replace('auth-shell', 'workspace-shell')]) {
    assert.throws(() => generateServiceWorker({ html: invalid, assets, version: 'build-2' }));
  }
  for (const asset of ['/api/notes', '/auth/me', 'https://other.test/_next/static/app.js', '/_next/static/../private', '/_next/static/app.js?token=secret']) {
    assert.throws(() => generateServiceWorker({ html, assets: [asset], version: 'build-2' }));
  }
});

async function buildFixture(run: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'syncpad-shell-test-'));
  try {
    await mkdir(path.join(directory, '.next/server/app'), { recursive: true });
    await mkdir(path.join(directory, '.next/static/chunks'), { recursive: true });
    await writeFile(path.join(directory, '.next/prerender-manifest.json'), JSON.stringify({ routes: { '/': { initialRevalidateSeconds: false } }, dynamicRoutes: {} }));
    await writeFile(path.join(directory, '.next/BUILD_ID'), 'fixture-build');
    await writeFile(path.join(directory, '.next/server/app/index.html'), html);
    await writeFile(path.join(directory, '.next/static/chunks/app.js'), 'static asset');
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

const generatorPath = path.resolve('scripts/build-service-worker.mjs');

test('postbuild copies anonymous HTML and maps static files to public Next asset URLs', async () => {
  await buildFixture(async (directory) => {
    const result = spawnSync(process.execPath, [generatorPath], { cwd: directory, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await readFile(path.join(directory, 'public/offline-shell.html'), 'utf8'), html);
    const source = await readFile(path.join(directory, 'public/sw.js'), 'utf8');
    assert.equal(source, generateServiceWorker({ html, assets: [assets[0]], version: 'fixture-build' }));
  });
});

test('postbuild fails closed for missing HTML and dynamic or revalidated root output', async () => {
  await buildFixture(async (directory) => {
    const manifests = [
      { routes: {}, dynamicRoutes: {} },
      { routes: { '/': { initialRevalidateSeconds: 60 } }, dynamicRoutes: {} },
      { routes: { '/': { initialRevalidateSeconds: false } }, dynamicRoutes: { '/': {} } },
    ];
    for (const manifest of manifests) {
      await writeFile(path.join(directory, '.next/prerender-manifest.json'), JSON.stringify(manifest));
      const result = spawnSync(process.execPath, [generatorPath], { cwd: directory, encoding: 'utf8' });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Root must be statically prerendered/);
    }
    await writeFile(path.join(directory, '.next/prerender-manifest.json'), JSON.stringify({ routes: { '/': { initialRevalidateSeconds: false } }, dynamicRoutes: {} }));
    await rm(path.join(directory, '.next/server/app/index.html'));
    const result = spawnSync(process.execPath, [generatorPath], { cwd: directory, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /ENOENT/);
    await assert.rejects(readFile(path.join(directory, 'public/sw.js')), /ENOENT/);
  });
});
