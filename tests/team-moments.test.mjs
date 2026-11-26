// What deserves a moment on screen is decided in team/moments.js, apart from the screens, so it is tested without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { entrance, dayPart, localMinutes, nextStep, moments, stake, raceShare, changedChars, countFrame, tableNote, firstDays, untouched, anyLog, shortNames, closeCard, crewOf, historyRows, gapLine, behindLine, CELEBRATE_HOLD, stopCta, afterClose } from '../team/moments.js';

const RULES = { points: { visit: 3, conversation: 5, followup: 2, dayClosedOnTime: 2 }, habits: { visits: 1, conversations: 2, followups: 1 }, closeBy: '19:00' };
const today = (over = {}) => ({ day: '2026-11-17', isWork: true, habits: [false, false, false, false], visits: 0, conversations: 0, followups: 0, closed: false, ...over });
const view = (over = {}) => ({
  me: { id: 'r_a', first: 'Ana', isNew: false, startDate: '2026-10-01' }, viewer: { role: 'rep' },
  today: today(), week: { workFingers: 5, fullFingers: 0 }, level: { name: 'aprendizaje', step: 1, xp: 0 }, badges: [{ code: 'first_log', level: 0 }, { code: 'full_hand', level: 0 }],
  table: { week: { ranked: 0, me: { place: null }, gap: null, behind: null, podium: [] } }, team: { working: 4, players: 4, closedToday: 1 }, ...over,
});

test('the full entrance plays on the first open of a day or when someone else used this phone last, and only then', () => {
  assert.equal(entrance({ lastDay: '2026-11-16', lastId: 'r_a', today: '2026-11-17', id: 'r_a' }), 'full');
  assert.equal(entrance({ lastDay: '2026-11-17', lastId: 'r_b', today: '2026-11-17', id: 'r_a' }), 'full');   // a shared phone: another person
  assert.equal(entrance({ lastDay: null, lastId: null, today: '2026-11-17', id: 'r_a' }), 'full');
  assert.equal(entrance({ lastDay: '2026-11-17', lastId: 'r_a', today: '2026-11-17', id: 'r_a' }), 'short');
});

test('the greeting follows the local hour of the person, not of the phone', () => {
  assert.deepEqual([dayPart(0), dayPart(11 * 60 + 59), dayPart(12 * 60), dayPart(18 * 60 + 59), dayPart(19 * 60), dayPart(23 * 60)], ['morning', 'morning', 'afternoon', 'afternoon', 'evening', 'evening']);
  assert.equal(localMinutes('2026-11-17T20:30:00.000Z', 'America/Panama'), 15 * 60 + 30);
  assert.equal(localMinutes('2026-11-17T04:05:00.000Z', 'America/Bogota'), 23 * 60 + 5);
});

test('the next step is the first habit still open today, with what it pays', () => {
  assert.deepEqual(nextStep(today(), RULES, 600), { code: 'visit', habit: 0, pts: 3, left: 1 });
  assert.deepEqual(nextStep(today({ habits: [true, false, false, false], visits: 1 }), RULES, 600), { code: 'conversation', habit: 1, pts: 5, left: 2 });
  assert.deepEqual(nextStep(today({ habits: [true, false, false, false], visits: 1, conversations: 1 }), RULES, 600), { code: 'conversation', habit: 1, pts: 5, left: 1 });
  assert.deepEqual(nextStep(today({ habits: [true, true, false, false], conversations: 3 }), RULES, 600), { code: 'followup', habit: 2, pts: 2, left: 1 });
  assert.deepEqual(nextStep(today({ habits: [true, true, true, false] }), RULES, 600), { code: 'close', habit: 3, pts: 2, left: 1 });
});

test('closing after the hour pays nothing, and the step says so', () => {
  assert.equal(nextStep(today({ habits: [true, true, true, false] }), RULES, 19 * 60).pts, 0);
  assert.equal(nextStep(today({ habits: [true, true, true, false] }), RULES, 18 * 60 + 59).pts, 2);
});

