import { expect, test, type Page } from '@playwright/test';
import { editor, login, newClient, register, syncLabel, uniqueEmail } from './helpers';

/** Selects with the keyboard so the page sees the same events a person would cause. */
async function select(page: Page, from: number, to: number) {
  await editor(page).focus();
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  for (let index = 0; index < from; index++) await page.keyboard.press('ArrowRight');
  for (let index = from; index < to; index++) await page.keyboard.press('Shift+ArrowRight');
}

const participants = (page: Page) => page.getByRole('list', { name: 'Participantes conectados' });
const selections = (page: Page) => page.getByRole('list', { name: 'Selecciones de otros participantes' });

test.describe('participantes y cursores (#40)', () => {
  test('se ve a quien está conectado, su selección sigue al texto y desaparece al irse', async ({ browser }) => {
    const email = uniqueEmail('e2e40');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS presencia', 'Nota viva');
      await editor(a.page).fill('hola mundo');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      // Sola en la nota: solo aparece ella misma.
      await expect(participants(a.page).getByRole('listitem')).toHaveCount(1);
      await expect(participants(a.page)).toContainText('(tú)');
      await expect(selections(a.page)).toHaveCount(0);

      await login(b.page, email, 'WS presencia', 'Nota viva');
      // La misma cuenta en dos clientes es un único participante con dos conexiones.
      await expect(participants(a.page).getByRole('listitem')).toHaveCount(1);
      await expect(participants(a.page)).toContainText('2 pestañas');
      await expect(participants(b.page)).toContainText('2 pestañas');

      // B selecciona «mundo»: A lo ve resaltado, y B no se ve a sí mismo.
      await select(b.page, 5, 10);
      await expect(selections(a.page).locator('mark')).toHaveText('mundo');
      await expect(selections(b.page)).toHaveCount(0);

      // Si A escribe delante, la selección de B sigue señalando «mundo».
      await editor(a.page).fill('¡¡¡ hola mundo');
      await expect(selections(a.page).locator('mark')).toHaveText('mundo');
      await expect(editor(b.page)).toHaveValue('¡¡¡ hola mundo');

      // B se va: desaparece la selección y A conserva el documento intacto.
      await b.context.close();
      await expect(participants(a.page)).not.toContainText('2 pestañas');
      await expect(selections(a.page)).toHaveCount(0);
      await expect(editor(a.page)).toHaveValue('¡¡¡ hola mundo');
      await expect(syncLabel(a.page)).toHaveText('Al día');
    } finally {
      await a.context.close();
      await b.context.close().catch(() => {});
    }
  });
});
