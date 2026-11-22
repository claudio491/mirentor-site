// The third wave's fixes. The example team shows a full week on the Monday it is presented, whether it was loaded that
// morning, past midnight or the day before (then one visible control brings it up to date, exactly and once). A real
// rep's practice site never counts as active nor earns. Voiding a site keeps what it already earned. Site rows add up to
// the week's total to the cent. Nobody claps, badges or gives a day off across the real and practice worlds. The
// practice hours path checks whose site it is. An older build loses the example team's businesses on removal.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { earnOf, mySites, publicEarn } from '../lib/team/pay.mjs';
import { exampleTeam } from '../lib/team/example.mjs';
import { exampleActions } from '../team/practice-steps.js';

const API = '/equipo/api';
const Z = (iso) => Date.parse(iso);
// Panama is UTC-5 all year.
const SUN_15 = Z('2026-11-22T20:00:00Z'), SUN_2330 = Z('2026-11-23T04:30:00Z'), MON_0030 = Z('2026-11-23T05:30:00Z'), MON_10 = Z('2026-11-23T15:00:00Z');

async function boot(t, clock) {
  const s = await start({ clock }); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  await s.call('POST', `${API}/log`, logBody('wave3-real-0001', { kind: 'talk', clientAt: new Date(clock).toISOString() }), { cookie: ana.cookie });
  const load = (who = a) => s.call('POST', `${API}/practice/example`, {}, { cookie: who.cookie });
  const team = async () => (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json;
  const asSlot = async (slot) => {
    const id = (await team()).example.find((r) => r.example === slot).id;
    return (await s.call('GET', `${API}/me?as=${id}`, undefined, { cookie: a.cookie })).json;
  };
  return { s, a, ana, load, team, asSlot };
}

/** What the Monday demo needs from Vendedor B's screens: every example rep with sites has accepted hours and earnings
 *  this week, a podium of different people, and a feed. */
function assertDemo(me, label) {
  const withSites = me.crew.filter((c) => c.sites.length);
  assert.equal(withSites.length, 3, `${label}: A, B and C have sites`);
  for (const c of withSites) {
    assert.ok(c.minutes > 0, `${label}: ${c.id} has hours this week`);
    assert.ok(c.cents > 0, `${label}: ${c.id} earns this week`);
    for (const x of c.sites) assert.ok(x.minutes > 0, `${label}: ${x.name} has hours this week`);
  }
  // three ranked (D is new), so the podium holds one: Vendedor A, ahead of B's own row, which shows its own score
  const W = me.table.week;
  assert.ok(W.podium.length >= 1 && W.ranked >= 3, `${label}: a podium (${W.podium.length}) and three ranked (${W.ranked})`);
  assert.equal(W.podium[0].first, 'Vendedor A');
  assert.ok(W.me.score > 0 && W.podium[0].score > W.me.score && W.me.place === 2, `${label}: visibly different reps (${W.podium[0].score} vs ${W.me.score})`);
  assert.equal(new Set([...W.podium, W.me, ...W.rest].map((r) => r.id)).size, 4);
  assert.ok(me.feed.length > 0, `${label}: a feed`);
  assert.ok(me.earn.week.cents > 0 && me.active.length > 0, `${label}: B's own sites earn`);
}

test('W3-1 the example team loaded on Monday 10:00 shows the week', async (t) => {
  const { load, team, asSlot } = await boot(t, MON_10);
  assert.equal((await load()).status, 200);
  const tv = await team();
  assert.equal(tv.exampleStale, false);
  assert.deepEqual(exampleActions(tv, 'admin'), ['view', 'remove']);
  assertDemo(await asSlot('B'), 'Monday 10:00');
});

test('W3-1 loaded on Sunday, on Monday the control reads "update"; one press replaces the team exactly; a second adds nothing', async (t) => {
  const { s, a, ana, load, team, asSlot } = await boot(t, SUN_15);
  await load();
  assertDemo(await asSlot('B'), 'Sunday 15:00');
  // B types a business on Sunday: it must not survive the update
  const B = (await team()).example.find((r) => r.example === 'B').id;
  assert.equal((await s.call('POST', `${API}/log?as=${B}`, logBody('wave3-prac-0001', { lead: { name: 'Negocio Practica Domingo', zone: 'Centro' }, clientAt: new Date(SUN_15).toISOString() }), { cookie: a.cookie })).status, 200);
  s.time.now = MON_10;
  const anaBefore = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).text;
  const stale = await team();
  assert.equal(stale.exampleStale, true, 'the team is from an earlier day');
  assert.deepEqual(exampleActions(stale, 'admin'), ['view', 'refresh', 'remove']);
  const at = s.lines().length;
  const r = await load();
  assert.equal(r.status, 200);
  assert.equal(r.json.exampleStale, false);
  const wrote = s.lines().slice(at).map((e) => e.type);
  assert.equal(wrote.filter((x) => x === 'practice.team.removed').length, 1);
  assert.ok(wrote.indexOf('practice.team.removed') < wrote.indexOf('rep.practice.example'), 'removed first, then loaded');
  assert.equal(wrote.filter((x) => x === 'rep.practice.example').length, 4);
  assertDemo(await asSlot('B'), 'Sunday load, Monday 10:00 after update');
  assert.equal(JSON.stringify(await asSlot('B')).includes('Negocio Practica Domingo'), false, 'the old team goes whole');
  assert.equal((await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).text, anaBefore, 'a real rep sees nothing change');
  // the same as a fresh load on Monday 10:00, event for event
  const fresh = exampleTeam({ now: new Date(MON_10).toISOString(), tz: 'America/Panama', country: 'PA', city: 'Panama City' }).events.length;
  assert.equal(s.lines().slice(at).filter((e) => e.type !== 'site.removed' && e.type !== 'practice.team.removed' && e.type !== 'lead.map').length, fresh);
  const n = s.lines().length;
  assert.equal((await load()).status, 200);
  assert.equal(s.lines().length, n, 'idempotent once up to date');
});

