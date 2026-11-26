// Track F, F5: the business's advance is a mark a manager sets on a real site and the rep sees on the route.
// site.advance { siteId, asked, paid, by } carries the whole mark each time: a correction replaces it, both null clears
// it. No amount, no name, no bank detail is ever stored. Every placeholder here is invented.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { checkAdvance } from '../lib/team/route.mjs';

const API = '/equipo/api';
// the helper's clock: Monday 16 Nov 2026, 10:00 in Panama
const TODAY = '2026-11-16';

async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' }), lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  const before = new Set(s.lines().filter((e) => e.type === 'site').map((e) => e.id));
  await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Taller de Ejemplo' } }, { cookie: a.cookie });
  const siteId = s.lines().filter((e) => e.type === 'site' && !before.has(e.id)).at(-1).id;
  const mark = (body, cookie = mgr.cookie, id = siteId) => s.call('POST', `${API}/site/${id}`, { what: 'advance', ...body }, { cookie });
  const advances = () => s.lines().filter((e) => e.type === 'site.advance');
  const team = async () => (await s.call('GET', `${API}/team`, undefined, { cookie: mgr.cookie })).json;
  return { s, a, ana, mgr, lia, siteId, mark, advances, team };
}

test('checkAdvance: real days not after today, paid needs asked and is not before it, both null clears', () => {
  assert.deepEqual(checkAdvance({ asked: '2026-11-12', paid: null }, TODAY), { mark: { asked: '2026-11-12', paid: null } });
  assert.deepEqual(checkAdvance({ asked: '2026-11-12', paid: '2026-11-12' }, TODAY), { mark: { asked: '2026-11-12', paid: '2026-11-12' } });
  assert.deepEqual(checkAdvance({ asked: null, paid: null }, TODAY), { mark: { asked: null, paid: null } });
  assert.deepEqual(checkAdvance({}, TODAY), { mark: { asked: null, paid: null } });
  for (const asked of ['2026-02-30', '2026-11-17', '16/11/2026', 'ayer', 20261112, true]) assert.equal(checkAdvance({ asked }, TODAY).error, 'day', String(asked));
  assert.equal(checkAdvance({ asked: '2026-11-12', paid: '2026-11-17' }, TODAY).error, 'day');
  assert.equal(checkAdvance({ asked: null, paid: '2026-11-12' }, TODAY).error, 'fields');
  assert.equal(checkAdvance({ asked: '2026-11-12', paid: '2026-11-11' }, TODAY).error, 'fields');
});

test('a manager and an admin mark the advance; the event is the whole mark and nothing else', async (t) => {
  const { a, mgr, mark, advances, team, siteId } = await setup(t);
  const r = await mark({ asked: '2026-11-12', paid: null, amount: 500, name: 'Nombre Ejemplo', bank: '0000' });
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.json.sites), 'it answers the team view');
  const ev = advances()[0];
  assert.deepEqual(Object.keys(ev).filter((k) => k !== 't').sort(), ['asked', 'by', 'paid', 'siteId', 'type']);
  assert.deepEqual([ev.siteId, ev.asked, ev.paid, ev.by], [siteId, '2026-11-12', null, mgr.id]);
  assert.deepEqual((await team()).sites.find((x) => x.id === siteId).advance, { asked: '2026-11-12', paid: null });
  // a correction replaces the whole mark; the admin may too
  assert.equal((await mark({ asked: '2026-11-13', paid: '2026-11-14' }, a.cookie)).status, 200);
  assert.deepEqual((await team()).sites.find((x) => x.id === siteId).advance, { asked: '2026-11-13', paid: '2026-11-14' });
  // clearing it brings the line back to nothing
  assert.equal((await mark({ asked: null, paid: null })).status, 200);
  assert.equal((await team()).sites.find((x) => x.id === siteId).advance, null);
});

test('refusals reuse the codes there are: day for a bad day, fields for paid without asked or before it; nothing appended', async (t) => {
  const { mark, advances } = await setup(t);
  for (const [body, code] of [[{ asked: '2026-11-31' }, 'day'], [{ asked: '2026-11-20' }, 'day'], [{ asked: '2026-11-12', paid: 'mañana' }, 'day'],
    [{ asked: null, paid: '2026-11-12' }, 'fields'], [{ asked: '2026-11-12', paid: '2026-11-10' }, 'fields']]) {
    const r = await mark(body);
    assert.deepEqual([r.status, r.json.error], [400, code], JSON.stringify(body));
  }
  assert.equal(advances().length, 0);
});

