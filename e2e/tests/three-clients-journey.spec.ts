import { expect, test, type Page } from '@playwright/test';
import { editor, goOffline, goOnline, login, newClient, register, startBackend, stopBackend, syncLabel, uniqueEmail, waitForServiceWorker } from './helpers';

const valueOf = (page: Page) => editor(page).inputValue();

/** Types at the start or end of the note, leaving the rest alone (a real edit, not a whole-text replacement). */
async function typeAt(page: Page, where: 'start' | 'end', text: string) {
  await editor(page).focus();
  await editor(page).evaluate((element, position) => {
    const area = element as HTMLTextAreaElement;
    const offset = position === 'start' ? 0 : area.value.length;
    area.setSelectionRange(offset, offset);
  }, where);
  await page.keyboard.insertText(text);
}
const occurrences = (text: string, fragment: string) => text.split(fragment).length - 1;

test.describe('recorrido de tres clientes con uno sin red y un reinicio del servidor (#55)', () => {
  test('todos convergen con el mismo contenido y los cambios confirmados sobreviven al reinicio', async ({ browser }) => {
    test.setTimeout(120_000);
    const email = uniqueEmail('e2e55');
    const [a, b, c] = await Promise.all([newClient(browser), newClient(browser), newClient(browser)]);
    try {
      await register(a.page, email, 'WS tres clientes', 'Nota tres');
      await editor(a.page).fill('base');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await waitForServiceWorker(c.page).catch(() => undefined);
      await login(b.page, email, 'WS tres clientes', 'Nota tres');
      await login(c.page, email, 'WS tres clientes', 'Nota tres');
      for (const client of [a, b, c]) await expect(editor(client.page)).toHaveValue('base');
      await waitForServiceWorker(c.page);

      // C pierde la red y edita: esos cambios existen solo en su dispositivo.
      await goOffline(c);
      await typeAt(c.page, 'end', '\nC sin red');
      await expect(c.page.locator('.pending')).toBeVisible();

      // A y B, conectados, editan a la vez en puntos distintos de la nota y se confirman.
      await typeAt(a.page, 'start', 'A al inicio\n');
      await typeAt(b.page, 'end', '\nB al final');
      for (const client of [a, b]) await expect(syncLabel(client.page)).toHaveText('Al día');
      await expect.poll(() => valueOf(a.page)).toContain('B al final');
      await expect.poll(() => valueOf(b.page)).toContain('A al inicio');
      const confirmed = await valueOf(a.page);

      // El servidor se reinicia con C aún sin red: lo confirmado vive en PostgreSQL, no en el proceso.
      await stopBackend();
      await expect(syncLabel(a.page)).not.toHaveText('Al día');
      await expect(syncLabel(b.page)).not.toHaveText('Al día');
      await typeAt(b.page, 'end', '\nB durante la caída');
      await expect(b.page.locator('.pending')).toBeVisible();
      await startBackend();

      // A y B reconectan solos: nada de lo confirmado se perdió y el cambio hecho durante la caída llega.
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await expect(syncLabel(b.page)).toHaveText('Al día');
      await expect.poll(() => valueOf(a.page)).toContain('B durante la caída');
      for (const line of confirmed.split('\n')) expect(await valueOf(a.page)).toContain(line);

      // C vuelve y aporta lo suyo: los tres acaban idénticos y cada cambio aparece exactamente una vez.
      await goOnline(c);
      for (const client of [a, b, c]) await expect(syncLabel(client.page)).toHaveText('Al día');
      await expect.poll(async () => (await valueOf(a.page)).includes('C sin red')).toBe(true);
      const [finalA, finalB, finalC] = await Promise.all([valueOf(a.page), valueOf(b.page), valueOf(c.page)]);
      expect(finalB).toBe(finalA);
      expect(finalC).toBe(finalA);
      for (const fragment of ['A al inicio', 'B al final', 'B durante la caída', 'C sin red']) {
        expect(occurrences(finalA, fragment), fragment).toBe(1);
      }
      await expect(c.page.locator('.pending')).toHaveCount(0);

      // Un cliente nuevo que carga desde el servidor ve exactamente lo mismo.
      const d = await newClient(browser);
      try {
        await login(d.page, email, 'WS tres clientes', 'Nota tres');
        await expect(editor(d.page)).toHaveValue(finalA);
      } finally {
        await d.context.close();
      }
    } finally {
      await Promise.all([a.context.close(), b.context.close(), c.context.close()]);
    }
  });
});
