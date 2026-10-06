// Aceptación de #28. Requiere frontend en :4000 y backend en :4001 (ver docs/issues/028-reconnection.md).
import { chromium } from '@playwright/test';

const base = 'http://127.0.0.1:4000';
const email = `acc28${Date.now()}@example.com`;
const password = 'password-123';
const out = {};
const browser = await chromium.launch();

const label = (page) => page.locator('.sync-status p').innerText();
const waitLabel = (page, text, timeout = 15000) =>
  page.waitForFunction((expected) => document.querySelector('.sync-status p')?.textContent === expected, text, { timeout });

// Cliente A: crea cuenta, workspace y nota.
const contextA = await browser.newContext();
const a = await contextA.newPage();
await a.goto(base);
await a.getByLabel('Email').fill(email);
await a.getByLabel('Contraseña').fill(password);
await a.getByRole('button', { name: 'Crear cuenta' }).click();
await a.getByLabel('Nuevo workspace').fill('WS 28');
await a.getByRole('button', { name: 'Crear', exact: true }).click();
await a.getByLabel('Nueva nota').fill('Nota 28');
await a.getByRole('button', { name: 'Añadir' }).click();
const editorA = a.getByRole('textbox', { name: 'Contenido de la nota' });
await waitLabel(a, 'Al día');
await editorA.fill('base compartida final');
await waitLabel(a, 'Al día');

// Cliente B: otro contexto (otro IndexedDB), misma cuenta, misma nota.
const contextB = await browser.newContext();
const b = await contextB.newPage();
await b.goto(base);
await b.getByLabel('Email').fill(email);
await b.getByLabel('Contraseña').fill(password);
await b.getByRole('button', { name: 'Entrar' }).click();
await b.getByRole('button', { name: /WS 28/ }).click();
await b.getByRole('button', { name: /Nota 28/ }).click();
const editorB = b.getByRole('textbox', { name: 'Contenido de la nota' });
await waitLabel(b, 'Al día');
await b.waitForFunction(() => document.querySelector('textarea')?.value === 'base compartida final');
out.bSawBase = await editorB.inputValue();

// A pierde la red y edita (reemplaza y borra); B edita conectado.
await contextA.setOffline(true);
await a.evaluate(() => window.dispatchEvent(new Event('offline')));
await waitLabel(a, 'Sin conexión');
out.labelOffline = await label(a);
await editorA.fill('base compartida + sin red');
out.pendingNoticeOffline = (await a.locator('.pending').count()) === 1;
await editorB.fill('B: base compartida final');
await waitLabel(b, 'Al día');

// A recupera la red: ambos deben converger sin duplicar ni perder cambios.
await contextA.setOffline(false);
await a.evaluate(() => window.dispatchEvent(new Event('online')));
await waitLabel(a, 'Al día');
const expected = 'B: base compartida + sin red';
await a.waitForFunction((text) => document.querySelector('textarea')?.value === text, expected, { timeout: 15000 });
await b.waitForFunction((text) => document.querySelector('textarea')?.value === text, expected, { timeout: 15000 });
out.a = await editorA.inputValue();
out.b = await editorB.inputValue();
out.converged = out.a === expected && out.b === expected;
out.pendingNoticeGoneAfter = (await a.locator('.pending').count()) === 0;

// Recarga completa de B: el servidor conserva el contenido fusionado, sin duplicados.
await b.reload();
await b.getByRole('button', { name: /Nota 28/ }).click().catch(async () => {
  await b.getByRole('button', { name: /WS 28/ }).click();
  await b.getByRole('button', { name: /Nota 28/ }).click();
});
await b.waitForFunction((text) => document.querySelector('textarea')?.value === text, expected, { timeout: 15000 });
out.afterReload = await editorB.inputValue();

console.log(JSON.stringify(out, null, 2));
await browser.close();
