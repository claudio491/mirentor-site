import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { start } from './team-helper.mjs';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const API = '/equipo/api';
const W1 = 'w_11111111', W2 = 'w_22222222', W3 = 'w_33333333';
// Two valid IMEIs (Luhn) and one with a wrong check digit.
const IMEI_A = '490154203237518', IMEI_B = '356938035643809', IMEI_BAD = '490154203237519';

/** An admin, a rep who installs one site, and a second rep who does not. */
async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto');
  const made = await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Ferretería La Prueba' } }, { cookie: a.cookie });
  assert.equal(made.status, 200);
  const siteId = made.json.sites?.[0]?.id || s.lines().find((e) => e.type === 'site').id;
  const addWorker = (id, over = {}, cookie = ana.cookie) => s.call('POST', `${API}/install/${siteId}/workers`, { id, name: `Persona ${id.slice(-1)}`, email: `p${id.slice(-1)}@equipo.test`, phone: true, ...over }, { cookie });
  const upload = (id, bytes = JPG, cookie = ana.cookie) => fetch(`${s.url}${API}/worker/${id}/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie }, body: bytes });
  const phone = (id, imei, cookie = ana.cookie) => s.call('POST', `${API}/worker/${id}/phone`, { imei }, { cookie });
  const types = () => s.lines().map((e) => e.type);
  return { s, a, ana, beto, siteId, addWorker, upload, phone, types };
}

test('the phone route answers consent_first until a consent photo is on file', async (t) => {
  const { s, ana, addWorker, upload, phone, siteId } = await setup(t);
  assert.equal((await addWorker(W1)).status, 200);
  const early = await phone(W1, IMEI_A);
  assert.deepEqual([early.status, early.json.error], [409, 'consent_first']);
  assert.equal(s.lines().some((e) => e.type === 'worker.phone'), false);
  assert.equal((await upload(W1)).status, 200);
  assert.equal(s.lines().find((e) => e.type === 'worker.consent').form, 'v1');
  assert.equal((await phone(W1, IMEI_A)).status, 200);
  const got = await s.call('GET', `${API}/install/${siteId}`, undefined, { cookie: ana.cookie });
  assert.equal(got.json.workers[0].imei, IMEI_A);
  assert.equal(got.json.workers[0].status, 'no_clip');
  assert.equal(got.json.workers[0].consent.form, 'v1');
});

test('a consent upload that is not an image is refused and nothing is appended', async (t) => {
  const { s, addWorker, upload } = await setup(t);
  await addWorker(W1);
  const r = await upload(W1, Buffer.from('hello'));
  assert.equal(r.status, 400);
  assert.equal((await r.json()).error, 'image');
  assert.equal(s.lines().some((e) => e.type === 'worker.consent'), false);
});

test('a consent over the limit is refused', async (t) => {
  const { s, addWorker, upload } = await setup(t);
  await addWorker(W1);
  const big = await upload(W1, Buffer.concat([JPG, Buffer.alloc(901 * 1024)]));
  assert.deepEqual([big.status, (await big.json()).error], [413, 'too_big']);
  assert.equal(s.lines().some((e) => e.type === 'worker.consent'), false);
});

test('the same worker id sent twice after a failed upload is still one worker', async (t) => {
  const { s, ana, siteId, addWorker, upload, types } = await setup(t);
  assert.equal((await addWorker(W1)).status, 200);
  assert.equal((await upload(W1, Buffer.from('broken'))).status, 400);
  assert.equal((await addWorker(W1)).status, 200);
  assert.equal(types().filter((x) => x === 'worker.added').length, 1);
  const got = await s.call('GET', `${API}/install/${siteId}`, undefined, { cookie: ana.cookie });
  assert.equal(got.json.workers.length, 1);
  assert.equal(got.json.workers[0].status, 'no_consent');
  assert.equal(got.json.workers[0].consent, null);
});

test('an IMEI with dashes is accepted and one held elsewhere is imei_taken; a bad one is refused', async (t) => {
  const { s, addWorker, upload, phone } = await setup(t);
  for (const w of [W1, W2]) { await addWorker(w); await upload(w); }
  const bad = await phone(W1, IMEI_BAD);
  assert.deepEqual([bad.status, bad.json.error], [400, 'imei']);
  assert.equal((await phone(W1, '49-015420 3237518')).status, 200);
  assert.equal(s.lines().find((e) => e.type === 'worker.phone').imei, IMEI_A);
  const taken = await phone(W2, IMEI_A);
  assert.deepEqual([taken.status, taken.json.error], [409, 'imei_taken']);
  assert.equal((await phone(W2, IMEI_B)).status, 200);
});

test('a coworker with no phone gets consent only and no phone', async (t) => {
  const { addWorker, upload, phone, types } = await setup(t);
  await addWorker(W1, { phone: false }); await upload(W1);
  const r = await phone(W1, IMEI_A);
  assert.equal(r.status, 409);
  assert.equal(types().includes('worker.phone'), false);
});

test('returning a phone frees its IMEI, and the clip needs a phone first', async (t) => {
  const { s, addWorker, upload, phone, ana } = await setup(t);
  for (const w of [W1, W2]) { await addWorker(w); await upload(w); }
  const noPhone = await s.call('POST', `${API}/worker/${W1}/clip`, {}, { cookie: ana.cookie });
  assert.equal(noPhone.status, 409);
  await phone(W1, IMEI_A);
  assert.equal((await s.call('POST', `${API}/worker/${W1}/clip`, {}, { cookie: ana.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/worker/${W1}/phone/return`, {}, { cookie: ana.cookie })).status, 200);
  assert.equal((await phone(W2, IMEI_A)).status, 200);
});

