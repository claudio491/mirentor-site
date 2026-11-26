// A toast never covers what a rep is about to tap, and never follows them to another screen: on Hoy, Pendientes and
// Vendedores it shows at the top, under the top bar; it stays 2.4 s plus 40 ms for each character past 60, 5 s at
// most; an error stays until it is tapped or 6 s; it leaves when the tab or the screen changes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { toastTime, toastEdge, toastFollows, TOAST_ERR_MS } from '../team/toast-steps.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a toast stays 2.4 s, 40 ms more for each character past 60, 5 s at most; an error 6 s', () => {
  assert.equal(toastTime('Anotado.'), 2400);
  assert.equal(toastTime('x'.repeat(60)), 2400);
  assert.equal(toastTime('x'.repeat(70)), 2800);
  assert.equal(toastTime('x'.repeat(400)), 5000, 'never more than 5 s');
  assert.equal(toastTime('', { error: true }), TOAST_ERR_MS);
  assert.equal(TOAST_ERR_MS, 6000);
  assert.equal(toastTime(null), 2400);
});

test('on Hoy, Pendientes and Vendedores the toast comes under the top bar; elsewhere as before', () => {
  for (const s of ['today', 'needs', 'reps']) assert.equal(toastEdge(s), 'under', s);
  for (const s of ['week', 'table', 'team', 'book', 'biz']) assert.equal(toastEdge(s), 'bottom', s);
  assert.equal(toastEdge('book', { sheet: true }), 'top', 'a sheet open: from the top, over its buttons never');
  assert.equal(toastEdge('today', { sheet: true }), 'top');
});

test('a change of screen takes the toast away, except the one that tells of that change', () => {
  assert.equal(toastFollows(0), true, 'shown just before the change: it is the news of it (Trabajador quitado, back to the install)');
  assert.equal(toastFollows(299), true);
  assert.equal(toastFollows(300), false);
  assert.equal(toastFollows(2000), false, 'shown on the screen left behind: it stays there');
});

test('the page uses them: the edge, the time, the error toast, and the change of screen takes the toast away', () => {
  const ui = read('team/ui.js'), app = read('team/app.js'), css = read('team/app.css');
  assert.match(ui, /toastEdge\(/); assert.match(ui, /toastTime\(/);
  assert.match(ui, /export function toastErr\(/);
  assert.match(ui, /export function dropToast\(/);
  const setTab = app.slice(app.indexOf('function setTab('), app.indexOf('function whenSeen('));
  assert.match(setTab, /if \(changed\) leaveToast\(\)/, 'a change of tab or screen drops the toast');
  assert.match(app, /\$\('#toast'\)\.addEventListener\('click', dropToast\)/, 'a tap takes it away');
  assert.match(css, /\.toast\[data-edge=under\]\{/);
  assert.match(css, /\.toast\.err\{[^}]*pointer-events:auto/, 'an error is tapped away');
  assert.doesNotMatch(app + read('team/book.js') + read('team/manager.js'), /[^.\w]toast\(errText\(/, 'an error toast is a toastErr');
});
