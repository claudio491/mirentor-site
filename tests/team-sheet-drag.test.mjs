// Every sheet shows a grab bar at its top. A bar that invites a drag and does nothing is a control that lies, so a
// sheet follows the finger from its top and closes when let go far enough down or with a quick flick. These tests pin
// what the drag decides, away from the page: how far the sheet moves, how fast the finger went, and whether the sheet
// closes or goes back. The numbers follow Vaul (the drawer by Emil Kowalski): a quarter-ish of the height, or 0.4 px/ms.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { follow, speed, release } from '../team/sheet-drag.js';

test('pulled down, a sheet follows the finger one pixel for one pixel', () => {
  assert.equal(follow(0), 0);
  assert.equal(follow(37), 37);
  assert.equal(follow(400), 400);
});

test('pulled up, a sheet gives a little, then resists, and never passes its limit', () => {
  const near = follow(-20), far = follow(-200), farther = follow(-4000);
  assert.ok(near < 0 && near > -20, `a short pull up moves less than the finger (${near})`);
  assert.ok(far < near, 'a longer pull still moves it a little more');
  assert.ok(farther > -64, `it never rises more than the limit (${farther})`);
});

test('the speed is read from the last stretch of the drag, not from the whole of it', () => {
  // a slow start, then a fast flick in the last 60 ms
  const samples = [{ y: 0, t: 0 }, { y: 10, t: 300 }, { y: 20, t: 600 }, { y: 50, t: 630 }, { y: 80, t: 660 }];
  assert.ok(Math.abs(speed(samples) - 1) < 0.01, `the flick at the end reads 1 px/ms (${speed(samples)})`);
});

test('a drag with no time or a single point has no speed', () => {
  assert.equal(speed([]), 0);
  assert.equal(speed([{ y: 4, t: 10 }]), 0);
  assert.equal(speed([{ y: 4, t: 10 }, { y: 9, t: 10 }]), 0);
});

test('let go past its share of the height, a sheet closes', () => {
  assert.equal(release({ dy: 260, vy: 0, height: 800 }), 'close');
  assert.equal(release({ dy: 100, vy: 0, height: 300 }), 'close');
});

test('let go slowly before that, a sheet goes back', () => {
  assert.equal(release({ dy: 120, vy: 0.1, height: 800 }), 'back');
  assert.equal(release({ dy: 60, vy: 0.2, height: 300 }), 'back');
});

test('a quick flick down closes a sheet that moved only a little', () => {
  assert.equal(release({ dy: 30, vy: 0.6, height: 800 }), 'close');
});

test('a twitch is not a flick: a fast but tiny move puts the sheet back', () => {
  assert.equal(release({ dy: 6, vy: 2, height: 800 }), 'back');
});

test('a flick up never closes a sheet', () => {
  assert.equal(release({ dy: -40, vy: -1.5, height: 800 }), 'back');
  assert.equal(release({ dy: 0, vy: 0, height: 800 }), 'back');
});
