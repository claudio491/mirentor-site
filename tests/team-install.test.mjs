import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { cleanImei, workerStatus, siteProgress, siteState, siteRecord } from '../lib/team/install.mjs';

const replay = (events) => events.reduce((s, e) => applyEvent(s, e), emptyState());
const T = (n) => `2026-11-1${n}T15:00:00Z`;
const IMEI_A = '490154203237518', IMEI_B = '356938035643809';
const rep = { type: 'rep.created', t: T(0), id: 'r1', handle: 'r1', name: 'Rep Uno', role: 'rep', country: 'PA', tz: 'America/Panama' };
const site = (id, over = {}) => ({ type: 'site', id, rep: 'r1', lead: { id: null, name: 'Taller Uno' }, t: T(1), city: 'Panama City', eligible: 12, ...over });
const worker = (id, siteId, over = {}) => ({ type: 'worker.added', t: T(2), id, siteId, name: `Persona ${id}`, email: `${id}@equipo.test`, by: 'r1', ...over });
const consent = (workerId, over = {}) => ({ type: 'worker.consent', t: T(3), workerId, v: 'v1', ext: 'jpg', form: 'f1', ...over });
const phone = (workerId, imei = IMEI_A, t = T(4)) => ({ type: 'worker.phone', t, workerId, imei });
const S = 's_aaaaaaaa', W1 = 'w_aaaaaaaa', W2 = 'w_bbbbbbbb';

test('cleanImei strips separators and checks the digit', () => {
  assert.equal(cleanImei('49 015420 323751 8'), IMEI_A);
  assert.equal(cleanImei('49-015420-323751-8'), IMEI_A);
  assert.equal(cleanImei('490154203237517'), null);
  assert.equal(cleanImei('4901542032375'), null);
  assert.equal(cleanImei('49015420323751a'), null);
  assert.equal(cleanImei(null), null);
  assert.equal(cleanImei(IMEI_B), IMEI_B);
});

test('a phone is not filed for a worker with no consent', () => {
  const s = replay([rep, site(S), worker(W1, S), phone(W1)]);
  assert.equal(s.workers.get(W1).imei, null);
  assert.equal(s.imeis.size, 0);
  assert.equal(s.phoneLog.length, 0);
  assert.equal(workerStatus(s.workers.get(W1)), 'no_consent');
});

test('a phone with a consent on file is filed and logged, with the IMEI cleaned', () => {
  const s = replay([rep, site(S), worker(W1, S), consent(W1), phone(W1, '49 015420 323751 8')]);
  assert.equal(s.workers.get(W1).imei, IMEI_A);
  assert.equal(s.imeis.get(IMEI_A), W1);
  assert.deepEqual(s.phoneLog, [{ imei: IMEI_A, worker: W1, site: S, what: 'given', t: T(4) }]);
  assert.equal(workerStatus(s.workers.get(W1)), 'no_clip');
});

test('a wrong check digit is not filed', () => {
  const s = replay([rep, site(S), worker(W1, S), consent(W1), phone(W1, '490154203237517')]);
  assert.equal(s.workers.get(W1).imei, null);
});

test('an IMEI held by one worker is not given to another', () => {
  const s = replay([rep, site(S), worker(W1, S), worker(W2, S), consent(W1), consent(W2), phone(W1), phone(W2)]);
  assert.equal(s.workers.get(W1).imei, IMEI_A);
  assert.equal(s.workers.get(W2).imei, null);
  assert.equal(s.imeis.get(IMEI_A), W1);
  assert.equal(s.phoneLog.length, 1);
});

test('a returned phone frees its IMEI and both moves stay in phoneLog', () => {
  const s = replay([rep, site(S), worker(W1, S), consent(W1), phone(W1), { type: 'worker.phone.returned', t: T(5), workerId: W1 }]);
  assert.equal(s.workers.get(W1).imei, null);
  assert.equal(s.imeis.size, 0);
  assert.deepEqual(s.phoneLog.map((p) => p.what), ['given', 'returned']);
  const again = replay([rep, site(S), worker(W1, S), worker(W2, S), consent(W1), consent(W2), phone(W1), { type: 'worker.phone.returned', t: T(5), workerId: W1 }, phone(W2)]);
  assert.equal(again.workers.get(W2).imei, IMEI_A);
});

test('the same worker id twice is one worker', () => {
  const s = replay([rep, site(S), worker(W1, S), worker(W1, S, { name: 'Otra persona' })]);
  assert.equal(s.workers.size, 1);
  assert.deepEqual(s.sites.get(S).workers, [W1]);
  assert.equal(s.workers.get(W1).name, `Persona ${W1}`);
});

test('a worker on a site that is not in the log is ignored', () => {
  assert.equal(replay([rep, worker(W1, 's_missing01')]).workers.size, 0);
});

test('a coworker with phone: false has consent_only status and is never given a phone', () => {
  const s = replay([rep, site(S), worker(W1, S, { phone: false }), consent(W1), phone(W1)]);
  assert.equal(s.workers.get(W1).imei, null);
  assert.equal(workerStatus(s.workers.get(W1)), 'consent_only');
  assert.equal(workerStatus(replay([rep, site(S), worker(W1, S, { phone: false })]).workers.get(W1)), 'no_consent');
});

test('status runs from no_consent to ready as the steps arrive; a clip needs a phone', () => {
  const base = [rep, site(S), worker(W1, S)];
  assert.equal(workerStatus(replay([...base, { type: 'worker.clip', t: T(5), workerId: W1 }]).workers.get(W1)), 'no_consent');
  assert.equal(workerStatus(replay([...base, consent(W1)]).workers.get(W1)), 'no_phone');
  assert.equal(replay([...base, consent(W1), { type: 'worker.clip', t: T(5), workerId: W1 }]).workers.get(W1).clip, null);
  assert.equal(workerStatus(replay([...base, consent(W1), phone(W1), { type: 'worker.clip', t: T(5), workerId: W1 }]).workers.get(W1)), 'ready');
});

