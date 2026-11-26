import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { repView, teamView, feedOf, weekPlace } from '../lib/team/view.mjs';

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

test('the person ahead and the person behind are named so two people with the same first name are not confused', () => {
  const two = [rep('ana', { name: 'Ana Ruiz' }), rep('beto', { name: 'Ana Soto' }), ...five().slice(2)];
  const s = build(two);
  // third place looks up at second: "Ana" alone would be either of the two on the podium
  assert.equal(repView(s, 'caro', ctx()).table.week.gap.aheadName, 'Ana S.');
  // first place is told who is behind
  assert.equal(repView(s, 'ana', ctx()).table.week.behind.name, 'Ana S.');
  // with nobody sharing a first name, the first name is enough
  assert.equal(repView(build(five()), 'caro', ctx()).table.week.gap.aheadName, 'BETO');
});

test('the rep payload says what Saturday and Sunday brought, so the chart of the week can give them their bar', () => {
  const v = repView(build([rep('ana'), log('ana', MON, '09:00', 'talk'), log('ana', '2026-11-21', '10:00', 'talk')]), 'ana', ctx('20:00', '2026-11-21')).week;
  assert.equal(v.weekendPoints, 8);
  assert.equal(v.points, v.days.reduce((a, d) => a + d.points, 0) + v.weekendPoints);
});

