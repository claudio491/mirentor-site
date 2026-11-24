// One tap, one meaning (team/taps.js). A step that is hard to take back asks twice, and one double tap must never pass
// both taps; the decisions live apart from the page so they can be tested here, and the screens may not arm a button
// on their own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { twiceStep, PAUSE_MS, WINDOW_MS } from '../team/taps.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('"asks twice": the first tap arms, the second counts only after a pause and before the window closes', () => {
  assert.ok(PAUSE_MS >= 250 && PAUSE_MS <= 400, `pause ${PAUSE_MS}`);
  assert.ok(WINDOW_MS >= 4000, `window ${WINDOW_MS}`);
  assert.equal(twiceStep(null, { now: 1000, detail: 1 }), 'arm');
  // the second click of a double click is the same gesture, however slow
  assert.equal(twiceStep(1000, { now: 1110, detail: 2 }), 'wait');
  assert.equal(twiceStep(1000, { now: 1000 + PAUSE_MS + 200, detail: 2 }), 'wait');
  // two quick single taps (a phone that counts each tap alone) are one gesture too
  assert.equal(twiceStep(1000, { now: 1150, detail: 1 }), 'wait');
  assert.equal(twiceStep(1000, { now: 1000 + PAUSE_MS - 1, detail: 1 }), 'wait');
  // a tap after the pause runs, and so does a key (detail 0)
  assert.equal(twiceStep(1000, { now: 1000 + PAUSE_MS, detail: 1 }), 'run');
  assert.equal(twiceStep(1000, { now: 2500, detail: 0 }), 'run');
  // a key held down repeats faster than the pause: it cannot confirm by itself
  assert.equal(twiceStep(1000, { now: 1030, detail: 0 }), 'wait');
  // too late: the window closed, so this tap arms again
  assert.equal(twiceStep(1000, { now: 1000 + WINDOW_MS + 1, detail: 1 }), 'arm');
  assert.equal(twiceStep(1000, { now: 1000 + WINDOW_MS, detail: 1 }), 'run');
});

test('every "asks twice" goes through taps.js: no screen arms a button by hand', () => {
  const scripts = readdirSync(new URL('../team/', import.meta.url)).filter((f) => f.endsWith('.js') && f !== 'taps.js');
  for (const f of scripts) {
    const src = read(`team/${f}`);
    assert.equal(/dataset\.armed\s*=|classList\.add\(\s*'armed'|classList\.contains\(\s*'armed'/.test(src), false, `${f} arms a button by hand`);
  }
  for (const f of ['manager.js', 'install.js', 'docs.js']) assert.match(read(`team/${f}`), /askTwice\(/, `${f} asks twice through taps.js`);
});
