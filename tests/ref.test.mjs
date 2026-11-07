import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refCode, refLink } from '../tools/ref.mjs';
import { REF } from '../lib/entry.mjs';

test('a lead gets the same six-character code every time, one the server accepts', () => {
  assert.equal(refCode('PA-0023'), refCode('PA-0023'));
  assert.match(refCode('PA-0023'), REF);
  assert.notEqual(refCode('PA-0023'), refCode('PA-0024'));
});

test('2,000 lead IDs get 2,000 different codes', () => {
  const codes = new Set(Array.from({ length: 2000 }, (_, i) => refCode(`PA-${String(i + 1).padStart(4, '0')}`)));
  assert.equal(codes.size, 2000);
});

test('the link carries the code before the waitlist anchor', () => {
  assert.equal(refLink('PA-0023'), `https://www.mirentor.com/?c=${refCode('PA-0023')}#lista-de-espera`);
});
