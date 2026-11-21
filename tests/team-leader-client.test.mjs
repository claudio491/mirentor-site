// The leadership view decides a few things before it draws: how minutes read as hours, what a site's card says, how
// the practice site is mentioned, and what the shell offers a leader. Those decisions live in team/leader-steps.js,
// away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hm, siteCard, practiceNote, shellFor, hoursModel } from '../team/leader-steps.js';
import { makeT } from '../team/i18n.js';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { leaderView } from '../lib/team/leader.mjs';

const es = makeT('es'), en = makeT('en');

test('minutes format as "69 h 4 min" and "51 h 7 min"', () => {
  assert.equal(hm(69 * 60 + 4), '69 h 4 min');
  assert.equal(hm(51 * 60 + 7), '51 h 7 min');
  // whole hours drop the minutes, under an hour drops the hours, nothing is still a number
  assert.deepEqual([hm(120), hm(45), hm(0)], ['2 h', '45 min', '0 min']);
  // the hours are written the way the reader's language writes a number
  assert.equal(hm(3750 * 60, (n) => n.toLocaleString('en-US')), '3,750 h');
  assert.equal(hm(null), '');
});

test('a legacy site\'s card text', () => {
  const legacy = { id: 's1', name: 'Negocio de Prueba', state: 'legacy', eligible: 8, consents: 0, phones: 0, workers: 0 };
  assert.equal(siteCard(legacy, es).line, 'Instalado antes de la app · consentimientos sin cargar');
  assert.equal(siteCard(legacy, en).line, 'Installed before the app · consents not loaded');
  // a legacy card shows no consent count: zero would read as "nobody signed", which nobody knows
  assert.equal(siteCard(legacy, es).figures.some((f) => f.key === 'consents'), false);
  // a site installed with the app reads its own counts, and has no such line
  const app = siteCard({ ...legacy, state: 'installed', consents: 4, phones: 3, workers: 4 }, es);
  assert.equal(app.line, null);
  assert.deepEqual(app.figures.map((f) => [f.key, f.value]), [['eligible', 8], ['consents', 4], ['phones', 3]]);
  assert.equal(app.figures.find((f) => f.key === 'consents').label, 'consentimientos en archivo');
  // an old site event with no eligible count stays empty and says so
  const old = siteCard({ ...legacy, state: 'installed', eligible: null }, es);
  assert.equal(old.figures.find((f) => f.key === 'eligible').value, null);
  assert.equal(siteCard({ ...legacy, state: 'waiting_phones' }, en).state, 'Waiting for phones');
});

test('practiceHidden is mentioned once, as a count, with no site name', () => {
  let state = emptyState();
  const t0 = '2026-11-16T14:00:00Z';
  state = applyEvent(state, { type: 'rep.created', id: 'r1', handle: 'ana', email: 'ana@equipo.test', name: 'Ana Prueba', role: 'rep', country: 'PA', city: 'Panama City', tz: 'America/Panama', workdays: [1, 2, 3, 4, 5], startDate: '2026-10-01', lang: 'es', t: t0 });
  state = applyEvent(state, { type: 'site', id: 'p1', rep: 'r1', lead: { id: null, name: 'Sitio de práctica Uno' }, city: 'Panama City', practice: true, t: t0 });
  state = applyEvent(state, { type: 'site', id: 'p2', rep: 'r1', lead: { id: null, name: 'Sitio de práctica Dos' }, city: 'Panama City', practice: true, t: t0 });
  state = applyEvent(state, { type: 'site', id: 's1', rep: 'r1', lead: { id: null, name: 'Negocio de Prueba' }, city: 'Panama City', eligible: 5, t: t0 });
  const view = leaderView(state, { now: '2026-11-19T20:00:00Z', leads: new Map() });
  assert.equal(view.practiceHidden, 2);
  for (const t of [es, en]) {
    const note = practiceNote(view, t);
    assert.equal((note.match(/\b2\b/g) || []).length, 1, note);
    assert.equal(/Uno|Dos|Sitio de práctica/.test(note), false, note);
    // nothing else the page writes from the view names a practice site
    const cards = view.cities.flatMap((c) => c.sites.map((s) => siteCard(s, t)));
    assert.equal(JSON.stringify(cards).includes('práctica'), false);
  }
  assert.equal(practiceNote({ ...view, practiceHidden: 0 }, es), null);
});

test('a leader\'s shell has no log button and no tabs', () => {
  assert.deepEqual(shellFor('leader'), { tabs: [], log: false, home: 'lead' });
  // the others are as they were: a rep logs and has their three zones, a manager has the team's three tabs
  assert.deepEqual(shellFor('rep'), { tabs: ['today', 'week', 'table'], log: true, home: 'today' });
  for (const role of ['manager', 'admin']) assert.deepEqual(shellFor(role), { tabs: ['team', 'needs', 'reps'], log: false, home: 'team' });
});

test('the hours graphic measures accepted hours against the Scorecard goal, newest week first', () => {
  const hours = [{ week: '2026-11-16', delivered: 600, accepted: 450, pct: 75, source: 'scorecard' }, { week: '2026-11-09', delivered: 1200, accepted: 300, pct: 25, source: 'manual' }];
  const m = hoursModel(hours, 3750 * 60);
  assert.equal(m.latest.week, '2026-11-16');
  assert.equal(m.ofGoal, 450 / (3750 * 60));
  // the weeks share one scale: the largest delivered week fills its track
  assert.deepEqual(m.weeks.map((w) => [w.week, w.d, w.a]), [['2026-11-16', 0.5, 0.375], ['2026-11-09', 1, 0.25]]);
  assert.deepEqual(hoursModel([], 3750 * 60), { latest: null, goal: 3750 * 60, ofGoal: null, weeks: [] });
});