test('W3-1 two managers press "update" at once: one team of four, replaced once', async (t) => {
  const { s, a, load, team } = await boot(t, SUN_15);
  await load();
  const mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' });
  s.time.now = MON_10;
  const at = s.lines().length;
  const [x, y] = await Promise.all([load(), load(mgr)]);
  assert.deepEqual([x.status, y.status], [200, 200]);
  const wrote = s.lines().slice(at).map((e) => e.type);
  assert.equal(wrote.filter((v) => v === 'practice.team.removed').length, 1);
  assert.equal(wrote.filter((v) => v === 'rep.practice.example').length, 4);
  assert.equal((await team()).example.length, 4);
});

test('W3-1 the recipe does not depend on the hour: Monday 00:30 holds the same week as Monday 10:00, nothing after now', async (t) => {
  const recipe = (now) => exampleTeam({ now: new Date(now).toISOString(), tz: 'America/Panama' });
  const strip = (evs) => evs.map(({ t: _t, ...e }) => JSON.stringify(e)).sort();
  const early = recipe(MON_0030), late = recipe(MON_10);
  assert.deepEqual(strip(early.events), strip(late.events));
  for (const [now, r] of [[MON_0030, early], [MON_10, late]]) {
    assert.ok(r.events.every((e) => Date.parse(e.t) <= now), 'never a log in the future');
    assert.deepEqual(r.events.map((e) => e.t), [...r.events.map((e) => e.t)].sort(), 'in time order');
  }
  // loaded at 00:30 and looked at then, and at 10:00 (the same day: nothing to update)
  const { s, load, team, asSlot } = await boot(t, MON_0030);
  await load();
  assertDemo(await asSlot('B'), 'Monday 00:30');
  s.time.now = MON_10;
  assert.equal((await team()).exampleStale, false);
  assertDemo(await asSlot('B'), 'Monday 00:30 load, 10:00 view');
});

test('W3-1 loaded Sunday 23:30: the week shows then; on Monday it updates to the new week', async (t) => {
  const { s, load, team, asSlot } = await boot(t, SUN_2330);
  await load();
  assertDemo(await asSlot('B'), 'Sunday 23:30');
  s.time.now = MON_10;
  assert.equal((await team()).exampleStale, true);
  await load();
  assertDemo(await asSlot('B'), 'Sunday 23:30 load, Monday 10:00 after update');
});

test('W3-7 the recipe is not loaded over an id someone else already holds', async (t) => {
  const { s, a, ana, load } = await boot(t, MON_10);
  const anaId = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.viewer.id;
  assert.equal((await s.call('POST', `${API}/site`, { id: 's_ejemplo-1', rep: anaId, lead: { name: 'Sitio Real Uno' } }, { cookie: a.cookie })).status, 200);
  const at = s.lines().length;
  const r = await load();
  assert.deepEqual([r.status, r.json.error], [409, 'id_taken']);
  assert.equal(s.lines().length, at, 'nothing appended');
});