test('a closed day, a full finger, a day off and a manager who does not play have no next step to log', () => {
  assert.deepEqual(nextStep(today({ habits: [true, false, false, true], closed: true }), RULES, 600), { code: 'closed' });
  assert.deepEqual(nextStep(today({ habits: [true, true, true, true], closed: true }), RULES, 600), { code: 'done' });
  assert.deepEqual(nextStep(today({ isWork: false }), RULES, 600), { code: 'rest' });
  assert.equal(nextStep(null, RULES, 600), null);
});

test('a finger that fills, a full hand, a new step, a new level and a new badge each get one moment, heaviest first', () => {
  const before = view();
  const fingerDone = view({ today: today({ habits: [true, true, true, true], closed: true }) });
  assert.deepEqual(moments(before, fingerDone), [{ kind: 'finger' }]);
  assert.deepEqual(moments(fingerDone, fingerDone), []);   // nothing new: no moment
  // the last finger of the week: the hand speaks, the finger does not repeat it
  const handDone = view({ today: today({ habits: [true, true, true, true] }), week: { workFingers: 5, fullFingers: 5 } });
  assert.deepEqual(moments(view({ week: { workFingers: 5, fullFingers: 4 } }), handDone), [{ kind: 'hand' }]);
  const step = view({ level: { name: 'aprendizaje', step: 2, xp: 252 } });
  assert.deepEqual(moments(before, step), [{ kind: 'step', name: 'aprendizaje', step: 2, xp: 252 }]);
  const level = view({ level: { name: 'oficio', step: 1, xp: 1003 } });
  assert.deepEqual(moments(view({ level: { name: 'aprendizaje', step: 3, xp: 998 } }), level), [{ kind: 'level', name: 'oficio', xp: 1003 }]);
  const badge = view({ badges: [{ code: 'first_log', level: 1 }, { code: 'full_hand', level: 0 }] });
  assert.deepEqual(moments(before, badge), [{ kind: 'badge', code: 'first_log', level: 1 }]);
  // taking the lead comes from the server's answer and goes first; at most two moments play
  const many = view({ today: today({ habits: [true, true, true, true] }), level: { name: 'aprendizaje', step: 2, xp: 260 }, badges: [{ code: 'first_log', level: 1 }, { code: 'full_hand', level: 0 }] });
  assert.deepEqual(moments(before, many, { tookLead: true }).map((m) => m.kind), ['lead', 'badge']);
});

test('the full hand badge and the full hand are one moment, not two', () => {
  const after = view({ today: today({ habits: [true, true, true, true] }), week: { workFingers: 5, fullFingers: 5 }, badges: [{ code: 'first_log', level: 0 }, { code: 'full_hand', level: 1 }] });
  assert.deepEqual(moments(view({ week: { workFingers: 5, fullFingers: 4 } }), after), [{ kind: 'badge', code: 'full_hand', level: 1 }]);
});

test('a read with nothing to compare, or a manager who does not play, has no moments', () => {
  assert.deepEqual(moments(null, view()), []);
  assert.deepEqual(moments(view(), view({ today: null, week: null, level: null, badges: [] })), []);
  // points taken back (a void) are never celebrated
  assert.deepEqual(moments(view({ level: { name: 'oficio', step: 1, xp: 1003 } }), view({ level: { name: 'aprendizaje', step: 3, xp: 990 } })), []);
});

test('what is at stake today is one fact, picked in order: day off, closed day, the place, the first days, the empty table', () => {
  assert.deepEqual(stake(view({ today: today({ isWork: false }) })), { kind: 'rest' });
  assert.deepEqual(stake(view({ today: today({ closed: true }) })), { kind: 'closed' });
  const T = (week) => ({ table: { week: { ranked: 4, podium: [], gap: null, behind: null, ...week } } });
  assert.deepEqual(stake(view(T({ me: { place: 1, score: 40 }, behind: { name: 'Beto', pts: 6 } }))), { kind: 'lead', score: 40, behind: { name: 'Beto', pts: 6 } });
  assert.deepEqual(stake(view(T({ me: { place: 3 }, gap: { pts: 12, aheadOnPodium: true, aheadName: 'Caro' } }))), { kind: 'place', place: 3, ranked: 4, gap: { pts: 12, name: 'Caro' } });
  assert.deepEqual(stake(view(T({ me: { place: 4 }, gap: { pts: 2, aheadOnPodium: false, aheadName: null } }))), { kind: 'place', place: 4, ranked: 4, gap: { pts: 2, name: null } });
  // day 3 of the first 14: started on the 15th, today is the 17th
  assert.deepEqual(stake(view({ me: { id: 'r_a', first: 'Ana', isNew: true, startDate: '2026-11-15' } })), { kind: 'new', day: 3, of: 14 });
  assert.deepEqual(stake(view()), { kind: 'zero' });
  assert.deepEqual(stake(view(T({ me: { place: null } }))), { kind: 'nopts' });
});