test('a site event from before this build still replays', () => {
  const s = replay([{ type: 'site', id: 's_oldoldold', rep: 'r1', lead: { id: null, name: 'Taller Uno' }, t: '2026-11-10T15:00:00Z' }]);
  const old = s.sites.get('s_oldoldold');
  assert.equal(old.city, '');
  assert.equal(old.eligible, null);
  assert.equal(old.coordinator, null);
  assert.equal(old.practice, false);
  assert.equal(old.legacy, false);
  assert.equal(old.phones, null);
  assert.equal(old.closed, null);
  assert.deepEqual(old.prep, { signs: null, zones: null });
  assert.deepEqual(old.workers, []);
  assert.equal(s.feed.length, 1);
});

test('site facts, phones, prep, coordinator and close are filed once', () => {
  const s = replay([rep, site(S, { coordinator: { name: 'Coordinadora Prueba', phone: '+507 0000 0000' } }),
    { type: 'site.phones', siteId: S, count: 10 }, { type: 'site.prep', siteId: S, what: 'signs', t: T(2) }, { type: 'site.prep', siteId: S, what: 'signs', t: T(3) },
    { type: 'site.prep', siteId: S, what: 'other', t: T(3) }, { type: 'site.coordinator', siteId: S, name: 'Otra Persona', phone: '1' },
    { type: 'install.close', siteId: S, by: 'r1', t: T(6) }, { type: 'install.close', siteId: S, by: 'r1', t: T(7) }]);
  const x = s.sites.get(S);
  assert.equal(x.eligible, 12);
  assert.equal(x.phones, 10);
  assert.deepEqual(x.prep, { signs: T(2), zones: null });
  assert.deepEqual(x.coordinator, { name: 'Otra Persona', phone: '1' });
  assert.equal(x.closed, T(6));
});

test('site.removed takes out a practice site with its workers and frees their IMEIs; a real site stays', () => {
  const events = [rep, site(S, { practice: true }), worker(W1, S), consent(W1), phone(W1)];
  const gone = replay([...events, { type: 'site.removed', siteId: S }]);
  assert.equal(gone.sites.size, 0);
  assert.equal(gone.workers.size, 0);
  assert.equal(gone.imeis.size, 0);
  assert.equal(gone.phoneLog.length, 0);
  assert.equal(gone.feed.length, 0);
  const real = replay([rep, site(S), worker(W1, S), consent(W1), phone(W1), { type: 'site.removed', siteId: S }]);
  assert.equal(real.sites.size, 1);
  assert.equal(real.workers.size, 1);
  assert.equal(real.imeis.size, 1);
});

test('siteProgress counts ready workers and never counts a practice site as real', () => {
  const s = replay([rep, site(S), worker(W1, S), worker(W2, S), worker('w_cccccccc', S, { phone: false }),
    consent(W1), phone(W1), { type: 'worker.clip', t: T(5), workerId: W1 }, consent(W2), consent('w_cccccccc')]);
  assert.deepEqual(siteProgress(s, S), { total: 3, ready: 1, consents: 3, phones: 1, allRecordingHaveConsent: true });
  const missing = replay([rep, site(S), worker(W1, S), worker(W2, S), consent(W1)]);
  assert.equal(siteProgress(missing, S).allRecordingHaveConsent, false);
  assert.equal(siteProgress(replay([rep, site(S)]), S).allRecordingHaveConsent, false);
  assert.deepEqual(siteProgress(replay([rep]), 's_nothere01'), { total: 0, ready: 0, consents: 0, phones: 0, allRecordingHaveConsent: false });
  const practice = replay([rep, site(S, { practice: true }), worker(W1, S), consent(W1)]);
  assert.equal(siteState(practice.sites.get(S)), 'practice');
});

test('siteState follows the site from phones to installed; legacy and practice take priority', () => {
  const st = (events) => siteState(replay([rep, ...events]).sites.get(S));
  assert.equal(st([site(S)]), 'waiting_phones');
  assert.equal(st([site(S), { type: 'site.phones', siteId: S, count: 5 }]), 'ready_to_install');
  assert.equal(st([site(S), { type: 'site.phones', siteId: S, count: 5 }, worker(W1, S)]), 'installing');
  assert.equal(st([site(S), { type: 'site.phones', siteId: S, count: 5 }, worker(W1, S), { type: 'install.close', siteId: S, by: 'r1', t: T(6) }]), 'closed');
  assert.equal(st([site(S), { type: 'install.close', siteId: S, by: 'r1', t: T(6) }, { type: 'site.step', siteId: S, what: 'installed', t: T(7) }]), 'installed');
  assert.equal(st([site(S, { legacy: true })]), 'legacy');
});

test('siteRecord lists worker, email, signature day, form version and IMEI', () => {
  const s = replay([rep, site(S), worker(W1, S), worker(W2, S), consent(W1, { t: '2026-11-12T03:00:00Z' }), phone(W1, IMEI_A, '2026-11-13T15:00:00Z')]);
  assert.deepEqual(siteRecord(s, S), [{ worker: `Persona ${W1}`, email: `${W1}@equipo.test`, signedOn: '2026-11-11', form: 'f1', imei: IMEI_A, givenOn: '2026-11-13' }]);
  assert.deepEqual(siteRecord(s, 's_nothere01'), []);
});
