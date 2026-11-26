// One tap, one meaning (team/taps.js). The second click of a double click never acts on what the first one changed, a
// list drawn again takes no tap until it settles, and a step that is hard to take back asks twice without one double
// tap passing both. The decisions live apart from the page so they can be tested here; the screens may not arm a
// button on their own, and every list a manager acts on is guarded.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { clickActs, twiceStep, SETTLE_MS, PAUSE_MS, WINDOW_MS, arrives } from '../team/taps.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the second click of a double click never acts, and a list drawn again takes no tap until it settles', () => {
  assert.ok(SETTLE_MS >= 300 && SETTLE_MS <= 600, `settle ${SETTLE_MS}`);
  assert.equal(clickActs({ detail: 1, now: 5000, settledAt: 0 }), true);
  // Double-clicking "Desactivar" on Andrea deactivated Andrea, then Camila: the second click is never a tap of its own
  assert.equal(clickActs({ detail: 2, now: 5000, settledAt: 0 }), false);
  assert.equal(clickActs({ detail: 3, now: 5000, settledAt: 0 }), false);
  // the list was drawn again under the finger: a tap before it settles does nothing, one after it acts
  assert.equal(clickActs({ detail: 1, now: 5000, settledAt: 5001 }), false);
  assert.equal(clickActs({ detail: 1, now: 5001, settledAt: 5001 }), true);
  // a key or a script (detail 0) acts at once: what has the focus does not move under a finger
  assert.equal(clickActs({ detail: 0, now: 5000, settledAt: 9000 }), true);
});

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

test('every list a manager acts on is guarded, and "Desactivar" asks twice like the other steps that are hard to take back', () => {
  const src = read('team/manager.js');
  // the confirmations, the sites and the ways; the people; a rep's history, where a manager undoes or voids through view-as
  for (const id of ['needsBody', 'repsBody', 'ledger']) assert.match(src, new RegExp(`guardList\\(\\$\\('#${id}'\\)\\)`), `#${id} is guarded`);
  assert.match(read('team/docs.js'), /guardList\(\$\('#docList'\)\)/, 'the documents a manager moves and removes are guarded');
  const deactivate = src.split('\n').find((line) => line.includes("'reps.deactivate'"));
  assert.ok(deactivate, 'the deactivate control is in manager.js');
  assert.match(deactivate, /twice\(e,/, 'deactivating asks twice');
});

// Fix round 1 (D8): the deep screens' arrival (P1) runs once per change. setTab numbers each call (tabAsk); a second tap
// while the first transition still runs makes the first one's arrival stand down.
test('a second tap while a transition runs does not start a second arrival', () => {
  // two taps on the same deep screen: each setTab takes a number, and each transition's go() runs later, in order
  let tabAsk = 0, arrivals = 0;
  const tap = () => ++tabAsk;
  const go = (ask, open, name) => { if (arrives(ask, tabAsk, open, name)) arrivals += 1; };
  const first = tap(), second = tap();
  go(first, 'route', 'route'); go(second, 'route', 'route');
  assert.equal(arrivals, 1, 'only the last one asked for arrives');
  // a tap on another screen meanwhile: the screen shown is the other one, so neither arrival of "route" runs
  const a = tap(); tap();
  go(a, 'sites', 'route');
  assert.equal(arrivals, 1);
  assert.equal(arrives(3, 3, 'route', 'route'), true);
  const app = read('team/app.js');
  assert.match(app.slice(app.indexOf('function setTab('), app.indexOf('function whenSeen(')), /if \(onArrive && arrives\(ask, tabAsk, open, name\)\) onArrive\(\);/);
});
