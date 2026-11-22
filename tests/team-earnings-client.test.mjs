// What the earnings screens decide on the phone: money to the cent at the display edge only, "monto por definir" while
// no rate is in force, the source sentence, a teammate's line and card, the rep's active sites, the forms a manager
// fills (site hours, the pay rate) and the example team's controls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { usd, money, paySource, mateLine, mateCard, siteRows, hasSites } from '../team/sites-steps.js';
import { siteHoursBody, payBody, recentMondays, siteActions } from '../team/manager-steps.js';
import { exampleActions } from '../team/practice-steps.js';
import { repFacts } from '../team/leader-steps.js';
import { makeT } from '../team/i18n.js';

const es = makeT('es'), en = makeT('en');

test('money: cents to US dollars at the edge, to the cent, with thousands; no amount reads "monto por definir"', () => {
  assert.deepEqual([usd(6110), usd(5), usd(0), usd(123456789)], ['US$61.10', 'US$0.05', 'US$0.00', 'US$1,234,567.89']);
  assert.equal(usd(null), null);
  assert.equal(money(null, es), 'monto por definir');
  assert.equal(money(null, en), 'amount to be defined');
  assert.equal(money(6110, es), 'US$61.10');
});

test('the source of an amount: hours accepted times the rate; with no rate, it says the amount is to be defined', () => {
  assert.equal(paySource(3666, 100, es), '61 h 6 min aceptadas × US$1.00 por hora');
  assert.equal(paySource(3666, 100, en), '61 h 6 min accepted × US$1.00 per hour');
  assert.match(paySource(3666, null, es), /^Monto por definir/);
  assert.equal(/[—―]/.test(paySource(0, null, en)), false);
});

test('a teammate\'s line on the table and their card: sites counted, the week\'s hours, earnings or "monto por definir"', () => {
  const crew = { id: 'r_b', sites: [{ name: 'Sitio de ejemplo 3', workers: 3, minutes: 640 }], minutes: 640, cents: 1067 };
  assert.equal(mateLine(crew, es), '1 sitio · 10 h 40 min · US$10.67');
  assert.equal(mateLine({ ...crew, cents: null }, en), '1 site · 10 h 40 min · amount to be defined');
  assert.equal(mateLine({ id: 'r_d', sites: [], minutes: 0, cents: 0 }, es), '0 sitios · 0 min · US$0.00');
  assert.equal(mateLine(null, es), null, 'no entry: no line');
  const card = mateCard(crew, 100, es);
  assert.deepEqual(card.sites, [{ name: 'Sitio de ejemplo 3', line: '3 trabajadores · 10 h 40 min' }]);
  assert.deepEqual([card.total, card.source], ['US$10.67', '10 h 40 min aceptadas × US$1.00 por hora']);
  // a card never has a worker's name to show: the entry holds counts and site names only
  assert.deepEqual(Object.keys(card.sites[0]).sort(), ['line', 'name']);
});

test('my active sites: the rows and their facts; the Hoy entry shows only with at least one site', () => {
  const active = [{ id: 's_1', name: 'Sitio de ejemplo 1', city: '', practice: true, workers: 4, recording: 4, phones: 3, consents: 4, week: 1830, last: 3666, cents: 3050 }];
  const rows = siteRows(active, es);
  assert.deepEqual(rows[0], { id: 's_1', name: 'Sitio de ejemplo 1', practice: true, facts: '4 graban · 3 teléfonos · 4 consentimientos', week: '30 h 30 min', last: '61 h 6 min', earned: 'US$30.50' });
  assert.equal(siteRows([{ ...active[0], cents: null }], en)[0].earned, 'amount to be defined');
  assert.deepEqual([hasSites({ active }), hasSites({ active: [] }), hasSites({})], [true, false, false]);
});

test('the site hours form: a Monday, whole hours and minutes 0 to 59, as minutes', () => {
  assert.deepEqual(siteHoursBody({ week: '2026-11-16', h: '61', m: '6' }), { what: 'hours', week: '2026-11-16', accepted: 3666 });
  assert.deepEqual(siteHoursBody({ week: '2026-11-16', h: '', m: '45' }), { what: 'hours', week: '2026-11-16', accepted: 45 });
  for (const [v, code] of [[{ week: '2026-11-17', h: '1', m: '0' }, 'week'], [{ week: '2026-11-16', h: '1.5', m: '0' }, 'hours_minutes'], [{ week: '2026-11-16', h: '1', m: '60' }, 'hours_minutes']]) {
    assert.throws(() => siteHoursBody(v), (e) => e.code === code, JSON.stringify(v));
  }
  assert.deepEqual(recentMondays('2026-11-18', 3), ['2026-11-16', '2026-11-09', '2026-11-02']);
});

test('the pay form: dollars with up to two decimals, as integer cents; never a float', () => {
  assert.deepEqual(payBody({ usd: '1.00', from: '2026-11-16' }), { cents: 100, from: '2026-11-16' });
  assert.deepEqual(payBody({ usd: '2.5', from: '2026-11-09' }), { cents: 250, from: '2026-11-09' });
  assert.deepEqual(payBody({ usd: ' 0.29 ', from: '2026-11-16' }), { cents: 29, from: '2026-11-16' });
  for (const usdText of ['', '0', '0.00', '1.005', 'abc', '1000.01', '-1']) assert.throws(() => payBody({ usd: usdText, from: '2026-11-16' }), (e) => e.code === 'pay_amount', usdText);
});

test('an installed real site offers its hours to a manager; a practice or legacy site does not', () => {
  const base = { steps: { installed: '2026-11-10T13:00:00Z' }, state: 'installed', workers: 2, practice: false, legacy: false };
  assert.ok(siteActions(base).includes('hours'));
  assert.equal(siteActions({ ...base, practice: true, state: 'practice' }).includes('hours'), false);
  assert.equal(siteActions({ ...base, legacy: true, state: 'legacy' }).includes('hours'), false);
  assert.equal(siteActions({ ...base, steps: {}, state: 'closed' }).includes('hours'), false);
});

test('the example team\'s controls: load when there is none; view each and remove when there is; never for a rep', () => {
  assert.deepEqual(exampleActions({ example: null }, 'admin'), ['load']);
  assert.deepEqual(exampleActions({ example: [{ id: 'r_a' }] }, 'manager'), ['view', 'remove']);
  assert.deepEqual(exampleActions({ example: null }, 'rep'), []);
});

test('the leadership rep card carries active sites as a number with its source', () => {
  const rep = { week: { visits: 1, conversations: 2, meetings: 0, contracts: 0 }, isNew: false, sites: 2, minutes: 600, cents: null };
  assert.deepEqual(repFacts(rep).find((f) => f.key === 'sites'), { key: 'sites', value: 2, source: 'site' });
});
