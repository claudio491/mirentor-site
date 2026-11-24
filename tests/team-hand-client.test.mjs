// The hand's lights come on one after another, each on a timer. A new paint takes over the lights a paint before it
// still had on their way, so stopping "Cómo se enciende" halfway never leaves a light of the demonstration on (15 lights
// showed while the caption said 13 de 21). Tested on a stand-in for the page: only the light switches are real here.
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';

globalThis.matchMedia ??= () => ({ matches: false, addEventListener() {} });   // ui.js asks once whether motion is reduced
const { paintHand, teachHand } = await import('../team/hand.js');

const light = () => { const on = new Set(); return { classList: { contains: (c) => on.has(c), add: (c) => on.add(c), remove: (c) => on.delete(c), toggle: (c, v) => (v ?? !on.has(c) ? on.add(c) : on.delete(c)) } }; };
/** A hand with its 21 lights and five finger labels, and nothing else to draw. */
const hand = () => ({ hand: { wrist: light(), joints: Array.from({ length: 5 }, () => Array.from({ length: 4 }, light)), bones: [], labels: Array.from({ length: 5 }, light), hits: [], ring: null } });
const lit = (el) => [el.hand.wrist, ...el.hand.joints.flat()].filter((n) => n.classList.contains('on')).length;
const week = (n) => Array.from({ length: 5 }, (_, f) => ({ kind: 'work', habits: [0, 1, 2, 3].map((j) => f * 4 + j < n) }));
/** Move the fake clock, letting the promises its timers resolve run in between. */
async function advance(ms, step = 10) { for (let t = 0; t < ms; t += step) { mock.timers.tick(step); for (let i = 0; i < 5; i += 1) await Promise.resolve(); } }

test('a paint takes over the lights a paint before it still had on their way', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const el = hand();
    paintHand(el, week(20), { wrist: true, animate: true });   // every light comes on, one after another
    await advance(200);
    assert.ok(lit(el) > 0 && lit(el) < 21, `halfway: ${lit(el)}`);
    paintHand(el, week(3), { wrist: false });   // the truth: three lights, drawn at once
    assert.equal(lit(el), 3);
    await advance(3000);
    assert.equal(lit(el), 3, 'no light of the earlier paint comes on afterwards');
  } finally { mock.timers.reset(); }
});

test('stopping "Cómo se enciende" halfway leaves exactly the lights of the week', async () => {
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const el = hand(), truth = week(12);
    paintHand(el, truth, { wrist: true });
    const want = lit(el);
    let ended = 0;
    const stop = teachHand(el, { finger: 2, done: () => { ended += 1; paintHand(el, truth, { wrist: true }); } });
    // into the last beat, where the other fingers light up one after another
    await advance(340 * 5 + 600 + 640 * 4 + 440 + 1700 + 330 * 2 + 90);
    stop();
    assert.equal(ended, 1);
    assert.equal(lit(el), want);
    await advance(4000);
    assert.equal(lit(el), want, `the caption says ${want - 1} of 20 and the hand agrees`);
  } finally { mock.timers.reset(); }
});
