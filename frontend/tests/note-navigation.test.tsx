import assert from 'node:assert/strict';
import test from 'node:test';
import { createDrainRegistry } from '../src/lib/note-drain';
import { noteStatusLabel } from '../src/lib/note-navigation';

const base = { active: false, syncState: 'up-to-date' as const, unsent: false, fallback: 'Actualizada 1/10/2026' };

test('the active note shows its sync state and any unsent edits', () => {
  assert.equal(noteStatusLabel({ ...base, active: true }), 'Al día');
  assert.equal(noteStatusLabel({ ...base, active: true, syncState: 'syncing', unsent: true }), 'Sincronizando');
  assert.equal(noteStatusLabel({ ...base, active: true, syncState: 'offline', unsent: true }), 'Sin conexión · cambios sin enviar');
});

test('inactive notes only stand out when they hold unsent edits, and deleted notes say so', () => {
  assert.equal(noteStatusLabel(base), 'Actualizada 1/10/2026');
  assert.equal(noteStatusLabel({ ...base, unsent: true }), 'Cambios sin enviar');
  assert.equal(noteStatusLabel({ ...base, active: true, deleted: true }), 'Eliminada en el servidor');
});

test('a held session is released only when it settles', () => {
  const seen: string[][] = [];
  const registry = createDrainRegistry((ids) => seen.push(ids));
  let released = 0;
  const settle = registry.hold('n1', () => { released++; });
  assert.deepEqual(registry.ids(), ['n1']);
  assert.equal(released, 0);
  settle(); settle();
  assert.equal(released, 1, 'release runs once');
  assert.deepEqual(registry.ids(), []);
  assert.deepEqual(seen, [['n1'], []]);
});

test('a held session is released after the timeout so it cannot leak', async () => {
  const registry = createDrainRegistry(() => {}, 10);
  let released = 0;
  registry.hold('n1', () => { released++; });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(released, 1);
  assert.deepEqual(registry.ids(), []);
});

test('clear releases every held session at once', () => {
  const registry = createDrainRegistry(() => {});
  let released = 0;
  registry.hold('a', () => { released++; });
  registry.hold('b', () => { released++; });
  registry.clear();
  assert.equal(released, 2);
  assert.deepEqual(registry.ids(), []);
});
