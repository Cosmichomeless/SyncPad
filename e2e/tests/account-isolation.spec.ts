import { expect, test, type Page } from '@playwright/test';
import { editor, goOffline, goOnline, login, newClient, register, uniqueEmail, waitForServiceWorker } from './helpers';

const SECRET = 'secreto de Alice que Bob nunca debe ver';

async function logout(page: Page) {
  await page.getByRole('button', { name: 'Salir' }).click();
  await expect(page.getByRole('button', { name: 'Entrar' })).toBeVisible();
}

const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

test.describe('aislamiento de datos entre cuentas en un mismo navegador (#52)', () => {
  test('cerrar sesión y entrar con otra cuenta no muestra nada de la anterior, ni conectado ni sin red', async ({ browser }) => {
    const alice = uniqueEmail('e2e52a');
    const bob = uniqueEmail('e2e52b');
    const client = await newClient(browser);
    const { page } = client;
    try {
      await register(page, alice, 'WS Alice', 'Nota Alice');
      await editor(page).fill(SECRET);
      await expect(page.locator('.sync-status p')).toHaveText('Al día');
      await waitForServiceWorker(page);

      // Al salir, la interfaz privada desaparece al instante.
      await logout(page);
      expect(await bodyText(page)).not.toContain('WS Alice');
      expect(await bodyText(page)).not.toContain(SECRET);

      // Bob entra en el mismo navegador: su espacio está vacío de rastro de Alice.
      await register(page, bob, 'WS Bob', 'Nota Bob');
      await expect(page.getByRole('button', { name: /WS Alice/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Nota Alice/ })).toHaveCount(0);
      expect(await bodyText(page)).not.toContain(SECRET);

      // Sin red y tras recargar solo existe la caché de Bob.
      await goOffline(client);
      await page.reload();
      await expect(page.getByRole('button', { name: /WS Bob/ })).toBeVisible();
      await expect(page.getByRole('button', { name: /WS Alice/ })).toHaveCount(0);
      expect(await bodyText(page)).not.toContain(SECRET);
      const identity = await page.evaluate(() => window.localStorage.getItem('syncpad.offline-identity.v1') ?? '');
      expect(identity).toContain(bob);
      expect(identity).not.toContain(alice);
      await goOnline(client);

      // La copia de Alice no se pierde: queda aislada y vuelve con su cuenta, sin mezclarse con la de Bob.
      await logout(page);
      await login(page, alice, 'WS Alice', 'Nota Alice');
      await expect(editor(page)).toHaveValue(SECRET);
      await expect(page.getByRole('button', { name: /WS Bob/ })).toHaveCount(0);
      await expect(page.getByRole('button', { name: /Nota Bob/ })).toHaveCount(0);
    } finally {
      await client.context.close();
    }
  });
});
