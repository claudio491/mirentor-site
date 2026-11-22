// The site's route, for the rep: six stops from an interested business to a site that records, read from the log by one
// pure function (routeOf), and the server rules around it. A rep opens a site only for themself and only for a business
// whose contract signature a manager confirmed. While a manager acts as the practice rep, the route can confirm the
// practice rep's own contract, phones and install, so it can be shown end to end; for a real rep those do not exist.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { routeOf, routesOf, teamRoutes, STOPS } from '../lib/team/route.mjs';
import { start, logBody } from './team-helper.mjs';

const replay = (events) => events.reduce((s, e) => applyEvent(s, e), emptyState());
const T = (d, h = 15) => `2026-11-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00Z`;
const rep = (id, over = {}) => ({ type: 'rep.created', t: T(1), id, handle: id, name: `Rep ${id}`, role: 'rep', country: 'PA', tz: 'America/Panama', ...over });
const LEAD = { id: 'APP-0001', name: 'Panadería La Espiga', zone: 'Centro' };
const log = (id, kind, over = {}) => ({ type: 'log', t: T(10), id, rep: 'r1', lead: LEAD, kind, ...over });
const confirm = (logId, what, t = T(12)) => ({ type: 'confirm', t, logId, what, by: 'boss' });
const site = (over = {}) => ({ type: 'site', t: T(14), id: 's_route0001', rep: 'r1', lead: { id: LEAD.id, name: LEAD.name }, city: 'Panama City', eligible: 8, ...over });
const statuses = (r) => r.stops.map((s) => s.status);
const base = [rep('r1'), rep('boss', { role: 'manager' })];

test('six stops in order', () => {
  assert.deepEqual(STOPS, ['interested', 'sent', 'signed', 'site', 'phones', 'install']);
});

test('nothing yet: the first stop is the one to do, the rest come later', () => {
  const r = routeOf(replay(base), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['now', 'later', 'later', 'later', 'later', 'later']);
  assert.equal(r.at, 0);
  assert.equal(r.stops[0].who, 'rep');
  assert.equal(r.contract, null); assert.equal(r.site, null);
});

