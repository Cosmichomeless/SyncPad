import { expect, test } from '@playwright/test';
import { editor, goOffline, goOnline, login, newClient, openNote, register, syncLabel, uniqueEmail, waitForServiceWorker } from './helpers';

test.describe('desconexión, recarga y reconexión (#31)', () => {
  test('un cliente sin red edita, recarga y converge con el que siguió conectado', async ({ browser }) => {
    const email = uniqueEmail('e2e31a');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS offline', 'Nota offline');
      await editor(a.page).fill('base compartida');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await waitForServiceWorker(a.page);

      await login(b.page, email, 'WS offline', 'Nota offline');
      await expect(editor(b.page)).toHaveValue('base compartida');

      // A queda sin red, edita y recarga: el texto local sobrevive a la recarga sin servidor.
      await goOffline(a);
      await editor(a.page).fill('base compartida + cambios sin red');
      await expect(a.page.locator('.pending')).toBeVisible();
      await a.page.reload();
      await openNote(a.page, 'WS offline', 'Nota offline').catch(() => undefined);
      await expect(editor(a.page)).toHaveValue('base compartida + cambios sin red');
      await expect(syncLabel(a.page)).not.toHaveText('Al día');

      // B edita conectado durante la desconexión de A.
      await editor(b.page).fill('Remoto: base compartida');
      await expect(syncLabel(b.page)).toHaveText('Al día');

      // Al volver la red ambos convergen exactamente en la fusión y quedan al día.
      await goOnline(a);
      const merged = 'Remoto: base compartida + cambios sin red';
      await expect(editor(a.page)).toHaveValue(merged);
      await expect(editor(b.page)).toHaveValue(merged);
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await expect(syncLabel(b.page)).toHaveText('Al día');
      await expect(a.page.locator('.pending')).toHaveCount(0);
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('tras la fusión una recarga completa conserva el contenido del servidor sin duplicados', async ({ browser }) => {
    const email = uniqueEmail('e2e31b');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS merge', 'Nota merge');
      await editor(a.page).fill('uno');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await login(b.page, email, 'WS merge', 'Nota merge');
      await expect(editor(b.page)).toHaveValue('uno');

      await goOffline(a);
      await editor(a.page).fill('uno dos');
      await editor(b.page).fill('cero uno');
      await expect(syncLabel(b.page)).toHaveText('Al día');
      await goOnline(a);

      await expect(editor(a.page)).toHaveValue('cero uno dos');
      await expect(editor(b.page)).toHaveValue('cero uno dos');
      await expect(syncLabel(a.page)).toHaveText('Al día');

      await b.page.reload();
      await openNote(b.page, 'WS merge', 'Nota merge').catch(() => undefined);
      await expect(editor(b.page)).toHaveValue('cero uno dos');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
