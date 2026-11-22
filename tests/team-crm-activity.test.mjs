// A week of CRM activity brought into the app for reps who do not use it yet. The nightly routine sends the CRM's
// Activities rows with the service token (PUT activity); each lands as a `crm.log` event, its own type, so an older
// build neither shows nor misdates it. In this build it counts exactly like a log made in the app that day, never goes
// back out in the export, shows its day and "desde el CRM" where a time would be, and DELETE activity takes a range
// out again exactly.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { start } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { openTeamStore } from '../lib/team/store.mjs';
import { CRM_LOG_ID, activityRows, removalRange } from '../lib/team/crm.mjs';
import { dayEndIso, localDay } from '../lib/team/rules.mjs';
import { dayOnly } from '../team/moments.js';
import { DICT, LANGS } from '../team/i18n.js';

const API = '/equipo/api';
const MON = '2026-11-16', TUE = '2026-11-17', WED = '2026-11-18', THU = '2026-11-19';
const at10 = (day) => Date.parse(`${day}T15:00:00Z`);   // 10:00 in Panama
const LEADS = [
  { id: 'L-001', company: 'Negocio de ejemplo', city: 'Panama City', zone: 'Centro' },
  { id: 'L-002', company: 'Negocio de prueba', city: 'Panama City', zone: 'Centro' },
];
const L1 = { id: 'L-001', name: 'Negocio de ejemplo' }, L2 = { id: 'L-002', name: 'Negocio de prueba' };
const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Three past days of work, as the CRM would send them, for one rep. */
const week = (rep) => [
  { id: 'crm_A-0001', rep, day: MON, kind: 'talk', channel: 'visit', lead: L1 },
  { id: 'crm_A-0002', rep, day: MON, kind: 'call', channel: 'call', lead: L2 },
  { id: 'crm_A-0003', rep, day: TUE, kind: 'talk', channel: 'visit', lead: L1 },
  { id: 'crm_A-0004', rep, day: TUE, kind: 'meeting', channel: 'call', lead: L2 },
  { id: 'crm_A-0005', rep, day: WED, kind: 'message', channel: 'whatsapp', lead: L1 },
  { id: 'crm_A-0006', rep, day: WED, kind: 'reply', channel: 'whatsapp', lead: L2 },
  { id: 'crm_A-0007', rep, day: WED, kind: 'talk', channel: 'visit', lead: L2 },
];

async function setup(t, { clock = at10(THU) } = {}) {
  const s = await start({ clock }); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const uno = (await s.call('POST', `${API}/reps`, { access: 'none', name: 'Vendedor Uno', city: 'Panama City', country: 'PA', workdays: [1, 2, 3, 4, 5], startDate: '2026-10-01' }, { cookie: a.cookie })).json.id;
  await s.call('PUT', `${API}/leads`, LEADS, { bearer: 'push-token' });
  const put = (body, bearer = 'push-token') => s.call('PUT', `${API}/activity`, body, { bearer });
  const del = (qs, bearer = 'push-token') => s.call('DELETE', `${API}/activity?${qs}`, undefined, { bearer });
  const get = (route, who) => s.call('GET', `${API}/${route}`, undefined, { cookie: who.cookie });
  return { s, a, ana, uno, put, del, get };
}
/** Every answer a person or the routine reads, as text. */
async function payloads(x) {
  const { s, a, ana, uno, get } = x;
  return { anaMe: (await get('me', ana)).text, adminMe: (await get('me', a)).text, unoMe: (await get(`me?as=${uno}`, a)).text, team: (await get('team', a)).text,
    lead: (await get('lead', a)).text, export: (await s.call('GET', `${API}/export`, undefined, { bearer: 'push-token' })).text };
}