test('another rep cannot open the install, add a worker or read a consent; a leader role is read-only on consents only', async (t) => {
  const { s, beto, a, ana, siteId, addWorker, upload, phone, types } = await setup(t);
  await addWorker(W1); await upload(W1);
  const before = s.lines().length;
  assert.equal((await s.call('GET', `${API}/install/${siteId}`, undefined, { cookie: beto.cookie })).status, 403);
  assert.equal((await addWorker(W2, {}, beto.cookie)).status, 403);
  assert.equal((await s.call('GET', `${API}/consent/${W1}`, undefined, { cookie: beto.cookie })).status, 403);
  assert.equal((await upload(W1, JPG, beto.cookie)).status, 403);
  assert.equal((await phone(W1, IMEI_A, beto.cookie)).status, 403);
  assert.equal((await s.call('POST', `${API}/install/${siteId}/close`, {}, { cookie: beto.cookie })).status, 403);
  assert.equal((await s.call('POST', `${API}/install/${siteId}/prep`, { what: 'signs' }, { cookie: beto.cookie })).status, 403);
  assert.equal(s.lines().length, before);
  assert.equal(types().includes('worker.phone'), false);
  // The rep who installs and a manager can read it.
  assert.equal((await s.call('GET', `${API}/consent/${W1}`, undefined, { cookie: ana.cookie })).status, 200);
  assert.equal((await s.call('GET', `${API}/consent/${W1}`, undefined, { cookie: a.cookie })).status, 200);
});

test('a consent photo is never served without a session, and is served private and uncached', async (t) => {
  const { s, a, ana, addWorker, upload } = await setup(t);
  await addWorker(W1); await upload(W1);
  assert.equal((await fetch(`${s.url}${API}/consent/${W1}`)).status, 401);
  const seen = await fetch(`${s.url}${API}/consent/${W1}`, { headers: { cookie: ana.cookie } });
  assert.deepEqual([seen.status, seen.headers.get('content-type'), seen.headers.get('cache-control')], [200, 'image/jpeg', 'private, no-store']);
  assert.deepEqual(Buffer.from(await seen.arrayBuffer()), JPG);
  assert.equal((await s.call('GET', `${API}/consent/${W2}`, undefined, { cookie: a.cookie })).status, 404);
});

test('prep and coordinator are recorded once, and a bad value is refused', async (t) => {
  const { s, ana, siteId, types } = await setup(t);
  const at = (p) => `${API}/install/${siteId}/${p}`;
  assert.equal((await s.call('POST', at('prep'), { what: 'banners' }, { cookie: ana.cookie })).status, 400);
  assert.equal((await s.call('POST', at('prep'), { what: 'signs' }, { cookie: ana.cookie })).status, 200);
  assert.equal((await s.call('POST', at('prep'), { what: 'signs' }, { cookie: ana.cookie })).status, 200);
  assert.equal(types().filter((x) => x === 'site.prep').length, 1);
  assert.equal((await s.call('POST', at('coordinator'), { name: 'X', phone: '' }, { cookie: ana.cookie })).status, 400);
  assert.equal((await s.call('POST', at('coordinator'), { name: 'Coordinadora Prueba', phone: '+507 6000-0000' }, { cookie: ana.cookie })).status, 200);
  const got = await s.call('GET', at('').replace(/\/$/, ''), undefined, { cookie: ana.cookie });
  assert.equal(got.json.site.coordinator.name, 'Coordinadora Prueba');
  assert.ok(got.json.site.prep.signs);
  assert.equal(got.json.site.prep.zones, null);
});

