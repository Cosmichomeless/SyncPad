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