test('a manager who does not play is greeted with the team\'s day', () => {
  assert.deepEqual(stake(view({ today: null, week: null, viewer: { role: 'manager' } })), { kind: 'team', working: 4, players: 4, closed: 1 });
});

test('the race bar runs from zero to the leader, and never past either end', () => {
  assert.deepEqual([raceShare(0, 40), raceShare(10, 40), raceShare(40, 40), raceShare(55, 40), raceShare(5, 0), raceShare(-3, 40)], [0, 0.25, 1, 1, 0, 0]);
});

test('a number that rolls says which of its characters changed', () => {
  assert.deepEqual(changedChars('2 de 4', '3 de 4'), [true, false, false, false, false, false]);
  assert.deepEqual(changedChars('83', '91'), [true, true]);
  assert.deepEqual(changedChars('89', '90'), [true, true]);
  assert.deepEqual(changedChars('9', '12'), [true, true]);      // another length: every character is new
  assert.deepEqual(changedChars('120', '128'), [false, false, true]);
  assert.deepEqual(changedChars(undefined, '7'), [false]);       // a first paint rolls nothing
});

test('an empty table says why it is empty: nobody scored, or the whole team is in its first days', () => {
  const T = (over) => ({ ranked: 0, podium: [], me: null, rest: [], ...over });
  assert.equal(tableNote(T({ ranked: 3 })), 'ranked');
  assert.equal(tableNote(T({ me: { isNew: false }, rest: [{ isNew: false }, { isNew: true }] })), 'empty');
  // everyone is new: someone may well have points, so the note must not say that nobody does
  assert.equal(tableNote(T({ me: { isNew: true }, rest: [{ isNew: true }, { isNew: true }] })), 'new');
  // a manager who does not play looks at a team of new reps
  assert.equal(tableNote(T({ rest: [{ isNew: true }] })), 'new');
  assert.equal(tableNote(T({})), 'empty');
});

test('a rep in their first days knows which day it is', () => {
  assert.deepEqual(firstDays(view({ me: { id: 'r_a', first: 'Ana', isNew: true, startDate: '2026-11-10' } })), { day: 8, of: 14 });
  assert.deepEqual(firstDays(view({ me: { id: 'r_a', first: 'Ana', isNew: true, startDate: '2026-11-17' } })), { day: 1, of: 14 });
  assert.equal(firstDays(view()), null);                                        // not new
  assert.equal(firstDays(view({ today: null, viewer: { role: 'manager' } })), null);   // nobody's day
});

test('a day is untouched until something is logged in it, whatever the habits say', () => {
  const zero = { messages: 0, replies: 0, meetings: 0 };
  assert.equal(untouched(today(zero)), true);
  assert.equal(untouched(today({ ...zero, messages: 1 })), false);              // a message lights no habit, and it is still a log
  assert.equal(untouched(today({ ...zero, conversations: 1 })), false);
  assert.equal(untouched(today({ ...zero, closed: true })), false);
  assert.equal(untouched(today({ ...zero, isWork: false })), false);            // a day off is not a day waiting to start
  assert.equal(untouched(null), false);
  // the card that closes the day asks only once there is something to close, on a day off too
  assert.deepEqual([anyLog(today(zero)), anyLog(today({ ...zero, isWork: false, replies: 1 })), anyLog(null)], [false, true, false]);
});

