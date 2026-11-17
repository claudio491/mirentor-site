import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RULES, KINDS, crmRow, flagsOf, channelOf, localDay, localMinutes, weekStart, addDays, isoWeekday, daysBetween, podiumSize } from '../lib/team/rules.mjs';

test('every kind maps to the CRM\'s own channel and outcome words', () => {
  assert.deepEqual(crmRow({ kind: 'talk' }), { channel: 'In-person visit', outcome: 'Visited, spoke with owner' });
  assert.deepEqual(crmRow({ kind: 'absent' }), { channel: 'In-person visit', outcome: 'Visited, owner not there' });
  assert.deepEqual(crmRow({ kind: 'call' }), { channel: 'Phone call', outcome: 'Call answered' });
  assert.deepEqual(crmRow({ kind: 'noanswer' }), { channel: 'Phone call', outcome: 'No answer' });
  assert.deepEqual(crmRow({ kind: 'noanswer', voicemail: true }), { channel: 'Phone call', outcome: 'Left voicemail' });
  assert.deepEqual(crmRow({ kind: 'message' }), { channel: 'WhatsApp message', outcome: 'Message sent' });
  assert.deepEqual(crmRow({ kind: 'message', channel: 'linkedin' }), { channel: 'LinkedIn message', outcome: 'Message sent' });
  assert.deepEqual(crmRow({ kind: 'message', channel: 'email' }), { channel: 'Email', outcome: 'Email sent' });
  assert.deepEqual(crmRow({ kind: 'message', channel: 'sms' }), { channel: 'SMS', outcome: 'Sent SMS' });
  assert.deepEqual(crmRow({ kind: 'reply', channel: 'email' }), { channel: 'Email', outcome: 'Replied' });
  assert.deepEqual(crmRow({ kind: 'meeting' }), { channel: 'In-person visit', outcome: 'Meeting booked' });
  assert.deepEqual(crmRow({ kind: 'meeting', channel: 'call' }), { channel: 'Phone call', outcome: 'Meeting booked' });
  assert.deepEqual(crmRow({ kind: 'baddata' }), { channel: 'Phone call', outcome: 'Wrong number' });
  assert.deepEqual(crmRow({ kind: 'baddata', channel: 'email' }), { channel: 'Email', outcome: 'Bounced' });
  assert.equal(crmRow({ kind: 'contract' }), null);
});

test('a channel the kind does not allow falls back to the kind\'s first channel', () => {
  assert.equal(channelOf('message', 'visit'), 'whatsapp');
  assert.equal(channelOf('meeting', undefined), 'visit');
  assert.equal(channelOf('talk', 'email'), 'visit');
});

test('flags say what each log counts as', () => {
  assert.deepEqual(flagsOf({ kind: 'talk' }), { visit: true, conversation: true, followup: true, message: false, reply: false, meeting: false, contract: false });
  assert.equal(flagsOf({ kind: 'meeting' }).visit, true);
  assert.equal(flagsOf({ kind: 'meeting', channel: 'call' }).visit, false);
  assert.equal(flagsOf({ kind: 'meeting', channel: 'call' }).conversation, true);
  assert.equal(flagsOf({ kind: 'message' }).followup, false);
  assert.equal(flagsOf({ kind: 'noanswer' }).followup, false);
  assert.equal(flagsOf({ kind: 'contract' }).contract, true);
});

test('unknown kinds are rejected by the table itself', () => {
  assert.equal(KINDS.dance, undefined);
  assert.throws(() => flagsOf({ kind: 'dance' }));
});

test('season rules carry the spec\'s numbers', () => {
  assert.deepEqual(RULES.points, { visit: 3, conversation: 5, followup: 2, message: 1, reply: 3, meetingBooked: 5, meetingHeld: 10, contractSent: 10, contractSigned: 20, siteSigned: 40, siteInstalled: 30, siteFirstHour: 30, dayClosedOnTime: 2 });
  assert.equal(RULES.caps.messagesPerDay, 10);
  assert.deepEqual(RULES.habits, { visits: 1, conversations: 2, followups: 1 });
  assert.deepEqual(RULES.goals, { visits: 5, conversations: 10, meetings: 3, contracts: 1 });
  assert.equal(RULES.closeBy, '19:00');
  assert.equal(RULES.pendingDays, 14);
  assert.equal(RULES.newRepDays, 14);
  assert.equal(RULES.streakSpares, 2);
  assert.deepEqual(RULES.levels.map((l) => l.name), ['aprendizaje', 'oficio', 'maestria', 'mentoria']);
  assert.deepEqual(RULES.levels.flatMap((l) => l.steps), [0, 250, 600, 1000, 1500, 2200, 3000, 4200, 5600, 7500, 10000, 13000]);
});

test('a moment late at night in UTC is still the previous day in Panama', () => {
  assert.equal(localDay('2026-11-17T03:30:00Z', 'America/Panama'), '2026-11-16');
  assert.equal(localDay('2026-11-17T05:00:00Z', 'America/Panama'), '2026-11-17');
  assert.equal(localMinutes('2026-11-16T23:59:00Z', 'America/Panama'), 18 * 60 + 59);
  assert.equal(localMinutes('2026-11-17T00:01:00Z', 'America/Panama'), 19 * 60 + 1);
});

test('weeks start on Monday', () => {
  assert.equal(weekStart('2026-11-18'), '2026-11-16');
  assert.equal(weekStart('2026-11-16'), '2026-11-16');
  assert.equal(weekStart('2026-11-22'), '2026-11-16');
  assert.equal(isoWeekday('2026-11-16'), 1);
  assert.equal(isoWeekday('2026-11-22'), 7);
  assert.equal(addDays('2026-11-30', 1), '2026-12-01');
  assert.equal(addDays('2026-11-16', -1), '2026-11-15');
  assert.equal(daysBetween('2026-11-16', '2026-11-30'), 14);
});

test('the podium shrinks with the team', () => {
  assert.equal(podiumSize(9), 3);
  assert.equal(podiumSize(7), 3);
  assert.equal(podiumSize(6), 2);
  assert.equal(podiumSize(5), 2);
  assert.equal(podiumSize(4), 2);
  assert.equal(podiumSize(3), 1);
  assert.equal(podiumSize(1), 1);
  assert.equal(podiumSize(0), 0);
});
