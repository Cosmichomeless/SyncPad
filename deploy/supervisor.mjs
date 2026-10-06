// Container entrypoint for the single-service deployment: apply migrations, then run the sync
// server, the Next.js server and Caddy side by side. If any of them dies the whole container
// exits so the host restarts it; SIGTERM is forwarded so WebSockets close with 1001.
import { spawn } from 'node:child_process';

const publicOrigin = process.env.CORS_ORIGIN || process.env.RENDER_EXTERNAL_URL;
if (!publicOrigin) {
  console.error('Set CORS_ORIGIN to the public URL of the service (Render provides RENDER_EXTERNAL_URL).');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is required.');
  process.exit(1);
}

const backendEnv = {
  ...process.env,
  CORS_ORIGIN: new URL(publicOrigin).origin,
  COOKIE_SECURE: process.env.COOKIE_SECURE ?? 'true',
  COOKIE_SAME_SITE: process.env.COOKIE_SAME_SITE ?? 'Lax',
  HOST: '127.0.0.1',
  PORT: '3001',
};

function run(name, command, args, options) {
  const child = spawn(command, args, { stdio: 'inherit', ...options });
  child.name = name;
  return child;
}

const migrate = run('migrate', 'node', ['dist/migrate.js'], { cwd: '/app/backend', env: backendEnv });
const migrated = await new Promise((resolve) => migrate.on('exit', (code) => resolve(code)));
if (migrated !== 0) {
  console.error(`Migrations failed (exit ${migrated}); not starting.`);
  process.exit(1);
}

const children = [
  run('backend', 'node', ['--conditions=syncpad-built', 'dist/index.js'], { cwd: '/app/backend', env: backendEnv }),
  run('web', 'node', ['server.js'], { cwd: '/app/frontend', env: { ...process.env, PORT: '3000', HOSTNAME: '127.0.0.1' } }),
  run('proxy', 'caddy', ['run', '--config', '/etc/caddy/Caddyfile', '--adapter', 'caddyfile'], { env: process.env }),
];

let stopping = false;
let exitCode = 0;
const remaining = new Set(children);

function stop(signal) {
  if (stopping) return;
  stopping = true;
  for (const child of remaining) child.kill(signal);
  // Anything that ignores SIGTERM does not get to keep the container alive.
  setTimeout(() => process.exit(exitCode || 1), 10_000).unref();
}

for (const child of children) {
  child.on('exit', (code, signal) => {
    remaining.delete(child);
    if (!stopping) {
      console.error(`${child.name} exited (${signal ?? code}); stopping the container.`);
      exitCode = 1;
      stop('SIGTERM');
    }
    if (remaining.size === 0) process.exit(exitCode);
  });
}
process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGTERM'));