test('people who share a first name are told apart on a lens, with as little as it takes', () => {
  const label = (...names) => [...shortNames(names.map((name, i) => ({ id: `r${i}`, name }))).values()];
  assert.deepEqual(label('José Molina', 'Mario Campos', 'Mateo Paredes'), ['José', 'Mario', 'Mateo']);
  // the same first name: the initial of what follows tells them apart
  assert.deepEqual(label('José Molina', 'José Pérez', 'Mario Campos'), ['José M.', 'José P.', 'Mario']);
  // a label like "Vendedor A" already ends in its letter
  assert.deepEqual(label('Vendedor A', 'Vendedor B'), ['Vendedor A', 'Vendedor B']);
  // the same first name and the same initial: only the whole name tells them apart
  assert.deepEqual(label('José Molina', 'José Medina'), ['José Molina', 'José Medina']);
  // nothing more to show, or nothing at all
  assert.deepEqual(label('Ana', 'Ana', '  Luz   María  '), ['Ana', 'Ana', 'Luz']);
  assert.deepEqual(label(''), ['']);
});

test('the card that closes the day shows where the route cannot: on a day off with something logged, and once the day is closed', () => {
  // A working day closes through the route's last stop, so the card waits until there is a report to read.
  assert.equal(closeCard(today({ visits: 1 })), false);
  assert.equal(closeCard(today({ closed: true })), true);
  // A day off has no route. Work logged on it can complete a finger missed earlier, and that needs its close too.
  assert.equal(closeCard(today({ isWork: false })), false);
  assert.equal(closeCard(today({ isWork: false, visits: 1 })), true);
  assert.equal(closeCard(today({ isWork: false, visits: 1, closed: true })), true);
  assert.equal(closeCard(null), false);
});

test('the faces on the team staircase are at most five, by name, and the viewer is always one of them', () => {
  const row = (name, mine = false) => ({ id: name, name, mine });
  const table = (me, podium, rest) => ({ me, podium, rest });
  const names = (list) => list.map((r) => r.name);
  const me = row('Zoe', true);
  // a small team: everybody, by name
  assert.deepEqual(names(crewOf(table(me, [row('Luis'), row('Ana')], [row('Mara')]))), ['Ana', 'Luis', 'Mara', 'Zoe']);
  // the viewer's own row on the podium is not a second face
  assert.deepEqual(names(crewOf(table(me, [row('Luis'), { ...me }], []))), ['Luis', 'Zoe']);
  // a larger team: five faces, and the viewer keeps theirs even when their name sorts last
  const big = table(me, [row('Ana'), row('Beto'), row('Caro')], [row('Dani'), row('Eli'), row('Fer')]);
  assert.deepEqual(names(crewOf(big)), ['Ana', 'Beto', 'Caro', 'Dani', 'Zoe']);
  // a viewer with no row of their own (a manager looking at the team) sees the first five
  assert.deepEqual(names(crewOf(table(null, [row('Luis')], [row('Ana')]))), ['Ana', 'Luis']);
  assert.equal(crewOf({ ...big, me: null }).length, 5);
});

test('in the history, a meeting the person still has to report as held comes first; the rest keeps its order', () => {
  const row = (id, code, status = 'earned', logId = id) => ({ id, logId, code, status });
  const ledger = [row('a', 'visit'), row('b', 'conversation'), row('m1', 'meeting_held', 'pending', 'L1'), row('c', 'contract_sent', 'pending', 'L2'), row('m2', 'meeting_held', 'pending', 'L3')];
  const pending = [{ logId: 'L1', code: 'meeting_held', held: false }, { logId: 'L2', code: 'contract_sent', held: false }, { logId: 'L3', code: 'meeting_held', held: true }];
  // L1 waits for the rep; L3 was already reported and now waits for the manager; a contract never waits for the rep
  assert.deepEqual(historyRows(ledger, pending).map((e) => e.id), ['m1', 'a', 'b', 'c', 'm2']);
  assert.deepEqual(historyRows(ledger, []).map((e) => e.id), ['a', 'b', 'm1', 'c', 'm2']);
  assert.deepEqual(historyRows([], pending), []);
});

