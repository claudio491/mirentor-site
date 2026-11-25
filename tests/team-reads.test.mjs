// The board's screens read the person's view again and again (the quiet check, after a log goes out), and every write
// answers with the new view. Reads and adoptions take numbers from one counter in the order they happen, so the screen
// only ever moves forward: an answer that went out before something the screen already shows is dropped (team/reads.js).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReads } from '../team/reads.js';

test('reads are shown in the order they went out: a newer answer is never dropped for an older one', () => {
  const r = createReads();
  const a = r.send(), b = r.send();
  assert.equal(r.take(a), true, 'a lands first and is shown');
  assert.equal(r.take(b), true, 'b went out after a, so it is newer: shown too');
  const c = r.send(), d = r.send();
  assert.equal(r.take(d), true);
  assert.equal(r.take(c), false, 'c went out before d, which is on screen');
});

test('a read that went out before a write the screen adopted is dropped; one sent after it is shown', () => {
  const r = createReads();
  const a = r.send();
  r.adopted();   // a log's answer, say
  assert.equal(r.take(a), false);
  const b = r.send();
  assert.equal(r.take(b), true);
});

test('a read can be asked again after a wait: a write adopted meanwhile makes it stale', () => {
  const r = createReads();
  const a = r.send();
  assert.equal(r.fresh(a), true);
  assert.equal(r.fresh(a), true, 'asking takes nothing');
  r.adopted();   // a log answered while the read waited on something else (the documents)
  assert.equal(r.fresh(a), false);
  assert.equal(r.take(a), false);
});