test('closing with nobody ready is refused; closing with one ready worker appends install.close once; a late worker is still added', async (t) => {
  const { s, ana, siteId, addWorker, upload, phone, types } = await setup(t);
  const close = () => s.call('POST', `${API}/install/${siteId}/close`, {}, { cookie: ana.cookie });
  await addWorker(W1); await upload(W1);
  const none = await close();
  assert.deepEqual([none.status, none.json.error], [409, 'nobody_ready']);
  assert.equal(types().includes('install.close'), false);
  await phone(W1, IMEI_A);
  assert.equal((await close()).status, 409);   // a phone with no clip yet is not ready
  await s.call('POST', `${API}/worker/${W1}/clip`, {}, { cookie: ana.cookie });
  assert.equal((await close()).status, 200);
  assert.equal((await close()).status, 200);
  assert.equal(types().filter((x) => x === 'install.close').length, 1);
  assert.equal((await addWorker(W3)).status, 200);
  assert.equal(types().filter((x) => x === 'worker.added').length, 2);
});

test('every install write is refused on a voided site and on a legacy site', async (t) => {
  const { s, a, ana, siteId } = await setup(t);
  const worker = (at, id) => s.call('POST', `${API}/install/${at}/workers`, { id, name: 'Persona Uno', email: 'p1@equipo.test', phone: true }, { cookie: ana.cookie });
  await s.call('POST', `${API}/site/${siteId}`, { what: 'void' }, { cookie: a.cookie });
  const voided = await worker(siteId, W2);
  assert.deepEqual([voided.status, voided.json.error], [404, 'site']);
  assert.equal((await s.call('GET', `${API}/install/${siteId}`, undefined, { cookie: ana.cookie })).status, 404);
  // A legacy site is one the log marks so: restart the service on a log that carries one.
  s.srv.close();
  appendFileSync(path.join(s.dir, 'team', 'events.jsonl'), `${JSON.stringify({ type: 'site', id: 's_legacy0001', rep: ana.id, lead: { id: null, name: 'Vieja Ferretería' }, legacy: true, by: ana.id, t: '2026-11-16T15:00:00.000Z' })}\n`);
  const again = await start({ dir: s.dir }); t.after(() => again.srv.close());
  const r = await again.call('POST', `${API}/install/s_legacy0001/workers`, { id: W1, name: 'Persona Uno', email: 'p1@equipo.test', phone: true }, { cookie: ana.cookie });
  assert.deepEqual([r.status, r.json.error], [409, 'legacy']);
  const prep = await again.call('POST', `${API}/install/s_legacy0001/prep`, { what: 'signs' }, { cookie: ana.cookie });
  assert.deepEqual([prep.status, prep.json.error], [409, 'legacy']);
});

test('the holder of a taken IMEI is named to a manager only, never to a rep', async (t) => {
  const { s, a, addWorker, upload, phone, ana } = await setup(t);
  for (const w of [W1, W2]) { await addWorker(w); await upload(w); }
  await phone(W1, IMEI_A);
  const rep = await phone(W2, IMEI_A, ana.cookie);
  assert.deepEqual([rep.status, rep.json.error], [409, 'imei_taken']);
  assert.equal('site' in rep.json, false);
  const boss = await s.call('POST', `${API}/worker/${W2}/phone`, { imei: IMEI_A }, { cookie: a.cookie });
  assert.deepEqual([boss.status, boss.json.error, boss.json.site], [409, 'imei_taken', 'Ferretería La Prueba']);
});

test('a rep who is not on the site gets 403 whether or not the ids exist; a manager gets 404', async (t) => {
  const { s, a, beto, siteId, addWorker, upload } = await setup(t);
  await addWorker(W1); await upload(W1);
  const before = s.lines().length;
  const ask = (method, p, body, cookie) => s.call(method, `${API}/${p}`, body, { cookie });
  for (const cookie of [beto.cookie]) {
    assert.equal((await ask('GET', 'install/s_doesnotexist1', undefined, cookie)).status, 403);
    assert.equal((await ask('POST', 'install/s_doesnotexist1/workers', { id: W3, name: 'Persona Tres', email: 'p3@equipo.test' }, cookie)).status, 403);
    assert.equal((await ask('GET', 'consent/w_doesnotexist1', undefined, cookie)).status, 403);
    assert.equal((await ask('POST', 'worker/w_doesnotexist1/phone', { imei: IMEI_A }, cookie)).status, 403);
    assert.equal((await ask('GET', `install/${siteId}`, undefined, cookie)).status, 403);
  }
  assert.equal((await ask('GET', 'install/s_doesnotexist1', undefined, a.cookie)).status, 404);
  assert.equal((await ask('GET', 'consent/w_doesnotexist1', undefined, a.cookie)).status, 404);
  assert.equal(s.lines().length, before);
});
