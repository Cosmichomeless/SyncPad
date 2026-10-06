// Aceptación de #29. Requiere frontend en :4000, backend en :4001 y Postgres (ver docs/issues/029-sync-status.md).
// Para simular una caída persistente el script para y arranca el backend de pruebas del puerto 4001.
import { execSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4000';
const backendDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../backend');
const out = {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function stopBackend() {
  try { execSync('lsof -ti tcp:4001 -sTCP:LISTEN | xargs kill'); } catch { /* not running */ }
}
async function startBackend() {
  spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: backendDir,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, DATABASE_URL: 'postgres://syncpad:syncpad@127.0.0.1:55432/syncpad', PORT: '4001', CORS_ORIGIN: base },
  }).unref();
  for (let attempt = 0; attempt < 40; attempt++) {
    if (await fetch('http://127.0.0.1:4001/health').then((r) => r.ok, () => false)) return;
    await sleep(250);
  }
  throw new Error('backend did not come back');
}

const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();
const status = () => page.locator('.sync-status p').innerText();
const waitStatus = (text, timeout = 15000) =>
  page.waitForFunction((expected) => document.querySelector('.sync-status p')?.textContent === expected, text, { timeout });
const retry = page.getByRole('button', { name: 'Reintentar conexión' });

await page.goto(base);
await page.getByLabel('Email').fill(`acc29${Date.now()}@example.com`);
await page.getByLabel('Contraseña').fill('password-123');
await page.getByRole('button', { name: 'Crear cuenta' }).click();
await page.getByLabel('Nuevo workspace').fill('WS 29');
await page.getByRole('button', { name: 'Crear', exact: true }).click();
await page.getByLabel('Nueva nota').fill('Nota 29');
await page.getByRole('button', { name: 'Añadir' }).click();
const editor = page.getByRole('textbox', { name: 'Contenido de la nota' });
await waitStatus('Al día');
out.liveRegions = await page.getByRole('status').count();
out.retryHiddenWhenUpToDate = (await retry.count()) === 0;
await editor.fill('texto conectado');
await waitStatus('Al día');

// 1. Sin red del navegador: etiqueta, reintento deshabilitado y motivo.
await context.setOffline(true);
await page.evaluate(() => window.dispatchEvent(new Event('offline')));
await waitStatus('Sin conexión');
out.offlineLabel = await status();
out.retryDisabledOffline = await retry.isDisabled();
out.offlineHint = await page.locator('.sync-status small').innerText();
await context.setOffline(false);
await page.evaluate(() => window.dispatchEvent(new Event('online')));
await waitStatus('Al día');
out.backOnline = await status();

// 2. Caída persistente del servidor: se sigue editando, el texto se conserva y el reintento está disponible.
stopBackend();
await waitStatus('Reconectando');
out.outageLabel = await status();
out.retryEnabledDuringOutage = await retry.isEnabled();
await editor.fill('texto conectado + escrito durante la caida');
out.pendingNoticeDuringOutage = (await page.locator('.pending').count()) === 1;
await sleep(3000);
out.stillReconnecting = await status();
out.textDuringOutage = await editor.inputValue();

// 3. El servidor vuelve y el reintento manual sincroniza sin perder nada.
await startBackend();
await retry.click();
await waitStatus('Al día', 20000);
out.afterRetry = await status();
out.textAfterRetry = await editor.inputValue();
out.pendingNoticeAfterRetry = (await page.locator('.pending').count()) === 0;

// 4. El servidor realmente tiene el texto: una recarga completa lo recupera.
await page.reload();
await page.getByRole('button', { name: /Nota 29/ }).click().catch(async () => {
  await page.getByRole('button', { name: /WS 29/ }).click();
  await page.getByRole('button', { name: /Nota 29/ }).click();
});
await page.waitForFunction(() => document.querySelector('textarea')?.value === 'texto conectado + escrito durante la caida', null, { timeout: 15000 });
out.afterReload = await editor.inputValue();

console.log(JSON.stringify(out, null, 2));
await browser.close();
