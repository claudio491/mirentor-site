// The third wave on the phone: the example team made for an earlier day offers "Actualizar equipo de ejemplo"; a
// teammate's line counts active sites; what voided sites still bring this week is its own line.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { exampleActions } from '../team/practice-steps.js';
import { mateLine, mateCard, goneLine } from '../team/sites-steps.js';
import { makeT } from '../team/i18n.js';

const es = makeT('es'), en = makeT('en');

test('the example team from an earlier day offers to update it; from today it does not', () => {
  assert.deepEqual(exampleActions({ example: [{ id: 'r_a' }], exampleStale: true }, 'admin'), ['view', 'refresh', 'remove']);
  assert.deepEqual(exampleActions({ example: [{ id: 'r_a' }], exampleStale: false }, 'manager'), ['view', 'remove']);
  assert.deepEqual(exampleActions({ example: [{ id: 'r_a' }], exampleStale: true }, 'rep'), []);
  assert.equal(es('reps.example.refresh'), 'Actualizar equipo de ejemplo');
  assert.equal(en('reps.example.refresh'), 'Update example team');
});

test('a teammate\'s line counts active sites', () => {
  const crew = { id: 'r_b', sites: [{ name: 'Sitio de ejemplo 3', workers: 3, minutes: 640 }], minutes: 640, cents: 1067 };
  assert.equal(mateLine(crew, es), '1 sitio activo · 10 h 40 min · US$10.67');
  assert.equal(mateLine({ ...crew, sites: [] }, en), '0 active sites · 10 h 40 min · US$10.67');
});

test('what sites voided this week still bring reads as its own line, in both languages; none, no line', () => {
  assert.equal(goneLine({ minutes: 20, cents: 33 }, es), 'Sitios anulados esta semana: 20 min · US$0.33');
  assert.equal(goneLine({ minutes: 20, cents: null }, en), 'Sites voided this week: 20 min · amount to be defined');
  assert.equal(goneLine(undefined, es), null);
  const card = mateCard({ id: 'r_b', sites: [], minutes: 20, cents: 33, gone: { minutes: 20, cents: 33 } }, 100, es);
  assert.equal(card.gone, 'Sitios anulados esta semana: 20 min · US$0.33');
  assert.equal(mateCard({ id: 'r_b', sites: [], minutes: 0, cents: 0 }, 100, es).gone, null);
});
