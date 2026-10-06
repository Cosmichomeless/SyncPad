import { defineConfig } from '@playwright/test';

const FRONTEND_PORT = 4000;
const BACKEND_PORT = 4001;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://syncpad:syncpad@127.0.0.1:55432/syncpad';

// Requires PostgreSQL (see docs/issues/031-offline-e2e.md). Servers already listening
// on the ports below are reused, so a locally running stack is not restarted.
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: FRONTEND_URL, trace: 'retain-on-failure' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'npx tsx src/index.ts',
      cwd: '../backend',
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      reuseExistingServer: true,
      timeout: 60_000,
      env: { DATABASE_URL, PORT: String(BACKEND_PORT), CORS_ORIGIN: FRONTEND_URL },
    },
    {
      command: `npm run build && npx next start -p ${FRONTEND_PORT} -H 127.0.0.1`,
      cwd: '../frontend',
      url: FRONTEND_URL,
      reuseExistingServer: true,
      timeout: 240_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
        NEXT_PUBLIC_WS_URL: `ws://127.0.0.1:${BACKEND_PORT}/ws`,
      },
    },
  ],
});