test('the route takes the service token only: none, a wrong one or a signed-in admin is refused and nothing is written', async (t) => {
  const x = await setup(t), { s, a, uno, put, del } = x;
  const before = s.lines().length;
  const body = { source: 'crm', rows: week(uno) };
  assert.deepEqual([(await put(body, null)).status, (await put(body, null)).json.error], [401, 'token']);
  assert.equal((await put(body, 'not-the-token')).status, 401);
  assert.equal((await s.call('PUT', `${API}/activity`, body, { cookie: a.cookie })).status, 401);
  assert.equal((await del(`source=crm&from=${MON}&to=${WED}`, null)).status, 401);
  assert.equal((await s.call('DELETE', `${API}/activity?source=crm&from=${MON}&to=${WED}`, undefined, { cookie: a.cookie })).status, 401);
  assert.equal(s.lines().length, before);
  // a GET is no way in either
  assert.equal((await s.call('GET', `${API}/activity`, undefined, { cookie: a.cookie })).status, 401);
});

test('rows land as crm.log events; the same ids again add nothing and change nothing', async (t) => {
  const { s, uno, put } = await setup(t);
  const one = await put({ source: 'crm', rows: week(uno) });
  assert.equal(one.status, 200);
  assert.deepEqual([one.json.added, one.json.repeated, one.json.refused, one.json.reasons], [7, 0, 0, []]);
  const events = s.lines().filter((e) => e.type === 'crm.log');
  assert.deepEqual(events.map((e) => e.id), week(uno).map((r) => r.id));
  assert.deepEqual(Object.keys(events[0]).sort(), ['channel', 'day', 'id', 'kind', 'lead', 'rep', 'source', 't', 'type'].sort());
  assert.equal(s.lines().some((e) => e.type === 'log' || e.type === 'lead.added'), false, 'no app log and no business added to the list');
  const count = s.lines().length;
  const two = await put({ source: 'crm', rows: week(uno) });
  assert.deepEqual([two.json.added, two.json.repeated, two.json.refused], [0, 7, 0]);
  assert.equal(s.lines().length, count);
  // the same id with other content is still the same row
  const three = await put({ source: 'crm', rows: [{ ...week(uno)[0], kind: 'absent' }] });
  assert.deepEqual([three.json.added, three.json.repeated], [0, 1]);
  assert.equal(s.lines().length, count);
});

