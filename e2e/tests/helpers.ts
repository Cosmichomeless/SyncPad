import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const PASSWORD = 'password-123';

export type Client = { context: BrowserContext; page: Page };

export const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;

export const editor = (page: Page) => page.getByRole('textbox', { name: 'Contenido de la nota' });
export const syncLabel = (page: Page) => page.locator('.sync-status p');

export async function newClient(browser: Browser): Promise<Client> {
  const context = await browser.newContext();
  return { context, page: await context.newPage() };
}

export async function register(page: Page, email: string, workspace: string, note: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
  await page.getByLabel('Nuevo workspace').fill(workspace);
  await page.getByRole('button', { name: 'Crear', exact: true }).click();
  await page.getByLabel('Nueva nota').fill(note);
  await page.getByRole('button', { name: 'Añadir' }).click();
  await expect(syncLabel(page)).toHaveText('Al día');
}

export async function login(page: Page, email: string, workspace: string, note: string) {
  await page.goto('/');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Entrar' }).click();
  await openNote(page, workspace, note);
}

/** Opens a note, selecting its workspace first when the note is not already listed. */
export async function openNote(page: Page, workspace: string, note: string) {
  const noteButton = page.getByRole('button', { name: new RegExp(note) });
  if (!(await noteButton.isVisible())) await page.getByRole('button', { name: new RegExp(workspace) }).click();
  await noteButton.click();
  await expect(syncLabel(page)).toHaveText('Al día');
}

/** Waits until the offline shell service worker controls the page, so offline reloads work. */
export async function waitForServiceWorker(page: Page) {
  await page.waitForFunction(() => navigator.serviceWorker?.controller !== null && navigator.serviceWorker?.controller !== undefined, null, {
    timeout: 20_000,
  });
}

/** Drops the network at the browser level and fires the event the page listens to. */
export async function goOffline({ context, page }: Client) {
  await context.setOffline(true);
  await page.evaluate(() => window.dispatchEvent(new Event('offline')));
  await expect(syncLabel(page)).toHaveText('Sin conexión');
}

export async function goOnline({ context, page }: Client) {
  await context.setOffline(false);
  await page.evaluate(() => window.dispatchEvent(new Event('online')));
}

const BACKEND_PORT = 4001;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgres://syncpad:syncpad@127.0.0.1:55432/syncpad';
/** Written when a test replaces the backend, so global-teardown can stop the process Playwright does not own. */
export const RESTARTED_BACKEND_PID_FILE = fileURLToPath(new URL('../test-results/restarted-backend.pid', import.meta.url));

function listeners(port: number): number[] {
  try {
    return execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' }).split('\n').filter(Boolean).map(Number);
  } catch {
    return []; // lsof exits 1 when nothing listens
  }
}

async function until(condition: () => Promise<boolean> | boolean, label: string, ms = 30_000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
}

/** Stops the sync backend, as a crash or deploy would. Clients see their sockets drop. */
export async function stopBackend() {
  for (const pid of listeners(BACKEND_PORT)) process.kill(pid, 'SIGTERM');
  await until(() => listeners(BACKEND_PORT).length === 0, 'the backend to stop');
}

/** Starts the backend again on the same port and database. It outlives the test; global-teardown stops it. */
export async function startBackend() {
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: fileURLToPath(new URL('../../backend', import.meta.url)),
    env: { ...process.env, DATABASE_URL, PORT: String(BACKEND_PORT), CORS_ORIGIN: 'http://127.0.0.1:4000' },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  await until(async () => (await fetch(`${BACKEND_URL}/health`).catch(() => null))?.ok === true, 'the backend to answer /health');
  mkdirSync(dirname(RESTARTED_BACKEND_PID_FILE), { recursive: true });
  writeFileSync(RESTARTED_BACKEND_PID_FILE, String(listeners(BACKEND_PORT)[0] ?? child.pid));
}
