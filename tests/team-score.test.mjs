import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { dayStats, ledger, weekOf, streak, goalOf, levelOf, lifetime } from '../lib/team/score.mjs';

const TZ = 'America/Panama';
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00-05:00`).toISOString();
const build = (events) => events.reduce((s, e) => applyEvent(s, e), emptyState());
const rep = (id, over = {}) => ({ type: 'rep.created', t: at('2026-11-02', '08:00'), id, handle: id, name: id, role: 'rep', country: 'PA', city: 'Panama City', tz: TZ, workdays: [1, 2, 3, 4, 5], startDate: '2026-11-02', lang: 'es', ...over });
let n = 0;
const log = (repId, day, hhmm, kind, lead = 'L1', over = {}) => ({ type: 'log', t: at(day, hhmm), id: `g${++n}`, rep: repId, lead: { id: lead, name: lead, zone: 'Z' }, kind, ...over });
const close = (repId, day, hhmm) => ({ type: 'day.close', t: at(day, hhmm), rep: repId, day, tomorrow: '', blocker: '' });
const ctx = (day = '2026-11-16', hhmm = '20:00', leads) => ({ now: at(day, hhmm), leads });
const earned = (entries) => entries.filter((e) => e.status === 'earned').reduce((a, e) => a + e.pts, 0);
const pending = (entries) => entries.filter((e) => e.status === 'pending').reduce((a, e) => a + e.pts, 0);
const MON = '2026-11-16';

test('a visit where the rep speaks with whoever decides is a visit and a conversation: 8 points', () => {
  const s = build([rep('a'), log('a', MON, '10:00', 'talk')]);
  const d = dayStats(s, 'a', MON, ctx());
  assert.deepEqual([d.visits, d.conversations, d.followups], [1, 1, 0]);
  assert.deepEqual(d.habits, [true, false, false, false]);
  assert.equal(earned(ledger(s, 'a', ctx())), 8);
});

test('a business the CRM said was contacted on an earlier day makes the visit a follow-up: 10 points, fixed when the log is made', () => {
  // The earlier contact is stamped on the log itself (`prior`): what the lead list says later cannot move these points.
  const s = build([rep('a'), log('a', MON, '10:00', 'talk', 'L1', { prior: '2026-11-10' })]);
  assert.equal(dayStats(s, 'a', MON, ctx()).followups, 1);
  assert.equal(earned(ledger(s, 'a', ctx())), 10);
  const later = ctx(MON, '20:00', new Map([['L1', { lastContact: MON }]]));
  assert.equal(earned(ledger(s, 'a', later)), 10);
  const plain = build([rep('a'), log('a', MON, '10:00', 'talk', 'L1')]);
  assert.equal(earned(ledger(plain, 'a', ctx(MON, '20:00', new Map([['L1', { lastContact: '2026-11-10' }]])))), 8);
});

test('a teammate\'s earlier log on the same business also makes it a follow-up', () => {
  const s = build([rep('a'), rep('b'), log('b', '2026-11-13', '11:00', 'absent'), log('a', MON, '10:00', 'call')]);
  assert.equal(dayStats(s, 'a', MON, ctx()).followups, 1);
  assert.equal(earned(ledger(s, 'a', { ...ctx(), from: MON, to: MON })), 5 + 2);
});

test('a contact made earlier the same day is not a follow-up', () => {
  const s = build([rep('a'), log('a', MON, '09:00', 'absent'), log('a', MON, '15:00', 'call')]);
  assert.equal(dayStats(s, 'a', MON, ctx()).followups, 0);
});

test('the same result on the same business the same day counts once', () => {
  const s = build([rep('a'), log('a', MON, '10:00', 'talk'), log('a', MON, '10:05', 'talk'), log('a', MON, '16:00', 'talk')]);
  assert.equal(earned(ledger(s, 'a', ctx())), 8);
  assert.equal(dayStats(s, 'a', MON, ctx()).visits, 1);
});

test('absent in the morning and a talk in the afternoon at one business is one visit', () => {
  const s = build([rep('a'), log('a', MON, '09:00', 'absent'), log('a', MON, '15:00', 'talk')]);
  const d = dayStats(s, 'a', MON, ctx());
  assert.deepEqual([d.visits, d.conversations], [1, 1]);
  assert.equal(earned(ledger(s, 'a', ctx())), 8);
});

test('messages score up to 10 a day and never count as a follow-up', () => {
  const logs = Array.from({ length: 12 }, (_, i) => log('a', MON, '10:00', 'message', `M${i}`, i === 0 ? { prior: '2026-11-01' } : {}));
  const s = build([rep('a'), ...logs]);
  const c = ctx(MON, '20:00');
  const d = dayStats(s, 'a', MON, c);
  assert.equal(d.messages, 12);
  assert.equal(d.followups, 0);
  assert.equal(earned(ledger(s, 'a', c)), 10);
});

test('a reply scores 3 once per business per day', () => {
  const s = build([rep('a'), log('a', MON, '10:00', 'reply', 'L1', { channel: 'whatsapp' }), log('a', MON, '11:00', 'reply', 'L1', { channel: 'email' })]);
  assert.equal(earned(ledger(s, 'a', ctx())), 3);
});

test('a meeting booked in person pays the visit, the conversation and 5 now, and 10 when it happens', () => {
  const m = log('a', MON, '10:00', 'meeting');
  const s = build([rep('a'), m]);
  const before = ledger(s, 'a', ctx());
  assert.equal(earned(before), 3 + 5 + 5);
  assert.equal(pending(before), 10);
  assert.equal(dayStats(s, 'a', MON, ctx()).conversations, 1);
  applyEvent(s, { type: 'confirm', t: at('2026-11-18', '12:00'), logId: m.id, what: 'meeting_held', by: 'boss' });
  const after = ledger(s, 'a', ctx('2026-11-18'));
  const held = after.find((e) => e.code === 'meeting_held');
  assert.deepEqual([held.status, held.pts, held.day], ['earned', 10, '2026-11-18']);
  assert.equal(earned(after), 23);
});

test('a meeting booked by phone is a conversation but not a visit', () => {
  const s = build([rep('a'), log('a', MON, '10:00', 'meeting', 'L1', { channel: 'call' })]);
  const d = dayStats(s, 'a', MON, ctx());
  assert.deepEqual([d.visits, d.conversations, d.meetings], [0, 1, 1]);
  assert.equal(earned(ledger(s, 'a', ctx())), 10);
});

test('a meeting nobody confirms in 14 days pays nothing more', () => {
  const s = build([rep('a'), log('a', MON, '10:00', 'meeting')]);
  const l = ledger(s, 'a', ctx('2026-12-01', '10:00'));
  assert.equal(l.find((e) => e.code === 'meeting_held').status, 'expired');
  assert.equal(earned(l), 13);
  assert.equal(pending(l), 0);
});

test('a contract pays 10 when the manager confirms it was sent and 20 at signature', () => {
  const c = log('a', MON, '10:00', 'contract');
  const s = build([rep('a'), c]);
  let l = ledger(s, 'a', ctx());
  assert.deepEqual([earned(l), pending(l)], [0, 10]);
  applyEvent(s, { type: 'confirm', t: at(MON, '18:00'), logId: c.id, what: 'contract_sent', by: 'boss' });
  l = ledger(s, 'a', ctx());
  assert.deepEqual([earned(l), pending(l)], [10, 20]);
  applyEvent(s, { type: 'confirm', t: at('2026-11-20', '09:00'), logId: c.id, what: 'contract_signed', by: 'boss' });
  l = ledger(s, 'a', ctx('2026-11-20'));
  assert.deepEqual([earned(l), pending(l)], [30, 0]);
  assert.equal(weekOf(s, 'a', MON, ctx('2026-11-20')).counts.contracts, 1);
});

test('a signed site pays 40, then 30 at install and 30 at the first approved hour', () => {
  const s = build([rep('a'), { type: 'site', t: at(MON, '10:00'), id: 's1', rep: 'a', lead: { id: 'L1', name: 'L1' }, by: 'boss' }]);
  assert.deepEqual([earned(ledger(s, 'a', ctx())), pending(ledger(s, 'a', ctx()))], [40, 60]);
  applyEvent(s, { type: 'site.step', t: at('2026-11-17', '10:00'), siteId: 's1', what: 'installed', by: 'boss' });
  applyEvent(s, { type: 'site.step', t: at('2026-11-19', '10:00'), siteId: 's1', what: 'first_hour', by: 'boss' });
  assert.equal(earned(ledger(s, 'a', ctx('2026-11-19'))), 100);
});

test('closing before 7 pm earns 2; closing later earns nothing and still lights the fourth mark', () => {
  const early = build([rep('a'), log('a', MON, '10:00', 'talk'), close('a', MON, '18:59')]);
  assert.equal(earned(ledger(early, 'a', ctx())), 10);
  assert.equal(dayStats(early, 'a', MON, ctx()).habits[3], true);
  const late = build([rep('a'), log('a', MON, '10:00', 'talk'), close('a', MON, '19:01')]);
  assert.equal(earned(ledger(late, 'a', ctx())), 8);
  assert.deepEqual([dayStats(late, 'a', MON, ctx()).habits[3], dayStats(late, 'a', MON, ctx()).closedOnTime], [true, false]);
});

test('a voided log contributes nothing', () => {
  const l1 = log('a', MON, '10:00', 'talk');
  const s = build([rep('a'), l1, { type: 'log.void', t: at(MON, '12:00'), logId: l1.id, by: 'boss', reason: 'duplicate' }]);
  assert.equal(earned(ledger(s, 'a', ctx())), 0);
  assert.equal(dayStats(s, 'a', MON, ctx()).visits, 0);
});

test('each mark of a finger is its own habit, so a gap shows which one was missed', () => {
  const s = build([rep('a'),
    log('a', MON, '09:00', 'talk', 'L1'), log('a', MON, '11:00', 'call', 'L2'), close('a', MON, '18:00')]);
  const w = weekOf(s, 'a', MON, ctx());
  assert.deepEqual(w.days[0].habits, [true, true, false, true]);
  assert.equal(w.days[0].marks, 3);
  assert.equal(w.marks, 1 + 3);
  assert.equal(w.fullFingers, 0);
  assert.deepEqual(w.days.map((d) => d.kind), ['work', 'future', 'future', 'future', 'future']);
});

test('each day of the week carries the points earned that day, for the chart of the week', () => {
  const s = build([rep('a'), log('a', MON, '09:00', 'talk', 'L1'), log('a', '2026-11-17', '10:00', 'call', 'L2'), close('a', '2026-11-17', '18:00')]);
  const w = weekOf(s, 'a', MON, ctx('2026-11-18'));
  assert.deepEqual(w.days.map((d) => d.points), [8, 7, 0, 0, 0]);
  assert.equal(w.points, 15);
});

test('points earned on Saturday and Sunday are in the week total and told apart: the hand has no finger for them', () => {
  const s = build([rep('a'), log('a', MON, '09:00', 'talk', 'L1'), log('a', '2026-11-21', '10:00', 'talk', 'L2')]);
  const w = weekOf(s, 'a', MON, ctx('2026-11-22'));
  assert.deepEqual(w.days.map((d) => d.points), [8, 0, 0, 0, 0]);
  assert.equal(w.weekendPoints, 8);
  assert.equal(w.points, 16);
  // a week with nothing on its weekend says so with a zero
  assert.equal(weekOf(build([rep('a'), log('a', MON, '09:00', 'talk', 'L1')]), 'a', MON, ctx('2026-11-22')).weekendPoints, 0);
});

test('a part-time rep has rest fingers and points scaled to a five-day week', () => {
  const s = build([rep('a', { workdays: [1, 3, 5] }), log('a', MON, '10:00', 'talk'), log('a', '2026-11-18', '10:00', 'call', 'L2')]);
  const w = weekOf(s, 'a', MON, ctx('2026-11-20'));
  assert.deepEqual(w.days.map((d) => d.kind), ['work', 'rest', 'work', 'rest', 'work']);
  assert.equal(w.points, 13);
  assert.equal(w.scaledPoints, Math.round(13 * 5 / 3));
  assert.equal(w.marksMax, 1 + 4 * 3);
});

test('a day off turns a working day into a rest finger', () => {
  const s = build([rep('a'), { type: 'dayoff', t: at(MON, '08:00'), scope: 'a', date: '2026-11-17' }, { type: 'dayoff', t: at(MON, '08:00'), scope: 'PA', date: '2026-11-19' }]);
  assert.deepEqual(weekOf(s, 'a', MON, ctx('2026-11-20')).days.map((d) => d.kind), ['work', 'rest', 'work', 'rest', 'work']);
});

test('a full day of work on Saturday completes one finger missed that week', () => {
  const sat = '2026-11-21';
  const s = build([rep('a'),
    log('a', sat, '09:00', 'talk', 'S1', {}), log('a', sat, '10:00', 'call', 'S2'), log('a', sat, '11:00', 'call', 'L9', { prior: '2026-11-01' }), close('a', sat, '17:00')]);
  const c = ctx('2026-11-22', '10:00');
  const w = weekOf(s, 'a', MON, c);
  assert.equal(w.fullFingers, 1);
  assert.equal(w.days.filter((d) => d.repaired).length, 1);
});

test('the week counts what the Rep Scorecard counts', () => {
  const s = build([rep('a'), log('a', MON, '09:00', 'talk', 'L1'), log('a', MON, '10:00', 'absent', 'L2'), log('a', '2026-11-17', '09:00', 'meeting', 'L3', { channel: 'call' })]);
  assert.deepEqual(weekOf(s, 'a', MON, ctx('2026-11-17')).counts, { visits: 2, conversations: 2, meetings: 1, contracts: 0, replies: 0 });
});

test('a streak counts working days with a conversation', () => {
  const s = build([rep('a', { startDate: '2026-11-11' }),
    log('a', '2026-11-11', '10:00', 'talk'), log('a', '2026-11-12', '10:00', 'call'), log('a', '2026-11-13', '10:00', 'talk', 'L2')]);
  assert.deepEqual(streak(s, 'a', '2026-11-13', ctx('2026-11-13')), { current: 3, best: 3, spares: 2, todayCounted: true });
});

test('weekends and days off never break a streak, and today is still open until it ends', () => {
  const s = build([rep('a', { startDate: '2026-11-12' }),
    log('a', '2026-11-12', '10:00', 'talk'), log('a', '2026-11-13', '10:00', 'call'),
    { type: 'dayoff', t: at('2026-11-13', '08:00'), scope: 'a', date: MON }, log('a', '2026-11-17', '10:00', 'talk', 'L3')]);
  const st = streak(s, 'a', '2026-11-18', ctx('2026-11-18', '09:00'));
  assert.deepEqual([st.current, st.todayCounted, st.spares], [3, false, 2]);
});

test('a missed day uses a spare and keeps the streak; a third missed day in a row resets it', () => {
  const base = [rep('a', { startDate: '2026-11-09' }), log('a', '2026-11-09', '10:00', 'talk'), log('a', '2026-11-10', '10:00', 'talk'), log('a', '2026-11-11', '10:00', 'talk')];
  const one = build(base);
  assert.deepEqual(streak(one, 'a', '2026-11-13', ctx('2026-11-13', '09:00')), { current: 3, best: 3, spares: 1, todayCounted: false });
  const three = build(base);
  const st = streak(three, 'a', '2026-11-17', ctx('2026-11-17', '09:00'));
  assert.deepEqual([st.current, st.best, st.spares], [0, 3, 0]);
});

test('a clean week gives one spare back, never above two', () => {
  const days = ['2026-11-02', '2026-11-03', '2026-11-05', '2026-11-06', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13'];
  const s = build([rep('a', { startDate: '2026-11-02' }), ...days.map((d) => log('a', d, '10:00', 'talk'))]);
  // Nov 4 was missed (one spare used); the week of Nov 9 was clean, so the spare comes back.
  assert.deepEqual(streak(s, 'a', MON, ctx(MON, '09:00')), { current: 9, best: 9, spares: 2, todayCounted: false });
});

test('the weekly goal offers three sizes built from the rep\'s working days', () => {
  const prev = ['2026-11-09', '2026-11-10', '2026-11-11'].flatMap((d) => [
    log('a', d, '09:00', 'talk', `A${d}`), log('a', d, '10:00', 'call', `B${d}`), log('a', d, '11:00', 'call', 'OLD', { prior: '2026-10-01' }), close('a', d, '18:00')]);
  const s = build([rep('a'), ...prev]);
  const c = ctx(MON, '09:00');
  assert.equal(weekOf(s, 'a', '2026-11-09', c).fullFingers, 3);
  assert.deepEqual(goalOf(s, 'a', MON, c), { options: [3, 4, 5], picked: 4, isDefault: true, fullFingers: 0, reached: false });
  applyEvent(s, { type: 'goal.pick', t: at(MON, '09:30'), rep: 'a', week: MON, k: 5 });
  assert.deepEqual([goalOf(s, 'a', MON, c).picked, goalOf(s, 'a', MON, c).isDefault], [5, false]);
  const part = build([rep('p', { workdays: [1, 3, 5] })]);
  assert.deepEqual(goalOf(part, 'p', MON, ctx(MON, '09:00')).options, [1, 2, 3]);
});

test('levels follow lifetime points', () => {
  assert.deepEqual(levelOf(1240), { name: 'oficio', step: 1, xp: 1240, floor: 1000, next: 1500 });
  assert.deepEqual(levelOf(0), { name: 'aprendizaje', step: 1, xp: 0, floor: 0, next: 250 });
  assert.deepEqual(levelOf(20000), { name: 'mentoria', step: 3, xp: 20000, floor: 13000, next: null });
  const s = build([rep('a'), log('a', '2026-11-09', '10:00', 'talk'), log('a', MON, '10:00', 'talk', 'L2')]);
  assert.equal(lifetime(s, 'a', ctx()), 16);
});

test('the days before a rep started are rest days: a first week is not a week of missed fingers', () => {
  const s = build([rep('a', { startDate: '2026-11-19' }), log('a', '2026-11-19', '10:00', 'talk')]);
  const w = weekOf(s, 'a', MON, ctx('2026-11-19'));
  assert.deepEqual(w.days.map((d) => d.kind), ['rest', 'rest', 'rest', 'work', 'future']);
  assert.deepEqual([w.workFingers, w.marksMax, w.marks], [2, 9, 2]);
  assert.deepEqual(goalOf(s, 'a', MON, ctx('2026-11-19')).options, [1, 2]);
});

test("a meeting's wait for confirmation runs from the day of the meeting, not from the day it was booked", () => {
  const s = build([rep('a'), log('a', MON, '10:00', 'meeting', 'L1', { channel: 'visit', when: '2026-12-04' })]);
  const held = (day) => ledger(s, 'a', ctx(day, '12:00')).find((e) => e.code === 'meeting_held');
  assert.deepEqual([held('2026-12-02').status, held('2026-12-17').status, held('2026-12-19').status], ['pending', 'pending', 'expired']);
  assert.equal(held('2026-12-02').at, at(MON, '10:00'));   // it is still listed at the moment it was booked
  const undated = build([rep('a'), log('a', MON, '10:00', 'meeting', 'L1', { channel: 'visit' })]);
  assert.equal(ledger(undated, 'a', ctx('2026-12-02', '12:00')).find((e) => e.code === 'meeting_held').status, 'expired');
});

test('a voided site pays nothing, and an undone confirmation waits again', () => {
  const m = log('a', MON, '10:00', 'meeting', 'L1', { channel: 'visit' });
  const s = build([rep('a'), m, { type: 'confirm', t: at(MON, '12:00'), logId: m.id, what: 'meeting_held', by: 'boss' },
    { type: 'site', t: at(MON, '13:00'), id: 's_1', rep: 'a', lead: { id: null, name: 'Sitio' }, by: 'boss' }]);
  assert.equal(earned(ledger(s, 'a', ctx())), 13 + 10 + 40);
  applyEvent(s, { type: 'confirm.undo', t: at(MON, '14:00'), logId: m.id, what: 'meeting_held', by: 'boss' });
  applyEvent(s, { type: 'site.void', t: at(MON, '14:05'), siteId: 's_1', by: 'boss' });
  const after = ledger(s, 'a', ctx());
  assert.deepEqual([earned(after), pending(after), after.some((e) => e.code.startsWith('site_')), s.feed.map((f) => f.type)], [13, 10, false, ['log']]);
});
