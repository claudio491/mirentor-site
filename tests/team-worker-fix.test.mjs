// Before reps get access: a worker typed wrong is corrected or removed (I7), a manager ticks and takes back the first
// approved hour (I4), and a legacy site loads the consents it already had.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { start, mail, as } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { siteProgress } from '../lib/team/install.mjs';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const API = '/equipo/api';
const W1 = 'w_11111111', W2 = 'w_22222222', W3 = 'w_33333333';
const IMEI_A = '490154203237518';

/** An admin, a rep who installs one site, another rep, a manager and a leader. */
async function setup(t, siteOver = {}) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto'), mgr = await s.addRep(a.cookie, 'mara', { role: 'manager' });
  const made = await s.call('POST', `${API}/reps`, { email: mail('lia'), name: 'Lia Lider', role: 'leader', city: '' }, { cookie: a.cookie });
  const lia = { id: made.json.id, cookie: as(mail('lia')) };
  const site = await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Ferretería La Prueba' }, ...siteOver }, { cookie: a.cookie });
  assert.equal(site.status, 200, site.text);
  const siteId = s.lines().filter((e) => e.type === 'site').at(-1).id;
  const call = (method, p, body, cookie = ana.cookie) => s.call(method, `${API}/${p}`, body, { cookie });
  const addWorker = (id, over = {}, cookie = ana.cookie) => call('POST', `install/${siteId}/workers`, { id, name: `Persona ${id.slice(-1)}`, email: `p${id.slice(-1)}@equipo.test`, phone: true, ...over }, cookie);
  const upload = (id, cookie = ana.cookie) => fetch(`${s.url}${API}/worker/${id}/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie }, body: JPG });
  const install = (cookie = ana.cookie) => call('GET', `install/${siteId}`, undefined, cookie);
  const count = (type) => s.lines().filter((e) => e.type === type).length;
  return { s, a, ana, beto, mgr, lia, siteId, call, addWorker, upload, install, count };
}

// ---- I7: correct or remove a worker ----

test('a name and an email typed wrong are corrected by the site\'s rep or a manager, and by nobody else', async (t) => {
  const { a, beto, lia, mgr, call, addWorker, install, count } = await setup(t);
  await addWorker(W1);
  const fixed = await call('POST', `worker/${W1}/edit`, { name: '  Luz   Marina ', email: 'LUZ@equipo.test' });
  assert.equal(fixed.status, 200, fixed.text);
  assert.deepEqual([fixed.json.workers[0].name, fixed.json.workers[0].email], ['Luz Marina', 'luz@equipo.test']);
  assert.equal(count('worker.edited'), 1);
  // the same values again append nothing
  assert.equal((await call('POST', `worker/${W1}/edit`, { name: 'Luz Marina', email: 'luz@equipo.test' })).status, 200);
  assert.equal(count('worker.edited'), 1);
  // a manager may; another rep and a leader may not
  assert.equal((await call('POST', `worker/${W1}/edit`, { name: 'Luz Marina Paz', email: 'luz@equipo.test' }, mgr.cookie)).status, 200);
  assert.deepEqual([(await call('POST', `worker/${W1}/edit`, { name: 'Otra Persona', email: 'o@equipo.test' }, beto.cookie)).json.error], ['not_yours']);
  const leader = await call('POST', `worker/${W1}/edit`, { name: 'Otra Persona', email: 'o@equipo.test' }, lia.cookie);
  assert.deepEqual([leader.status, leader.json.error], [403, 'read_only']);
  // the email stays required on a site installed through the app, and the name needs two letters
  assert.deepEqual([(await call('POST', `worker/${W1}/edit`, { name: 'Luz', email: '' })).json.error], ['email']);
  assert.deepEqual([(await call('POST', `worker/${W1}/edit`, { name: 'L', email: 'l@equipo.test' })).json.error], ['fields']);
  assert.equal(count('worker.edited'), 2);
  assert.equal((await install(a.cookie)).json.workers[0].name, 'Luz Marina Paz');
});

test('removing a worker who holds a phone is refused until it comes back; then they leave the list and the counts, and their consent stays on disk', async (t) => {
  const { s, a, beto, lia, call, addWorker, upload, install, count } = await setup(t);
  for (const w of [W1, W2]) { await addWorker(w); await upload(w); }
  assert.equal((await call('POST', `worker/${W1}/phone`, { imei: IMEI_A })).status, 200);
  const held = await call('POST', `worker/${W1}/remove`, {});
  assert.deepEqual([held.status, held.json.error], [409, 'return_phone_first']);
  assert.equal(count('worker.removed'), 0);
  // another rep and a leader cannot remove anyone
  assert.deepEqual([(await call('POST', `worker/${W2}/remove`, {}, beto.cookie)).json.error], ['not_yours']);
  assert.deepEqual([(await call('POST', `worker/${W2}/remove`, {}, lia.cookie)).json.error], ['read_only']);
  assert.equal((await call('POST', `worker/${W1}/phone/return`, {})).status, 200);
  const gone = await call('POST', `worker/${W1}/remove`, {});
  assert.equal(gone.status, 200, gone.text);
  assert.deepEqual(gone.json.workers.map((w) => w.id), [W2]);
  assert.deepEqual([gone.json.progress.total, gone.json.progress.consents], [1, 1]);
  // the consent photo stays on disk and still answers at its address, for the record
  assert.equal(existsSync(path.join(s.dir, 'team', 'consents', `${W1}.jpg`)), true);
  assert.equal((await call('GET', `consent/${W1}`, undefined, a.cookie)).status, 200);
  // nothing more is done to a removed worker; the same id again adds nobody
  assert.deepEqual([(await call('POST', `worker/${W1}/edit`, { name: 'Persona Uno', email: 'p1@equipo.test' })).status], [404]);
  assert.deepEqual([(await call('POST', `worker/${W1}/remove`, {})).status], [404]);
  assert.equal((await addWorker(W1)).status, 200);
  assert.equal(count('worker.added'), 2);
  assert.deepEqual((await install()).json.workers.map((w) => w.id), [W2]);
  // the team view counts the site without them
  const site = (await call('GET', 'team', undefined, a.cookie)).json.sites[0];
  assert.deepEqual([site.workers, site.consents], [1, 1]);
});

test('the reducer: a removal holds only without a phone, a practice worker goes entirely, and an edit never touches a removed worker', () => {
  const state = emptyState();
  const t0 = '2026-11-16T15:00:00Z';
  for (const e of [
    { type: 'rep.created', id: 'r1', handle: 'ana', name: 'Ana Rep', role: 'rep', city: 'Panama City', t: t0 },
    { type: 'site', id: 's_real0001', rep: 'r1', lead: { name: 'Real' }, t: t0 }, { type: 'site', id: 's_prac0001', rep: 'r1', lead: { name: 'Práctica' }, practice: true, t: t0 },
    { type: 'worker.added', siteId: 's_real0001', id: W1, name: 'Uno', email: 'u@equipo.test', t: t0 }, { type: 'worker.added', siteId: 's_real0001', id: W2, name: 'Dos', email: 'd@equipo.test', t: t0 },
    { type: 'worker.added', siteId: 's_prac0001', id: W3, name: 'Tres', email: 't@equipo.test', t: t0 },
    { type: 'worker.consent', workerId: W1, ext: 'jpg', v: 'abc', form: 'v1', t: t0 }, { type: 'worker.phone', workerId: W1, imei: IMEI_A, t: t0 },
    { type: 'worker.removed', workerId: W1, t: t0 }, { type: 'worker.removed', workerId: W2, t: t0 }, { type: 'worker.removed', workerId: W3, t: t0 },
    { type: 'worker.edited', workerId: W2, name: 'Cambiado', email: '', t: t0 },
  ]) applyEvent(state, e);
  assert.deepEqual(state.sites.get('s_real0001').workers, [W1], 'a phone holder stays');
  assert.equal(state.workers.get(W2).removed, t0);
  assert.equal(state.workers.get(W2).name, 'Dos');
  assert.equal(state.workers.has(W3), false);
  assert.deepEqual(siteProgress(state, 's_real0001').total, 1);
});

// ---- I4: the first approved hour from the manager's screen ----

test('a manager ticks and takes back a rep\'s first approved hour; a rep and a leader cannot', async (t) => {
  const { a, ana, mgr, lia, call, count } = await setup(t);
  const hour = (cookie, body) => call('POST', 'ladder', { step: 'hour', ...body }, cookie);
  const row = async () => (await call('GET', 'team', undefined, mgr.cookie)).json.reps.find((r) => r.id === ana.id);
  assert.deepEqual([(await row()).hourDone, (await row()).ladderDone], [false, 0]);
  assert.equal((await hour(mgr.cookie, { rep: ana.id })).status, 200);
  assert.deepEqual([(await row()).hourDone, (await row()).ladderDone], [true, 1]);
  // the rep sees it ticked, and cannot take it back
  assert.equal((await call('GET', 'me')).json.ladder.find((x) => x.step === 'hour').done, true);
  assert.deepEqual([(await hour(ana.cookie, { undo: true })).json.error], ['step_locked']);
  assert.deepEqual([(await hour(ana.cookie, { rep: ana.id, undo: true })).json.error], ['step_locked']);
  // a leader changes nothing
  const leader = await hour(lia.cookie, { rep: ana.id, undo: true });
  assert.deepEqual([leader.status, leader.json.error], [403, 'read_only']);
  // only the manager's step is taken back this way, and undo means only true
  await call('POST', 'ladder', { step: 'video' });
  assert.deepEqual([(await call('POST', 'ladder', { step: 'video', undo: true })).json.error], ['step_locked']);
  assert.deepEqual([(await call('POST', 'ladder', { step: 'video', rep: ana.id, undo: true }, mgr.cookie)).json.error], ['step_locked']);
  assert.deepEqual([(await hour(mgr.cookie, { rep: ana.id, undo: 'yes' })).json.error], ['fields']);
  assert.equal(count('ladder.untick'), 0);
  // the undo
  assert.equal((await hour(a.cookie, { rep: ana.id, undo: true })).status, 200);
  assert.equal(count('ladder.untick'), 1);
  assert.deepEqual([(await row()).hourDone, (await row()).ladderDone], [false, 1], 'the rep\'s own video tick stays');
  // taking back what is not ticked appends nothing; ticking again works
  assert.equal((await hour(mgr.cookie, { rep: ana.id, undo: true })).status, 200);
  assert.equal(count('ladder.untick'), 1);
  assert.equal((await hour(mgr.cookie, { rep: ana.id })).status, 200);
  assert.equal((await row()).hourDone, true);
});

// ---- past consents on a legacy site ----

test('a legacy site: a manager loads past consents with no phone and an optional email; it pays nothing and posts nothing', async (t) => {
  const { s, a, ana, mgr, lia, siteId, call, addWorker, upload, install, count } = await setup(t, { legacy: true, eligible: 40, city: 'Colón' });
  // the site's rep is refused as before; a manager or an admin may load
  const rep = await addWorker(W1, { email: '' });
  assert.deepEqual([rep.status, rep.json.error], [409, 'legacy']);
  const added = await addWorker(W1, { email: '', phone: true }, mgr.cookie);
  assert.equal(added.status, 200, added.text);
  assert.deepEqual([added.json.site.legacy, added.json.workers[0].email, added.json.workers[0].phone], [true, '', false]);
  // an email that is there must be well formed
  assert.deepEqual([(await addWorker(W2, { email: 'no-es-correo' }, a.cookie)).json.error], ['email']);
  assert.equal((await addWorker(W2, {}, a.cookie)).status, 200);
  assert.equal((await upload(W1, mgr.cookie)).status, 200);
  assert.equal((await upload(W1, ana.cookie)).status, 409, 'the rep loads nothing here');
  const view = (await install(mgr.cookie)).json;
  assert.deepEqual([view.progress.consents, view.progress.total, view.workers[0].status], [1, 2, 'consent_only']);
  // nothing of an install: no prep, no phone, no clip, no close
  for (const [p, body] of [[`install/${siteId}/prep`, { what: 'signs' }], [`install/${siteId}/coordinator`, { name: 'Coord', phone: '60000000' }], [`install/${siteId}/close`, {}], [`worker/${W1}/phone`, { imei: IMEI_A }], [`worker/${W1}/clip`, {}]]) {
    const r = await call('POST', p, body, mgr.cookie);
    assert.deepEqual([r.status, r.json.error], [409, 'legacy'], p);
  }
  // a correction keeps the email optional; a removal works the same way
  assert.equal((await call('POST', `worker/${W2}/edit`, { name: 'Persona Dos', email: '' }, mgr.cookie)).status, 200);
  assert.equal((await call('POST', `worker/${W2}/remove`, {}, mgr.cookie)).status, 200);
  // the site shows "1 de 40" to managers and leadership, with its record
  const site = (await call('GET', 'team', undefined, a.cookie)).json.sites.find((x) => x.id === siteId);
  assert.deepEqual([site.legacy, site.eligible, site.consents, site.workers], [true, 40, 1, 1]);
  const lead = (await call('GET', 'lead', undefined, lia.cookie)).json;
  const card = lead.cities.flatMap((c) => c.sites).find((x) => x.id === siteId);
  assert.deepEqual([card.state, card.eligible, card.consents], ['legacy', 40, 1]);
  const record = await call('GET', `site/${siteId}/record.csv`, undefined, lia.cookie);
  assert.equal(record.status, 200);
  assert.match(record.text, /^"Persona 1","","2026-11-16","v1",""/m);
  // no points, no "signed a site", nothing installed
  assert.equal(s.lines().some((e) => e.type === 'install.close' || e.type === 'site.step'), false);
  const me = (await call('GET', 'me')).json;
  assert.equal(me.feed.some((f) => f.ref === siteId), false);
  assert.equal(me.ledger.length, 0);
  assert.equal(count('worker.added'), 2);
});
