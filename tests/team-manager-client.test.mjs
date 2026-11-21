// The manager's site and hours controls decide a few things before the server answers: what the site form sends, what
// the hours form sends, which controls a site offers, and which roles the person form lists. Those decisions live in
// team/manager-steps.js, away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteBody, hoursBody, siteActions, roleOptions } from '../team/manager-steps.js';
import { DICT } from '../team/i18n.js';

const base = { rep: 'r_1', name: '  Negocio de Prueba ', city: 'Panama City', eligible: '', coordName: '', coordPhone: '', kind: 'normal' };
const refused = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('the site form sends eligible only when it is filled, and never null', () => {
  const body = siteBody(base, 's_1');
  assert.deepEqual(body, { id: 's_1', rep: 'r_1', lead: { name: 'Negocio de Prueba' }, city: 'Panama City' });
  assert.equal('eligible' in body, false);
  assert.equal(siteBody({ ...base, eligible: ' 12 ' }, 's_1').eligible, 12);
  assert.equal(siteBody({ ...base, eligible: '0' }, 's_1').eligible, 0);
  for (const bad of ['-1', '1.5', 'doce', '5001']) assert.equal(refused(() => siteBody({ ...base, eligible: bad }, 's_1')), 'site_eligible', bad);
  // no city typed: the field is left out, the server keeps the site with no city
  assert.equal('city' in siteBody({ ...base, city: ' ' }, 's_1'), false);
});

test('the site form sends a coordinator only with both a name and a phone', () => {
  assert.equal('coordinator' in siteBody(base, 's_1'), false);
  assert.deepEqual(siteBody({ ...base, coordName: ' Coord Uno ', coordPhone: '507 555 0101' }, 's_1').coordinator, { name: 'Coord Uno', phone: '507 555 0101' });
  for (const [n, p] of [['Coord Uno', ''], ['', '5075550101'], ['C', '5075550101'], ['Coord Uno', '555']]) assert.equal(refused(() => siteBody({ ...base, coordName: n, coordPhone: p }, 's_1')), 'site_coordinator', `${n}/${p}`);
});

test('practice and legacy are one choice: a site is one of normal, practice or legacy, never both', () => {
  assert.deepEqual([siteBody({ ...base, kind: 'practice' }, 's_1').practice, siteBody({ ...base, kind: 'practice' }, 's_1').legacy], [true, undefined]);
  assert.deepEqual([siteBody({ ...base, kind: 'legacy' }, 's_1').legacy, siteBody({ ...base, kind: 'legacy' }, 's_1').practice], [true, undefined]);
  const normal = siteBody(base, 's_1');
  assert.equal('practice' in normal || 'legacy' in normal, false);
  assert.equal(refused(() => siteBody({ ...base, kind: 'both' }, 's_1')), 'site_kind');
  assert.equal(refused(() => siteBody({ ...base, name: 'x' }, 's_1')), 'fields');
});

test('the hours form takes hours and minutes and sends minutes, for a Monday, with accepted no more than delivered', () => {
  const v = { week: '2026-11-16', dh: '69', dm: '4', ah: '51', am: '7' };
  assert.deepEqual(hoursBody(v), { weeks: [{ week: '2026-11-16', delivered: 69 * 60 + 4, accepted: 51 * 60 + 7 }] });
  assert.deepEqual(hoursBody({ ...v, dm: '', am: '' }).weeks[0], { week: '2026-11-16', delivered: 69 * 60, accepted: 51 * 60 });
  assert.equal(refused(() => hoursBody({ ...v, week: '2026-11-17' })), 'week');
  assert.equal(refused(() => hoursBody({ ...v, week: '16/11/2026' })), 'week');
  assert.equal(refused(() => hoursBody({ ...v, dm: '60' })), 'hours_minutes');
  assert.equal(refused(() => hoursBody({ ...v, dh: '-1' })), 'hours_minutes');
  assert.equal(refused(() => hoursBody({ ...v, dh: '', dm: '' , ah: '', am: '' })), 'hours_minutes');
  assert.equal(refused(() => hoursBody({ ...v, ah: '70' })), 'hours_order');
});

test('each site offers the controls its state allows', () => {
  const site = (over) => ({ state: 'waiting_phones', legacy: false, practice: false, workers: 0, steps: {}, ...over });
  assert.deepEqual(siteActions(site({})), ['install', 'phones', 'installed', 'void']);   // nobody on it yet: no record to download
  assert.deepEqual(siteActions(site({ state: 'installing', phones: 3, workers: 2 })), ['install', 'phones', 'record', 'void']);
  assert.deepEqual(siteActions(site({ state: 'closed', phones: 3, workers: 2, closed: 't' })), ['install', 'confirm', 'record', 'void']);
  assert.deepEqual(siteActions(site({ state: 'installed', workers: 2, steps: { installed: 't' } })), ['install', 'first_hour', 'record', 'void']);
  // a legacy site is not installed here: no install screens, no phones; it keeps the old way of being marked
  assert.deepEqual(siteActions(site({ state: 'legacy', legacy: true })), ['installed', 'void']);
  // a practice site opens like a real one and is removed, never voided; it has no record and counts in no total
  assert.deepEqual(siteActions(site({ state: 'practice', practice: true, workers: 2, closed: 't' })), ['install', 'confirm', 'remove']);
  assert.deepEqual(siteActions(site({ state: 'practice', practice: true })), ['install', 'phones', 'remove']);
});

test('only an admin is offered the roles, Liderazgo among them, with its own label', () => {
  assert.deepEqual(roleOptions('admin'), ['rep', 'manager', 'admin', 'leader']);
  assert.deepEqual(roleOptions('manager'), []);
  assert.deepEqual([DICT.es['role.leader'], DICT.en['role.leader']], ['Liderazgo', 'Leadership']);
  for (const code of ['site_eligible', 'site_coordinator', 'site_kind', 'hours_order', 'hours_minutes']) for (const l of ['es', 'en']) assert.ok(DICT[l][`err.${code}`], `${l} err.${code}`);
});
