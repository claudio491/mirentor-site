// What deserves a moment on screen is decided in team/moments.js, apart from the screens, so it is tested without a browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entrance, dayPart, localMinutes, nextStep, moments, stake, raceShare, changedChars, tableNote, firstDays, untouched, anyLog } from '../team/moments.js';

const RULES = { points: { visit: 3, conversation: 5, followup: 2, dayClosedOnTime: 2 }, habits: { visits: 1, conversations: 2, followups: 1 }, closeBy: '19:00' };
const today = (over = {}) => ({ day: '2026-11-17', isWork: true, habits: [false, false, false, false], visits: 0, conversations: 0, followups: 0, closed: false, ...over });
const view = (over = {}) => ({
  me: { id: 'r_a', first: 'Ana', isNew: false, startDate: '2026-10-01' }, viewer: { role: 'rep' },
  today: today(), week: { workFingers: 5, fullFingers: 0 }, level: { name: 'aprendizaje', step: 1, xp: 0 }, badges: [{ code: 'first_log', level: 0 }, { code: 'full_hand', level: 0 }],
  table: { week: { ranked: 0, me: { place: null }, gap: null, behind: null, podium: [] } }, team: { working: 4, players: 4, closedToday: 1 }, ...over,
});

test('the full entrance plays after signing in and on the first open of a day, and only then', () => {
  assert.equal(entrance({ fresh: true, lastDay: '2026-11-17', lastId: 'r_a', today: '2026-11-17', id: 'r_a' }), 'full');
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
