// On a phone the return key says what it does. In a form of several fields it reads "next" and moves to the next field
// shown, and on the last one it reads "done": inside a form that sends the form, outside one it puts the keyboard away.
// A number field gets the digit pad (text + inputmode numeric), never type=number, which shows the full keyboard on an
// iPhone and quietly turns "12a" into an empty value. These tests pin those decisions, away from the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { enterPlan, numberAttrs } from '../team/keys.js';

test('every field but the last one shown moves on; the last one is done', () => {
  assert.deepEqual(enterPlan([true, true, true]), [{ hint: 'next', to: 1 }, { hint: 'next', to: 2 }, { hint: 'done', to: null }]);
});

test('a hidden field is skipped, and a field followed only by hidden ones is the last', () => {
  assert.deepEqual(enterPlan([true, false, true, false]), [{ hint: 'next', to: 2 }, { hint: 'next', to: 2 }, { hint: 'done', to: null }, { hint: 'done', to: null }]);
});

test('a lone field is done, and an empty form plans nothing', () => {
  assert.deepEqual(enterPlan([true]), [{ hint: 'done', to: null }]);
  assert.deepEqual(enterPlan([]), []);
});

test('a number field is text with the digit pad, never type=number', () => {
  const a = numberAttrs();
  assert.equal(a.type, 'text');
  assert.equal(a.inputmode, 'numeric');
  assert.equal(a.pattern, '[0-9]*');
});
