// Practice mode on the phone: which controls each screen offers for viewer x target (a person's own screens, a real rep
// in view-as, the practice rep), how a request made while acting carries whose it is, and the IMEI rule per site kind.
// The server stays the judge; these decide only what the screen offers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actingMode, readOnlyIn, repControls, withAs, practiceActions, logLocked, staleAs } from '../team/practice-steps.js';
import { controls, imeiFor, practiceImei } from '../team/install-steps.js';
import { ladderControls, postSeen } from '../team/ladder-steps.js';
import { practiceNote } from '../team/leader-steps.js';
import { makeT } from '../team/i18n.js';

const real = { me: { id: 'r_ana', name: 'Ana Prueba' } }, prac = { me: { id: 'r_prac', name: 'Vendedor de práctica', practice: true } };

test('three ways a rep\'s screens are open: own, view-as on a real rep (read only), acting as the practice rep', () => {
  assert.equal(actingMode(null, real), 'self');
  assert.equal(actingMode('r_ana', real), 'view');
  assert.equal(actingMode('r_prac', prac), 'practice');
  // whatever the address says, only an answer that is the practice rep opens writes
  assert.equal(actingMode('r_prac', real), 'view');
  assert.equal(actingMode('r_ana', null), 'view');
  assert.deepEqual(['self', 'view', 'practice'].map(readOnlyIn), [false, true, false]);
});

test('which controls the rep screens offer, per mode', () => {
  const view = repControls('view');
  assert.deepEqual(Object.entries(view).filter(([k, v]) => v && k !== 'manage').map(([k]) => k), [], 'a real rep in view-as: no control that writes');
  assert.equal(view.manage, true);   // the manager's own controls on a rep (a badge, reopening a day) stay
  const own = repControls('self');
  for (const k of ['log', 'close', 'goal', 'held', 'play', 'kudos', 'signOut']) assert.equal(own[k], true, k);
  assert.equal(own.manage, false);
  const p = repControls('practice');
  for (const k of ['log', 'close', 'goal', 'held', 'play', 'note']) assert.equal(p[k], true, k);
  // a clap from the practice rep would show on a real person's line; signing out would sign the manager out
  assert.deepEqual([p.kudos, p.signOut, p.manage], [false, false, false]);
});

test('install controls: none through view-as on a real rep; the full set, with the example photo, as the practice rep', () => {
  const practiceSite = { practice: true, closed: null }, realSite = { practice: false, closed: null };
  const w = { phone: true, consent: null, imei: null, clip: null };
  const none = controls({ readOnly: readOnlyIn('view'), site: practiceSite, worker: w });
  assert.deepEqual(Object.values(none).some(Boolean), false);
  const acting = controls({ readOnly: readOnlyIn('practice'), site: practiceSite, worker: w });
  assert.deepEqual([acting.consent, acting.example, acting.phone, acting.close, acting.addWorker], [true, true, false, true, true]);
  // the consent lock stays on: the phone opens only once a consent is on file
  assert.equal(controls({ readOnly: false, site: practiceSite, worker: { ...w, consent: { v: '1' } } }).phone, true);
  // once a consent is on file the example is not offered again: the camera can still replace it
  assert.equal(controls({ readOnly: false, site: practiceSite, worker: { ...w, consent: { v: '1' } } }).example, false);
  // a real site never offers the example photo, to anyone
  assert.equal(controls({ readOnly: false, site: realSite, worker: w }).example, false);
  assert.equal(controls({ readOnly: false, site: practiceSite, worker: null }).example, false);
});

test('ladder: self steps tick as the practice rep, never through view-as on a real rep', () => {
  const step = { step: 'video', by: 'rep', done: false };
  assert.equal(ladderControls({ readOnly: readOnlyIn('view'), step, canLog: false }).tick, false);
  assert.equal(ladderControls({ readOnly: readOnlyIn('practice'), step, canLog: true }).tick, true);
  assert.equal(ladderControls({ readOnly: readOnlyIn('practice'), step: { step: 'zones', by: 'rep', done: false }, canLog: true }).zones, true);
  const row = { kind: 'play', key: 'welcome' };
  assert.deepEqual([postSeen(row, [], readOnlyIn('view')), postSeen(row, [], readOnlyIn('practice'))], [false, true]);
});

test('a request made while acting as the practice rep carries `as`, once; any other request is left as it is', () => {
  assert.equal(withAs('log', 'practice', 'r_prac'), 'log?as=r_prac');
  assert.equal(withAs('leads?q=Tienda', 'practice', 'r_prac'), 'leads?q=Tienda&as=r_prac');
  assert.equal(withAs('me?as=r_prac', 'practice', 'r_prac'), 'me?as=r_prac');
  assert.equal(withAs('worker/w_1/consent', 'practice', 'r prac'), 'worker/w_1/consent?as=r%20prac');
  // view-as on a real rep sends no write, and a person's own request names nobody
  assert.equal(withAs('log', 'view', 'r_ana'), 'log');
  assert.equal(withAs('log', 'self', null), 'log');
});

