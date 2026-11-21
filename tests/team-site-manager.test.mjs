import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { start } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { siteRecord } from '../lib/team/install.mjs';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const API = '/equipo/api';
const W1 = 'w_11111111', W2 = 'w_22222222', W3 = 'w_33333333';
const IMEI_A = '490154203237518', IMEI_B = '356938035643809';
const HEADER = 'worker,email,signed_on,form,imei,given_on,returned_on';

/** An admin, a rep who installs, and a helper that makes a site for that rep. */
async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const site = async (over = {}) => {
    const before = new Set(s.lines().filter((e) => e.type === 'site').map((e) => e.id));
    const r = await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Ferretería La Prueba' }, ...over }, { cookie: a.cookie });
    const made = s.lines().filter((e) => e.type === 'site' && !before.has(e.id)).at(-1);
    return { r, id: made?.id };
  };
  const stateOf = async (id) => (await s.call('GET', `${API}/install/${id}`, undefined, { cookie: ana.cookie })).json.site.state;
  const addWorker = (siteId, id, over = {}) => s.call('POST', `${API}/install/${siteId}/workers`, { id, name: `Persona ${id.slice(-1)}`, email: `p${id.slice(-1)}@equipo.test`, phone: true, ...over }, { cookie: ana.cookie });
  const upload = (id) => fetch(`${s.url}${API}/worker/${id}/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: ana.cookie }, body: JPG });
  const phone = (id, imei) => s.call('POST', `${API}/worker/${id}/phone`, { imei }, { cookie: ana.cookie });
  const manage = (siteId, body) => s.call('POST', `${API}/site/${siteId}`, body, { cookie: a.cookie });
  return { s, a, ana, site, stateOf, addWorker, upload, phone, manage };
}

test('the install card needs phones: site state is waiting_phones until what=phones', async (t) => {
  const { s, a, ana, site, stateOf, manage } = await setup(t);
  const { r, id } = await site({ city: 'Panama City', eligible: 14, coordinator: { name: 'Coordinadora Uno', phone: '+507 6000-0000' } });
  assert.equal(r.status, 200);
  const made = s.lines().find((e) => e.id === id);
  assert.deepEqual([made.city, made.eligible, made.coordinator.name], ['Panama City', 14, 'Coordinadora Uno']);
  assert.equal(await stateOf(id), 'waiting_phones');
  for (const count of [0, 501, 2.5, '12', null]) assert.equal((await manage(id, { what: 'phones', count })).status, 400, `count ${count}`);
  assert.equal(await stateOf(id), 'waiting_phones');
  assert.equal((await manage(id, { what: 'phones', count: 12 })).status, 200);
  assert.equal(s.lines().find((e) => e.type === 'site.phones').count, 12);
  assert.equal(await stateOf(id), 'ready_to_install');
  // a rep cannot set phones
  assert.equal((await s.call('POST', `${API}/site/${id}`, { what: 'phones', count: 3 }, { cookie: ana.cookie })).status, 403);
  void a;
});

test('eligible must be an integer from 0 to 5000: the route refuses the rest and the reducer ignores it', async (t) => {
  const { s, site } = await setup(t);
  for (const eligible of [2.5, -1, 5001, '7', true]) {
    const r = await site({ eligible });
    assert.deepEqual([r.r.status, r.r.json.error], [400, 'fields'], `eligible ${eligible}`);
  }
  assert.equal(s.lines().some((e) => e.type === 'site'), false);
  assert.equal((await site({ eligible: 0 })).r.status, 200);
  assert.equal((await site({ eligible: 5000 })).r.status, 200);
  const st = [{ type: 'site', id: 's_aaaaaaaa', rep: 'r1', lead: { name: 'x' }, t: '2026-11-11T15:00:00Z', eligible: 2.5 }].reduce((x, e) => applyEvent(x, e), emptyState());
  assert.equal(st.sites.get('s_aaaaaaaa').eligible, null);
});

test('legacy and practice together are refused', async (t) => {
  const { s, site } = await setup(t);
  const r = await site({ practice: true, legacy: true });
  assert.deepEqual([r.r.status, r.r.json.error], [400, 'fields']);
  assert.equal(s.lines().some((e) => e.type === 'site'), false);
  assert.equal((await site({ practice: 'yes' })).r.status, 400);
  assert.equal((await site({ practice: true })).r.status, 200);
  assert.equal(s.lines().find((e) => e.type === 'site').practice, true);
});

test('installed is refused until the rep closed', async (t) => {
  const { s, ana, site, addWorker, upload, phone, manage } = await setup(t);
  const { id } = await site();
  await manage(id, { what: 'phones', count: 5 });
  await addWorker(id, W1); await upload(W1); await phone(W1, IMEI_A);
  const early = await manage(id, { what: 'installed' });
  assert.deepEqual([early.status, early.json.error], [409, 'install_not_closed']);
  assert.equal(s.lines().some((e) => e.type === 'site.step'), false);
  await s.call('POST', `${API}/worker/${W1}/clip`, {}, { cookie: ana.cookie });
  assert.equal((await s.call('POST', `${API}/install/${id}/close`, {}, { cookie: ana.cookie })).status, 200);
  assert.equal((await manage(id, { what: 'installed' })).status, 200);
  assert.equal(s.lines().filter((e) => e.type === 'site.step' && e.what === 'installed').length, 1);
});

test('a legacy site and a site with no workers keep the old installed behavior', async (t) => {
  const { s, site, addWorker, manage } = await setup(t);
  const old = await site({ legacy: true });
  assert.equal((await manage(old.id, { what: 'installed' })).status, 200);
  const bare = await site();
  assert.equal((await manage(bare.id, { what: 'installed' })).status, 200);
  const crowded = await site();
  await addWorker(crowded.id, W1);
  assert.equal((await manage(crowded.id, { what: 'installed' })).json.error, 'install_not_closed');
  assert.equal(s.lines().filter((e) => e.type === 'site.step').length, 2);
});

test('a practice site is removed with its consent files and a real site is not', async (t) => {
  const { s, ana, site, addWorker, upload, manage } = await setup(t);
  const practice = await site({ practice: true }), real = await site();
  await addWorker(practice.id, W1); await upload(W1);
  await addWorker(real.id, W2); await upload(W2);
  const file = (w) => path.join(s.dir, 'team', 'consents', `${w}.jpg`);
  assert.equal(existsSync(file(W1)), true);
  const refused = await manage(real.id, { what: 'remove' });
  assert.deepEqual([refused.status, refused.json.error], [409, 'not_practice']);
  assert.equal(existsSync(file(W2)), true);
  assert.equal(s.lines().some((e) => e.type === 'site.removed'), false);
  assert.equal((await manage(practice.id, { what: 'remove' })).status, 200);
  assert.equal(existsSync(file(W1)), false);
  assert.equal(existsSync(file(W2)), true);
  assert.equal(s.lines().filter((e) => e.type === 'site.removed').length, 1);
  assert.equal((await s.call('GET', `${API}/install/${practice.id}`, undefined, { cookie: ana.cookie })).status, 403);
  assert.equal((await manage(practice.id, { what: 'remove' })).status, 404);
});

test('record.csv has one line per worker and phone with consent and is refused to a rep', async (t) => {
  const { s, a, ana, site, addWorker, upload, phone } = await setup(t);
  const { id } = await site();
  await addWorker(id, W1, { name: '=HYPERLINK("http://x","clic")' }); await upload(W1);
  await phone(W1, IMEI_A);
  await s.call('POST', `${API}/worker/${W1}/phone/return`, {}, { cookie: ana.cookie });
  await phone(W1, IMEI_B);
  await addWorker(id, W2, { phone: false, name: 'Persona Sin Telefono' }); await upload(W2);
  await addWorker(id, W3, { name: 'Persona Sin Firma' });   // no consent: not in the record
  const r = await s.call('GET', `${API}/site/${id}/record.csv`, undefined, { cookie: a.cookie });
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/csv/);
  const rows = r.text.trim().split('\n');
  assert.equal(rows[0], HEADER);
  assert.equal(rows.length, 4, r.text);
  assert.ok(rows[1].startsWith(`"'=HYPERLINK(""http://x"",""clic"")","p1@equipo.test","2026-11-16","v1","${IMEI_A}","2026-11-16","2026-11-16"`), rows[1]);
  assert.ok(rows[2].includes(`"${IMEI_B}","2026-11-16",""`), rows[2]);
  assert.equal(rows[3], '"Persona Sin Telefono","p2@equipo.test","2026-11-16","v1","","",""');
  const rep = await s.call('GET', `${API}/site/${id}/record.csv`, undefined, { cookie: ana.cookie });
  assert.deepEqual([rep.status, rep.json.error], [403, 'manager_only']);
  const none = await s.call('GET', `${API}/site/${id}/record.csv`);
  assert.equal(none.status, 401);
});

test('record.csv is 404 for a practice site and for a site that is not there', async (t) => {
  const { s, a, site } = await setup(t);
  const practice = await site({ practice: true });
  assert.equal((await s.call('GET', `${API}/site/${practice.id}/record.csv`, undefined, { cookie: a.cookie })).status, 404);
  assert.equal((await s.call('GET', `${API}/site/s_nothere01/record.csv`, undefined, { cookie: a.cookie })).status, 404);
});

test('siteRecord keeps a returned phone: one row per pair, returnedOn empty while held', () => {
  const T = (d) => `2026-11-${d}T15:00:00Z`;
  const ev = [
    { type: 'rep.created', t: T(10), id: 'r1', handle: 'r1', name: 'Rep Uno', role: 'rep', country: 'PA', tz: 'America/Panama' },
    { type: 'site', id: 's_aaaaaaaa', rep: 'r1', lead: { name: 'Taller Uno' }, t: T(11) },
    { type: 'worker.added', t: T(11), id: 'w_aaaaaaaa', siteId: 's_aaaaaaaa', name: 'Persona A', email: 'a@equipo.test' },
    { type: 'worker.consent', t: T(12), workerId: 'w_aaaaaaaa', v: 'v1', ext: 'jpg', form: 'v1' },
    { type: 'worker.phone', t: T(13), workerId: 'w_aaaaaaaa', imei: IMEI_A },
    { type: 'worker.phone.returned', t: T(14), workerId: 'w_aaaaaaaa' },
    { type: 'worker.phone', t: T(15), workerId: 'w_aaaaaaaa', imei: IMEI_B },
  ];
  const rows = siteRecord(ev.reduce((x, e) => applyEvent(x, e), emptyState()), 's_aaaaaaaa');
  assert.deepEqual(rows.map((r) => [r.imei, r.givenOn, r.returnedOn]), [[IMEI_A, '2026-11-13', '2026-11-14'], [IMEI_B, '2026-11-15', null]]);
});

test('a practice site never appears in export, and export carries no site data', async (t) => {
  const { s, site } = await setup(t);
  await site({ practice: true, lead: { name: 'Negocio de Practica Unico' } });
  await site({ lead: { name: 'Negocio Real Unico' } });
  const r = await s.call('GET', `${API}/export`, undefined, { bearer: 'push-token' });
  assert.equal(r.status, 200);
  assert.equal(r.text.includes('Negocio de Practica Unico'), false);
  assert.equal(r.text.includes('Negocio Real Unico'), false);
  assert.equal('sites' in r.json, false);
});
