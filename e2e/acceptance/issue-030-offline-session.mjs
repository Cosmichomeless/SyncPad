// Aceptación manual de #30. Requiere frontend en :4000 y backend en :4001 (ver docs/issues/030-offline-navigation.md).
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4000';
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const out = {};
page.on('pageerror', (e) => (out.pageerror = (out.pageerror ?? []).concat(String(e))));

async function register(page, email) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill('password-123');
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

await page.goto(base);
await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
out.swControlled = true;
const email = `acc${Date.now()}@example.com`;
await register(page, email);
await page.getByLabel('Nuevo workspace').fill('Offline acceptance');
await page.getByRole('button', { name: 'Crear', exact: true }).click();
await page.getByLabel('Nueva nota').fill('Nota A');
await page.getByRole('button', { name: 'Añadir' }).click();
const editor = page.getByRole('textbox', { name: 'Contenido de la nota' });
await editor.waitFor();
await page.waitForFunction(() => document.body.innerText.includes('Editando · conectado'));
await editor.fill('texto persistido offline');
await page.waitForTimeout(500);

// 1. Full offline reload, visited note restored
await context.setOffline(true);
await page.reload();
await page.waitForSelector('text=Nota A', { timeout: 10000 });
await page.getByRole('button', { name: /Nota A/ }).click();
await page.waitForTimeout(800);
out.restoredOffline = await editor.inputValue();
out.workspaceListedOffline = await page.locator('text=Offline acceptance').count();

// 2. Logout offline: local UI locked, reload does not restore
await page.getByRole('button', { name: 'Salir' }).click();
await page.waitForSelector('text=Entrar');
await page.reload();
await page.waitForSelector('text=Entrar');
out.lockedAfterOfflineLogout = (await page.locator('text=Nota A').count()) === 0;
await context.setOffline(false);

// 3. Explicit login restores and other account sees nothing of A
await page.getByLabel('Email').fill(email);
await page.getByLabel('Contraseña').fill('password-123');
await page.getByRole('button', { name: 'Entrar' }).click();
await page.waitForSelector('text=Nota A');
out.loginRestoresNotes = true;
await page.getByRole('button', { name: 'Salir' }).click();
await page.waitForSelector('text=Entrar');
const other = `acc2${Date.now()}@example.com`;
await register(page, other);
await page.waitForSelector('text=Workspaces');
out.otherAccountSeesNoteA = (await page.locator('text=Nota A').count()) > 0;
await context.setOffline(true);
await page.reload();
await page.waitForSelector('text=Workspaces');
out.otherAccountOfflineSeesNoteA = (await page.locator('text=Nota A').count()) > 0;
await context.setOffline(false);

console.log(JSON.stringify(out, null, 2));
await browser.close();