test('the Vendedores screen offers create when there is no practice rep, view-as and remove when there is one', () => {
  assert.deepEqual(practiceActions({ practice: null }, 'admin'), ['create']);
  assert.deepEqual(practiceActions({ practice: { id: 'r_prac' } }, 'manager'), ['view', 'remove']);
  assert.deepEqual(practiceActions({ practice: null }, 'rep'), []);
  assert.deepEqual(practiceActions({ practice: null }, 'leader'), []);
  assert.deepEqual(practiceActions(null, 'admin'), []);
});

test('the IMEI rule per site kind: a practice site takes DEMO-0001, a real site keeps the 15 digits and the check', () => {
  const p = { practice: true }, r = { practice: false };
  assert.equal(imeiFor(p, 'DEMO-0001'), 'DEMO-0001');
  assert.equal(imeiFor(p, '  demo   0001 '), 'DEMO 0001');
  assert.equal(imeiFor(r, 'DEMO-0001'), null);
  assert.equal(imeiFor(r, '49-015420 3237518'), '490154203237518');
  assert.equal(imeiFor(r, '490154203237519'), null);
  // practice: 4 to 20 letters, digits, spaces or dashes; no check digit and no all-same refusal
  assert.equal(practiceImei('000000000000000'), '000000000000000');
  assert.equal(practiceImei('490154203237519'), '490154203237519');
  for (const bad of ['D1', 'DEMO_0001', 'x'.repeat(21), '----', 42, null]) assert.equal(practiceImei(bad), null, String(bad));
});

test('the leadership view says how many practice reps it leaves out, with the practice sites', () => {
  const es = makeT('es'), en = makeT('en');
  assert.equal(practiceNote({ practiceHidden: 0, practiceReps: 0 }, es), null);
  assert.match(practiceNote({ practiceHidden: 0, practiceReps: 1 }, es), /1 vendedor de práctica/);
  assert.match(practiceNote({ practiceHidden: 0, practiceReps: 1 }, en), /1 practice rep/);
  const both = practiceNote({ practiceHidden: 2, practiceReps: 1 }, es);
  assert.match(both, /2 sitios de práctica/);
  assert.match(both, /1 vendedor de práctica/);
});

test('leaving practice mode: until the answer arrives the screens are someone else\'s, so they read only', () => {
  // the address already says "nobody" while the loaded screens are still the practice rep's (or a real rep's)
  const loadedPrac = { ...prac, viewer: { id: 'r_boss', role: 'admin', as: 'r_prac' } }, loadedReal = { ...real, viewer: { id: 'r_boss', role: 'admin', as: 'r_ana' } };
  assert.equal(actingMode(null, loadedPrac), 'view');
  assert.equal(actingMode(null, loadedReal), 'view');
  assert.equal(repControls(actingMode(null, loadedPrac)).log, false);
  assert.equal(withAs('log', actingMode(null, loadedPrac), null), 'log');   // and no write leaves: nothing offers one
  // entering: the address names the practice rep while the loaded screens are still the manager's own
  assert.equal(actingMode('r_prac', { me: { id: 'r_boss' }, viewer: { id: 'r_boss', role: 'admin', as: null } }), 'view');
  // a person's own screens, loaded as their own, are theirs
  assert.equal(actingMode(null, { me: { id: 'r_ana' }, viewer: { id: 'r_ana', role: 'rep', as: null } }), 'self');
  assert.equal(actingMode(null, null), 'self');
});

test('a closed day locks logging, except the practice rep\'s', () => {
  const closed = { closed: '2026-11-21T22:00:00Z' }, open = { closed: null };
  assert.equal(logLocked(closed, 'self'), true);
  assert.equal(logLocked(closed, 'practice'), false);
  assert.equal(logLocked(open, 'self'), false);
  assert.equal(logLocked(null, 'self'), false);
});

test('an address that names a rep who is gone is dropped, and the screens start as the person', () => {
  const gone = { code: 'rep', status: 404 };
  assert.equal(staleAs(gone, 'r_prac'), true);
  assert.equal(staleAs(gone, null), false);
  assert.equal(staleAs({ code: 'offline', status: 0 }, 'r_prac'), false);
  assert.equal(staleAs({ code: 'read_only', status: 403 }, 'r_prac'), false);
  assert.equal(staleAs(null, 'r_prac'), false);
});
