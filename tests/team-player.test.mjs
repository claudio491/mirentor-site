// The stage shows one sequence of frames at a time. Whoever starts a sequence "once" waits for it to end, and a log's
// answer is such a wait: if another sequence took the stage and the first one simply stopped, the day stayed frozen on
// that stop. These tests pin the rule: a sequence that is replaced ends, and whoever waited for it goes on.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPlayer } from '../team/player.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const within = (promise, ms) => Promise.race([promise, sleep(ms).then(() => 'still waiting')]);

test('a sequence played once shows each frame in order and ends after the last one', async () => {
  const seen = [], player = createPlayer((f) => seen.push(f));
  const whole = await player.play([[1, 5], [2, 5], [3, 5]], { once: true });
  assert.deepEqual(seen, [1, 2, 3]);
  assert.equal(whole, true);
});

test('starting another sequence ends the one before, and whoever waited for it goes on', async () => {
  const seen = [], player = createPlayer((f) => seen.push(f));
  const first = player.play([[1, 400], [2, 400], [3, 400]], { once: true });
  await sleep(10);
  player.play([[0, 400], [1, 400]]);                       // a loop takes the stage
  assert.equal(await within(first, 150), false, 'the replaced sequence must end, saying it was cut short');
  assert.deepEqual(seen, [1, 0]);
  player.stop();
});

test('a loop keeps going until it is stopped, and a pair with no time holds its frame', async () => {
  const seen = [], player = createPlayer((f) => seen.push(f));
  player.play([[0, 4], [1, 4]]);
  await sleep(40);
  player.stop();
  const count = seen.length;
  assert.ok(count >= 4 && seen.slice(0, 4).join('') === '0101', `a loop alternates: ${seen.join('')}`);
  await sleep(20);
  assert.equal(seen.length, count, 'nothing is shown after stop');
  seen.length = 0;
  assert.equal(await player.play([[3, 0]]), true);
  assert.deepEqual(seen, [3]);
});

test('with no motion, a sequence played once shows its last frame and a loop its first, at once', async () => {
  const seen = [], player = createPlayer((f) => seen.push(f), { still: true });
  assert.equal(await player.play([[1, 300], [2, 300], [3, 300]], { once: true }), true);
  await player.play([[0, 300], [1, 300]]);
  assert.deepEqual(seen, [3, 0]);
});
