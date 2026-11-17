// The rule for a log that could not be sent, tested without a browser: it lives in team/queue.js, apart from the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, mine } from '../team/queue.js';
import { sessionMove, HOME, LEAVE } from '../team/door.js';

test('a log that could not be sent is kept, unless the server refused it for good', () => {
  // no answer at all, the service restarting, too many requests, a session that ended: the log waits and goes out again
  for (const e of [{ code: 'offline', status: 0 }, { status: 500 }, { status: 502 }, { status: 503 }, { status: 504 }, { status: 429 }, { status: 401, code: 'session' }, { status: 408 }, null, {}])
    assert.equal(verdict(e), 'keep', JSON.stringify(e));
  // refused for who is asking or from where, not for what the log says: it waits, because that can be put right
  for (const e of [{ status: 403, code: 'not_on_team' }, { status: 403, code: 'origin' }]) assert.equal(verdict(e), 'keep', JSON.stringify(e));
  // the server understood and said no: sending it again cannot help
  for (const e of [{ status: 400, code: 'lead' }, { status: 403, code: 'not_yours' }, { status: 404 }, { status: 409, code: 'day_closed' }, { status: 409, code: 'do_not_call' }, { status: 413 }, { status: 415 }])
    assert.equal(verdict(e), 'drop', JSON.stringify(e));
});

test('on a shared phone each waiting log belongs to who made it', () => {
  const queue = [{ rep: 'r_a', body: { id: 'one' } }, { rep: 'r_b', body: { id: 'two' } }, { rep: 'r_a' }, null, 'junk', { rep: 'r_a', body: { id: 'three' } }];
  assert.deepEqual(mine(queue, 'r_a').map((q) => q.body.id), ['one', 'three']);
  assert.deepEqual(mine('not a list', 'r_a'), []);
});

test('what the app does when the server says this person cannot go on', () => {
  const now = 1_000_000;
  // the session ended: the page itself is the door, so it is loaded again, once
  assert.equal(sessionMove({ status: 401, code: 'session' }, { lastReload: 0, now }), 'reload');
  assert.equal(sessionMove({ status: 401 }, { lastReload: now - 5000, now }), 'gate:session');   // just tried: say so instead of going round
  assert.equal(sessionMove({ status: 401 }, { lastReload: now - 20000, now }), 'reload');
  assert.equal(sessionMove({ status: 401 }, { lastReload: null, now }), 'gate:session');        // nowhere to remember the last try
  // signed in, but not on the team
  assert.equal(sessionMove({ status: 403, code: 'not_on_team' }, { lastReload: 0, now }), 'gate:team');
  // anything else is not about who is signed in
  for (const e of [{ status: 403, code: 'origin' }, { status: 403, code: 'manager_only' }, { status: 500 }, { code: 'offline', status: 0 }, null]) assert.equal(sessionMove(e, { lastReload: 0, now }), null, JSON.stringify(e));
  assert.deepEqual([HOME, LEAVE], ['./', 'salir']);
});