test('a rep, a leader and view-as cannot write it; a voided or practice site takes none', async (t) => {
  const { s, a, ana, lia, mark, advances } = await setup(t);
  assert.equal((await mark({ asked: '2026-11-12' }, ana.cookie)).status, 403);
  assert.equal((await mark({ asked: '2026-11-12' }, lia.cookie)).status, 403);
  // view-as: a manager acting as anyone writes no manager control
  const asRep = await s.call('POST', `${API}/site/x?as=${ana.id}`, { what: 'advance', asked: '2026-11-12' }, { cookie: a.cookie });
  assert.equal(asRep.status, 403);
  // a practice site
  const prac = await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie });
  const before = new Set(s.lines().filter((e) => e.type === 'site').map((e) => e.id));
  await s.call('POST', `${API}/site`, { rep: prac.json.id, lead: { name: 'Práctica de Ejemplo' } }, { cookie: a.cookie });
  const pid = s.lines().filter((e) => e.type === 'site' && !before.has(e.id)).at(-1).id;
  const p = await mark({ asked: '2026-11-12' }, a.cookie, pid);
  assert.deepEqual([p.status, p.json.error], [409, 'practice']);
  // a voided site
  const { siteId } = await (async () => ({ siteId: s.lines().filter((e) => e.type === 'site')[0].id }))();
  await s.call('POST', `${API}/site/${siteId}`, { what: 'void' }, { cookie: a.cookie });
  assert.equal((await mark({ asked: '2026-11-12' }, a.cookie, siteId)).status, 404);
  assert.equal(advances().length, 0);
});

test('Pendientes lists the advances requested and not paid, oldest first, with the days waiting, and counts them', async (t) => {
  const { s, a, ana, mark, team, siteId } = await setup(t);
  const before = new Set(s.lines().filter((e) => e.type === 'site').map((e) => e.id));
  await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Panadería de Ejemplo' } }, { cookie: a.cookie });
  const second = s.lines().filter((e) => e.type === 'site' && !before.has(e.id)).at(-1).id;
  await mark({ asked: '2026-11-14' });
  await mark({ asked: '2026-11-10' }, undefined, second);
  let v = await team();
  assert.deepEqual(v.needs.advances.map((x) => [x.siteId, x.name, x.rep, x.asked, x.days]), [[second, 'Panadería de Ejemplo', ana.id, '2026-11-10', 6], [siteId, 'Taller de Ejemplo', ana.id, '2026-11-14', 2]]);
  await mark({ asked: '2026-11-10', paid: '2026-11-15' }, undefined, second);
  v = await team();
  assert.deepEqual(v.needs.advances.map((x) => x.siteId), [siteId]);
  // a voided site lists no advance
  await s.call('POST', `${API}/site/${siteId}`, { what: 'void' }, { cookie: a.cookie });
  assert.deepEqual((await team()).needs.advances, []);
});