test('a talk without a meeting still waits on the meeting', () => {
  const r = routeOf(replay([...base, log('l-talk-0001', 'talk')]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['now', 'later', 'later', 'later', 'later', 'later']);
  assert.equal(r.lead.name, LEAD.name);
});

test('meeting only: interested is done with its date, sending the contract is the one to do', () => {
  const r = routeOf(replay([...base, log('l-meet-0001', 'meeting')]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'now', 'later', 'later', 'later', 'later']);
  assert.equal(r.stops[0].at, T(10));
  assert.deepEqual([r.at, r.stops[1].who], [1, 'rep']);
});

test('contract sent, unconfirmed: stop 2 waits on a manager', () => {
  const r = routeOf(replay([...base, log('l-meet-0001', 'meeting'), log('l-cont-0001', 'contract', { t: T(11) })]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'wait', 'later', 'later', 'later', 'later']);
  assert.deepEqual([r.at, r.stops[1].who, r.stops[1].since], [1, 'manager', T(11)]);
  assert.deepEqual(r.contract, { logId: 'l-cont-0001', t: T(11), sent: null, signed: null });
});

test('signed, unconfirmed: the sending is confirmed, the signature waits on a manager', () => {
  const r = routeOf(replay([...base, log('l-meet-0001', 'meeting'), log('l-cont-0001', 'contract'), confirm('l-cont-0001', 'contract_sent', T(12))]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'wait', 'later', 'later', 'later']);
  assert.equal(r.stops[1].at, T(12));
  assert.deepEqual([r.at, r.stops[2].who], [2, 'manager']);
});

test('signed and confirmed: opening the site is the rep\'s to do', () => {
  const r = routeOf(replay([...base, log('l-meet-0001', 'meeting'), log('l-cont-0001', 'contract'), confirm('l-cont-0001', 'contract_sent'), confirm('l-cont-0001', 'contract_signed', T(13))]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'now', 'later', 'later']);
  assert.equal(r.stops[2].at, T(13));
  assert.deepEqual([r.at, r.stops[3].who], [3, 'rep']);
});

const signed = [...base, log('l-meet-0001', 'meeting'), log('l-cont-0001', 'contract'), confirm('l-cont-0001', 'contract_sent'), confirm('l-cont-0001', 'contract_signed', T(13))];

test('site opened, no phones: the phones wait on a manager', () => {
  const r = routeOf(replay([...signed, site()]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'done', 'wait', 'later']);
  assert.equal(r.stops[3].at, T(14));
  assert.deepEqual([r.at, r.stops[4].who], [4, 'manager']);
  assert.equal(r.site.id, 's_route0001');
});

test('phones arrived: the install is the rep\'s to do, and the phones carry the day they were marked', () => {
  const r = routeOf(replay([...signed, site(), { type: 'site.phones', t: T(15), siteId: 's_route0001', count: 6 }]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'done', 'done', 'now']);
  assert.equal(r.stops[4].at, T(15));
  assert.deepEqual([r.at, r.stops[5].who, r.site.phones], [5, 'rep', 6]);
});

test('install closed, unconfirmed: the install waits on a manager', () => {
  const r = routeOf(replay([...signed, site(), { type: 'site.phones', t: T(15), siteId: 's_route0001', count: 6 }, { type: 'install.close', t: T(16), siteId: 's_route0001' }]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'done', 'done', 'wait']);
  assert.deepEqual([r.at, r.stops[5].who, r.stops[5].since], [5, 'manager', T(16)]);
});

test('installed: every stop is done and the route is complete', () => {
  const r = routeOf(replay([...signed, site(), { type: 'site.phones', t: T(15), siteId: 's_route0001', count: 6 }, { type: 'install.close', t: T(16), siteId: 's_route0001' },
    { type: 'site.step', t: T(17), siteId: 's_route0001', what: 'installed' }]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.equal(r.stops[5].at, T(17));
  assert.deepEqual([r.at, r.complete], [6, true]);
});

test('a business with two contract logs uses the latest', () => {
  const r = routeOf(replay([...base, log('l-cont-0001', 'contract', { t: T(10) }), confirm('l-cont-0001', 'contract_sent'),
    log('l-cont-0002', 'contract', { t: T(18) })]), 'r1', LEAD.id);
  assert.equal(r.contract.logId, 'l-cont-0002');
  assert.deepEqual(statuses(r).slice(0, 3), ['done', 'wait', 'later']);
});

test('a voided contract does not count, and another rep\'s logs and sites are not this rep\'s route', () => {
  const s = replay([...base, rep('r2'), log('l-cont-0001', 'contract'), { type: 'log.void', t: T(11), logId: 'l-cont-0001', by: 'boss' },
    log('l-other-001', 'meeting', { rep: 'r2' }), site({ rep: 'r2' })]);
  assert.deepEqual(statuses(routeOf(s, 'r1', LEAD.id)), ['now', 'later', 'later', 'later', 'later', 'later']);
  assert.deepEqual(statuses(routeOf(s, 'r2', LEAD.id)).slice(0, 5), ['done', 'done', 'done', 'done', 'wait']);
});

test('a site opened by a manager with no contract on the board passes the stops before it', () => {
  const r = routeOf(replay([...base, site()]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'done', 'wait', 'later']);
  assert.equal(r.stops[0].at, null);
});

test('a practice rep\'s route says so', () => {
  const s = replay([rep('boss', { role: 'admin' }), { type: 'rep.practice', t: T(1), id: 'rp', handle: 'prac', name: 'Práctica', tz: 'America/Panama' }, log('l-prac-0001', 'meeting', { rep: 'rp' })]);
  assert.equal(routeOf(s, 'rp', LEAD.id).practice, true);
  assert.equal(routeOf(s, 'boss', LEAD.id).practice, false);
});

test('my sites on the way: every business at stop 2 or further, furthest first; the manager\'s list puts what waits on a manager first and leaves practice out', () => {
  const B = { id: 'APP-0002', name: 'Taller Dos', zone: 'Norte' }, C = { id: 'APP-0003', name: 'Café Tres', zone: 'Sur' };
  const s = replay([...signed, rep('r2'), { type: 'rep.practice', t: T(1), id: 'rp', handle: 'prac', name: 'Práctica', tz: 'America/Panama' },
    log('l-b-talk-01', 'talk', { lead: B }), log('l-c-meet-01', 'meeting', { lead: C }),
    log('l-r2-cont-1', 'contract', { rep: 'r2', lead: B }), log('l-rp-cont-1', 'contract', { rep: 'rp', lead: C })]);
  const mine = routesOf(s, 'r1');
  assert.deepEqual(mine.map((r) => [r.lead.id, r.at]), [[LEAD.id, 3], [C.id, 1]]);   // the talk alone is not on the way
  const all = teamRoutes(s);
  assert.deepEqual(all.map((r) => [r.rep, r.lead.id]), [['r2', B.id], ['r1', LEAD.id], ['r1', C.id]]);
  assert.equal(all[0].stops[all[0].at].who, 'manager');
});

// ---- the server ----
const API = '/equipo/api';
const SITE_FIELDS = { city: 'Panama City', eligible: 9, coordinator: { name: 'Coordinadora Prueba', phone: '6000-0000' } };

async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto');
  return { s, a, ana, beto };
}
/** A contract logged by `who` for a new business; returns its log id and the business id. */
async function contract(s, who, id = 'contract-log-0001', name = 'Panadería La Espiga') {
  const r = await s.call('POST', `${API}/log`, logBody(id, { kind: 'contract', lead: { name, zone: 'Centro' } }), { cookie: who.cookie });
  assert.equal(r.status, 200);
  return { logId: id, lead: s.lines().find((e) => e.type === 'log' && e.id === id).lead.id };
}
const confirmAs = (s, cookie, logId, what) => s.call('POST', `${API}/confirm`, { logId, what }, { cookie });
const openSite = (s, cookie, body, as = '') => s.call('POST', `${API}/route/site${as}`, body, { cookie });

test('a rep reads the route of a business, and their screens carry the businesses on the way', async (t) => {
  const { s, ana } = await setup(t);
  const c = await contract(s, ana);
  const got = await s.call('GET', `${API}/route?lead=${encodeURIComponent(c.lead)}`, undefined, { cookie: ana.cookie });
  assert.equal(got.status, 200);
  assert.deepEqual(got.json.route.stops.map((x) => x.status), ['done', 'wait', 'later', 'later', 'later', 'later']);
  const me = await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie });
  assert.deepEqual(me.json.routes.map((r) => r.lead.id), [c.lead]);
});

