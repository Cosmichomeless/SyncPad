import { expect, test } from '@playwright/test';
import { editor, goOffline, goOnline, login, newClient, register, syncLabel, uniqueEmail, waitForServiceWorker, type Client } from './helpers';

const API = 'http://127.0.0.1:4001';
const banner = (page: Client['page']) => page.getByRole('alert').filter({ hasText: 'Esta nota se eliminó en el servidor' });

/** Deletes the first note of the first workspace as the logged-in user of `client`. */
async function deleteFirstNote({ context }: Client) {
  const csrf = (await context.cookies(API)).find((cookie) => cookie.name === 'syncpad_csrf')?.value;
  expect(csrf).toBeTruthy();
  const workspaces = (await (await context.request.get(`${API}/workspaces`)).json()) as { workspaces: { id: string }[] };
  const notes = (await (await context.request.get(`${API}/workspaces/${workspaces.workspaces[0].id}/notes`)).json()) as { notes: { id: string }[] };
  const response = await context.request.delete(`${API}/notes/${notes.notes[0].id}`, { headers: { 'x-csrf-token': csrf! } });
  expect(response.status()).toBe(204);
}

test.describe('borrado de una nota mientras otro cliente está sin red (#34)', () => {
  test('el cliente que vuelve conserva su copia local, la exporta y la descarta sin recrear la nota', async ({ browser }) => {
    const email = uniqueEmail('e2e34a');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS borrado', 'Nota efímera');
      await editor(a.page).fill('texto ya sincronizado');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await waitForServiceWorker(a.page);

      await login(b.page, email, 'WS borrado', 'Nota efímera');

      // A pierde la red y escribe cambios que nunca llegarán al servidor.
      await goOffline(a);
      const localText = 'texto ya sincronizado + cambios sin red que no deben perderse';
      await editor(a.page).fill(localText);
      await expect(a.page.locator('.pending')).toBeVisible();

      // B borra la nota en el servidor mientras A está desconectado.
      await deleteFirstNote(b);

      // Al volver la red A detecta el borrado: no recrea la nota y conserva el texto en solo lectura.
      await goOnline(a);
      await expect(banner(a.page)).toBeVisible();
      await expect(banner(a.page)).toContainText('Incluye cambios que nunca llegaron al servidor');
      await expect(editor(a.page)).toHaveValue(localText);
      await expect(editor(a.page)).toHaveJSProperty('readOnly', true);
      await expect(a.page.getByRole('button', { name: /Nota efímera/ })).toHaveCount(1); // solo la copia recuperable
      await expect(a.page.getByText('Copia local recuperable')).toBeVisible();

      // La copia exportada es exactamente el texto local.
      const [download] = await Promise.all([a.page.waitForEvent('download'), a.page.getByRole('button', { name: 'Descargar copia (.txt)' }).click()]);
      expect(download.suggestedFilename()).toMatch(/\.txt$/);
      const path = await download.path();
      const { readFile } = await import('node:fs/promises');
      expect(await readFile(path, 'utf8')).toBe(localText);

      // Tras recargar, la nota sigue como copia recuperable y no ha vuelto a la lista del servidor.
      await a.page.reload();
      await expect(a.page.getByText('Eliminadas en el servidor')).toBeVisible();
      await a.page.getByRole('button', { name: /Nota efímera/ }).click();
      await expect(editor(a.page)).toHaveValue(localText);
      await expect(banner(a.page)).toBeVisible();

      // Descartar elimina la copia local y la entrada recuperable.
      await a.page.getByRole('button', { name: 'Descartar copia local' }).click();
      await expect(a.page.getByText('Eliminadas en el servidor')).toHaveCount(0);
      await expect(a.page.getByRole('button', { name: /Nota efímera/ })).toHaveCount(0);
      await a.page.reload();
      await expect(a.page.getByRole('button', { name: /Nota efímera/ })).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('un cliente conectado ve el borrado en directo y deja de sincronizar', async ({ browser }) => {
    const email = uniqueEmail('e2e34b');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS directo', 'Nota viva');
      await editor(a.page).fill('contenido compartido');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await login(b.page, email, 'WS directo', 'Nota viva');

      await deleteFirstNote(b);

      await expect(banner(a.page)).toBeVisible();
      await expect(editor(a.page)).toHaveValue('contenido compartido');
      await expect(editor(a.page)).toHaveJSProperty('readOnly', true);
      await expect(a.page.locator('.sync-status')).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
