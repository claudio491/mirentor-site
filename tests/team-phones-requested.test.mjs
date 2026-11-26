// A site says how many phones it needs when it is opened; each shipment adds to the phones that arrived; the old count
// stays as the correction that sets the total. What is owed is what was asked and has not arrived.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { phonesOf } from '../lib/team/install.mjs';
import { teamView } from '../lib/team/view.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const LEADS = [{ id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New' }, { id: 'PA-0002', company: 'Taller Dos', city: 'Panama City', zone: 'Centro', stage: 'New' }];
const SITE = 's_phones-site-01';

test('two shipments add up, the total stays a correction, and a voided site owes nothing', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose'), lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const replay = () => { const st = emptyState(); for (const e of s.lines()) applyEvent(st, e); return st; };
  const site = () => replay().sites.get(SITE);
  const route = async (who = mario) => { const r = await s.call('GET', `${API}/route?lead=PA-0001`, undefined, { cookie: who.cookie }); assert.equal(r.status, 200, r.text); return r.json.route; };
  const manage = (body) => s.call('POST', `${API}/site/${SITE}`, body, { cookie: a.cookie });

  // opening asks how many phones it needs: the site, then the request, never inside the site event
  const open = { id: SITE, rep: mario.id, lead: { id: 'PA-0001', name: 'Taller Uno' } };
  for (const request of [0, 501, '30', 2.5]) {
    const before = s.lines().length, r = await s.call('POST', `${API}/site`, { ...open, request }, { cookie: a.cookie });
    assert.deepEqual([r.status, r.json.error, s.lines().length], [400, 'fields', before], String(request));
  }
  let r = await s.call('POST', `${API}/site`, { ...open, request: 30 }, { cookie: a.cookie });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(s.lines().slice(-2).map((e) => e.type), ['site', 'site.request']);
  assert.deepEqual([s.lines().at(-1).siteId, s.lines().at(-1).count, 'request' in s.lines().at(-2)], [SITE, 30, false]);
  assert.deepEqual(phonesOf(site()), { requested: 30, arrived: null, owed: 30 });
  assert.deepEqual([(await route()).site.requested, (await route()).site.phones], [30, null]);
  const listed = r.json.sites.find((x) => x.id === SITE);
  assert.deepEqual([listed.requested, listed.owed], [30, 30]);

  // two shipments add up; the phones stop is done from the first
  const first = new Date(s.time.now).toISOString();
  assert.equal((await manage({ what: 'arrived', count: 4 })).status, 200);
  s.time.now += 3600000;
  const between = new Date(s.time.now - 1800000).toISOString();
  r = await manage({ what: 'arrived', count: 6 });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(s.lines().slice(-2).map((e) => [e.type, e.count]), [['site.phones.added', 4], ['site.phones.added', 6]]);
  let way = await route();
  assert.deepEqual([way.site.phones, way.site.requested, way.stops.find((x) => x.key === 'phones').status], [10, 30, 'done']);
  assert.equal(phonesOf(site()).owed, 20);
  assert.equal(site().phonesAt, first);
  assert.deepEqual(phonesOf(site(), between), { requested: 30, arrived: 4, owed: 26 });
  assert.deepEqual([r.json.sites.find((x) => x.id === SITE).owed, r.json.sites.find((x) => x.id === SITE).phones], [20, 10]);

  // the count is a correction of the total; a later shipment adds to it
  assert.equal((await manage({ what: 'phones', count: 8 })).status, 200);
  assert.deepEqual([site().phones, phonesOf(site()).owed], [8, 22]);
  assert.equal((await manage({ what: 'arrived', count: 2 })).status, 200);
  assert.deepEqual([site().phones, site().phonesAt, phonesOf(site())], [10, first, { requested: 30, arrived: 10, owed: 20 }]);

  // a count that is not 1 to 500 is refused and writes nothing
  for (const what of ['request', 'arrived']) {
    for (const count of [0, 501, '30', 2.5]) {
      const before = s.lines().length, bad = await manage({ what, count });
      assert.deepEqual([bad.status, bad.json.error, s.lines().length], [400, 'fields', before], `${what} ${count}`);
    }
  }
  assert.equal((await manage({ what: 'request', count: 25 })).status, 200);
  assert.deepEqual(phonesOf(site()), { requested: 25, arrived: 10, owed: 15 });

  // the site's rep changes the request from the route; another rep has no site there; a leader writes nothing
  r = await s.call('POST', `${API}/route/request`, { lead: 'PA-0001', count: 35 }, { cookie: mario.cookie });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.me, 'the rep\'s answer');
  assert.equal((await route()).site.requested, 35);
  for (const count of [0, 501, '30', 2.5]) {
    const before = s.lines().length, bad = await s.call('POST', `${API}/route/request`, { lead: 'PA-0001', count }, { cookie: mario.cookie });
    assert.deepEqual([bad.status, bad.json.error, s.lines().length], [400, 'fields', before], String(count));
  }
  const other = await s.call('POST', `${API}/route/request`, { lead: 'PA-0001', count: 35 }, { cookie: jose.cookie });
  assert.deepEqual([other.status, other.json.error], [404, 'site']);
  const none = await s.call('POST', `${API}/route/request`, { lead: 'PA-0002', count: 5 }, { cookie: mario.cookie });
  assert.deepEqual([none.status, none.json.error], [404, 'site']);
  const leader = await s.call('POST', `${API}/route/request`, { lead: 'PA-0001', count: 35 }, { cookie: lia.cookie });
  assert.deepEqual([leader.status, leader.json.error], [403, 'read_only']);

  // a rep opening a site from the route asks too
  await s.call('POST', `${API}/log`, logBody('ph-log-00001', { lead: { id: 'PA-0002' }, kind: 'contract' }), { cookie: jose.cookie });
  for (const what of ['contract_sent', 'contract_signed']) assert.equal((await s.call('POST', `${API}/confirm`, { logId: 'ph-log-00001', what }, { cookie: a.cookie })).status, 200);
  const before = s.lines().length;
  const badOpen = await s.call('POST', `${API}/route/site`, { lead: 'PA-0002', id: 's_phones-site-02', request: 0 }, { cookie: jose.cookie });
  assert.deepEqual([badOpen.status, badOpen.json.error, s.lines().length], [400, 'fields', before]);
  assert.equal((await s.call('POST', `${API}/route/site`, { lead: 'PA-0002', id: 's_phones-site-02', request: 12 }, { cookie: jose.cookie })).status, 200);
  assert.deepEqual(s.lines().slice(-2).map((e) => [e.type, e.count ?? null]), [['site', null], ['site.request', 12]]);

  // voided: off the manager's list, and owes nothing; a hand-edited shipment changes nothing
  assert.equal((await manage({ what: 'void' })).status, 200);
  const st = replay();
  assert.equal(teamView(st, { now: new Date(s.time.now).toISOString() }).sites.some((x) => x.id === SITE), false);
  assert.equal(phonesOf(st.sites.get(SITE)).owed, 0);
  const had = structuredClone({ phones: st.sites.get(SITE).phones, hist: st.sites.get(SITE).phoneHist });
  for (const count of [-1, 0, 501, '3', 1.5]) applyEvent(st, { type: 'site.phones.added', siteId: SITE, count, t: new Date(s.time.now).toISOString() });
  applyEvent(st, { type: 'site.request', siteId: SITE, count: 'x', t: new Date(s.time.now).toISOString() });
  assert.deepEqual({ phones: st.sites.get(SITE).phones, hist: st.sites.get(SITE).phoneHist }, had);
});

test('a legacy site and a practice site owe nothing in the team\'s list, so its sum is what was asked and not delivered', () => {
  const T = (h) => `2026-11-16T${h}:00:00Z`;
  const st = emptyState();
  applyEvent(st, { type: 'rep.created', id: 'r1', handle: 'r1', email: '', name: 'Mario Paz', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: T(10) });
  for (const [id, over] of [['s_real', {}], ['s_legacy', { legacy: true }], ['s_practice', { practice: true }]]) {
    applyEvent(st, { type: 'site', id, rep: 'r1', lead: { id: null, name: id }, city: 'Panama City', t: T(11), ...over });
    applyEvent(st, { type: 'site.request', siteId: id, count: 10, t: T(12) });
    applyEvent(st, { type: 'site.phones.added', siteId: id, count: 4, t: T(13) });
  }
  const sites = teamView(st, { now: T(15), lang: 'es' }).sites;
  assert.deepEqual(sites.map((x) => [x.id, x.requested, x.owed]), [['s_real', 10, 6], ['s_legacy', 10, 0], ['s_practice', 10, 0]]);
  assert.equal(sites.reduce((sum, x) => sum + x.owed, 0), 6);
});
