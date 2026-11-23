// The CRM's Owner column names a rep the way a person writes it ("José Antonio Lima"), not by the app's id or handle.
// The bridge sends that name; the app finds the one active rep it means, or refuses the row when it cannot be sure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { activityRows, nameKey } from '../lib/team/crm.mjs';

const NOW = '2026-11-19T20:00:00.000Z';
const L1 = { id: 'PA-0001', name: 'Negocio de ejemplo' };
const rep = (id, name, extra = {}) => ({ type: 'rep.created', id, handle: id.slice(2), email: `${id.slice(2)}@example.com`, name, role: 'rep', country: 'PA', city: 'Panama City', tz: 'America/Panama', workdays: [1, 2, 3, 4, 5], lang: 'es', ...extra });

function stateWith(events) {
  const s = emptyState();
  events.forEach((e, i) => applyEvent(s, { t: `2026-11-10T1${i % 10}:00:00.000Z`, ...e }));
  return s;
}
const row = (id, who) => ({ id, rep: who, day: '2026-11-18', kind: 'talk', channel: 'visit', lead: L1 });

test('nameKey drops accents, case and punctuation', () => {
  assert.equal(nameKey('  José  Antonio   LIMA. '), 'jose antonio lima');
  assert.equal(nameKey(''), '');
  assert.equal(nameKey(null), '');
});

test('an Owner name finds its rep: exact, with accents, or with a middle name more or less', () => {
  const s = stateWith([rep('r_mateo', 'Mateo Rivas'), rep('r_jose', 'Jose Lima'), rep('r_nico', 'Nicolás Vega')]);
  const r = activityRows(s, { source: 'crm', rows: [row('crm_N-1', 'Mateo Rivas'), row('crm_N-2', 'José Antonio Lima'), row('crm_N-3', 'nicolas vega')] }, { now: NOW });
  assert.equal(r.refused, 0, JSON.stringify(r.reasons));
  assert.deepEqual(r.events.map((e) => e.rep), ['r_mateo', 'r_jose', 'r_nico']);
});

test('a name two reps could own, a first name alone, or a stranger is refused, never guessed', () => {
  const s = stateWith([rep('r_j1', 'Jose Lima'), rep('r_j2', 'Jose Lima Ruiz'), rep('r_ana', 'Ana Ruiz')]);
  const r = activityRows(s, { source: 'crm', rows: [row('crm_M-1', 'Jose Lima Ruiz Perez'), row('crm_M-2', 'Ana'), row('crm_M-3', 'Claudio'), row('crm_M-4', 'Pedro Gomez')] }, { now: NOW });
  assert.deepEqual(r.reasons.map((x) => x.reason), ['rep', 'rep', 'rep', 'rep']);
});

test('two reps with the very same name: the row is refused', () => {
  const s = stateWith([rep('r_a', 'Mario Sosa'), rep('r_b', 'Mario Sosa')]);
  const r = activityRows(s, { source: 'crm', rows: [row('crm_D-1', 'Mario Sosa')] }, { now: NOW });
  assert.deepEqual(r.reasons.map((x) => x.reason), ['rep']);
});

test('an inactive or practice rep never gets a row by name', () => {
  const s = stateWith([rep('r_old', 'Ivan Soto'), { type: 'rep.updated', id: 'r_old', patch: { active: false } }, rep('r_p', 'Vendedor Practica', { practice: true })]);
  const r = activityRows(s, { source: 'crm', rows: [row('crm_I-1', 'Ivan Soto'), row('crm_I-2', 'Vendedor Practica')] }, { now: NOW });
  assert.deepEqual(r.reasons.map((x) => x.reason), ['not_a_rep', 'rep']);
});

test('a rep who left keeps their old rows off a namesake who is still here', () => {
  const s = stateWith([rep('r_left', 'José Antonio Lima'), { type: 'rep.updated', id: 'r_left', patch: { active: false } }, rep('r_new', 'Jose Lima')]);
  const r = activityRows(s, { source: 'crm', rows: [row('crm_L-1', 'José Antonio Lima')] }, { now: NOW });
  assert.equal(r.added, 0);
  assert.deepEqual(r.reasons.map((x) => x.reason), ['not_a_rep']);
});