test('a meeting that still waits to be confirmed stays in the history a phone gets, however much was logged after it', () => {
  // the meeting is two weeks ahead; in the days after booking it, the rep logs far more than the 40 rows a phone gets
  const events = [rep('ana'), log('ana', MON, '09:00', 'meeting', 'M1', { when: '2026-11-30' })];
  for (const day of ['2026-11-17', '2026-11-18', '2026-11-19']) for (let i = 0; i < 9; i += 1) events.push(log('ana', day, `1${i}:00`, 'talk'));
  const v = repView(build(events), 'ana', ctx('20:00', '2026-11-19'));
  assert.ok(v.ledger.length > 40, `the history holds the recent rows and what waits: ${v.ledger.length}`);
  const waiting = v.ledger.filter((e) => e.code === 'meeting_held' && e.status === 'pending');
  assert.equal(waiting.length, 1, 'the row from which the rep reports the meeting as held is still there');
  assert.equal(v.pending.some((p) => p.logId === waiting[0].logId && !p.held), true);
  // newest first, as before: what waits from days ago comes after the recent rows
  assert.equal(v.ledger.at(-1).id, waiting[0].id);
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

test('me lists the installs that wait for the rep: phones marked, not voided, not legacy, not confirmed installed', () => {
  const T0 = at('2026-11-12', '10:00');
  const site = (id, over = {}) => ({ type: 'site', t: T0, id, rep: 'ana', lead: { id: null, name: `Taller ${id}` }, city: 'Panama City', eligible: 8, by: 'boss', ...over });
  const phones = (siteId, count = 4) => ({ type: 'site.phones', t: T0, siteId, count, by: 'boss' });
  const worker = (id, siteId) => ({ type: 'worker.added', t: at('2026-11-13', '09:00'), id, siteId, name: `Persona ${id}`, email: `${id}@equipo.test`, by: 'ana' });
  const s = build([rep('ana'), rep('beto'),
    site('s_wait'),                                         // no phones yet: nothing to install
    site('s_ready'), phones('s_ready'),                     // ready to install
    site('s_doing'), phones('s_doing', 3), worker('w_aaaaaaaa', 's_doing'),
    { type: 'worker.consent', t: at('2026-11-13', '09:05'), workerId: 'w_aaaaaaaa', v: 'v1', ext: 'jpg', form: 'v1' },
    { type: 'worker.phone', t: at('2026-11-13', '09:06'), workerId: 'w_aaaaaaaa', imei: '490154203237518' },
    { type: 'worker.clip', t: at('2026-11-13', '09:07'), workerId: 'w_aaaaaaaa' },
    worker('w_bbbbbbbb', 's_doing'),
    site('s_done'), phones('s_done'), { type: 'site.step', t: T0, siteId: 's_done', what: 'installed', by: 'boss' },
    site('s_void'), phones('s_void'), { type: 'site.void', t: T0, siteId: 's_void', by: 'boss' },
    site('s_old', { legacy: true }), phones('s_old'),
    site('s_prac', { practice: true }), phones('s_prac', 2),
    site('s_beto', { rep: 'beto' }), phones('s_beto')]);
  const mine = repView(s, 'ana', ctx()).installs;
  assert.deepEqual(mine, [
    { id: 's_ready', name: 'Taller s_ready', state: 'ready_to_install', ready: 0, total: 0, phones: 4, practice: false, closed: false },
    { id: 's_doing', name: 'Taller s_doing', state: 'installing', ready: 1, total: 2, phones: 3, practice: false, closed: false },
    { id: 's_prac', name: 'Taller s_prac', state: 'practice', ready: 0, total: 0, phones: 2, practice: true, closed: false },
  ]);
  assert.deepEqual(repView(s, 'beto', ctx()).installs.map((x) => x.id), ['s_beto']);
  // A site the manager installs is not on the manager's list unless the manager is its rep.
  assert.deepEqual(repView(build([rep('ana'), rep('boss', { role: 'admin' }), site('s_ready'), phones('s_ready')]), 'boss', ctx()).installs, []);
});

test('a practice site earns no points, adds no feed line, is no signed site in the month table, and the manager sees it labeled', () => {
  const s = build([rep('ana'), rep('beto'), log('beto', MON, '09:00', 'talk'),
    { type: 'site', t: at(MON, '10:00'), id: 's_prac', rep: 'ana', lead: { id: null, name: 'Sitio de práctica' }, practice: true, by: 'boss' }]);
  const v = repView(s, 'ana', ctx());
  assert.equal(v.ledger.some((e) => e.code.startsWith('site_')), false);
  assert.equal(v.feed.some((f) => f.code === 'site_signed'), false);
  assert.equal(v.table.month.me.sites, 0);
  assert.equal(v.installs.length, 0, 'no phones marked yet');
  assert.deepEqual(teamView(s, ctx()).sites.map((x) => [x.id, x.practice]), [['s_prac', true]], 'the manager sees it labeled');
});

test('a closed install stays in me until a manager confirms it, and leaves once it is installed', () => {
  const T0 = at('2026-11-12', '10:00');
  const base = [rep('ana'), { type: 'site', t: T0, id: 's1', rep: 'ana', lead: { id: null, name: 'Taller' }, by: 'boss' }, { type: 'site.phones', t: T0, siteId: 's1', count: 1, by: 'boss' },
    { type: 'worker.added', t: T0, id: 'w_aaaaaaaa', siteId: 's1', name: 'Persona', email: 'p@equipo.test', by: 'ana' },
    { type: 'worker.consent', t: T0, workerId: 'w_aaaaaaaa', v: 'v1', ext: 'jpg', form: 'v1' }, { type: 'worker.phone', t: T0, workerId: 'w_aaaaaaaa', imei: '490154203237518' },
    { type: 'worker.clip', t: T0, workerId: 'w_aaaaaaaa' }, { type: 'install.close', t: at('2026-11-13', '10:00'), siteId: 's1', by: 'ana' }];
  assert.deepEqual(repView(build(base), 'ana', ctx()).installs.map((x) => [x.id, x.state, x.closed]), [['s1', 'closed', true]]);
  const done = build([...base, { type: 'site.step', t: at('2026-11-14', '10:00'), siteId: 's1', what: 'installed', by: 'boss' }]);
  assert.deepEqual(repView(done, 'ana', ctx()).installs, []);
});

test('repView carries the address of every training video by key, null while it does not exist', async () => {
  const { VIDEOS } = await import('../lib/team/rules.mjs');
  const v = repView(build([rep('ana')]), 'ana', ctx());
  assert.deepEqual(Object.keys(v.videos), Object.keys(VIDEOS));
  assert.deepEqual(Object.values(v.videos), Object.keys(VIDEOS).map(() => null));
  // a copy: the screen can never change the server's list
  assert.notEqual(v.videos, VIDEOS);
  VIDEOS.pitch = 'https://videos.equipo.test/presentar.mp4';
  try { assert.equal(repView(build([rep('ana')]), 'ana', ctx()).videos.pitch, 'https://videos.equipo.test/presentar.mp4'); } finally { VIDEOS.pitch = null; }
});

test('repView carries the person\'s own two zones, and nobody else\'s', () => {
  const s = build([rep('ana'), rep('beto'), { type: 'zones.pick', rep: 'ana', zones: ['Bella Vista', 'Obarrio'] }]);
  assert.deepEqual(repView(s, 'ana', ctx()).zones, ['Bella Vista', 'Obarrio']);
  assert.deepEqual(repView(s, 'beto', ctx()).zones, []);
  // a copy: the screen can never change the state
  const v = repView(s, 'ana', ctx()); v.zones.push('X');
  assert.deepEqual(repView(s, 'ana', ctx()).zones, ['Bella Vista', 'Obarrio']);
});

test('weekPlace answers the place the week table gives, alone: ranked, unranked, new, the practice world and a manager', () => {
  const st = build([...five(), rep('nuevo', { startDate: MON }), log('nuevo', MON, '12:00', 'talk'), rep('jefa', { role: 'manager' }), rep('cero'),
    { type: 'rep.practice', t: at('2026-11-02', '08:00'), id: 'prac', handle: 'prac', name: 'Vendedor de práctica', city: 'Panama City', tz: TZ, workdays: [1, 2, 3, 4, 5], startDate: '2026-11-02' },
    log('prac', MON, '12:30', 'talk')]);
  for (const id of ['ana', 'beto', 'caro', 'dani', 'eli', 'nuevo', 'jefa', 'cero', 'prac']) {
    assert.equal(weekPlace(st, id, ctx()), repView(st, id, ctx()).table.week.me?.place ?? null, id);
  }
  assert.deepEqual(['ana', 'dani', 'nuevo', 'cero', 'prac'].map((id) => weekPlace(st, id, ctx())), [1, 4, null, null, 1]);
});

test('the feed shows no points for a second "sent" on a business whose sending was already paid', () => {
  const first = log('ana', MON, '10:00', 'contract', 'X'), again = log('ana', '2026-12-17', '10:00', 'contract', 'X');
  const sent = (logId, day) => ({ type: 'confirm', t: at(day, '18:00'), logId, what: 'contract_sent', by: 'boss' });
  const s = build([rep('ana'), rep('boss', { role: 'manager' }), first, sent(first.id, MON), again, sent(again.id, '2026-12-17')]);
  const lines = feedOf(s, 'boss', ctx('20:00', '2026-12-17')).filter((f) => f.code === 'contract_sent');
  assert.deepEqual(lines.map((f) => [f.id, f.pts]), [[`${again.id}:contract_sent`, 0], [`${first.id}:contract_sent`, 10]]);
});

test('a meeting still waiting from an earlier day keeps its hour in pending, and a log with none says null', () => {
  const events = [rep('ana'), log('ana', '2026-11-12', '09:00', 'meeting', 'MT1', { when: '2026-11-13', time: '15:30' }), log('ana', '2026-11-12', '09:30', 'meeting', 'MT2')];
  const v = repView(build(events), 'ana', ctx());
  const byLead = Object.fromEntries(v.pending.filter((p) => p.code === 'meeting_held').map((p) => [p.lead.id, p.time]));
  assert.deepEqual(byLead, { MT1: '15:30', MT2: null });
  for (const p of v.pending) assert.equal('time' in p, true);
});
