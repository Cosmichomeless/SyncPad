// Aceptación manual de #27. Requiere frontend en :4000 y backend en :4001.
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4000';
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const out = {};
page.on('pageerror', (e) => (out.pageerror = (out.pageerror ?? []).concat(String(e))));

await page.goto(base);
await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
await page.reload();
await page.waitForFunction(() => !!navigator.serviceWorker.controller);
await page.getByLabel('Email').fill(`acc27${Date.now()}@example.com`);
await page.getByLabel('Contraseña').fill('password-123');
await page.getByRole('button', { name: 'Crear cuenta' }).click();
await page.getByLabel('Nuevo workspace').fill('Local editing');
await page.getByRole('button', { name: 'Crear', exact: true }).click();
await page.getByLabel('Nueva nota').fill('Nota local');
await page.getByRole('button', { name: 'Añadir' }).click();
const editor = page.getByRole('textbox', { name: 'Contenido de la nota' });
await page.waitForFunction(() => document.body.innerText.includes('Editando · conectado'));
await editor.fill('base conectada');

// Second tab sees the connected edit (incremental update is forwarded)
const second = await context.newPage();
await second.goto(base);
await second.getByRole('button', { name: /Nota local/ }).click();
await second.waitForFunction(() => document.querySelector('textarea')?.value === 'base conectada');
out.connectedEditReachesSecondTab = true;
await second.close();

// Offline: reopen note, type without a socket, text and pending notice persist
await context.setOffline(true);
await page.reload();
await page.getByRole('button', { name: /Nota local/ }).click();
await page.waitForFunction(() => document.querySelector('textarea') && !document.querySelector('textarea').disabled);
await editor.pressSequentially(' + escrito sin red', { delay: 10 });
out.textWhileOffline = await editor.inputValue();
out.pendingShown = (await page.getByRole('status').filter({ hasText: 'pendientes de confirmar' }).count()) > 0;
await page.waitForTimeout(500);
await page.reload();
await page.getByRole('button', { name: /Nota local/ }).click();
await page.waitForFunction(() => document.querySelector('textarea')?.value.includes('sin red'));
out.restoredAfterReload = await editor.inputValue();
await page.screenshot({ path: '/private/tmp/claude-501/-Users-david-Dev-Side-proyects-SyncPad/cf9ea0c9-7848-4e32-a854-d5152d5592be/scratchpad/issue-027.png' });
await browser.close();
console.log(JSON.stringify(out, null, 2));