test('a counter ends on its exact value, a percentage with a decimal included; the frames before it are whole numbers', () => {
  assert.equal(countFrame(0, 88.5, 1), 88.5);
  assert.equal(countFrame(0, 88.5, 1.2), 88.5, 'a late frame past the end still writes the value');
  assert.equal(countFrame(0, 88.5, 0), 0);
  assert.equal(Number.isInteger(countFrame(0, 88.5, 0.5)), true);
  assert.equal(countFrame(3, 12, 1), 12, 'whole numbers end where they always did');
  assert.equal(countFrame(12, 3, 1), 3);
  assert.equal(countFrame(0, 4144, 1), 4144);
});

// Fix round 1 (D1): the entrance said "A 0 puntos de Omar." on a tie. The gap line is decided once, for the entrance
// and the table: a tie reads "Empatas con {name}."
test('the gap to the place ahead: a tie is a tie, by name or not, and a gap names the place ahead when it can', () => {
  assert.deepEqual(gapLine({ pts: 0, name: 'Omar' }), { key: 'table.sup.tie', name: 'Omar' });
  assert.deepEqual(gapLine({ pts: 0, name: null }), { key: 'table.sup.tie.next' });
  assert.deepEqual(gapLine({ pts: 6, name: 'Omar' }), { key: 'table.sup.gap.named', pts: 6, name: 'Omar' });
  assert.deepEqual(gapLine({ pts: 6, name: null }), { key: 'table.sup.gap.next', pts: 6 });
  assert.equal(gapLine(null), null);
  const app = readFileSync(new URL('../team/app.js', import.meta.url), 'utf8');
  const welcome = app.slice(app.indexOf('function welcome('), app.indexOf('async function poll('));
  assert.match(welcome, /gapLine\(st\.gap\)/, 'the entrance words its gap with gapLine');
  assert.equal(/table\.sup\.gap\.named/.test(welcome), false, 'and never words a gap of its own');
});

