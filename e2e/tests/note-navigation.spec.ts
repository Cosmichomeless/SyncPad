import { expect, test } from '@playwright/test';
import { editor, goOffline, goOnline, login, newClient, openNote, register, syncLabel, uniqueEmail } from './helpers';

test.describe('navegación entre notas (#42)', () => {
  test('cambiar de nota sin red no descarta las ediciones y se envían al volver', async ({ browser }) => {
    const email = uniqueEmail('e2e42');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS navegación', 'Nota A');
      await a.page.getByLabel('Nueva nota').fill('Nota B');
      await a.page.getByRole('button', { name: 'Añadir' }).click();
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await a.page.getByRole('button', { name: /Nota A/ }).click();
      await expect(syncLabel(a.page)).toHaveText('Al día');

      // La nota activa está marcada y muestra su estado de sincronización.
      const cardA = a.page.getByRole('button', { name: /Nota A/ });
      await expect(cardA).toHaveAttribute('aria-current', 'true');
      await expect(cardA).toContainText('Al día');
      await expect(a.page).toHaveTitle('Nota A · SyncPad');

      await goOffline(a);
      await editor(a.page).fill('edición hecha sin red');
      await expect(cardA).toContainText('cambios sin enviar');

      // Cambiar de nota: la edición no se pierde y la nota avisa de que sigue sin enviar.
      await a.page.getByRole('button', { name: /Nota B/ }).click();
      await expect(a.page.getByRole('button', { name: /Nota B/ })).toHaveAttribute('aria-current', 'true');
      await expect(cardA).not.toHaveAttribute('aria-current', 'true');
      await expect(cardA).toContainText('Cambios sin enviar');
      await expect(a.page).toHaveTitle('Nota B · SyncPad');

      // Al volver la red, la nota abandonada termina de subir sin tener que reabrirla.
      await goOnline(a);
      await expect(cardA).not.toContainText('Cambios sin enviar');
      await login(b.page, email, 'WS navegación', 'Nota A');
      await expect(editor(b.page)).toHaveValue('edición hecha sin red');

      // Y al reabrirla en el cliente original sigue ahí.
      await openNote(a.page, 'WS navegación', 'Nota A');
      await expect(editor(a.page)).toHaveValue('edición hecha sin red');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