// ---- W3-2: a real rep's practice site ----
test('W3-2 a real rep\'s practice site is never active, never named to the leadership or a teammate, never earns', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto');
  const anaId = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.viewer.id;
  await s.call('POST', `${API}/pay`, { cents: 100 }, { cookie: a.cookie });
  assert.equal((await s.call('POST', `${API}/site`, { id: 's_wave3-prac-real', rep: anaId, lead: { name: 'Sitio Practica Real' }, practice: true }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/site/s_wave3-prac-real`, { what: 'installed' }, { cookie: a.cookie })).status, 200);
  const card = (await s.call('GET', `${API}/lead`, undefined, { cookie: a.cookie })).json.cities.flatMap((c) => c.reps).find((r) => r.id === anaId);
  assert.equal(card.sites, 0);
  const mate = (await s.call('GET', `${API}/me`, undefined, { cookie: beto.cookie })).json;
  assert.deepEqual(mate.crew.find((c) => c.id === anaId).sites, []);
  assert.equal(JSON.stringify(mate).includes('Sitio Practica Real'), false);
  assert.deepEqual((await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.active, []);
  // and no hours written on it by any path ever pay: the reducer would take them, the earnings do not
  const st = emptyState(), ev = (e) => applyEvent(st, { t: '2026-11-16T15:00:00Z', ...e });
  ev({ type: 'rep.created', id: 'r_ana', handle: 'ana', email: 'ana@equipo.test', name: 'Ana Prueba', role: 'rep', tz: 'America/Panama' });
  ev({ type: 'pay.rate', cents: 100, from: '2026-11-16' });
  ev({ type: 'site', id: 's_p', rep: 'r_ana', lead: { name: 'Sitio Practica' }, practice: true });
  ev({ type: 'site.step', siteId: 's_p', what: 'installed' });
  ev({ type: 'site.hours', siteId: 's_p', week: '2026-11-16', accepted: 600 });
  const r = st.reps.get('r_ana');
  assert.deepEqual([earnOf(st, r, '2026-11-16').minutes, earnOf(st, r, '2026-11-16').cents, mySites(st, r, '2026-11-16', '2026-11-09').length, publicEarn(st, r, '2026-11-16').sites.length], [0, 0, 0, 0]);
});

// ---- W3-3 and W3-4: voids and cents ----
function twoSites() {
  const st = emptyState(), ev = (e) => applyEvent(st, { t: '2026-11-16T15:00:00Z', ...e });
  ev({ type: 'rep.created', id: 'r_ana', handle: 'ana', email: 'ana@equipo.test', name: 'Ana Prueba', role: 'rep', tz: 'America/Panama' });
  ev({ type: 'pay.rate', cents: 100, from: '2026-11-09' });
  for (const id of ['s_1', 's_2']) {
    ev({ type: 'site', id, rep: 'r_ana', lead: { name: `Sitio ${id}` }, t: '2026-11-09T15:00:00Z' });
    ev({ type: 'site.step', siteId: id, what: 'installed', t: '2026-11-09T16:00:00Z' });
    ev({ type: 'site.hours', siteId: id, week: '2026-11-09', accepted: 20 });
    ev({ type: 'site.hours', siteId: id, week: '2026-11-16', accepted: 20 });
  }
  return { st, ev, ana: st.reps.get('r_ana') };
}

test('W3-4 site rows add up to the week total, to the cent (largest remainder)', () => {
  const { st, ana } = twoSites();
  const rows = mySites(st, ana, '2026-11-16', '2026-11-09'), total = earnOf(st, ana, '2026-11-16').cents;
  assert.equal(total, 67);
  assert.deepEqual(rows.map((x) => x.cents), [34, 33]);
  assert.equal(rows.reduce((a, x) => a + x.cents, 0), total);
});

test('W3-3 voiding a site keeps what it earned in the weeks before the void and in the week of the void', () => {
  const { st, ev, ana } = twoSites();
  const before = [earnOf(st, ana, '2026-11-09'), earnOf(st, ana, '2026-11-16')].map((e) => [e.minutes, e.cents]);
  ev({ type: 'site.void', siteId: 's_2', t: '2026-11-18T15:00:00Z' });   // Wednesday of the second week
  assert.deepEqual([earnOf(st, ana, '2026-11-09'), earnOf(st, ana, '2026-11-16')].map((e) => [e.minutes, e.cents]), before, 'nothing earned is erased');
  // the site is no longer active; this week's share shows apart, so the rows still add up to the total
  const rows = mySites(st, ana, '2026-11-16', '2026-11-09'), wk = earnOf(st, ana, '2026-11-16');
  assert.deepEqual(rows.map((x) => x.id), ['s_1']);
  assert.deepEqual(wk.gone, { minutes: 20, cents: 33 });
  assert.equal(rows.reduce((a, x) => a + x.cents, 0) + wk.gone.cents, wk.cents);
  assert.deepEqual(publicEarn(st, ana, '2026-11-16').gone, { minutes: 20, cents: 33 });
  // a week after the void: the site pays nothing, whatever the log says
  ev({ type: 'site.hours', siteId: 's_2', week: '2026-11-23', accepted: 600 });
  ev({ type: 'site.hours', siteId: 's_1', week: '2026-11-23', accepted: 60 });
  assert.deepEqual([earnOf(st, ana, '2026-11-23').minutes, earnOf(st, ana, '2026-11-23').cents, earnOf(st, ana, '2026-11-23').gone], [60, 100, undefined]);
});

// ---- W3-6: across worlds ----
test('W3-6 nobody claps, badges or gives a day off across the real and the practice worlds', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto');
  await s.call('POST', `${API}/log`, logBody('wave3-real-0002'), { cookie: beto.cookie });
  const team = (await s.call('POST', `${API}/practice/example`, {}, { cookie: a.cookie })).json;
  const B = team.example.find((r) => r.example === 'B').id;
  const exLine = (await s.call('GET', `${API}/me?as=${B}`, undefined, { cookie: a.cookie })).json.feed.find((f) => !f.mine).id;
  const realLine = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.feed[0].id;
  const at = s.lines().length;
  // a real rep guessing an example line's id
  const r1 = await s.call('POST', `${API}/kudos`, { target: exLine }, { cookie: ana.cookie });
  assert.deepEqual([r1.status, r1.json.error], [400, 'target']);
  // the practice world clapping a real line
  assert.equal((await s.call('POST', `${API}/kudos?as=${B}`, { target: realLine }, { cookie: a.cookie })).status, 403);
  // a manager not acting: no badge and no day off for an example rep
  assert.deepEqual([(await s.call('POST', `${API}/badge`, { rep: B, text: 'Bien hecho' }, { cookie: a.cookie })).json.error], ['practice']);
  assert.deepEqual([(await s.call('POST', `${API}/dayoff`, { scope: B, date: '2026-11-17' }, { cookie: a.cookie })).json.error], ['practice']);
  assert.equal(s.lines().length, at, 'nothing appended');
  // the real ones still work
  assert.equal((await s.call('POST', `${API}/kudos`, { target: realLine }, { cookie: ana.cookie })).status, 200);
});

// ---- W3-8: the practice hours path checks whose site it is ----
test('W3-8 acting as Vendedor B, hours on Vendedor A\'s site are refused', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const team = (await s.call('POST', `${API}/practice/example`, {}, { cookie: a.cookie })).json;
  const B = team.example.find((r) => r.example === 'B').id;
  const at = s.lines().length;
  const r = await s.call('POST', `${API}/route/hours?as=${B}`, { site: 's_ejemplo-1', week: '2026-11-16', accepted: 60 }, { cookie: a.cookie });
  assert.deepEqual([r.status, r.json.error], [404, 'site']);
  assert.equal(s.lines().length, at);
  // B's own site takes them
  const mine = (await s.call('GET', `${API}/me?as=${B}`, undefined, { cookie: a.cookie })).json.active[0].id;
  assert.equal((await s.call('POST', `${API}/route/hours?as=${B}`, { site: mine, week: '2026-11-16', accepted: 60 }, { cookie: a.cookie })).status, 200);
});

// ---- W3-5: the wave 2 build replaying the log ----
/** What the wave 2 build (7ab9a94) does with businesses: lead.added and practice.lead.added add one, lead.map drops the
 *  temporary id. It does not know rep.practice.example or practice.team.removed. */
function wave2Leads(events) {
  const appLeads = new Map();
  for (const e of events) {
    if (e.type === 'lead.added' && e.lead && typeof e.lead.id === 'string') appLeads.set(e.lead.id, { ...e.lead });
    if (e.type === 'practice.lead.added' && e.lead && typeof e.lead.id === 'string') appLeads.set(e.lead.id, { ...e.lead, practice: true });
    if (e.type === 'lead.map') appLeads.delete(e.temp);
  }
  return [...appLeads.values()];
}

test('W3-5 the wave 2 build keeps no example team business after removal; the real ones stay', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  await s.call('POST', `${API}/log`, logBody('wave3-real-0003', { lead: { name: 'Negocio Real Nuevo', zone: 'Centro' } }), { cookie: ana.cookie });
  const team = (await s.call('POST', `${API}/practice/example`, {}, { cookie: a.cookie })).json;
  const B = team.example.find((r) => r.example === 'B').id;
  await s.call('POST', `${API}/log?as=${B}`, logBody('wave3-prac-0002', { lead: { name: 'Negocio Practica B', zone: 'Centro' } }), { cookie: a.cookie });
  assert.deepEqual(wave2Leads(s.lines()).map((l) => l.company).sort(), ['Negocio Practica B', 'Negocio Real Nuevo']);
  const realMe = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).text;
  await s.call('POST', `${API}/practice/example/remove`, {}, { cookie: a.cookie });
  assert.deepEqual(wave2Leads(s.lines()).map((l) => l.company), ['Negocio Real Nuevo']);
  assert.equal((await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).text, realMe, 'this build reads the same');
});