// Final round (N6): tied for first, the table and the entrance said "{name} te sigue a 0 puntos." The line about the rep
// behind is decided once too: a tie is a tie.
test('tied for first reads as a tie, in the table and in the entrance', () => {
  const view = { today: { isWork: true }, me: {}, table: { week: { me: { place: 1, score: 40 }, behind: { name: 'Camila', pts: 0 }, ranked: 4 } } };
  assert.deepEqual(behindLine(stake(view).behind), { key: 'table.sup.tie', name: 'Camila' });
  assert.deepEqual(behindLine({ name: 'Camila', pts: 7 }), { key: 'table.sup.behind', name: 'Camila', pts: 7 });
  assert.equal(behindLine(null), null);
  const app = readFileSync(new URL('../team/app.js', import.meta.url), 'utf8');
  assert.equal((app.match(/behindLine\(/g) || []).length, 2, 'the table and the entrance both word it with behindLine');
  assert.equal(/t\('table\.sup\.behind'/.test(app), false, 'and never word it on their own');
});

// Fix round 1 (D3): a moment holds the app for a breath; pinned so nobody lengthens it by accident.
test('a moment holds 1,600 ms, and 1,200 ms with reduced motion', () => {
  assert.deepEqual(CELEBRATE_HOLD, { full: 1600, reduced: 1200 });
  const fx = readFileSync(new URL('../team/fx.js', import.meta.url), 'utf8');
  const celebrate = fx.slice(fx.indexOf('export function celebrate('), fx.indexOf('\n}\n', fx.indexOf('export function celebrate(')));
  assert.match(celebrate, /setTimeout\(off, reduce \? CELEBRATE_HOLD\.reduced : CELEBRATE_HOLD\.full\)/);
  assert.equal(/for \(const ms of \[/.test(celebrate), false, 'no leftover one-item loop');
});

// Track F, F4: the day's completion comes before its paperwork. The moment carries the report: shared where the
// browser can share text, else copied; a share the rep cancels is not an error and leaves the moment open.
import { reportAction, reportOutcome, DONE_HOLD } from '../team/moments.js';
import { backStep } from '../team/back-steps.js';
import { DICT as F4 } from '../team/i18n.js';
test('the moment shares the report where the browser can, else copies it, each with its quiet line', () => {
  assert.deepEqual(reportAction(true), { kind: 'share', key: 'dd.share', hint: 'dd.share.hint' });
  assert.deepEqual(reportAction(false), { kind: 'copy', key: 'dd.copy', hint: 'dd.copy.hint' });
  assert.equal(F4.es['dd.share'], 'Compartir el reporte'); assert.equal(F4.en['dd.share'], 'Share the report');
  assert.equal(F4.es['dd.copy'], 'Copiar el reporte'); assert.equal(F4.en['dd.copy'], 'Copy the report');
  assert.equal(F4.es['dd.share.hint'], 'Elige Slack y el canal del equipo.'); assert.equal(F4.en['dd.share.hint'], "Pick Slack and the team's channel.");
  assert.equal(F4.es['dd.copy.hint'], 'Pégalo en el canal del equipo en Slack.');
  assert.equal(F4.es['dd.done'], 'Listo.');
});
test('what each outcome does: done says Listo and closes after 900 ms; a cancelled share stays; a failed share copies; a failed copy says so', () => {
  assert.equal(DONE_HOLD, 900);
  assert.deepEqual(reportOutcome('share', 'ok'), { say: 'dd.done', close: true, then: null });
  assert.deepEqual(reportOutcome('copy', 'ok'), { say: 'dd.done', close: true, then: null });
  assert.deepEqual(reportOutcome('share', 'cancel'), { say: null, close: false, then: null });
  assert.deepEqual(reportOutcome('share', 'fail'), { say: null, close: false, then: 'copy' });
  assert.deepEqual(reportOutcome('copy', 'fail'), { say: 'close.copy.fail', close: false, then: null });
});
test('Back closes the moment first, before any sheet or screen', () => {
  assert.equal(backStep({ moment: true, sheets: 1, deep: true, away: true }), 'moment');
  assert.equal(backStep({ skip: 1, moment: true }), 'skip');
});

test('Hoy\'s stop for a closed day: no "Cerrar el día" button, whatever the stop shown; an open day keeps its button', () => {
  const closed = today({ habits: [true, true, true, true], visits: 1, conversations: 2, followups: 1, closed: true });
  const step = nextStep(closed, RULES, 15 * 60);
  for (const sel of [0, 1, 2, 3]) assert.equal(stopCta({ today: closed, step, sel, done: true }), null);
  // closed with a habit still open: still none
  const part = today({ habits: [true, false, false, true], visits: 1, closed: true });
  assert.equal(stopCta({ today: part, step: nextStep(part, RULES, 15 * 60), sel: 3, done: true }), null);
  // an open day: log the stop, go on once it is done, close on the last one; a manager looking has none
  const open = today({ habits: [true, true, true, false], visits: 1, conversations: 2, followups: 1 });
  const s3 = nextStep(open, RULES, 15 * 60);
  assert.deepEqual(stopCta({ today: open, step: s3, sel: 3, done: false }), { step: 'close' });
  assert.deepEqual(stopCta({ today: open, step: s3, sel: 0, done: true }), { step: 'next' });
  assert.deepEqual(stopCta({ today: today(), step: nextStep(today(), RULES, 0), sel: 0, done: false }), { step: 'log' });
  assert.equal(stopCta({ today: open, step: null, sel: 3, done: false }), null);
});

test('closing the day that fills the finger: the moment plays at once and the stop owes no answer; any other close as before', () => {
  assert.deepEqual(afterClose([{ kind: 'finger' }]), { owed: false, now: true });
  assert.deepEqual(afterClose([{ kind: 'level' }, { kind: 'finger' }]), { owed: false, now: true });
  // no finger moment (the four not complete, or the hand's own moment): the stop answers first, then any moment
  assert.deepEqual(afterClose([]), { owed: true, now: false });
  assert.deepEqual(afterClose([{ kind: 'hand' }]), { owed: true, now: false });
  assert.deepEqual(afterClose(undefined), { owed: true, now: false });
});