test('each refused row says why, and none of them is written', async (t) => {
  const { s, a, ana, uno, put } = await setup(t);
  const lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  const mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' });
  const gone = await s.addRep(a.cookie, 'ido');
  await s.call('POST', `${API}/reps/${gone.id}`, { patch: { active: false } }, { cookie: a.cookie });
  const prac = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  const ok = { rep: uno, day: TUE, kind: 'talk', channel: 'visit', lead: L1 };
  const rows = [
    { ...ok, id: 'A-0001' },                                   // the app's own shape of id: never the CRM's
    { ...ok, id: 'crm_B-0002', rep: 'r_nobody' },
    { ...ok, id: 'crm_B-0003', rep: a.id },                    // the admin
    { ...ok, id: 'crm_B-0004', rep: lia.id },                  // a leader
    { ...ok, id: 'crm_B-0005', rep: mgr.id },                  // a manager
    { ...ok, id: 'crm_B-0006', rep: prac },                    // the practice rep
    { ...ok, id: 'crm_B-0007', rep: gone.id },                 // no longer active
    { ...ok, id: 'crm_B-0008', day: '2026-11-31' },
    { ...ok, id: 'crm_B-0009', day: '2026-11-20' },            // tomorrow in Panama
    { ...ok, id: 'crm_B-0010', day: '2026-10-18' },            // 32 days back
    { ...ok, id: 'crm_B-0011', kind: 'gossip' },
    { ...ok, id: 'crm_B-0012', kind: 'contract', channel: 'visit' },
    { ...ok, id: 'crm_B-0013', channel: 'email' },             // a talk is a visit
    { ...ok, id: 'crm_B-0014', lead: { id: '', name: 'Negocio de ejemplo' } },
    { ...ok, id: 'crm_B-0015', lead: { id: 'L-009', name: '' } },
    'not a row',
  ];
  const before = s.lines().length;
  const r = await put({ source: 'crm', rows });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.reasons, [
    { index: 0, id: 'A-0001', reason: 'id' }, { index: 1, id: 'crm_B-0002', reason: 'rep' }, { index: 2, id: 'crm_B-0003', reason: 'not_a_rep' },
    { index: 3, id: 'crm_B-0004', reason: 'not_a_rep' }, { index: 4, id: 'crm_B-0005', reason: 'not_a_rep' }, { index: 5, id: 'crm_B-0006', reason: 'not_a_rep' },
    { index: 6, id: 'crm_B-0007', reason: 'not_a_rep' }, { index: 7, id: 'crm_B-0008', reason: 'day' }, { index: 8, id: 'crm_B-0009', reason: 'future' },
    { index: 9, id: 'crm_B-0010', reason: 'too_old' }, { index: 10, id: 'crm_B-0011', reason: 'kind' }, { index: 11, id: 'crm_B-0012', reason: 'contract' },
    { index: 12, id: 'crm_B-0013', reason: 'channel' }, { index: 13, id: 'crm_B-0014', reason: 'lead' }, { index: 14, id: 'crm_B-0015', reason: 'lead' },
    { index: 15, id: null, reason: 'row' },
  ]);
  assert.deepEqual([r.json.added, r.json.repeated, r.json.refused], [0, 0, 16]);
  assert.equal(s.lines().length, before);
  // the edges that pass: today, exactly 31 days back, and a rep named by handle
  const edges = await put({ source: 'crm', rows: [{ ...ok, id: 'crm_C-0001', day: THU }, { ...ok, id: 'crm_C-0002', day: '2026-10-19', lead: L2 }, { ...ok, id: 'crm_C-0003', rep: 'ana', lead: L2 }] });
  assert.deepEqual([edges.json.added, edges.json.refused], [3, 0]);
  assert.equal(s.lines().filter((e) => e.type === 'crm.log').at(-1).rep, ana.id);
  // the body itself: no source, another source, no rows
  for (const bad of [{ rows: [ok] }, { source: 'sheet', rows: [ok] }, { source: 'crm' }, { source: 'crm', rows: [] }]) {
    const b = await put(bad);
    assert.deepEqual([b.status, b.json.error], [400, 'fields']);
  }
});

test('the same rep, day, business and kind counts once: against an app log, an earlier import and the same request', async (t) => {
  const { s, ana, put } = await setup(t, { clock: at10(TUE) });
  await s.call('POST', `${API}/log`, { id: 'app-log-0001', lead: { id: 'L-001' }, kind: 'talk', clientAt: new Date(at10(TUE)).toISOString() }, { cookie: ana.cookie });
  const r = await put({ source: 'crm', rows: [
    { id: 'crm_D-0001', rep: ana.id, day: TUE, kind: 'talk', channel: 'visit', lead: L1 },          // the app already has it
    { id: 'crm_D-0002', rep: ana.id, day: MON, kind: 'call', channel: 'call', lead: L2 },
    { id: 'crm_D-0003', rep: ana.id, day: MON, kind: 'call', channel: 'call', lead: L2 },           // the row above again
    { id: 'crm_D-0004', rep: ana.id, day: MON, kind: 'noanswer', channel: 'call', lead: L2 },       // another kind
  ] });
  assert.deepEqual([r.json.added, r.json.repeated, r.json.refused], [2, 2, 0]);
  const again = await put({ source: 'crm', rows: [{ id: 'crm_D-0005', rep: ana.id, day: MON, kind: 'call', channel: 'call', lead: L2 }] });
  assert.deepEqual([again.json.added, again.json.repeated], [0, 1]);
  // and the app, the other way round: a talk logged in the app on a day the CRM already gave counts once
  assert.deepEqual(s.lines().filter((e) => e.type === 'crm.log').map((e) => e.id), ['crm_D-0002', 'crm_D-0004']);
});