test('a rep opening a site for an unconfirmed contract is refused, and nothing is appended', async (t) => {
  const { s, a, ana } = await setup(t);
  const c = await contract(s, ana);
  const before = s.lines().length;
  const r1 = await openSite(s, ana.cookie, { lead: c.lead, ...SITE_FIELDS });
  assert.deepEqual([r1.status, r1.json.error], [403, 'contract_unsigned']);
  await confirmAs(s, a.cookie, c.logId, 'contract_sent');
  const r2 = await openSite(s, ana.cookie, { lead: c.lead, ...SITE_FIELDS });
  assert.deepEqual([r2.status, r2.json.error], [403, 'contract_unsigned']);
  assert.equal(s.lines().filter((e) => e.type === 'site').length, 0);
  assert.equal(s.lines().length, before + 1);   // only the confirmation
});

test('a rep opens the site for a confirmed signature: linked to the business, named from it, paid like any site', async (t) => {
  const { s, a, ana } = await setup(t);
  const c = await contract(s, ana);
  await confirmAs(s, a.cookie, c.logId, 'contract_sent'); await confirmAs(s, a.cookie, c.logId, 'contract_signed');
  const r = await openSite(s, ana.cookie, { id: 's_rep-open-0001', lead: c.lead, ...SITE_FIELDS, rep: 'someone-else', lead_name: 'ignored' });
  assert.equal(r.status, 200);
  const ev = s.lines().find((e) => e.type === 'site');
  const me = await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie });
  assert.deepEqual([ev.id, ev.rep, ev.lead, ev.city, ev.eligible, ev.coordinator, ev.by], ['s_rep-open-0001', me.json.me.id, { id: c.lead, name: 'Panadería La Espiga' }, 'Panama City', 9, SITE_FIELDS.coordinator, me.json.me.id]);
  assert.equal(ev.practice, undefined);
  assert.ok(me.json.ledger.some((e) => e.code === 'site_signed' && e.status === 'earned'), 'the site pays through the same path');
  assert.deepEqual(r.json.me.routes[0].stops.map((x) => x.status), ['done', 'done', 'done', 'done', 'wait', 'later']);
  // the same form again is the same site; another id for the same business is refused
  assert.equal((await openSite(s, ana.cookie, { id: 's_rep-open-0001', lead: c.lead, ...SITE_FIELDS })).status, 200);
  const again = await openSite(s, ana.cookie, { id: 's_rep-open-0002', lead: c.lead, ...SITE_FIELDS });
  assert.deepEqual([again.status, again.json.error], [409, 'site_exists']);
  assert.equal(s.lines().filter((e) => e.type === 'site').length, 1);
});