test('the rep sees the mark on the route, and nothing when there is none', async (t) => {
  const { s, a, ana, mark } = await setup(t);
  // a contract the rep logged, then the site a manager opens for that business
  await s.call('POST', `${API}/log`, logBody('advance-log-0001', { kind: 'contract', lead: { name: 'Carpintería de Ejemplo', zone: 'Centro' } }), { cookie: ana.cookie });
  const lead = s.lines().find((e) => e.type === 'log' && e.id === 'advance-log-0001').lead;
  const before = new Set(s.lines().filter((e) => e.type === 'site').map((e) => e.id));
  await s.call('POST', `${API}/site`, { rep: ana.id, lead: { id: lead.id, name: 'Carpintería de Ejemplo' } }, { cookie: a.cookie });
  const siteId = s.lines().filter((e) => e.type === 'site' && !before.has(e.id)).at(-1).id;
  const mark2 = (body) => mark(body, undefined, siteId);
  const route = async () => ((await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.routes || []).find((r) => r.site && r.site.id === siteId);
  assert.equal((await route()).site.advance, null);
  await mark2({ asked: '2026-11-12' });
  assert.deepEqual((await route()).site.advance, { asked: '2026-11-12', paid: null });
});

test('replay checks each mark again: an unknown site, a day that is not a calendar day or after its day, a rep or a leader as writer change nothing', () => {
  const state = emptyState(), t = '2026-11-16T15:00:00Z';
  applyEvent(state, { type: 'rep.created', id: 'r_mgr', handle: 'memo', email: 'memo@equipo.test', name: 'Memo Ejemplo', role: 'manager', tz: 'America/Panama', t });
  applyEvent(state, { type: 'rep.created', id: 'r_ana', handle: 'ana', email: 'ana@equipo.test', name: 'Ana Ejemplo', role: 'rep', tz: 'America/Panama', t });
  applyEvent(state, { type: 'rep.created', id: 'r_lia', handle: 'lia', email: 'lia@equipo.test', name: 'Lía Ejemplo', role: 'leader', tz: 'America/Panama', t });
  applyEvent(state, { type: 'site', id: 's_1', rep: 'r_ana', lead: { id: null, name: 'Taller de Ejemplo' }, t });
  const at = () => state.sites.get('s_1').advance || null;
  for (const e of [{ asked: '2026-02-30' }, { asked: '2026-11-17' }, { asked: null, paid: '2026-11-12' }, { asked: '2026-11-12', paid: '2026-11-11' }]) {
    applyEvent(state, { type: 'site.advance', siteId: 's_1', asked: null, paid: null, ...e, by: 'r_mgr', t });
  }
  assert.equal(at(), null);
  applyEvent(state, { type: 'site.advance', siteId: 's_1', asked: '2026-11-12', paid: null, by: 'r_ana', t });
  applyEvent(state, { type: 'site.advance', siteId: 's_1', asked: '2026-11-12', paid: null, by: 'r_lia', t });
  applyEvent(state, { type: 'site.advance', siteId: 's_nobody', asked: '2026-11-12', paid: null, by: 'r_mgr', t });
  assert.equal(at(), null);
  applyEvent(state, { type: 'site.advance', siteId: 's_1', asked: '2026-11-12', paid: null, by: 'r_mgr', t });
  assert.deepEqual(at(), { asked: '2026-11-12', paid: null });
  applyEvent(state, { type: 'site.advance', siteId: 's_1', asked: null, paid: null, by: 'r_mgr', t });
  assert.equal(at(), null);
  // a practice site takes none
  applyEvent(state, { type: 'site', id: 's_p', rep: 'r_ana', lead: { id: null, name: 'Práctica' }, practice: true, t });
  applyEvent(state, { type: 'site.advance', siteId: 's_p', asked: '2026-11-12', paid: null, by: 'r_mgr', t });
  assert.equal(state.sites.get('s_p').advance || null, null);
});

test('an advance marked on a site that is then voided shows nowhere: not in Pendientes, not on the team\'s sites, not on the rep\'s route', async (t) => {
  const { s, a, ana, mark, team } = await setup(t);
  await s.call('POST', `${API}/log`, logBody('advance-log-0002', { kind: 'contract', lead: { name: 'Vidriería de Ejemplo', zone: 'Centro' } }), { cookie: ana.cookie });
  const lead = s.lines().find((e) => e.type === 'log' && e.id === 'advance-log-0002').lead;
  const before = new Set(s.lines().filter((e) => e.type === 'site').map((e) => e.id));
  await s.call('POST', `${API}/site`, { rep: ana.id, lead: { id: lead.id, name: 'Vidriería de Ejemplo' } }, { cookie: a.cookie });
  const siteId = s.lines().filter((e) => e.type === 'site' && !before.has(e.id)).at(-1).id;
  const routeSite = async () => ((await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.routes || []).map((r) => r.site).find((x) => x && x.id === siteId) || null;
  assert.equal((await mark({ asked: '2026-11-12' }, undefined, siteId)).status, 200);
  // marked: it shows in all three places
  assert.ok((await team()).needs.advances.some((x) => x.siteId === siteId));
  assert.deepEqual((await team()).sites.find((x) => x.id === siteId).advance, { asked: '2026-11-12', paid: null });
  assert.deepEqual((await routeSite()).advance, { asked: '2026-11-12', paid: null });
  // voided: it shows nowhere
  assert.equal((await s.call('POST', `${API}/site/${siteId}`, { what: 'void' }, { cookie: a.cookie })).status, 200);
  const v = await team();
  assert.deepEqual(v.needs.advances.filter((x) => x.siteId === siteId), []);
  assert.equal(v.sites.find((x) => x.id === siteId), undefined, 'the team\'s sites no longer list it');
  assert.equal(await routeSite(), null, 'the rep\'s route no longer carries it');
});