test('a day the rep closed in the app takes no imported row', async (t) => {
  const { s, ana, put } = await setup(t, { clock: at10(WED) });
  await s.call('POST', `${API}/log`, { id: 'app-log-0002', lead: { id: 'L-001' }, kind: 'talk', clientAt: new Date(at10(WED)).toISOString() }, { cookie: ana.cookie });
  assert.equal((await s.call('POST', `${API}/close`, { tomorrow: 'Visitas en el centro' }, { cookie: ana.cookie })).status, 200);
  s.time.now = at10(THU);
  const r = await put({ source: 'crm', rows: [{ id: 'crm_E-0001', rep: ana.id, day: WED, kind: 'call', channel: 'call', lead: L2 }, { id: 'crm_E-0002', rep: ana.id, day: TUE, kind: 'call', channel: 'call', lead: L2 }] });
  assert.deepEqual(r.json.reasons, [{ index: 0, id: 'crm_E-0001', reason: 'day_closed' }]);
  assert.equal(r.json.added, 1);
});

test('an imported day lights that day and not today; the board, the table and the leadership view count it', async (t) => {
  const x = await setup(t), { a, uno, put, get } = x;
  await put({ source: 'crm', rows: week(uno) });
  const me = (await get(`me?as=${uno}`, a)).json;
  const byDay = Object.fromEntries(me.week.days.map((d) => [d.day, d]));
  assert.deepEqual(byDay[MON].habits.slice(0, 3), [true, true, false]); // a visit and two conversations; nothing to follow up yet
  assert.deepEqual(byDay[TUE].habits.slice(0, 3), [true, true, true]);  // a visit, two conversations, a follow-up
  assert.equal(byDay[WED].visits, 1);
  assert.deepEqual(byDay[THU].habits, [false, false, false, false]);
  assert.deepEqual([me.today.day, me.today.visits, me.today.conversations], [THU, 0, 0]);
  assert.ok(me.week.points > 0);
  assert.equal(me.streak.current, 3);
  const team = (await get('team', a)).json, row = team.reps.find((r) => r.id === uno);
  assert.equal(row.week.points, me.week.points);
  assert.equal(team.needs.pace.some((p) => p.rep === uno), false, 'no longer under pace');
  // the meeting waits for the manager, dated by its day
  const waiting = team.needs.confirm.find((c) => c.logId === 'crm_A-0004');
  assert.deepEqual([waiting.what, waiting.at, waiting.crm], ['meeting_held', TUE, true]);
  assert.equal((await x.s.call('POST', `${API}/confirm`, { logId: 'crm_A-0004', what: 'meeting_held' }, { cookie: a.cookie })).status, 200);
  const lead = (await get('lead', a)).json, mine = lead.cities.flatMap((c) => c.reps).find((r) => r.id === uno);
  assert.deepEqual(mine.week, { visits: 3, conversations: 5, meetings: 1, contracts: 0 });
});

test('points, lights and streak equal those of the same logs made in the app on those days', async (t) => {
  const crm = await setup(t), app = await setup(t, { clock: at10(MON) });
  const rows = week(crm.ana.id);
  assert.equal((await crm.put({ source: 'crm', rows })).json.added, 7);
  for (const r of rows) {
    app.s.time.now = at10(r.day);
    const made = await app.s.call('POST', `${API}/log`, { id: `app-${r.id.slice(4)}-x`, lead: { id: r.lead.id }, kind: r.kind, channel: r.channel, clientAt: new Date(at10(r.day)).toISOString() }, { cookie: app.ana.cookie });
    assert.equal(made.status, 200);
  }
  app.s.time.now = at10(THU);
  const view = async (x) => {
    const me = (await x.get('me', x.ana)).json, team = (await x.get('team', x.a)).json, row = team.reps.find((r) => r.id === x.ana.id);
    return { week: me.week, today: me.today, streak: me.streak, level: me.level, goal: me.goal, badges: me.badges, tableWeek: me.table.week.me.score,
      ledger: me.ledger.map((e) => [e.code, e.pts, e.status]).sort(), team: { week: row.week, streak: row.streak, level: row.level, today: { ...row.today, lastLogAt: null } } };
  };
  assert.deepEqual(await view(crm), await view(app));
});