test('a rep cannot open a site for another rep\'s business, nor with bad fields', async (t) => {
  const { s, a, ana, beto } = await setup(t);
  const c = await contract(s, ana);
  await confirmAs(s, a.cookie, c.logId, 'contract_sent'); await confirmAs(s, a.cookie, c.logId, 'contract_signed');
  const other = await openSite(s, beto.cookie, { lead: c.lead, ...SITE_FIELDS });
  assert.deepEqual([other.status, other.json.error], [403, 'contract_unsigned']);
  const viewAs = await openSite(s, a.cookie, { lead: c.lead, ...SITE_FIELDS }, `?as=${encodeURIComponent((await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.me.id)}`);
  assert.deepEqual([viewAs.status, viewAs.json.error], [403, 'read_only']);
  assert.deepEqual((await openSite(s, ana.cookie, { lead: c.lead, eligible: -1 })).json.error, 'fields');
  assert.deepEqual((await openSite(s, ana.cookie, { lead: c.lead, coordinator: { name: 'X', phone: '1' } })).json.error, 'fields');
  assert.deepEqual((await openSite(s, ana.cookie, {})).json.error, 'lead');
  assert.equal(s.lines().filter((e) => e.type === 'site').length, 0);
  // a manager still opens any site as before
  assert.equal((await s.call('POST', `${API}/site`, { rep: (await s.call('GET', `${API}/me`, undefined, { cookie: beto.cookie })).json.me.id, lead: { name: 'Taller Libre' } }, { cookie: a.cookie })).status, 200);
});

