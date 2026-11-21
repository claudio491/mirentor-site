// The install screens decide a few things on the phone before the server answers: whether an IMEI is well typed, which
// step of a worker is open, whether the Hoy card shows, and what a worker looks like when a consent upload fails.
// Those decisions live in team/install-steps.js, away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanImei as serverImei } from '../lib/team/install.mjs';
import { cleanImei, workerSteps, installCard, prepRows, newWorkerId, consentFailed, statusKey, workerOrder } from '../team/install-steps.js';
import { makeT } from '../team/i18n.js';

const IMEI_A = '490154203237518', IMEI_B = '356938035643809';

test('the client\'s cleanImei agrees with the server\'s on the shared vectors', () => {
  const vectors = [IMEI_A, IMEI_B, '49 015420 323751 8', '49-015420-323751-8', ' 35693803 5643809 ', '490154203237517', '4901542032375', '49015420323751a',
    '4901542032375180', '', '   ', null, undefined, 490154203237518, '49_015420_323751_8', '000000000000000'];
  for (const v of vectors) assert.equal(cleanImei(v), serverImei(v), `disagree on ${JSON.stringify(v)}`);
  assert.equal(cleanImei('49-015420-323751-8'), IMEI_A);
  assert.equal(cleanImei('490154203237517'), null);
});

test('workerSteps(worker) opens step 2 only with a consent', () => {
  const steps = (w) => workerSteps(w).map((s) => [s.key, s.open, s.done]);
  const base = { id: 'w_aaaaaaaaaaaa', phone: true, consent: null, imei: null, clip: null };
  assert.deepEqual(steps(base), [['consent', true, false], ['phone', false, false], ['clip', false, false]]);
  assert.deepEqual(steps({ ...base, consent: { v: 'v1' } }), [['consent', true, true], ['phone', true, false], ['clip', false, false]]);
  assert.deepEqual(steps({ ...base, consent: { v: 'v1' }, imei: IMEI_A }), [['consent', true, true], ['phone', true, true], ['clip', true, false]]);
  assert.deepEqual(steps({ ...base, consent: { v: 'v1' }, imei: IMEI_A, clip: '2026-11-21T15:00:00Z' }), [['consent', true, true], ['phone', true, true], ['clip', true, true]]);
  // a phone on file without a consent (it cannot happen on the server) still keeps step 2 shut
  assert.deepEqual(steps({ ...base, imei: IMEI_A }).slice(0, 2), [['consent', true, false], ['phone', false, false]]);
  // a coworker who signs and gets no phone has a single step
  assert.deepEqual(steps({ ...base, phone: false, consent: { v: 'v1' } }), [['consent', true, true]]);
});

test('the install card shows for ready_to_install and installing, never for waiting_phones or states it should not', () => {
  const card = (over) => installCard({ id: 's1', name: 'Taller', ready: 0, total: 0, phones: 4, practice: false, ...over });
  const table = [
    [{ state: 'ready_to_install' }, 'start'],
    [{ state: 'installing', ready: 1, total: 3 }, 'continue'],
    [{ state: 'waiting_phones', phones: null }, null],
    [{ state: 'closed', ready: 3, total: 3 }, null],
    [{ state: 'installed' }, null],
    [{ state: 'legacy' }, null],
    // the practice site reports `practice` whatever its stage: phones and workers decide
    [{ state: 'practice', practice: true }, 'start'],
    [{ state: 'practice', practice: true, total: 2, ready: 1 }, 'continue'],
    [{ state: 'practice', practice: true, phones: null }, null],
    // phones not marked never shows a card, whatever the state says
    [{ state: 'ready_to_install', phones: null }, null],
  ];
  for (const [over, want] of table) assert.equal(card(over)?.kind ?? null, want, JSON.stringify(over));
  assert.equal(installCard(null), null);
  assert.deepEqual(card({ state: 'practice', practice: true }).practice, true);
});

test('a failed consent upload leaves the worker as "Falta firma" and keeps the id for the retry', () => {
  const id = newWorkerId(() => 0.5);
  assert.match(id, /^w_[A-Za-z0-9]{12}$/);
  assert.notEqual(newWorkerId(), newWorkerId());
  const saved = { id, name: 'Trabajador 4', phone: true, status: 'no_consent', consent: null, imei: null, clip: null };
  const after = consentFailed(saved);
  assert.equal(after.id, id, 'the same id goes out again, so the server never makes a second worker');
  assert.equal(after.status, 'no_consent');
  assert.equal(after.retry, true);
  assert.equal(after.consent, null);
  assert.equal(workerSteps(after)[1].open, false, 'the phone step stays locked');
  const es = makeT('es'), en = makeT('en');
  assert.equal(es(statusKey(after.status)), 'Falta firma');
  assert.equal(en(statusKey(after.status)), 'Needs consent');
  // a worker who already had a consent keeps it: a failed new photo does not take the old one away
  const signed = consentFailed({ ...saved, status: 'no_phone', consent: { v: 'v1' } });
  assert.deepEqual([signed.status, signed.consent], ['no_phone', { v: 'v1' }]);
});

test('before recording: signs, zones and the coordinator, each done or not', () => {
  const site = { prep: { signs: '2026-11-21T14:00:00Z', zones: null }, coordinator: null };
  assert.deepEqual(prepRows(site).map((r) => [r.key, r.done]), [['signs', true], ['zones', false], ['coordinator', false]]);
  assert.deepEqual(prepRows({ prep: { signs: null, zones: null }, coordinator: { name: 'Persona', phone: '6000-0000' } }).map((r) => r.done), [false, false, true]);
  // an old site with no prep on file reads as nothing done
  assert.deepEqual(prepRows({}).map((r) => r.done), [false, false, false]);
});

test('every status has its words, and the list puts who is done first and who still needs something last, near the add button, each in the order they were added', () => {
  for (const st of ['ready', 'no_consent', 'no_phone', 'no_clip', 'consent_only']) for (const lang of ['es', 'en']) assert.ok(makeT(lang)(statusKey(st)).length > 0);
  const ws = [{ id: 'a', status: 'ready' }, { id: 'b', status: 'no_consent' }, { id: 'c', status: 'consent_only' }, { id: 'd', status: 'no_phone' }];
  assert.deepEqual(workerOrder(ws).map((w) => w.id), ['a', 'c', 'b', 'd']);
});
