// A rep's day is drawn as four stops on a route, each an illustration of four frames. What each stop has and needs,
// which frames it shows and where a log lands are decided here, away from the screen, so they can be tested.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STOPS, LAST_STEP, stopsOf, standOn, loopOf, rewardOf, landed, stepOf } from '../team/stops.js';

const RULES = { habits: { visits: 1, conversations: 2, followups: 1 } };
const day = (over = {}) => ({ isWork: true, closed: false, visits: 0, conversations: 0, followups: 0, habits: [false, false, false, false], ...over });
const frames = (seq) => seq.map(([f]) => f);

test('a day is four stops, each with what it has and what it needs', () => {
  assert.deepEqual(STOPS, ['visit', 'talk', 'follow', 'close']);
  assert.deepEqual(stopsOf(day(), RULES).map((s) => [s.have, s.need, s.done]), [[0, 1, false], [0, 2, false], [0, 1, false], [0, 1, false]]);
  // a stop never shows more than it needs: three visits are still "1 of 1"
  const busy = stopsOf(day({ visits: 3, conversations: 1, followups: 2, habits: [true, false, true, false] }), RULES);
  assert.deepEqual(busy.map((s) => [s.have, s.need, s.done]), [[1, 1, true], [1, 2, false], [1, 1, true], [0, 1, false]]);
  assert.deepEqual(stopsOf(day({ closed: true, habits: [false, false, false, true] }), RULES)[3], { have: 1, need: 1, done: true });
});

test('the stop to stand on is the first habit still open, and the close once the first three are done', () => {
  const at = (habits, over = {}) => standOn(stopsOf(day({ habits, ...over }), RULES));
  assert.equal(at([false, false, false, false]), 0);
  assert.equal(at([true, false, false, false]), 1);
  assert.equal(at([true, false, true, false]), 1);
  assert.equal(at([true, true, false, false]), 2);
  assert.equal(at([true, true, true, false]), 3);
  assert.equal(at([true, true, true, true], { closed: true }), 3);
  // a day closed with habits still open stands on its close: there is nothing left to do today
  assert.equal(at([true, false, false, true], { closed: true }), 3);
  assert.equal(at([false, false, false, true], { closed: true }), 3);
});

test('a stop waits on its first two frames and rests on its last two once it is done', () => {
  for (let i = 0; i < 4; i += 1) {
    const waiting = loopOf(i, { have: 0, need: i === 1 ? 2 : 1, done: false }), done = loopOf(i, { have: i === 1 ? 2 : 1, need: i === 1 ? 2 : 1, done: true });
    assert.ok(frames(waiting).every((f) => f === 0 || f === 1), `stop ${i} waits on ${frames(waiting)}`);
    assert.ok(frames(done).every((f) => f === 2 || f === 3), `stop ${i} rests on ${frames(done)}`);
    // a loop of one frame holds it (0 ms); a loop of several gives each one its time
    for (const seq of [waiting, done]) assert.ok(seq.length === 1 ? seq[0][1] === 0 : seq.every(([, ms]) => ms >= 400), JSON.stringify(seq));
  }
  // the conversation that has not started is not a still picture: its first bubble comes and goes
  assert.equal(loopOf(1, { have: 0, need: 2, done: false }).length, 2);
  // one conversation of two shows its one speech bubble and holds it
  assert.deepEqual(loopOf(1, { have: 1, need: 2, done: false }), [[1, 0]]);
});

test('a log plays the frames between where the stop was and where it is now', () => {
  assert.deepEqual(frames(rewardOf(0, 0, 1, 1)), [1, 2, 3]);
  assert.deepEqual(frames(rewardOf(2, 0, 1, 1)), [1, 2, 3]);
  assert.deepEqual(frames(rewardOf(3, 0, 1, 1)), [1, 2, 3]);
  assert.deepEqual(frames(rewardOf(1, 0, 1, 2)), [1]);           // the first conversation: one bubble
  assert.deepEqual(frames(rewardOf(1, 1, 2, 2)), [2, 3]);        // the second: two bubbles, then the cups
  assert.deepEqual(frames(rewardOf(1, 0, 2, 2)), [1, 2, 3]);     // both at once (a refresh that brings two)
  assert.deepEqual(frames(rewardOf(0, 1, 1, 1)), [3]);           // nothing new: it simply rests
  for (const seq of [rewardOf(0, 0, 1, 1), rewardOf(1, 0, 1, 2), rewardOf(1, 1, 2, 2), rewardOf(3, 0, 1, 1)]) assert.ok(seq.every(([, ms]) => ms > 0), 'every frame of an answer takes time, so it can be waited for');
});

