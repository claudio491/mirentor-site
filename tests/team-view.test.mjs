import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { repView, teamView, feedOf } from '../lib/team/view.mjs';

const TZ = 'America/Panama';
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00-05:00`).toISOString();
const build = (events) => events.reduce((s, e) => applyEvent(s, e), emptyState());
const rep = (id, over = {}) => ({ type: 'rep.created', t: at('2026-11-02', '08:00'), id, handle: id, name: `${id.toUpperCase()} Apellido`, role: 'rep', country: 'PA', city: 'Panama City', tz: TZ, workdays: [1, 2, 3, 4, 5], startDate: '2026-11-02', lang: 'es', ...over });
let n = 0;
const log = (repId, day, hhmm, kind, lead = `L${++n}`, over = {}) => ({ type: 'log', t: at(day, hhmm), id: `g${++n}`, rep: repId, lead: { id: lead, name: `Negocio ${lead}`, zone: 'Z' }, kind, ...over });
const MON = '2026-11-16';
const ctx = (hhmm = '20:00', day = MON) => ({ now: at(day, hhmm) });
// Five reps with 13, 8, 5, 3 and 1 points on Monday.
const five = () => [rep('ana'), rep('beto'), rep('caro'), rep('dani'), rep('eli'),
  log('ana', MON, '09:00', 'talk'), log('ana', MON, '09:30', 'call'), log('beto', MON, '10:00', 'talk'), log('caro', MON, '10:30', 'call'), log('dani', MON, '11:00', 'absent'), log('eli', MON, '11:30', 'message')];

test('with five ranked reps the podium has two places, and a rep in fourth sees only their own number', () => {
  const v = repView(build(five()), 'dani', ctx()).table.week;
  assert.deepEqual(v.podium.map((r) => [r.place, r.id, r.score]), [[1, 'ana', 13], [2, 'beto', 8]]);
  assert.deepEqual([v.me.place, v.me.score, v.me.onPodium], [4, 3, false]);
  assert.deepEqual(v.gap, { pts: 2, aheadOnPodium: false, aheadName: null });
  assert.deepEqual(v.rest.map((r) => r.id), ['caro', 'eli']);
  for (const r of v.rest) { assert.equal('place' in r, false); assert.equal('score' in r, false); }
  assert.equal(v.ranked, 5);
});

test('a rep on the podium sees the name ahead and the name behind when both are on it', () => {
  const second = repView(build(five()), 'beto', ctx()).table.week;
  assert.deepEqual(second.gap, { pts: 5, aheadOnPodium: true, aheadName: 'ANA' });
  assert.equal(second.behind, null);
  const first = repView(build(five()), 'ana', ctx()).table.week;
  assert.equal(first.gap, null);
  assert.deepEqual(first.behind, { pts: 5, name: 'BETO' });
  assert.equal(first.me.onPodium, true);
});

test('a rep in their first 14 days is listed as new and never ranked, whatever their score', () => {
  const s = build([...five(), rep('nuevo', { startDate: '2026-11-11' }), log('nuevo', MON, '08:00', 'talk'), log('nuevo', MON, '08:30', 'talk'), log('nuevo', MON, '09:00', 'talk')]);
  const v = repView(s, 'dani', ctx()).table.week;
  assert.deepEqual(v.podium.map((r) => r.id), ['ana', 'beto']);
  assert.deepEqual(v.rest.find((r) => r.id === 'nuevo').isNew, true);
  const own = repView(s, 'nuevo', ctx()).table.week;
  assert.deepEqual([own.me.place, own.me.isNew, own.gap], [null, true, null]);
});

test('a score of zero is never ranked', () => {
  const s = build([rep('ana'), rep('beto'), rep('caro'), rep('dani'), log('ana', MON, '09:00', 'talk')]);
  const v = repView(s, 'beto', ctx()).table.week;
  assert.deepEqual(v.podium.map((r) => r.id), ['ana']);
  assert.equal(v.ranked, 1);
  assert.deepEqual([v.me.place, v.gap], [null, null]);
  assert.deepEqual(v.rest.map((r) => r.id), ['caro', 'dani']);
});

test('on a tie, whoever reached the score first stays ahead', () => {
  const s = build([rep('ana'), rep('beto'), rep('caro'), rep('dani'), log('beto', MON, '09:00', 'talk'), log('ana', MON, '10:00', 'talk')]);
  const v = repView(s, 'ana', ctx()).table.week;
  assert.deepEqual(v.podium.map((r) => r.id), ['beto']);
  assert.deepEqual([v.me.place, v.gap.pts, v.gap.aheadName], [2, 0, 'BETO']);
});

test('the day table uses today\'s points and the month table uses signed sites, then meetings held', () => {
  const m = log('beto', '2026-11-10', '10:00', 'meeting');
  const s = build([...five(), m, { type: 'confirm', t: at('2026-11-12', '10:00'), logId: m.id, what: 'meeting_held', by: 'boss' },
    { type: 'site', t: at('2026-11-13', '10:00'), id: 's1', rep: 'caro', lead: { id: 'X', name: 'X' }, by: 'boss' }]);
  const t = repView(s, 'ana', ctx()).table;
  assert.deepEqual(t.day.podium.map((r) => [r.id, r.score]), [['ana', 13], ['beto', 8]]);
  // Two reps have something this month, so the podium is one place: a signed site outranks a meeting held.
  assert.deepEqual(t.month.podium.map((r) => [r.id, r.sites, r.meetings]), [['caro', 1, 0]]);
  assert.deepEqual([t.month.ranked, t.month.me.place, t.month.gap], [2, null, null]);
  const mine = repView(s, 'beto', ctx()).table.month.me;
  assert.deepEqual([mine.place, mine.sites, mine.meetings], [2, 0, 1]);
});

test('the rep payload carries today, the hand, the goal, the streak and the level as numbers and codes only', () => {
  const v = repView(build(five()), 'ana', ctx());
  assert.deepEqual(v.today.habits, [true, true, false, false]);
  assert.deepEqual([v.today.points, v.week.marks, v.week.marksMax], [13, 3, 21]);
  assert.deepEqual([v.streak.current, v.level.name, v.goal.options.length], [1, 'aprendizaje', 3]);
  assert.deepEqual([v.me.first, v.me.role, v.me.lang], ['ANA', 'rep', 'es']);
  assert.equal(v.team.target, 10);
  assert.equal(v.ledger[0].code.length > 0, true);
  assert.equal('email' in v.me, false);   // a person's view names nobody's address, not even their own: that is the viewer's
});

test('the rep payload says what Saturday and Sunday brought, so the chart of the week can give them their bar', () => {
  const v = repView(build([rep('ana'), log('ana', MON, '09:00', 'talk'), log('ana', '2026-11-21', '10:00', 'talk')]), 'ana', ctx('20:00', '2026-11-21')).week;
  assert.equal(v.weekendPoints, 8);
  assert.equal(v.points, v.days.reduce((a, d) => a + d.points, 0) + v.weekendPoints);
});

test('the feed shows who did what without the business, and marks what the viewer applauded', () => {
  const l1 = log('ana', MON, '09:00', 'talk', 'SECRETO');
  const s = build([rep('ana'), rep('beto'), l1, log('ana', MON, '09:10', 'message', 'M1'), { type: 'kudos', t: at(MON, '09:20'), by: 'beto', target: l1.id, on: true }, { type: 'play', t: at(MON, '09:30'), logId: l1.id, text: 'Pregunté por el encargado.' }]);
  const f = feedOf(s, 'beto', ctx());
  assert.equal(f.length, 1);
  // Points travel only with the viewer's own moves: a rep cannot add up what a teammate outside the podium has.
  assert.deepEqual([f[0].code, f[0].name, f[0].pts, f[0].kudos, f[0].clapped, f[0].mine, f[0].play], ['talk', 'ANA', null, 1, true, false, 'Pregunté por el encargado.']);
  assert.equal(feedOf(s, 'ana', ctx())[0].pts, 8);
  assert.equal(JSON.stringify(f).includes('SECRETO'), false);
  assert.equal(feedOf(s, 'ana', ctx())[0].mine, true);
});

test('the manager sees what needs confirming, who is silent after noon and which logs came in late', () => {
  const m = log('ana', MON, '09:00', 'meeting'), c = log('beto', MON, '09:30', 'contract'), late = log('caro', MON, '10:00', 'talk', 'L77', { late: true, clientAt: at(MON, '06:00') });
  const s = build([rep('ana'), rep('beto'), rep('caro'), rep('dani'), rep('part', { workdays: [2, 4] }), rep('boss', { role: 'manager' }), m, c, late]);
  const t = teamView(s, ctx('13:00'));
  assert.deepEqual(t.needs.confirm.map((x) => [x.rep, x.what]), [['ana', 'meeting_held'], ['beto', 'contract_sent']]);
  assert.deepEqual(t.needs.silent.map((x) => x.rep), ['dani']);
  assert.deepEqual(t.needs.late.map((x) => x.rep), ['caro']);
  assert.deepEqual(teamView(s, ctx('11:00')).needs.silent, []);
  assert.deepEqual(t.reps.map((r) => r.id), ['ana', 'beto', 'caro', 'dani', 'part']);
  assert.deepEqual(t.reps.map((r) => r.place), [1, null, 2, null, null]);
  applyEvent(s, { type: 'confirm', t: at(MON, '14:00'), logId: c.id, what: 'contract_sent', by: 'boss' });
  assert.deepEqual(teamView(s, ctx('15:00')).needs.confirm.map((x) => x.what), ['meeting_held', 'contract_signed']);
});
