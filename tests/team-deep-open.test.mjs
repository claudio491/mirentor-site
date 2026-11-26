// A deep screen opens once (its arrival runs inside the change), a manager's page holds still while it loads, and in
// Pendientes a group's count rolls with the row that leaves, not before it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { countRolls } from '../team/craft-steps.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('a group whose rows left keeps its old count until they have gone, then rolls to the new one', () => {
  const before = new Map([['needs.stall.title', 2], ['needs.confirm.title', 3], ['needs.meet.title', 1]]);
  const after = new Map([['needs.stall.title', 1], ['needs.confirm.title', 3], ['needs.meet.title', 0]]);
  assert.deepEqual(countRolls(before, after), [{ group: 'needs.stall.title', from: 1 + 1, to: 1 }, { group: 'needs.meet.title', from: 1, to: 0 }]);
  assert.deepEqual(countRolls(before, before), [], 'nothing left: nothing rolls');
  assert.deepEqual(countRolls(new Map([['x', 1]]), new Map([['x', 2]])), [], 'a row that arrives is drawn at once, as before');
});

test('the deep screens arrive inside the change; the manager\'s chips and support hold their place', () => {
  for (const [f, name] of [['team/book.js', 'book'], ['team/biz.js', 'biz']]) {
    const src = read(f);
    assert.match(src, new RegExp(`setTab\\('${name}', \\{ onArrive: `), `${name} arrives through setTab's onArrive`);
    assert.doesNotMatch(src, /setTimeout\(\(\) => \{ if \(S\.tab !== /, `${name} no longer arrives after the change`);
  }
  const mgr = read('team/manager.js'), missing = mgr.slice(mgr.indexOf('function renderMissing('), mgr.indexOf('if (!failed) return;'));
  assert.match(missing, /#teamDateChip/); assert.match(missing, /#teamSampleChip/);
  assert.match(read('team/app.css'), /#s-team \.support:empty\{min-height:/);
  assert.match(mgr, /countRolls\(/);
});
