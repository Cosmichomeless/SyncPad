// Concurrent-editor benchmark: `npx tsx bench/run.mts` (see docs/issues/050-benchmark.md).
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';
import { applyNoteUpdate, createNoteDocument } from '@syncpad/shared';
import { createDatabasePool } from '../src/database.js';

type Scenario = { rooms: number; editorsPerRoom: number; editsPerEditor: number; intervalMs: number };
type Stats = { memory: NodeJS.MemoryUsage; cpu: NodeJS.CpuUsage };

const env = (name: string, fallback: number) => (process.env[name] ? Number(process.env[name]) : fallback);
const databaseUrl = process.env.BENCH_DATABASE_URL;
const sweep = (process.env.BENCH_SWEEP ?? '1x5,1x20,1x50,5x20,5x50,10x20,10x50').split(',').map((entry) => entry.split('x').map(Number));
const editsPerEditor = env('BENCH_EDITS', 100);
const intervalMs = env('BENCH_INTERVAL_MS', 100);
// The pass criterion for "this load is fine": 95% of saves acknowledged inside this budget, nothing dropped.
const P95_BUDGET_MS = env('BENCH_P95_BUDGET_MS', 250);

const percentile = (sorted: number[], p: number) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)] : 0);
const mb = (bytes: number) => Math.round(bytes / 1024 / 1024);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function createNotes(count: number) {
  if (!databaseUrl) return { ids: Array.from({ length: count }, () => randomUUID()), cleanup: async () => {} };
  const pool = createDatabasePool(databaseUrl);
  const owner = (await pool.query<{ id: string }>('INSERT INTO syncpad.users (email, password_hash) VALUES ($1, $2) RETURNING id', [`bench-${randomUUID()}@example.com`, 'x'])).rows[0].id;
  const workspace = (await pool.query<{ id: string }>('INSERT INTO syncpad.workspaces (name, created_by) VALUES ($1, $2) RETURNING id', ['bench', owner])).rows[0].id;
  const ids: string[] = [];
  for (let index = 0; index < count; index++) {
    ids.push((await pool.query<{ id: string }>('INSERT INTO syncpad.notes (workspace_id, title, created_by) VALUES ($1, $2, $3) RETURNING id', [workspace, `bench ${index}`, owner])).rows[0].id);
  }
  return {
    ids,
    cleanup: async () => {
      await pool.query('DELETE FROM syncpad.notes WHERE workspace_id = $1', [workspace]);
      await pool.query('DELETE FROM syncpad.workspaces WHERE id = $1', [workspace]);
      await pool.query('DELETE FROM syncpad.users WHERE id = $1', [owner]);
      await pool.end();
    },
  };
}

