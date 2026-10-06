import { defineConfig } from '@playwright/test';

// Opt-in: regenerates docs/screenshots/*.png for the README with `npm --prefix e2e run screenshots`.
// It runs its own servers on other ports against a throwaway database that is recreated on every
// run, so it neither touches your data nor depends on a stack that is already running.
const FRONTEND_PORT = 4010;
const BACKEND_PORT = 4011;
const FRONTEND_URL = `http://127.0.0.1:${FRONTEND_PORT}`;
const ADMIN_DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://syncpad:syncpad@127.0.0.1:55432/syncpad';
const SCREENSHOT_DATABASE = 'syncpad_screenshots';
const DATABASE_URL = (() => {
  const url = new URL(ADMIN_DATABASE_URL);
  url.pathname = `/${SCREENSHOT_DATABASE}`;
  return url.toString();
})();

export default defineConfig({
  testDir: './screenshots',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: { baseURL: FRONTEND_URL, viewport: { width: 1280, height: 1500 }, colorScheme: 'light', locale: 'es-ES' },
  projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
  webServer: [
    {
      command: 'npx tsx ../e2e/screenshots/prepare-database.ts && npx tsx src/migrate.ts && npx tsx src/index.ts',
      cwd: '../backend',
      url: `http://127.0.0.1:${BACKEND_PORT}/health`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        ADMIN_DATABASE_URL,
        SCREENSHOT_DATABASE,
        DATABASE_URL,
        PORT: String(BACKEND_PORT),
        CORS_ORIGIN: FRONTEND_URL,
      },
    },
    {
      command: `npm run build && npx next start -p ${FRONTEND_PORT} -H 127.0.0.1`,
      cwd: '../frontend',
      url: FRONTEND_URL,
      reuseExistingServer: false,
      timeout: 240_000,
      env: {
        NEXT_PUBLIC_API_URL: `http://127.0.0.1:${BACKEND_PORT}`,
        NEXT_PUBLIC_WS_URL: `ws://127.0.0.1:${BACKEND_PORT}/ws`,
      },
    },
  ],
});
