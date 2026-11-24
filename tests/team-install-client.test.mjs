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

test('an IMEI that is one digit fifteen times is refused on both sides, though fifteen zeros pass the Luhn check', () => {
  for (const v of ['000000000000000', '000 000 000 000 000', '000-000000-000000-0', ...'123456789'.split('').map((d) => d.repeat(15))]) {
    assert.equal(cleanImei(v), null, `client takes ${v}`);
    assert.equal(serverImei(v), null, `server takes ${v}`);
  }
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
    [{ state: 'installed' }, null],
    [{ state: 'legacy' }, null],
    // the practice site reports `practice` whatever its stage: phones and workers decide
    [{ state: 'practice', practice: true }, 'start'],
    [{ state: 'practice', practice: true, total: 2, ready: 1 }, 'continue'],
    [{ state: 'practice', practice: true, phones: null }, null],
    // closed and not yet confirmed: the card stays, waiting for the manager, and opens the close screen
    [{ state: 'closed', ready: 3, total: 3, closed: true }, 'closed'],
    [{ state: 'practice', practice: true, total: 2, ready: 2, closed: true }, 'closed'],
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

test('a scan finds the IMEI among whatever the barcode reader saw, with or without a label around it', async () => {
  const { imeiFromScan } = await import('../team/install-steps.js');
  assert.equal(imeiFromScan(['SN 12345', 'IMEI: 49-015420-323751-8']), IMEI_A);
  assert.equal(imeiFromScan(['IMEI1 356938035643809 IMEI2 490154203237518']), IMEI_B);
  assert.equal(imeiFromScan(['490154203237517', 'ABC']), null, 'a wrong check digit is never picked');
  assert.equal(imeiFromScan([]), null);
});

test('a worker\'s screen says which step is next and how many there are', async () => {
  const { stepNow } = await import('../team/install-steps.js');
  const base = { phone: true, consent: null, imei: null, clip: null };
  assert.deepEqual(stepNow(base), { at: 1, of: 3 });
  assert.deepEqual(stepNow({ ...base, consent: { v: 'v1' } }), { at: 2, of: 3 });
  assert.deepEqual(stepNow({ ...base, consent: { v: 'v1' }, imei: IMEI_A }), { at: 3, of: 3 });
  assert.deepEqual(stepNow({ ...base, consent: { v: 'v1' }, imei: IMEI_A, clip: 'x' }), { at: 3, of: 3 });
  assert.deepEqual(stepNow({ ...base, phone: false }), { at: 1, of: 1 });
});

test('the site record lists who signed, the day they signed and the phone by its last four digits', async () => {
  const { recordRows } = await import('../team/install-steps.js');
  const ws = [
    { id: 'a', name: 'Trabajador 1', consent: { t: '2026-11-21T14:30:00Z', form: 'v1' }, imei: IMEI_A, phone: true },
    { id: 'b', name: 'Trabajador 2', consent: null, imei: null, phone: true },
    { id: 'c', name: 'Trabajador 3', consent: { t: '2026-11-22T03:30:00Z', form: 'v1' }, imei: null, phone: false },
  ];
  // days are the rep's local days: 10:30 pm on the 21st in Panama is still the 21st
  assert.deepEqual(recordRows(ws, 'America/Panama'), [
    { id: 'a', name: 'Trabajador 1', day: '2026-11-21', tail: '7518', phone: true },
    { id: 'c', name: 'Trabajador 3', day: '2026-11-21', tail: null, phone: false },
  ]);
});

test('the close screen can close with whoever is ready, and after closing it waits for the manager', async () => {
  const { closeState } = await import('../team/install-steps.js');
  const v = (over = {}, progress = {}) => ({ site: { closed: null, ...over }, progress: { ready: 0, total: 2, allRecordingHaveConsent: false, ...progress } });
  assert.equal(closeState(v()).kind, 'nobody');
  assert.equal(closeState(v({}, { ready: 1 })).kind, 'ready');
  assert.equal(closeState(v({ closed: '2026-11-21T20:00:00Z' }, { ready: 1 })).kind, 'closed');
  assert.equal(closeState(v({ closed: '2026-11-21T20:00:00Z', installed: true }, { ready: 1 })).kind, 'closed');
});

test('the controls a screen offers: none at all when a manager looks through view-as, and each one only when it can act', async () => {
  const { controls } = await import('../team/install-steps.js');
  const site = { closed: null }, closed = { closed: '2026-11-21T20:00:00Z' };
  const w = (over = {}) => ({ phone: true, consent: null, imei: null, clip: null, ...over });
  const on = (c) => Object.entries(c).filter(([, v]) => v).map(([k]) => k).sort();
  // read only: whatever the site and the worker, nothing that writes
  for (const wk of [null, w(), w({ consent: { v: 'v1' } }), w({ consent: { v: 'v1' }, imei: IMEI_A })]) for (const st of [site, closed]) {
    assert.deepEqual(on(controls({ readOnly: true, site: st, worker: wk })), [], JSON.stringify({ st, wk }));
  }
  // the site screen
  assert.deepEqual(on(controls({ readOnly: false, site, worker: null })), ['addWorker', 'close', 'prep']);
  assert.deepEqual(on(controls({ readOnly: false, site: closed, worker: null })), ['addWorker', 'prep'], 'a closed install cannot close again; late workers still come in');
  // a worker: the consent always (a new photo replaces the old), the phone only with a consent, the return only with a
  // phone; the correction and the removal always (the server refuses a removal while a phone is held)
  assert.deepEqual(on(controls({ readOnly: false, site, worker: w() })), ['addWorker', 'close', 'consent', 'edit', 'prep', 'remove']);
  assert.deepEqual(on(controls({ readOnly: false, site, worker: w({ consent: { v: 'v1' } }) })), ['addWorker', 'close', 'consent', 'edit', 'phone', 'prep', 'remove']);
  assert.deepEqual(on(controls({ readOnly: false, site, worker: w({ consent: { v: 'v1' }, imei: IMEI_A }) })), ['addWorker', 'clip', 'close', 'consent', 'edit', 'prep', 'remove', 'returnPhone']);
  assert.deepEqual(on(controls({ readOnly: false, site, worker: w({ consent: { v: 'v1' }, imei: IMEI_A, clip: 'x' }) })), ['addWorker', 'close', 'consent', 'edit', 'prep', 'remove', 'returnPhone']);
  // after a return the phone step is open again
  assert.equal(controls({ readOnly: false, site, worker: w({ consent: { v: 'v1' } }) }).phone, true);
  // a coworker who signs only never gets a phone control
  assert.deepEqual(on(controls({ readOnly: false, site, worker: w({ phone: false, consent: { v: 'v1' } }) })), ['addWorker', 'close', 'consent', 'edit', 'prep', 'remove']);
  // a legacy site loads past consents only: people, their photo, a correction or a removal; no prep, phone, clip or close
  const legacy = { legacy: true, closed: null };
  assert.deepEqual(on(controls({ readOnly: false, site: legacy, worker: null })), ['addWorker']);
  assert.deepEqual(on(controls({ readOnly: false, site: legacy, worker: w({ phone: false }) })), ['addWorker', 'consent', 'edit', 'remove']);
  assert.deepEqual(on(controls({ readOnly: true, site: legacy, worker: w({ phone: false }) })), []);
});

test('a failed consent upload keeps the photo for a retry only when the failure was the signal or the server', async () => {
  const { keepForRetry } = await import('../team/install-steps.js');
  const refusal = (status, code) => ({ status, code, data: { ok: false, error: code } });
  for (const e of [{ code: 'offline', status: 0 }, { code: 'unknown', status: 502, data: null }, refusal(500, 'server')]) assert.equal(keepForRetry(e), true, JSON.stringify(e));
  // a page that is not the server's own answer (a captive portal, a proxy): nobody looked at the photo, so it is kept
  for (const e of [{ code: 'unknown', status: 200, data: null }, { code: 'unknown', status: 413, data: null }, { code: 'unknown', status: 403, data: { message: 'x' } }]) assert.equal(keepForRetry(e), true, JSON.stringify(e));
  for (const e of [refusal(413, 'too_big'), refusal(400, 'image'), refusal(409, 'legacy'), refusal(403, 'not_yours'), null]) assert.equal(keepForRetry(e), false, JSON.stringify(e));
});

test('a correction sends a clean name and email; the email may be empty only on a legacy site', async () => {
  const { workerEditBody } = await import('../team/install-steps.js');
  assert.deepEqual(workerEditBody({ name: '  Luz   Marina Paz ', email: ' LUZ@Equipo.test ' }), { name: 'Luz Marina Paz', email: 'luz@equipo.test' });
  assert.throws(() => workerEditBody({ name: 'L', email: 'l@equipo.test' }), { code: 'fields' });
  assert.throws(() => workerEditBody({ name: 'Luz Paz', email: '' }), { code: 'email' });
  assert.deepEqual(workerEditBody({ name: 'Luz Paz', email: '' }, true), { name: 'Luz Paz', email: '' });
});