test('imported rows never go back out: the export holds none of them, nor a stage they would raise', async (t) => {
  const { s, ana, uno, put } = await setup(t, { clock: at10(TUE) });
  await s.call('POST', `${API}/log`, { id: 'app-log-0003', lead: { id: 'L-001' }, kind: 'talk', clientAt: new Date(at10(TUE)).toISOString() }, { cookie: ana.cookie });
  await put({ source: 'crm', rows: [...week(uno).filter((r) => r.day <= TUE), { id: 'crm_F-0001', rep: ana.id, day: MON, kind: 'meeting', channel: 'visit', lead: L2 }] });
  const ex = (await s.call('GET', `${API}/export`, undefined, { bearer: 'push-token' })).json;
  assert.deepEqual(ex.logs.map((l) => l.id), ['app-log-0003']);
  assert.deepEqual(ex.stages, [{ lead: 'L-001', stage: 'Contacted' }]);
  assert.equal(JSON.stringify(ex).includes('crm_'), false);
});

test('no time of day for these: the feed, the history, the waiting list and the route carry the day and say where it came from', async (t) => {
  const { s, a, ana, uno, put, get } = await setup(t);
  // a move made in the app today, then the CRM's rows of earlier days, sent newest first
  await s.call('POST', `${API}/log`, { id: 'app-log-0004', lead: { id: 'L-001' }, kind: 'talk', clientAt: new Date(at10(THU)).toISOString() }, { cookie: ana.cookie });
  await put({ source: 'crm', rows: [...week(uno)].reverse() });
  const me = (await get(`me?as=${uno}`, a)).json;
  assert.equal(me.feed[0].id, 'app-log-0004', "today's move stays on top");
  assert.match(me.feed[0].at, /T\d{2}:\d{2}/);
  const feed = me.feed.filter((f) => f.id.startsWith('crm_'));
  assert.ok(feed.length >= 5);
  for (const f of feed) { assert.match(f.at, DAY_ONLY); assert.equal(f.crm, true); }
  assert.deepEqual(feed.map((f) => f.at), [...feed.map((f) => f.at)].sort().reverse(), 'newest day first');
  const imported = me.ledger.filter((e) => e.logId && e.logId.startsWith('crm_'));
  assert.ok(imported.length >= 7);
  for (const e of imported) { assert.match(e.at, DAY_ONLY); assert.equal(e.crm, true); }
  for (const p of me.pending) assert.match(p.at, DAY_ONLY);
  const team = (await get('team', a)).json, row = team.reps.find((r) => r.id === uno);
  assert.equal(row.today.lastLogAt, WED);
  const route = (await get(`route?lead=L-002&as=${uno}`, a)).json.route;
  assert.equal(route.stops[0].at, TUE);
  // nothing anywhere carries the minute the server keeps internally for these days
  const all = JSON.stringify(me) + JSON.stringify(team);
  for (const day of [MON, TUE, WED]) assert.equal(all.includes(dayEndIso(day, 'America/Panama')), false, day);
  // a log made in the app keeps its real time
  assert.ok(s.lines().length > 0);
});