test('a log lands on the first stop whose number grew, and one that moves no habit lands nowhere', () => {
  const none = day();
  assert.equal(landed(none, day({ visits: 1, conversations: 1, habits: [true, false, false, false] }), RULES), 0);   // visited and spoke
  assert.equal(landed(none, day({ conversations: 1 }), RULES), 1);                                                 // a call
  assert.equal(landed(none, day({ followups: 1, habits: [false, false, true, false] }), RULES), 2);
  assert.equal(landed(day({ visits: 1, habits: [true, false, false, false] }), day({ visits: 1, closed: true, habits: [true, false, false, true] }), RULES), 3);
  assert.equal(landed(none, day(), RULES), null);                                                                   // a message: no habit moved
  // a second visit with nobody there on a day whose visit is done changes nothing a stop shows
  assert.equal(landed(day({ visits: 1, habits: [true, false, false, false] }), day({ visits: 2, habits: [true, false, false, false] }), RULES), null);
  // a visit with a conversation, when the visit was already done, lands on the conversations
  assert.equal(landed(day({ visits: 1, habits: [true, false, false, false] }), day({ visits: 2, conversations: 1, habits: [true, false, false, false] }), RULES), 1);
  assert.equal(landed(null, day(), RULES), null);
  assert.equal(landed(day(), null, RULES), null);
});

test('the team climbs the staircase with every meeting and stands by the flag only at its goal', () => {
  assert.equal(LAST_STEP, 8);
  assert.deepEqual([0, 1, 2, 7, 8, 11].map((m) => stepOf(m, 8)), [0, 1, 2, 7, 8, 8]);     // four reps: one step per meeting
  assert.deepEqual([0, 1, 5, 9, 10].map((m) => stepOf(m, 10)), [0, 1, 4, 7, 8]);          // five reps: the first meeting still moves, the flag waits for the tenth
  assert.deepEqual([1, 2, 3, 4].map((m) => stepOf(m, 4)), [2, 4, 6, 8]);                  // two reps: two steps each
  assert.equal(stepOf(3, 0), 0);                                                          // no goal, no climb
});

// 24 Nov: on arriving at Equipo the team climbs to its step, one hop per step, so the staircase says what a meeting
// does. The path is keyframes relative to where the team ends (the crew is placed there), in px of the staircase.
test('the climb starts on the ground, hops between steps and ends where the team stands', async () => {
  const { climbFrames } = await import('../team/stops.js');
  const steps = [[0.4, 0.8], [0.2, 0.7], [0.3, 0.6]];
  assert.deepEqual(climbFrames(0, steps, 400, 400), [], 'on the ground there is nothing to climb');
  const f = climbFrames(2, steps, 400, 400, 14);
  assert.deepEqual(f.map((k) => k.offset), [0, 0.25, 0.5, 0.75, 1]);
  assert.equal(f[0].translate, '40.0px 80.0px', 'it starts on the ground, relative to its step');
  assert.equal(f.at(-1).translate, '0.0px 0.0px', 'and ends where it stands');
  const y = (k) => Number(k.translate.split(' ')[1].replace('px', ''));
  assert.ok(y(f[1]) < (y(f[0]) + y(f[2])) / 2, 'between two steps it hops up');
});

// Fix round 1 (A2): the stage gives up height so the four stops clear the tab bar with 6 px of air; never under 112 px
// (the page scrolls by what is missing then), and never more than it must.
test('the stage gives up only the height it must, and never goes under 112 px', async () => {
  const { stageFit, STAGE_MIN } = await import('../team/stops.js');
  assert.equal(STAGE_MIN, 112);
  assert.deepEqual(stageFit({ natural: 303, over: 22 }), { height: 281, short: 0 });
  assert.deepEqual(stageFit({ natural: 303, over: -40 }), { height: 303, short: 0 }, 'room to spare: it keeps its size, it does not grow');
  assert.deepEqual(stageFit({ natural: 200, over: 106 }), { height: 112, short: 18 }, 'under 112 the page scrolls by what is missing');
  assert.deepEqual(stageFit({ natural: 303, over: 0 }), { height: 303, short: 0 });
  assert.deepEqual(stageFit({ natural: 303, over: 22.4 }), { height: 280, short: 0 }, 'whole pixels, rounded toward clearing the bar');
});
