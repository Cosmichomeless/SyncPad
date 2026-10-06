import { expect, test } from '@playwright/test';
import { editor, login, newClient, register, syncLabel, uniqueEmail } from './helpers';

test.describe('deshacer y rehacer solo con ediciones propias (#36)', () => {
  test('Ctrl/Cmd+Z deshace lo escrito aquí y conserva lo que escribió el otro participante', async ({ browser }) => {
    const email = uniqueEmail('e2e36');
    const a = await newClient(browser);
    const b = await newClient(browser);
    try {
      await register(a.page, email, 'WS deshacer', 'Nota compartida');
      await editor(a.page).fill('base');
      await expect(syncLabel(a.page)).toHaveText('Al día');
      await login(b.page, email, 'WS deshacer', 'Nota compartida');
      await expect(editor(b.page)).toHaveValue('base');

      // Línea de una sola palabra: Cmd+flecha (macOS) y Ctrl+flecha (Linux) llevan al borde.
      // B escribe al principio; A escribe al final, con pausa entre ambos pasos.
      await editor(b.page).click();
      await b.page.keyboard.press('ControlOrMeta+ArrowLeft');
      await b.page.keyboard.type('B: ');
      await expect(editor(a.page)).toHaveValue('B: base');

      // Una pausa mayor que la ventana de agrupación (500 ms) separa esta edición de la anterior.
      await a.page.waitForTimeout(700);
      await editor(a.page).click();
      await a.page.keyboard.press('ControlOrMeta+ArrowRight');
      await a.page.keyboard.type(' + A');
      await expect(editor(b.page)).toHaveValue('B: base + A');

      // Deshacer en A solo quita lo de A, y B lo ve.
      await a.page.keyboard.press('ControlOrMeta+z');
      await expect(editor(a.page)).toHaveValue('B: base');
      await expect(editor(b.page)).toHaveValue('B: base');

      // Rehacer lo devuelve.
      await a.page.keyboard.press('ControlOrMeta+Shift+z');
      await expect(editor(a.page)).toHaveValue('B: base + A');
      await expect(editor(b.page)).toHaveValue('B: base + A');

      // Seguir deshaciendo en A nunca revierte lo de B: tras agotar su historial queda el texto de B.
      for (let step = 0; step < 4; step++) await a.page.keyboard.press('ControlOrMeta+z');
      await expect(editor(a.page)).toHaveValue('B: ');
      await expect(editor(b.page)).toHaveValue('B: ');
      await expect(syncLabel(a.page)).toHaveText('Al día');
    } finally {
      await a.context.close();
      await b.context.close();
    }
  });
});
