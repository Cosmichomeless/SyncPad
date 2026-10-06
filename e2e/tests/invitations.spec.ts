import { expect, test } from '@playwright/test';
import { PASSWORD, newClient, register, uniqueEmail, type Client } from './helpers';

const members = (client: Client) => client.page.getByRole('list', { name: 'Miembros', exact: true });

/** Opens an invitation link, then signs up as `email`. Leaves the page on the signed-in shell. */
async function signUpViaLink({ page }: Client, link: string, email: string) {
  await page.goto(link);
  await expect(page.getByText('Has recibido una invitación a un workspace.')).toBeVisible();
  await expect.poll(() => new URL(page.url()).hash, { message: 'the token must leave the address bar' }).toBe('');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crear cuenta' }).click();
}

test.describe('invitaciones y miembros (#41)', () => {
  test('un propietario invita por enlace de un solo uso, el invitado entra como miembro sin controles y se le puede quitar', async ({ browser }) => {
    const ownerEmail = uniqueEmail('e2e41o');
    const guestEmail = uniqueEmail('e2e41g');
    const strangerEmail = uniqueEmail('e2e41s');
    const owner = await newClient(browser);
    const guest = await newClient(browser);
    const stranger = await newClient(browser);
    try {
      await register(owner.page, ownerEmail, 'Equipo 41', 'Nota compartida');
      await expect(members(owner)).toContainText(`${ownerEmail} (tú)`);
      await expect(members(owner)).toContainText('Propietario');

      // Invitar a quien ya es miembro se explica; el enlace solo aparece al crearlo.
      await owner.page.getByLabel('Invitar por email').fill(ownerEmail);
      await owner.page.getByRole('button', { name: 'Crear enlace de invitación' }).click();
      await expect(owner.page.getByRole('alert').filter({ hasText: 'ya es miembro' })).toBeVisible();

      await owner.page.getByLabel('Invitar por email').fill(guestEmail);
      await owner.page.getByRole('button', { name: 'Crear enlace de invitación' }).click();
      const link = await owner.page.getByLabel('Enlace de invitación').inputValue();
      expect(link).toMatch(/\/#invite=[A-Za-z0-9_-]{43}$/);
      await expect(owner.page.getByRole('list', { name: 'Invitaciones pendientes' })).toContainText(guestEmail);

      // Una segunda invitación vigente para el mismo email no pisa la primera.
      await owner.page.getByLabel('Invitar por email').fill(guestEmail);
      await owner.page.getByRole('button', { name: 'Crear enlace de invitación' }).click();
      await expect(owner.page.getByRole('alert').filter({ hasText: 'Revócala' })).toBeVisible();

      // Otra cuenta no puede usar el enlace (va dirigido a otro email) y no consume la invitación.
      await signUpViaLink(stranger, link, strangerEmail);
      await stranger.page.getByRole('button', { name: 'Aceptar invitación' }).click();
      await expect(stranger.page.getByRole('alert').filter({ hasText: 'no es válida' })).toBeVisible();
      await expect(stranger.page.getByRole('button', { name: /Equipo 41/ })).toHaveCount(0);

      // El invitado acepta y ve el workspace como miembro, sin controles de gestión.
      await signUpViaLink(guest, link, guestEmail);
      await guest.page.getByRole('button', { name: 'Aceptar invitación' }).click();
      await expect(guest.page.getByRole('button', { name: /Equipo 41/ })).toBeVisible();
      await expect(guest.page.getByText('Has recibido una invitación')).toHaveCount(0);
      await expect(members(guest)).toContainText(`${guestEmail} (tú)`);
      await expect(members(guest)).toContainText('Propietario');
      await expect(guest.page.getByRole('button', { name: 'Crear enlace de invitación' })).toHaveCount(0);
      await expect(guest.page.getByRole('button', { name: /^Quitar a/ })).toHaveCount(0);
      await expect(guest.page.getByText('Solo un propietario puede invitar o quitar miembros')).toBeVisible();
      await expect(guest.page.getByRole('button', { name: /Nota compartida/ })).toBeVisible();

      // El servidor tampoco deja gestionar al miembro aunque llame a la API a mano.
      const workspaceId = await guest.page.evaluate(async () => {
        const response = await fetch('http://127.0.0.1:4001/workspaces', { credentials: 'include' });
        return (await response.json()).workspaces[0].id as string;
      });
      const status = await guest.page.evaluate(async (id) => (await fetch(`http://127.0.0.1:4001/workspaces/${id}/invitations`, { credentials: 'include' })).status, workspaceId);
      expect(status).toBe(403);

      // El enlace es de un solo uso: una vez aceptado ya no sirve ni figura como pendiente.
      await owner.page.reload();
      await expect(members(owner)).toContainText(guestEmail);
      await expect(owner.page.getByRole('list', { name: 'Invitaciones pendientes' })).toHaveCount(0);
      await guest.page.goto(link);
      await guest.page.getByRole('button', { name: 'Aceptar invitación' }).click();
      await expect(guest.page.getByRole('alert').filter({ hasText: 'no es válida' })).toBeVisible();

      // El propietario quita al miembro: pierde el acceso al recargar.
      owner.page.once('dialog', (dialog) => void dialog.accept());
      await owner.page.getByRole('button', { name: `Quitar a ${guestEmail}` }).click();
      await expect(members(owner)).not.toContainText(guestEmail);
      await guest.page.reload();
      await expect(guest.page.getByRole('button', { name: /Equipo 41/ })).toHaveCount(0);
    } finally {
      await owner.context.close();
      await guest.context.close();
      await stranger.context.close();
    }
  });

  test('revocar una invitación pendiente invalida su enlace', async ({ browser }) => {
    const owner = await newClient(browser);
    const guest = await newClient(browser);
    const guestEmail = uniqueEmail('e2e41r');
    try {
      await register(owner.page, uniqueEmail('e2e41ro'), 'Equipo revocar', 'Nota');
      await owner.page.getByLabel('Invitar por email').fill(guestEmail);
      await owner.page.getByRole('button', { name: 'Crear enlace de invitación' }).click();
      const link = await owner.page.getByLabel('Enlace de invitación').inputValue();
      await owner.page.getByRole('button', { name: `Revocar invitación de ${guestEmail}` }).click();
      await expect(owner.page.getByRole('list', { name: 'Invitaciones pendientes' })).toHaveCount(0);

      await signUpViaLink(guest, link, guestEmail);
      await guest.page.getByRole('button', { name: 'Aceptar invitación' }).click();
      await expect(guest.page.getByRole('alert').filter({ hasText: 'no es válida' })).toBeVisible();
    } finally {
      await owner.context.close();
      await guest.context.close();
    }
  });
});
