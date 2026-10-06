import { expect, test, type Page } from '@playwright/test';
import { editor, login, newClient, register, syncLabel, uniqueEmail } from './helpers';

const select = (page: Page, from: number, to: number) => editor(page).evaluate((element, [start, end]) => {
  const area = element as HTMLTextAreaElement;
  area.focus();
  area.setSelectionRange(start, end);
}, [from, to]);

const preview = (page: Page) => page.getByRole('region', { name: 'Vista con formato' });

test.describe('formato enriquecido acotado (#39)', () => {
  test('negrita, lista y enlace se sincronizan entre dos clientes', async ({ browser }) => {
    const email = uniqueEmail('e2e39');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS formato', 'Nota con formato');
      await editor(a.page).fill('hola mundo\nleche\npan');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await login(b.page, email, 'WS formato', 'Nota con formato');
      await expect(editor(b.page)).toHaveValue('hola mundo\nleche\npan');

      // A: negrita sobre «mundo»
      await select(a.page, 5, 10);
      await a.page.getByRole('button', { name: 'Negrita' }).click();
      await expect(preview(b.page).locator('strong')).toHaveText('mundo');

      // A: lista con las dos últimas líneas
      await select(a.page, 11, 20);
      await a.page.getByRole('button', { name: 'Lista' }).click();
      await expect(preview(b.page).locator('ul > li')).toHaveText(['leche', 'pan']);
      await expect(editor(b.page)).toHaveValue('hola mundo\n- leche\n- pan');

      // B: enlace sobre «hola»
      await select(b.page, 0, 4);
      await b.page.getByRole('button', { name: 'Enlace', exact: true }).click();
      await b.page.getByLabel('Dirección del enlace').fill('https://example.com/');
      await b.page.getByRole('button', { name: 'Aplicar enlace' }).click();
      const link = preview(a.page).getByRole('link', { name: 'hola' });
      await expect(link).toHaveAttribute('href', 'https://example.com/');
      await expect(link).toHaveAttribute('rel', /noopener/);
      await expect(link).toHaveAttribute('target', '_blank');

      // El texto plano no cambió y ambos siguen al día.
      await expect(editor(a.page)).toHaveValue('hola mundo\n- leche\n- pan');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await expect(syncLabel(b.page)).toHaveText('Al día');

      // El formato sobrevive a recargar (IndexedDB + servidor).
      await a.page.reload();
      await a.page.getByRole('button', { name: /Nota con formato/ }).click();
      await expect(preview(a.page).locator('strong')).toHaveText('mundo');
      await expect(preview(a.page).getByRole('link', { name: 'hola' })).toBeVisible();
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });

  test('un enlace javascript: se rechaza y el HTML escrito se muestra como texto', async ({ browser }) => {
    const a = await newClient(browser);
    const dialogs: string[] = [];
    a.page.on('dialog', async (dialog) => { dialogs.push(dialog.message()); await dialog.dismiss(); });
    try {
      await register(a.page, uniqueEmail('e2e39x'), 'WS seguro', 'Nota segura');
      const hostile = '<img src=x onerror=alert(1)> <script>alert(2)</script>';
      await editor(a.page).fill(hostile);
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await expect(preview(a.page)).toContainText(hostile);
      await expect(preview(a.page).locator('img, script')).toHaveCount(0);

      await select(a.page, 0, 5);
      await a.page.getByRole('button', { name: 'Enlace', exact: true }).click();
      await a.page.getByLabel('Dirección del enlace').fill('javascript:alert(3)');
      // type=url del navegador deja pasar javascript:; la aplicación lo rechaza.
      await a.page.getByRole('button', { name: 'Aplicar enlace' }).click();
      await expect(a.page.locator('.format-hint')).toContainText('http(s)://');
      await expect(preview(a.page).locator('a')).toHaveCount(0);
      expect(dialogs).toEqual([]);
    } finally {
      await a.context.close();
    }
  });
});