test('DELETE takes a range out exactly: every answer is what it was before, and the same rows import again', async (t) => {
  const x = await setup(t), { s, a, ana, uno, put, del } = x;
  await s.call('PUT', `${API}/activity`, { source: 'crm', rows: [{ id: 'crm_G-0001', rep: uno, day: '2026-11-12', kind: 'talk', channel: 'visit', lead: L1 }] }, { bearer: 'push-token' });
  const before = await payloads(x);
  assert.equal((await put({ source: 'crm', rows: week(uno) })).json.added, 7);
  // what people did on them meanwhile: a meeting confirmed, a row voided, a clap on a line of the feed
  assert.equal((await s.call('POST', `${API}/confirm`, { logId: 'crm_A-0004', what: 'meeting_held' }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/void`, { logId: 'crm_A-0005', reason: 'prueba' }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/kudos`, { target: 'crm_A-0007' }, { cookie: ana.cookie })).status, 200);
  assert.notEqual((await payloads(x)).unoMe, before.unoMe);
  // a bad range is refused and removes nothing
  for (const qs of [`source=sheet&from=${MON}&to=${WED}`, `source=crm&from=${WED}&to=${MON}`, `source=crm&from=${MON}`, 'source=crm&from=2026-11-31&to=2026-12-01']) {
    const b = await del(qs);
    assert.deepEqual([b.status, b.json.error], [400, 'fields'], qs);
  }
  const gone = await del(`source=crm&from=${MON}&to=${WED}`);
  assert.deepEqual([gone.status, gone.json.removed], [200, 7]);
  assert.equal(s.lines().at(-1).type, 'crm.log.removed');
  assert.deepEqual(await payloads(x), before, 'byte for byte');
  // a restart agrees, and the row outside the range stayed
  const again = openTeamStore(s.dir, { log: () => {} }).state;
  assert.deepEqual([...again.logs.keys()].filter((k) => k.startsWith('crm_')), ['crm_G-0001']);
  // nothing left in the range: a second DELETE removes nothing and writes nothing
  const count = s.lines().length;
  assert.equal((await del(`source=crm&from=${MON}&to=${WED}`)).json.removed, 0);
  assert.equal(s.lines().length, count);
  const re = await put({ source: 'crm', rows: week(uno) });
  assert.deepEqual([re.json.added, re.json.repeated], [7, 0]);
  // they come back as new: the confirmation, the void and the clap of the first time stayed with the rows removed
  const back = (await x.get(`me?as=${uno}`, a)).json;
  assert.equal(back.pending.some((p) => p.logId === 'crm_A-0004' && p.code === 'meeting_held'), true);
  assert.equal(back.ledger.some((e) => e.logId === 'crm_A-0005'), true);
  assert.equal(back.feed.find((f) => f.id === 'crm_A-0007').kudos, 0);
  assert.equal(openTeamStore(s.dir, { log: () => {} }).state.logs.has('crm_A-0004'), true);
});

/** The build before this task, taken from git and opened on the same folder. */
async function previousBuild(t) {
  const root = fileURLToPath(new URL('..', import.meta.url)), dir = mkdtempSync(path.join(tmpdir(), 'team-prev-'));
  try { execFileSync('sh', ['-c', `git -C "${root}" archive a981fdf lib/team team | tar -x -C "${dir}"`], { stdio: 'ignore' }); } catch { t.skip('git history not available'); return null; }
  if (!readdirSync(path.join(dir, 'lib', 'team')).includes('state.mjs')) { t.skip('git history not available'); return null; }
  return { store: await import(pathToFileURL(path.join(dir, 'lib/team/store.mjs')).href), view: await import(pathToFileURL(path.join(dir, 'lib/team/view.mjs')).href) };
}

test('the build before this one replays the log with imports and removals in it: it shows none of them and nothing breaks', async (t) => {
  const x = await setup(t), { s, a, ana, uno, put, del } = x;
  const prev = await previousBuild(t);
  if (!prev) return;
  const said = [];
  const read = () => {
    const st = prev.store.openTeamStore(s.dir, { log: (m) => said.push(m) }).state, ctx = { now: new Date(at10(THU)).toISOString(), lang: 'es', tz: 'America/Panama' };
    return JSON.stringify({ uno: prev.view.repView(st, uno, ctx), ana: prev.view.repView(st, ana.id, ctx), team: prev.view.teamView(st, ctx), logs: [...st.logs.keys()] });
  };
  const before = read();
  await put({ source: 'crm', rows: week(uno) });
  await s.call('POST', `${API}/confirm`, { logId: 'crm_A-0004', what: 'meeting_held' }, { cookie: a.cookie });
  await s.call('POST', `${API}/kudos`, { target: 'crm_A-0007' }, { cookie: ana.cookie });
  assert.equal(read(), before, 'nothing shown, nothing misdated');
  await del(`source=crm&from=${MON}&to=${TUE}`);
  await put({ source: 'crm', rows: week(uno) });
  assert.equal(read(), before);
  assert.deepEqual(said, []);
});