test('the practice controls of the route: only while a manager acts as the practice rep, only on its own business and site', async (t) => {
  const { s, a, ana } = await setup(t);
  const P = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  const as = `?as=${encodeURIComponent(P)}`;
  const adminId = (await s.call('GET', `${API}/me`, undefined, { cookie: a.cookie })).json.viewer.id;
  const meet = await s.call('POST', `${API}/log${as}`, logBody('prac-meet-0001', { kind: 'meeting', lead: { name: 'Negocio de Prueba', zone: 'Centro' } }), { cookie: a.cookie });
  const lead = meet.json.me.recentLeads[0].id;
  await s.call('POST', `${API}/log${as}`, logBody('prac-cont-0001', { kind: 'contract', lead: { id: lead } }), { cookie: a.cookie });
  const real = await contract(s, ana, 'contract-log-0009', 'Taller Real');

  // a real rep, and the admin on their own screens, have no such routes
  for (const [cookie, path, body] of [[ana.cookie, 'route/confirm', { lead: real.lead, what: 'contract_sent' }], [a.cookie, 'route/confirm', { lead, what: 'contract_sent' }],
    [ana.cookie, 'route/phones', { lead: real.lead, count: 3 }], [ana.cookie, 'route/installed', { lead: real.lead }]]) {
    const r = await s.call('POST', `${API}/${path}`, body, { cookie });
    assert.deepEqual([r.status, r.json.error], [403, 'practice_only'], `${path}`);
  }
  // acting, on a business that is not the practice rep's own: nothing to confirm
  const foreign = await s.call('POST', `${API}/route/confirm${as}`, { lead: real.lead, what: 'contract_sent' }, { cookie: a.cookie });
  assert.equal(foreign.status, 404);
  assert.equal(s.lines().some((e) => e.type === 'confirm'), false);

  // the order holds: the signature only after the sending
  assert.deepEqual((await s.call('POST', `${API}/route/confirm${as}`, { lead, what: 'contract_signed' }, { cookie: a.cookie })).json.error, 'order');
  for (const what of ['contract_sent', 'contract_signed']) assert.equal((await s.call('POST', `${API}/route/confirm${as}`, { lead, what }, { cookie: a.cookie })).status, 200);
  const confirms = s.lines().filter((e) => e.type === 'confirm');
  assert.deepEqual(confirms.map((e) => [e.logId, e.what, e.by]), [['prac-cont-0001', 'contract_sent', adminId], ['prac-cont-0001', 'contract_signed', adminId]]);

  const opened = await openSite(s, a.cookie, { id: 's_prac-route-01', lead, ...SITE_FIELDS }, as);
  assert.equal(opened.status, 200);
  const ev = s.lines().find((e) => e.type === 'site');
  assert.deepEqual([ev.rep, ev.practice, ev.by, ev.lead.id], [P, true, adminId, lead]);

  // the install cannot be confirmed before it is closed, then the phones and the install are marked as a manager would
  const ph = await s.call('POST', `${API}/route/phones${as}`, { lead, count: 2 }, { cookie: a.cookie });
  assert.equal(ph.status, 200);
  assert.deepEqual(s.lines().filter((e) => e.type === 'site.phones').map((e) => [e.siteId, e.count, e.by]), [['s_prac-route-01', 2, adminId]]);
  assert.equal((await s.call('POST', `${API}/route/phones${as}`, { lead, count: 0 }, { cookie: a.cookie })).json.error, 'fields');
  await s.call('POST', `${API}/install/s_prac-route-01/workers${as}`, { id: 'w_pracroute01', name: 'Persona Prueba', email: 'persona@equipo.test' }, { cookie: a.cookie });
  assert.equal((await s.call('POST', `${API}/route/installed${as}`, { lead }, { cookie: a.cookie })).json.error, 'install_not_closed');
  s.time.now += 1000;
  const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF example bytes'), Buffer.from([0xff, 0xd9])]);
  const put = await fetch(`${s.url}${API}/worker/w_pracroute01/consent${as}`, { method: 'PUT', headers: { cookie: a.cookie, 'content-type': 'image/jpeg' }, body: JPG });
  assert.equal(put.status, 200);
  await s.call('POST', `${API}/worker/w_pracroute01/phone${as}`, { imei: 'DEMO-0001' }, { cookie: a.cookie });
  await s.call('POST', `${API}/worker/w_pracroute01/clip${as}`, {}, { cookie: a.cookie });
  await s.call('POST', `${API}/install/s_prac-route-01/close${as}`, {}, { cookie: a.cookie });
  const done = await s.call('POST', `${API}/route/installed${as}`, { lead }, { cookie: a.cookie });
  assert.equal(done.status, 200);
  assert.deepEqual(s.lines().filter((e) => e.type === 'site.step').map((e) => [e.what, e.by]), [['installed', adminId]]);
  const route = done.json.me.routes.find((r) => r.lead.id === lead);
  assert.deepEqual([route.complete, route.practice], [true, true]);
  // practice is nobody's total and waits for no manager
  const team = await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie });
  assert.equal(team.json.routes.some((r) => r.rep === P), false);
});

test('a site a manager opened with no business id is that business\'s site when the name matches, accents and case aside', () => {
  const r = routeOf(replay([...signed, site({ lead: { id: null, name: 'panaderia LA espiga ' } })]), 'r1', LEAD.id);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'done', 'wait', 'later']);
  assert.equal(r.site.id, 's_route0001');
  // another rep's site, or another name, is not
  assert.equal(routeOf(replay([...signed, site({ rep: 'r2', lead: { id: null, name: LEAD.name } })]), 'r1', LEAD.id).site, null);
  assert.equal(routeOf(replay([...signed, site({ lead: { id: null, name: 'Panadería Otra' } })]), 'r1', LEAD.id).site, null);
});

test('a legacy site is complete for the route and stays out of both lists', () => {
  const s = replay([...signed, site({ legacy: true })]);
  const r = routeOf(s, 'r1', LEAD.id);
  assert.equal(r.complete, true);
  assert.deepEqual(statuses(r), ['done', 'done', 'done', 'done', 'done', 'done']);
  assert.deepEqual(routesOf(s, 'r1'), []);
  assert.deepEqual(teamRoutes(s), []);
  // one a manager opened with no business at all is out too
  const bare = replay([...base, site({ legacy: true, lead: { id: null, name: 'Sitio Antiguo' } })]);
  assert.deepEqual([routesOf(bare, 'r1'), teamRoutes(bare)], [[], []]);
});
