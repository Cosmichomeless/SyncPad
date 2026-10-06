import { expect, test } from '@playwright/test';
import { editor, register, syncLabel, uniqueEmail } from './helpers';

test.describe('teclado y lector de pantalla (#56)', () => {
  test('crear, abrir y editar una nota funciona solo con teclado', async ({ page }) => {
    await register(page, uniqueEmail('e2e56'), 'WS teclado', 'Primera');

    // Crear: escribir el título y Enter envía el formulario; el foco termina en el editor de la nota nueva.
    await page.getByLabel('Nueva nota').focus();
    await page.keyboard.type('Segunda');
    await page.keyboard.press('Enter');
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveAccessibleDescription('Segunda');

    // Editar: lo escrito va a la nota y se confirma en el estado de sincronización.
    await page.keyboard.type('hola desde el teclado');
    await expect(editor(page)).toHaveValue('hola desde el teclado');
    await expect(syncLabel(page)).toHaveText('Al día');

    // Abrir: se llega a la otra nota con Tab/Shift+Tab y se activa con Enter; el foco vuelve al editor.
    const first = page.getByRole('button', { name: /Primera/ });
    await first.focus();
    await page.keyboard.press('Enter');
    await expect(first).toHaveAttribute('aria-current', 'true');
    await expect(editor(page)).toBeFocused();
    await expect(editor(page)).toHaveAccessibleDescription('Primera');
    await expect(editor(page)).toHaveValue('');

    // Y la edición de la segunda sigue ahí con la barra espaciadora como activador.
    const second = page.getByRole('button', { name: /Segunda/ });
    await second.focus();
    await page.keyboard.press('Space');
    await expect(editor(page)).toHaveValue('hola desde el teclado');
  });

  test('el enlace de salto, el foco visible y el formulario de enlace responden al teclado', async ({ page }) => {
    await register(page, uniqueEmail('e2e56b'), 'WS foco', 'Nota foco');

    await page.goto('/');
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Saltar al contenido' });
    await expect(skip).toBeFocused();
    await expect(skip).toBeInViewport();
    await page.keyboard.press('Enter');
    await expect(page.locator('main#principal')).toBeFocused();

    // Todo control enfocado con teclado tiene un contorno visible.
    const salir = page.getByRole('button', { name: 'Salir' });
    await salir.focus();
    expect(await salir.evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
    expect(await salir.evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);

    // El formulario de enlace recibe el foco al abrirse y Escape devuelve el foco al botón.
    await page.getByRole('button', { name: /Nota foco/ }).click();
    await expect(syncLabel(page)).toHaveText('Al día');
    const enlace = page.getByRole('button', { name: 'Enlace', exact: true });
    await enlace.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Dirección del enlace')).toBeFocused();
    await expect(enlace).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Dirección del enlace')).toHaveCount(0);
    await expect(enlace).toBeFocused();
  });

  test('el estado de sincronización es una región viva con texto y la presencia se anuncia como texto', async ({ page }) => {
    await register(page, uniqueEmail('e2e56c'), 'WS vivo', 'Nota viva');
    const status = page.locator('.sync-status [role="status"]');
    await expect(status).toHaveText('Al día');
    await expect(status).toHaveAttribute('aria-live', 'polite');
    await expect(page.locator('.sync-dot')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('.presence [role="status"]')).toContainText(/1 participante conectado: .*\(tú\)/);
  });
});
