// The daily site report's decisions on the phone: the starting values, the body sent, and when Hoy reminds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftOf, bodyOf, hoursOf, countOf, nudgeOf, GEAR } from '../team/report-steps.js';
import { GEAR as SERVER_GEAR, checkReport } from '../lib/team/report.mjs';

test('the form starts from what the app knows: people and phones working tonight, hours empty, no answer yet', () => {
  const d = draftOf({ people: 3, phones: 3, name: 'X', city: '', lead: 'Ana' }, null);
  assert.equal(d.people, 3);
  assert.equal(d.phones.working, 3);
  assert.deepEqual([d.phones.out, d.headsets.working, d.sets], [0, 0, 0]);
  assert.deepEqual([d.delivered, d.accepted, d.allOk], ['', '', null]);
  assert.equal(bodyOf(d).error, 'report_answer');
});

test('the body: hours typed with a comma are numbers, empty hours stay null, and the server takes it as sent', () => {
  const d = { ...draftOf({ people: 2, phones: 2 }, null), delivered: '7,5', accepted: '', allOk: true };
  const { body } = bodyOf(d);
  assert.deepEqual([body.delivered, body.accepted], [7.5, null]);
  assert.ok(checkReport(body).report);
  assert.equal(bodyOf({ ...d, delivered: 'siete' }).error, 'report_hours');
  assert.equal(bodyOf({ ...d, sets: NaN }).error, 'report_counts');
  assert.deepEqual([hoursOf(' 8 '), hoursOf(''), Number.isNaN(hoursOf('1,2,3'))], [8, null, true]);
  assert.deepEqual([countOf('12'), Number.isNaN(countOf('-1')), Number.isNaN(countOf('1.5'))], [12, true, true]);
});

test('editing starts from the report already sent', () => {
  const report = { report: checkReport({ people: 4, delivered: null, accepted: null, phones: { working: 2 }, sets: 1, allOk: false, notes: 'n' }).report };
  const d = draftOf({ people: 9, phones: 9 }, report);
  assert.deepEqual([d.people, d.phones.working, d.phones.out, d.delivered, d.allOk, d.notes], [4, 2, 0, '', false, 'n']);
});

test('the client and the server count the same hardware', () => {
  assert.equal(GEAR, SERVER_GEAR);
});

test('Hoy reminds from 5 pm local time, of the first live site with no report today, and never on a read-only screen', () => {
  const me = (time, active) => ({ serverTime: time, me: { tz: 'America/Panama' }, active });
  const two = [{ id: 'a', name: 'A', report: '2026-11-16T20:00:00Z' }, { id: 'b', name: 'B', report: null }];
  assert.equal(nudgeOf(me('2026-11-16T21:59:00Z', two)), null);   // 4:59 pm in Panama
  assert.equal(nudgeOf(me('2026-11-16T22:00:00Z', two)).id, 'b');   // 5:00 pm
  assert.equal(nudgeOf(me('2026-11-16T22:00:00Z', two), true), null);
  assert.equal(nudgeOf(me('2026-11-16T22:00:00Z', [two[0]])), null);
  assert.equal(nudgeOf(me('2026-11-16T22:00:00Z', [])), null);
});
