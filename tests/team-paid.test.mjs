// The log sheet promises points for each result (+8 for "visité y hablé"), and a log can pay less: a business pays its
// visit, its conversation and its reply once a day, and messages stop paying at the day's cap. The toast then said
// "+3" with no reason. paid.js names the part that did not pay; these tests pin it, and check that what the phone
// promises is exactly what the server's rules flag for each result, so the two can never drift apart.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promised, shortfall } from '../team/paid.js';
import { KINDS, flagsOf } from '../lib/team/rules.mjs';

test('a talk at a business already talked to today is short of its conversation', () => {
  assert.deepEqual(shortfall('talk', null, ['visit']), ['conversation']);
});

test('a log that earned all it promised is short of nothing', () => {
  assert.deepEqual(shortfall('talk', null, ['visit', 'conversation', 'followup']), []);
  assert.deepEqual(shortfall('absent', null, ['visit']), []);
});

test('a message past the day\'s cap is short of its message', () => {
  assert.deepEqual(shortfall('message', 'whatsapp', []), ['message']);
});

test('a meeting in person promises the visit too; by phone it does not', () => {
  assert.deepEqual(promised('meeting', 'visit'), ['visit', 'conversation', 'meeting_booked']);
  assert.deepEqual(promised('meeting', 'call'), ['conversation', 'meeting_booked']);
});

test('what the phone promises is what the server flags, for every result and channel', () => {
  for (const kind of Object.keys(KINDS)) {
    for (const channel of KINDS[kind].channels.length ? KINDS[kind].channels : [null]) {
      const f = flagsOf({ kind, channel });
      const server = [f.visit && 'visit', f.conversation && 'conversation', f.message && 'message', f.reply && 'reply', f.meeting && 'meeting_booked'].filter(Boolean);
      assert.deepEqual([...promised(kind, channel)].sort(), server.sort(), `${kind}/${channel}`);
    }
  }
});
