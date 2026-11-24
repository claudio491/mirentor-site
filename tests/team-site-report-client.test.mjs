// The daily site report's decisions on the phone: the starting values, the body sent, and when Hoy reminds.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { draftOf, bodyOf, hoursOf, countOf, nudgeOf, dayKey, forYesterday, GEAR } from '../team/report-steps.js';
import { readFileSync } from 'node:fs';
import { DICT } from '../team/i18n.js';
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

test('an emptied "Personas" box asks for the people, not for the hardware, in the order the server checks', () => {
  const d = { ...draftOf({ people: 2, phones: 2 }, null), allOk: true };
  for (const people of [Number.NaN, -1, 1.5, undefined]) assert.equal(bodyOf({ ...d, people }).error, 'report_people', String(people));
  // the people come first, as on the server: with bad hours or counts too, the people are what is asked for
  assert.equal(bodyOf({ ...d, people: Number.NaN, delivered: 'siete', sets: Number.NaN }).error, 'report_people');
  assert.equal(checkReport({ ...bodyOf(d).body, people: null }).error, 'report_people');
  assert.equal(bodyOf({ ...d, sets: Number.NaN }).error, 'report_counts');
  assert.equal(bodyOf({ ...d, people: 0 }).body.people, 0);   // nobody worked is an answer
});

test('a report for yesterday reads "ayer" where a label says "hoy", once the dictionary has those words', () => {
  const got = (day) => ({ day, days: ['2026-11-26', '2026-11-25'] });
  assert.deepEqual([forYesterday(got('2026-11-25')), forYesterday(got('2026-11-26')), forYesterday({ day: '2026-11-26', days: ['2026-11-26'] }), forYesterday({})], [true, false, false, false]);
  const has = (k) => k === 'report.people.yesterday';
  assert.equal(dayKey('report.people', true, has), 'report.people.yesterday');
  assert.equal(dayKey('report.people', false, has), 'report.people');
  assert.equal(dayKey('report.hours', true, has), 'report.hours', 'no yesterday words yet: the label as it is');
  // every label the form reads exists, and a yesterday version, where there is one, never says today
  const src = readFileSync(new URL('../team/report.js', import.meta.url), 'utf8');
  const keys = [...src.matchAll(/\b(?:L|dayKey)\(\s*'([^']+)'/g)].map((m) => m[1]);
  for (const k of ['report.people', 'report.hours', 'report.n.out', 'report.n.working', 'report.allOk', 'report.notes']) assert.ok(keys.includes(k), `${k} is read through L()`);
  for (const k of keys) {
    for (const l of ['es', 'en']) assert.ok(k in DICT[l], `${l} ${k}`);
    const y = `${k}.yesterday`;
    if (y in DICT.es) for (const [l, re] of [['es', /\bhoy\b|esta noche/i], ['en', /\btoday\b|tonight/i]]) assert.equal(re.test(DICT[l][y]), false, `${l} ${y} says today`);
  }
});