async function runScenario(scenario: Scenario) {
  const child = fork(fileURLToPath(new URL('./server.mts', import.meta.url)), [], { execArgv: ['--import', 'tsx'], env: process.env });
  const [ready] = (await once(child, 'message')) as [{ port: number }];
  const empty: Stats = { memory: { rss: 0, heapUsed: 0 } as NodeJS.MemoryUsage, cpu: { user: 0, system: 0 } };
  const stats = () => new Promise<Stats>((resolve) => {
    if (!child.connected) { resolve(empty); return; }
    child.once('exit', () => resolve(empty));
    child.once('message', (message: Stats & { type: string }) => resolve(message));
    child.send({ type: 'stats' });
  });
  const { ids, cleanup } = await createNotes(scenario.rooms);
  const ackLatencies: number[] = [];
  const propagation: number[] = [];
  const sentAt = new Map<string, number>();
  let failures = 0;
  let sent = 0;
  let closedByUs = false;
  const dropped = new Set<WebSocket>(); // sockets the server (or the network) cut on us
  let serverExit: number | null = null;
  child.once('exit', (code) => { serverExit = code ?? -1; });
  const editors: { socket: WebSocket; doc: ReturnType<typeof createNoteDocument> }[] = [];
  const before = await stats();
  const generatorBefore = process.cpuUsage();

  await Promise.all(ids.flatMap((noteId) => Array.from({ length: scenario.editorsPerRoom }, async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${ready.port}/ws?noteId=${noteId}`, { headers: { cookie: 'syncpad_session=bench', origin: 'http://127.0.0.1:3000' } });
    const doc = createNoteDocument();
    let remote = false;
    const pending = new Map<string, number>();
    let counter = 0;
    doc.doc.on('update', (update: Uint8Array) => {
      if (remote) return;
      const encoded = Buffer.from(update).toString('base64');
      const requestId = `u${++counter}`;
      const now = performance.now();
      pending.set(requestId, now);
      sentAt.set(encoded, now);
      sent++;
      socket.send(JSON.stringify({ type: 'update', requestId, update: encoded }));
    });
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString()) as { type: string; update?: string; requestId?: string; code?: string };
      if (message.type === 'sync' || message.type === 'update') {
        const born = message.type === 'update' ? sentAt.get(message.update!) : undefined;
        if (born !== undefined) propagation.push(performance.now() - born);
        remote = true;
        applyNoteUpdate(doc.doc, new Uint8Array(Buffer.from(message.update!, 'base64')));
        remote = false;
      } else if (message.type === 'ack' && message.requestId && pending.has(message.requestId)) {
        ackLatencies.push(performance.now() - pending.get(message.requestId)!);
        pending.delete(message.requestId);
      } else if (message.type === 'sync-error') failures++;
    });
    socket.on('error', () => { dropped.add(socket); });
    socket.on('close', () => { if (pending.size) failures += pending.size; if (!closedByUs) dropped.add(socket); });
    try { await once(socket, 'open'); } catch { dropped.add(socket); return; }
    socket.send(JSON.stringify({ type: 'sync-request', requestId: 'hs' }));
    editors.push({ socket, doc });
  })));
  await sleep(300);

  const started = performance.now();
  await Promise.all(editors.map(async ({ doc }, index) => {
    await sleep((index * scenario.intervalMs) / editors.length); // spread the first keystrokes
    for (let edit = 0; edit < scenario.editsPerEditor; edit++) {
      const at = Math.floor(Math.random() * (doc.content.length + 1));
      doc.content.insert(at, String.fromCharCode(97 + (edit % 26)));
      await sleep(scenario.intervalMs);
    }
  }));
  const deadline = Date.now() + 15_000;
  while (ackLatencies.length + failures < sent && Date.now() < deadline) await sleep(25);
  await sleep(500); // let the last broadcasts land
  const elapsedS = (performance.now() - started) / 1000;

  const texts = new Map<string, Set<string>>();
  editors.forEach(({ doc }, index) => {
    const noteId = ids[Math.floor(index / scenario.editorsPerRoom)];
    texts.set(noteId, (texts.get(noteId) ?? new Set()).add(doc.content.toString()));
  });
  const converged = [...texts.values()].every((set) => set.size === 1);
  const after = await stats();
  const generator = process.cpuUsage(generatorBefore);
  closedByUs = true;
  for (const { socket } of editors) socket.terminate();
  if (serverExit === null) { child.send({ type: 'stop' }); await once(child, 'exit'); }
  await cleanup();

  const acks = ackLatencies.sort((a, b) => a - b);
  const props = propagation.sort((a, b) => a - b);
  const p95 = percentile(acks, 95);
  return {
    editors: ids.length * scenario.editorsPerRoom,
    rooms: scenario.rooms,
    updates: sent,
    updatesPerSecond: Math.round(sent / elapsedS),
    ackP50: Math.round(percentile(acks, 50)),
    ackP95: Math.round(p95),
    ackP99: Math.round(percentile(acks, 99)),
    propP95: Math.round(percentile(props, 95)),
    failures: failures + (sent - ackLatencies.length - failures),
    dropped: dropped.size,
    serverCrashed: serverExit !== null && serverExit !== 0 && !closedByUs,
    converged,
    rssMb: mb(after.memory.rss),
    heapMb: mb(after.memory.heapUsed),
    heapGrowthMb: mb(after.memory.heapUsed - before.memory.heapUsed),
    cpuPercent: Math.round(((after.cpu.user + after.cpu.system - before.cpu.user - before.cpu.system) / 1000 / (elapsedS * 1000)) * 100),
    generatorCpuPercent: Math.round(((generator.user + generator.system) / 1000 / (elapsedS * 1000)) * 100),
    ok: p95 <= P95_BUDGET_MS && failures === 0 && dropped.size === 0 && converged && ackLatencies.length === sent,
  };
}

console.log(`# SyncPad benchmark · ${new Date().toISOString()}`);
console.log(`node ${process.version} · ${os.cpus()[0].model} × ${os.cpus().length} · ${Math.round(os.totalmem() / 1024 ** 3)} GB · store=${databaseUrl ? 'postgres' : 'memory'}`);
console.log(`${editsPerEditor} edits/editor, one every ${intervalMs} ms (${(1000 / intervalMs).toFixed(0)}/s each), pass = p95 ack ≤ ${P95_BUDGET_MS} ms with no failures\n`);
console.log('| rooms × editors | updates | upd/s | ack p50 | p95 | p99 | propagation p95 | server RSS | heap Δ | CPU | load gen CPU | pass |');
console.log('| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | :---: |');
let limit: string | undefined;
for (const [rooms, editorsPerRoom] of sweep) {
  const result = await runScenario({ rooms, editorsPerRoom, editsPerEditor, intervalMs });
  console.log(`| ${rooms} × ${editorsPerRoom} (${result.editors}) | ${result.updates} | ${result.updatesPerSecond} | ${result.ackP50} ms | ${result.ackP95} ms | ${result.ackP99} ms | ${result.propP95} ms | ${result.rssMb} MB | ${result.heapGrowthMb} MB | ${result.cpuPercent}% | ${result.generatorCpuPercent}% | ${result.ok ? '✅' : '❌'} |`);
  if (!result.ok && !limit) limit = `${rooms} rooms × ${editorsPerRoom} editors (${result.editors} concurrent)`;
}
console.log(limit ? `\nFirst scenario over budget: ${limit}.` : '\nEvery scenario stayed inside the budget; raise BENCH_SWEEP to find the limit.');
