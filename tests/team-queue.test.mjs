// The rule for a log that could not be sent, tested without a browser: it lives in team/queue.js, apart from the screens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict, fromServer, mine, requestTimeout } from '../team/queue.js';
import { sessionMove, HOME, LEAVE } from '../team/door.js';

/** A refusal as the app's api() hands it over when the server itself said no: its own JSON, { ok: false, error }. */
const refusal = (status, code) => ({ status, code, data: { ok: false, error: code } });

test('a log that could not be sent is kept, unless the server refused it for good', () => {
  // no answer at all, the service restarting, too many requests, a session that ended: the log waits and goes out again
  for (const e of [{ code: 'offline', status: 0 }, refusal(500, 'server'), { status: 502, code: 'unknown', data: null }, refusal(503, 'busy'), { status: 504, code: 'unknown', data: null },
    refusal(429, 'too_many'), refusal(401, 'session'), refusal(408, 'timeout'), null, {}])
    assert.equal(verdict(e), 'keep', JSON.stringify(e));
  // refused for who is asking or from where, not for what the log says: it waits, because that can be put right
  for (const e of [refusal(403, 'not_on_team'), refusal(403, 'origin')]) assert.equal(verdict(e), 'keep', JSON.stringify(e));
  // the server understood and said no: sending it again cannot help
  for (const e of [refusal(400, 'lead'), refusal(403, 'not_yours'), refusal(404, 'not_found'), refusal(409, 'day_closed'), refusal(409, 'do_not_call'), refusal(413, 'too_large'), refusal(415, 'type')])
    assert.equal(verdict(e), 'drop', JSON.stringify(e));
});

test('an answer that is not the server\'s own JSON keeps the log waiting, whatever its status', () => {
  // a captive portal's page answered 200, a proxy's 403 or 404 page, a JSON body someone else wrote: nobody read the log
  for (const e of [{ status: 200, code: 'unknown', data: null }, { status: 403, code: 'unknown', data: null }, { status: 404, code: 'unknown', data: null },
    { status: 400, code: 'unknown', data: { message: 'Bad Request' } }, { status: 409, code: 'unknown', data: { ok: false } }, { status: 400, code: 'lead' }])
    assert.equal(verdict(e), 'keep', JSON.stringify(e));
  assert.deepEqual([fromServer(refusal(409, 'day_closed')), fromServer({ status: 200, data: null }), fromServer({ status: 403, data: '<h1>' }), fromServer(null)], [true, false, false, false]);
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

test('a photo sent as its own bytes gets ninety seconds before it counts as no signal; everything else keeps fifteen', () => {
  const photo = new Blob([new Uint8Array(800 * 1024)], { type: 'image/jpeg' });
  assert.equal(requestTimeout(photo), 90000);
  for (const body of [undefined, null, { id: 'g1' }, 'texto', [1]]) assert.equal(requestTimeout(body), 15000, JSON.stringify(body));
});
