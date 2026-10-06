import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, editor, newClient, openNote, register, syncLabel, uniqueEmail, type Client } from './helpers';

const preview = (page: Page) => page.getByRole('region', { name: 'Vista con formato' });
const participants = (page: Page) => page.getByRole('list', { name: 'Participantes conectados' });
const selections = (page: Page) => page.getByRole('list', { name: 'Selecciones de otros participantes' });

async function select(page: Page, from: number, to: number) {
  await editor(page).focus();
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  for (let index = 0; index < from; index++) await page.keyboard.press('ArrowRight');
  for (let index = from; index < to; index++) await page.keyboard.press('Shift+ArrowRight');
}

/** The owner invites `email` through the UI and the guest signs up and accepts the link. */
async function joinByInvitation(owner: Client, guest: Client, email: string) {
  await owner.page.getByLabel('Invitar por email').fill(email);
  await owner.page.getByRole('button', { name: 'Crear enlace de invitación' }).click();
  const link = await owner.page.getByLabel('Enlace de invitación').inputValue();
  await guest.page.goto(link);
  await guest.page.getByLabel('Email').fill(email);
  await guest.page.getByLabel('Contraseña').fill(PASSWORD);
  await guest.page.getByRole('button', { name: 'Crear cuenta' }).click();
  await guest.page.getByRole('button', { name: 'Aceptar invitación' }).click();
}

test.describe('editor y gestión de miembros entre cuentas distintas (#43)', () => {
  test('propietario y miembro colaboran con formato y presencia, y ven controles acordes a su rol', async ({ browser }) => {
    const ownerEmail = uniqueEmail('e2e43o');
    const guestEmail = uniqueEmail('e2e43g');
    const owner = await newClient(browser);
    const guest = await newClient(browser);
    try {
      await register(owner.page, ownerEmail, 'WS roles', 'Nota roles');
      await editor(owner.page).fill('hola mundo');
      await expect(syncLabel(owner.page)).toHaveText('Al día');
      await joinByInvitation(owner, guest, guestEmail);
      await openNote(guest.page, 'WS roles', 'Nota roles');
      await expect(editor(guest.page)).toHaveValue('hola mundo');

      // Presencia: dos cuentas distintas, cada una se ve a sí misma como «(tú)» y a la otra por su email.
      await expect(participants(owner.page).getByRole('listitem')).toHaveCount(2);
      await expect(participants(guest.page).getByRole('listitem')).toHaveCount(2);
      await expect(participants(owner.page).locator(`[title="${guestEmail}"]`)).toBeVisible();
      await expect(participants(guest.page).locator(`[title="${ownerEmail}"]`)).toBeVisible();
      await expect(participants(guest.page).locator(`[title="${guestEmail}"]`)).toContainText('(tú)');

      // El propietario formatea y el miembro lo ve.
      await select(owner.page, 5, 10);
      await owner.page.getByRole('button', { name: 'Negrita' }).click();
      await expect(preview(guest.page).locator('strong')).toHaveText('mundo');
      await expect(selections(guest.page).locator('mark')).toHaveText('mundo');

      // El miembro también puede formatear (puede editar) y el propietario lo ve.
      await select(guest.page, 0, 4);
      await guest.page.getByRole('button', { name: 'Negrita' }).click();
      await expect(preview(owner.page).locator('strong')).toHaveText(['hola', 'mundo']);
      await expect(syncLabel(owner.page)).toHaveText('Al día');
      await expect(syncLabel(guest.page)).toHaveText('Al día');

      // Controles por rol. La lista del propietario se refresca al recuperar el foco.
      await owner.page.evaluate(() => window.dispatchEvent(new Event('focus')));
      await expect(owner.page.getByRole('button', { name: 'Crear enlace de invitación' })).toBeVisible();
      await expect(owner.page.getByRole('button', { name: `Quitar a ${guestEmail}` })).toBeVisible();
      await expect(owner.page.getByRole('button', { name: `Quitar a ${ownerEmail}` })).toHaveCount(0);
      await expect(guest.page.getByRole('button', { name: 'Crear enlace de invitación' })).toHaveCount(0);
      await expect(guest.page.getByRole('button', { name: /^Quitar a/ })).toHaveCount(0);
      await expect(guest.page.getByRole('list', { name: 'Miembros', exact: true })).toContainText(ownerEmail);
      await expect(guest.page.getByText('Solo un propietario puede invitar o quitar miembros.')).toBeVisible();
    } finally {
      await owner.context.close();
      await guest.context.close();
    }
  });
});