test('the reducer: a crm.log keeps its day in any time zone, ignores what does not hold, and a removal recomputes first contacts', () => {
  const st = emptyState(), t0 = '2026-11-19T15:00:00Z';
  applyEvent(st, { type: 'rep.created', id: 'r_uno', handle: 'vendedor-uno', email: '', name: 'Vendedor Uno', role: 'rep', tz: 'Asia/Tokyo', startDate: '2026-10-01', t: t0 });
  const ev = (id, day, over = {}) => ({ type: 'crm.log', id, rep: 'r_uno', day, kind: 'talk', channel: 'visit', lead: { id: 'L-001', name: 'Negocio de ejemplo' }, source: 'crm', t: t0, ...over });
  for (const e of [ev('crm_H-0001', TUE), ev('crm_H-0002', MON), ev('crm_H-0003', '2026-13-01'), ev('crm_H-0004', MON, { rep: 'r_nadie' }), ev('crm_H-0005', MON, { lead: null })]) applyEvent(st, e);
  assert.deepEqual([...st.logs.keys()], ['crm_H-0001', 'crm_H-0002']);
  assert.deepEqual([st.logs.get('crm_H-0001').day, localDay(st.logs.get('crm_H-0001').t, 'Asia/Tokyo')], [TUE, TUE]);
  assert.equal(st.leadFirstDay.get('L-001'), MON);
  applyEvent(st, { type: 'crm.log.removed', source: 'crm', from: MON, to: MON, t: t0 });
  assert.deepEqual([...st.logs.keys()], ['crm_H-0001']);
  assert.equal(st.leadFirstDay.get('L-001'), TUE);
  assert.deepEqual(st.byRep.get('r_uno'), ['crm_H-0001']);
  // a removal that names another source, or no range, removes nothing
  applyEvent(st, { type: 'crm.log.removed', source: 'sheet', from: MON, to: WED, t: t0 });
  applyEvent(st, { type: 'crm.log.removed', source: 'crm', t: t0 });
  assert.equal(st.logs.size, 1);
});

test('the pure pieces: the id shape, the last minute of a day, the range and the day-only stamp', () => {
  assert.ok(CRM_LOG_ID.test('crm_ACT-0123'));
  for (const bad of ['ACT-0123', 'crm_', 'crm:ACT', `crm_${'x'.repeat(61)}`, 'abcdefgh']) assert.equal(CRM_LOG_ID.test(bad), false, bad);
  assert.equal(dayEndIso(WED, 'America/Panama'), '2026-11-19T04:59:00.000Z');
  assert.equal(localDay(dayEndIso(WED, 'Europe/Madrid'), 'Europe/Madrid'), WED);
  assert.equal(localDay(dayEndIso('2026-03-08', 'America/New_York'), 'America/New_York'), '2026-03-08');   // a day that loses an hour
  assert.deepEqual(removalRange({ source: 'crm', from: MON, to: WED }), { from: MON, to: WED });
  assert.equal(removalRange({ source: 'crm', from: WED, to: MON }), null);
  assert.equal(removalRange({ source: 'crm', from: '2026-02-30', to: WED }), null);
  assert.equal(dayOnly(TUE), true);
  assert.equal(dayOnly('2026-11-17T15:00:00.000Z'), false);
  assert.equal(dayOnly(null), false);
  assert.equal(typeof activityRows, 'function');
  for (const lang of LANGS) assert.ok(DICT[lang]['time.crm'], lang);
  assert.equal(DICT.es['time.crm'], 'desde el CRM');
  assert.equal(DICT.en['time.crm'], 'from the CRM');
});

test('nothing on the screens imports: no client file calls the activity route', () => {
  const dir = fileURLToPath(new URL('../team/', import.meta.url));
  for (const f of readdirSync(dir).filter((n) => n.endsWith('.js'))) assert.equal(/['"`]activity['"`?]/.test(readFileSync(path.join(dir, f), 'utf8')), false, f);
});
