// Aceptación manual de #30. Requiere frontend en :4000 y backend en :4001 (ver docs/issues/030-offline-navigation.md).
import { chromium } from '@playwright/test';
const base = 'http://127.0.0.1:4000', api = 'http://127.0.0.1:4001';
const browser = await chromium.launch();
const context = await browser.newContext();
const p1 = await context.newPage();
const out = {};
await p1.goto(base);
await p1.evaluate(() => navigator.serviceWorker.ready.then(() => true));
await p1.reload();
await p1.waitForFunction(() => !!navigator.serviceWorker.controller);
await p1.getByLabel('Email').fill(`acc4${Date.now()}@example.com`);
await p1.getByLabel('Contraseña').fill('password-123');
await p1.getByRole('button', { name: 'Crear cuenta' }).click();
await p1.getByLabel('Nuevo workspace').fill('WS C');
await p1.getByRole('button', { name: 'Crear', exact: true }).click();
await p1.getByLabel('Nueva nota').fill('Nota C');
await p1.getByRole('button', { name: 'Añadir' }).click();
const ed = p1.getByRole('textbox', { name: 'Contenido de la nota' });
await p1.waitForFunction(() => document.body.innerText.includes('Editando · conectado'));
await ed.fill('contenido C');
await p1.waitForTimeout(500);

// Reconnection with changed metadata (rename while tab is offline)
await context.setOffline(true);
await p1.reload();
await p1.getByRole('button', { name: /Nota C/ }).click();
await p1.waitForTimeout(500);
await context.setOffline(false);
const rq = context.request;
const csrf = (await (await rq.get(`${api}/auth/csrf`)).json()).csrfToken;
const ws = (await (await rq.get(`${api}/workspaces`)).json()).workspaces[0];
const list = await (await rq.get(`${api}/workspaces/${ws.id}/notes`)).json();
const note = (list.notes ?? list)[0];
const r = await rq.patch(`${api}/notes/${note.id}`, { headers: { 'x-csrf-token': csrf, origin: base }, data: { title: 'Nota C renombrada' } });
out.renameStatus = r.status();

await p1.evaluate(() => window.dispatchEvent(new Event('online')));
await p1.waitForSelector('text=Nota C renombrada', { timeout: 15000 }).catch(() => {});
out.renamedVisible = (await p1.locator('text=Nota C renombrada').count()) > 0;
out.contentAfterReconnect = await ed.inputValue();

// Two tabs: logout in tab 1 locks tab 2
const p2 = await context.newPage();
await p2.goto(base);
await p2.waitForSelector('text=Salir');
await context.setOffline(true);
await p1.getByRole('button', { name: 'Salir' }).click();
await p1.waitForSelector('text=Entrar');
await p2.waitForSelector('text=Entrar', { timeout: 10000 }).then(() => (out.tab2LockedByTab1Logout = true)).catch(() => (out.tab2LockedByTab1Logout = false));
await p2.reload();
await p2.waitForSelector('text=Entrar');
out.tab2StillLockedAfterReload = (await p2.locator('text=Nota C').count()) === 0;
await browser.close();
console.log(JSON.stringify(out, null, 2));
