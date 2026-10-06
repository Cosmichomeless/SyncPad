import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import { PASSWORD, editor, goOffline, login, newClient, openNote, register, syncLabel, type Client } from '../tests/helpers';

// Seeded data for the README screenshots: the same two people, workspace and notes in every image.
const ANA = 'ana.garcia@example.com';
const LUIS = 'luis.martin@example.com';
const WORKSPACE = 'Equipo de producto';
const MAIN_NOTE = 'Acta de la reunión semanal';
const OTHER_NOTES: Array<[title: string, content: string]> = [
  ['Ideas para el lanzamiento', 'Mensaje principal: notas compartidas que siguen funcionando sin conexión.\nPúblico: equipos pequeños que editan en trenes, aviones y salas sin cobertura.'],
  ['Checklist de release', 'Pasar la batería de pruebas completa.\nRevisar los límites conocidos en el README.\nEtiquetar la versión.'],
];
const MINUTES = [
  'Asistentes: Ana García y Luis Martín.',
  'Acuerdos de hoy:',
  'Publicar la versión 1.0 el viernes',
  'Revisar la documentación de despliegue',
  'Preparar la demostración sin conexión',
  'Hoja de ruta completa: roadmap',
].join('\n');

const OUT = (name: string) => fileURLToPath(new URL(`../../docs/screenshots/${name}.png`, import.meta.url));
const preview = (page: Page) => page.getByRole('region', { name: 'Vista con formato' });

/** Every shot starts from the top of the page, whatever the last interaction scrolled to. */
async function shoot(page: Page, name: string, clip?: { x: number; y: number; width: number; height: number }) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: OUT(name), clip });
}

// The app column is 720 px wide and centred; these crops drop the empty margins of the tall viewport.
const LOGIN_CROP = { x: 240, y: 60, width: 800, height: 640 };
const APP_CROP = { x: 240, y: 90, width: 800, height: 1380 };

/** Selects `text` inside the editor with the keyboard, as a person would, so the app sees real selection events. */
async function selectText(page: Page, content: string, text: string) {
  const from = content.indexOf(text);
  expect(from, `"${text}" is in the note`).toBeGreaterThanOrEqual(0);
  await editor(page).focus();
  await page.keyboard.press('ControlOrMeta+ArrowUp');
  for (let index = 0; index < from; index++) await page.keyboard.press('ArrowRight');
  for (let index = 0; index < text.length; index++) await page.keyboard.press('Shift+ArrowRight');
}

async function format(page: Page, content: string, text: string, button: string) {
  await selectText(page, content, text);
  await page.getByRole('button', { name: button, exact: true }).click();
}

async function addNote(page: Page, title: string, content: string) {
  await page.getByLabel('Nueva nota').fill(title);
  await page.getByRole('button', { name: 'Añadir' }).click();
  await page.getByRole('button', { name: new RegExp(title) }).click();
  await editor(page).fill(content);
  await expect(syncLabel(page)).toHaveText('Al día');
}

async function invite(owner: Client, guest: Client, email: string) {
  await owner.page.getByLabel('Invitar por email').fill(email);
  await owner.page.getByRole('button', { name: 'Crear enlace de invitación' }).click();
  const link = await owner.page.getByLabel('Enlace de invitación').inputValue();
  await guest.page.goto(link);
  await guest.page.getByLabel('Email').fill(email);
  await guest.page.getByLabel('Contraseña').fill(PASSWORD);
  await guest.page.getByRole('button', { name: 'Crear cuenta' }).click();
  await guest.page.getByRole('button', { name: 'Aceptar invitación' }).click();
}

test('capturas del README con datos sembrados', async ({ browser }) => {
  const ana = await newClient(browser);
  const luis = await newClient(browser);
  try {
    // 01 · login
    await ana.page.goto('/');
    await expect(ana.page.getByRole('button', { name: 'Entrar' })).toBeVisible();
    await shoot(ana.page, '01-login', LOGIN_CROP);

    // Seed: Ana creates the workspace and three notes with formatted content.
    await register(ana.page, ANA, WORKSPACE, MAIN_NOTE);
    await editor(ana.page).fill(MINUTES);
    await expect(syncLabel(ana.page)).toHaveText('Al día');
    await format(ana.page, MINUTES, 'Publicar la versión 1.0 el viernes\nRevisar la documentación de despliegue\nPreparar la demostración sin conexión', 'Lista');
    const withList = await editor(ana.page).inputValue();
    await format(ana.page, withList, 'versión 1.0', 'Negrita');
    await format(ana.page, await editor(ana.page).inputValue(), 'Acuerdos de hoy:', 'Negrita');
    await selectText(ana.page, await editor(ana.page).inputValue(), 'roadmap');
    await ana.page.getByRole('button', { name: 'Enlace', exact: true }).click();
    await ana.page.getByLabel('Dirección del enlace').fill('https://example.com/roadmap');
    await ana.page.getByRole('button', { name: 'Aplicar enlace' }).click();
    for (const [title, content] of OTHER_NOTES) await addNote(ana.page, title, content);
    await ana.page.getByRole('button', { name: new RegExp(MAIN_NOTE) }).click();
    await expect(syncLabel(ana.page)).toHaveText('Al día');
    await expect(preview(ana.page).locator('strong').first()).toBeVisible();
    await expect(preview(ana.page).locator('a')).toHaveAttribute('href', 'https://example.com/roadmap');

    // 02 · notes
    await shoot(ana.page, '02-notas', APP_CROP);

    // 03 · collaboration: Luis joins through an invitation and selects a line Ana sees live.
    await invite(ana, luis, LUIS);
    await openNote(luis.page, WORKSPACE, MAIN_NOTE);
    // The one-time invitation link is already used; reloading hides its box from the shot.
    await ana.page.reload();
    await openNote(ana.page, WORKSPACE, MAIN_NOTE);
    const shared = await editor(luis.page).inputValue();
    await selectText(luis.page, shared, 'Revisar la documentación de despliegue');
    const participants = ana.page.getByRole('list', { name: 'Participantes conectados' });
    await expect(participants.getByRole('listitem')).toHaveCount(2);
    await expect(ana.page.getByRole('list', { name: 'Selecciones de otros participantes' }).locator('mark')).toBeVisible();
    await ana.page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await expect(ana.page.getByRole('button', { name: `Quitar a ${LUIS}` })).toBeVisible();
    await shoot(ana.page, '03-colaboracion', APP_CROP);

    // 04 · offline: Ana loses the network and keeps writing; the edit waits on the device.
    await goOffline(ana);
    await editor(ana.page).focus();
    await ana.page.keyboard.press('ControlOrMeta+ArrowDown');
    await ana.page.keyboard.type('\nPendiente: confirmar la fecha con ventas');
    await expect(ana.page.getByText('Cambios locales guardados en este dispositivo')).toBeVisible();
    await shoot(ana.page, '04-sin-conexion', APP_CROP);
  } finally {
    await ana.context.close();
    await luis.context.close();
  }

  // 05 · mobile: the same account on a phone-sized screen.
  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  try {
    const page = await phone.newPage();
    await login(page, ANA, WORKSPACE, MAIN_NOTE);
    // Scroll to the editor, which on a phone sits below the workspace and notes lists.
    await page.locator('article.editor-preview').evaluate((element) => element.scrollIntoView({ block: 'start' }));
    await page.screenshot({ path: OUT('05-movil') });
  } finally {
    await phone.close();
  }
});
