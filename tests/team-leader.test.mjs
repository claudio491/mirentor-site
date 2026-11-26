import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { start, mail, as, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { leaderView } from '../lib/team/leader.mjs';
import { SCORECARD_ACCEPTED_GOAL_HOURS } from '../lib/team/rules.mjs';

const API = '/equipo/api';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const W1 = 'w_11111111';
const IMEI_A = '490154203237518';

/** An admin, a rep who installs one site with one signed worker holding a phone, a manager and a leader. */
async function setup(t, over = {}) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana', over.ana);
  const site = await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Ferretería La Prueba' }, city: 'Panama City', eligible: 12 }, { cookie: a.cookie });
  assert.equal(site.status, 200);
  const siteId = s.lines().find((e) => e.type === 'site').id;
  await s.call('POST', `${API}/install/${siteId}/workers`, { id: W1, name: 'Persona Uno', email: 'p1@equipo.test', phone: true }, { cookie: ana.cookie });
  await fetch(`${s.url}${API}/worker/${W1}/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: ana.cookie }, body: JPG });
  await s.call('POST', `${API}/worker/${W1}/phone`, { imei: IMEI_A }, { cookie: ana.cookie });
  const made = await s.call('POST', `${API}/reps`, { email: mail('lia'), name: 'Lia Lider', role: 'leader', city: '' }, { cookie: a.cookie });
  assert.equal(made.status, 200);
  const lia = { id: made.json.id, cookie: as(mail('lia')) };
  const mgr = await s.call('POST', `${API}/reps`, { email: mail('mara'), name: 'Mara Manager', role: 'manager' }, { cookie: a.cookie });
  return { s, a, ana, lia, mgr: { id: mgr.json.id, cookie: as(mail('mara')) }, siteId };
}

test('an admin makes a leader; a manager cannot, and a person can be turned into one', async (t) => {
  const { s, a, mgr } = await setup(t);
  const lia = [...s.lines()].find((e) => e.type === 'rep.created' && e.email === mail('lia'));
  assert.equal(lia.role, 'leader');
  const bymgr = await s.call('POST', `${API}/reps`, { email: mail('tito'), name: 'Tito Lider', role: 'leader' }, { cookie: mgr.cookie });
  assert.equal(bymgr.status, 200);
  assert.equal(s.lines().find((e) => e.email === mail('tito')).role, 'rep');
  const rep = await s.addRep(a.cookie, 'beto');
  const patched = await s.call('POST', `${API}/reps/${rep.id}`, { patch: { role: 'leader' } }, { cookie: a.cookie });
  assert.equal(patched.status, 200);
  assert.equal(s.lines().filter((e) => e.type === 'rep.updated').pop().patch.role, 'leader');
  const refused = await s.call('POST', `${API}/reps/${rep.id}`, { patch: { role: 'leader' } }, { cookie: mgr.cookie });
  assert.deepEqual([refused.status, refused.json.error], [403, 'admin_only']);
});

test('a leader reads the view and can write nothing', async (t) => {
  const { s, ana, lia, siteId } = await setup(t);
  const before = s.lines().length;
  const writes = [
    ['POST', `log`, logBody('log-aaaaaaaa')], ['POST', 'close', { tomorrow: 'x' }], ['POST', 'goal', { k: 'a' }], ['POST', 'kudos', { id: 'x', on: true }], ['POST', 'play', { logId: 'x', text: 'y' }], ['POST', 'held', { logId: 'x' }],
    ['POST', 'site', { rep: ana.id, lead: { name: 'Otro Negocio' } }], ['POST', `site/${siteId}`, { what: 'installed' }], ['POST', 'confirm', { logId: 'x', what: 'meeting_held' }],
    ['POST', 'void', { logId: 'x' }], ['POST', 'reopen', { rep: ana.id, day: '2026-11-16' }], ['POST', 'reps', { email: mail('nuevo'), name: 'Nuevo Rep' }], ['POST', `reps/${ana.id}`, { patch: { city: 'X' } }],
    ['POST', 'hours', { weeks: [{ week: '2026-11-16', delivered: 60, accepted: 30 }] }], ['POST', 'badge', { rep: ana.id, text: 'hola' }], ['POST', 'dayoff', { scope: 'all', date: '2026-11-20' }],
    ['POST', `install/${siteId}/workers`, { id: 'w_99999999', name: 'Persona Dos', email: 'p2@equipo.test' }], ['POST', `install/${siteId}/prep`, { what: 'signs' }],
    ['POST', `install/${siteId}/coordinator`, { name: 'Coord Uno', phone: '5075550101' }], ['POST', `install/${siteId}/close`, {}],
    ['POST', `worker/${W1}/phone`, { imei: '356938035643809' }], ['POST', `worker/${W1}/clip`, {}], ['POST', `worker/${W1}/phone/return`, {}],
    ['POST', 'zones', { zones: ['a', 'b'] }], ['POST', 'ladder', { step: 'video' }], ['POST', 'ladder', { step: 'hour', rep: ana.id }], ['POST', 'seen', { video: 'pitch' }],
    ['DELETE', `install/${siteId}/workers`, undefined],
  ];
  for (const [method, p, body] of writes) {
    const r = await s.call(method, `${API}/${p}`, body, { cookie: lia.cookie });
    assert.deepEqual([r.status, r.json?.error], [403, 'read_only'], `${method} ${p}`);
  }
  const up = await fetch(`${s.url}${API}/worker/${W1}/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: lia.cookie }, body: JPG });
  assert.deepEqual([up.status, (await up.json()).error], [403, 'read_only']);
  // reads outside the allow-list are closed too: the install screen, the team table, a made-up route
  for (const p of [`install/${siteId}`, 'team', 'zones', 'export', 'worker/x/consent']) {
    const r = await s.call('GET', `${API}/${p}`, undefined, { cookie: lia.cookie });
    assert.equal(r.status === 403 || r.status === 404 || r.status === 401, true, p);
    assert.notEqual(r.status, 200, p);
  }
  assert.equal((await s.call('GET', `${API}/install/${siteId}`, undefined, { cookie: lia.cookie })).json.error, 'read_only');
  assert.equal(s.lines().length, before, 'nothing was appended');

  // what a leader may do
  assert.equal((await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie })).status, 200);
  assert.equal((await s.call('GET', `${API}/scorecard`, undefined, { cookie: lia.cookie })).status, 200);
  assert.equal((await s.call('GET', `${API}/leads?q=taller`, undefined, { cookie: lia.cookie })).status, 200);
  const consent = await fetch(`${s.url}${API}/consent/${W1}`, { headers: { cookie: lia.cookie } });
  assert.equal(consent.status, 200);
  assert.deepEqual(Buffer.from(await consent.arrayBuffer()), JPG);
  const rec = await s.call('GET', `${API}/site/${siteId}/record.csv`, undefined, { cookie: lia.cookie });
  assert.equal(rec.status, 200);
  assert.match(rec.text, /Persona Uno/);
  const photo = await s.call('GET', `${API}/photo/${ana.id}`, undefined, { cookie: lia.cookie });
  assert.deepEqual([photo.status, photo.json.error], [404, 'photo']);   // allowed: there is just no picture
  const lang = await s.call('POST', `${API}/lang`, { lang: 'en' }, { cookie: lia.cookie });
  assert.equal(lang.status, 200);
  assert.equal(lang.json.me, undefined);
  assert.equal(s.lines().filter((e) => e.type === 'rep.updated').pop().patch.lang, 'en');
});

test('a leader asking for me gets a viewer and no rep board, even with no logs', async (t) => {
  const { s, lia } = await setup(t);
  const me = await s.call('GET', `${API}/me`, undefined, { cookie: lia.cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(me.json, { ok: true, viewer: { id: lia.id, role: 'leader', lang: 'es', first: 'Lia', email: mail('lia') } });
  // the others are unchanged
  const adm = await s.call('GET', `${API}/me`, undefined, { cookie: as(mail('jefe')) });
  assert.equal(adm.json.viewer.role, 'admin');
  assert.ok(adm.json.table);
});

test('a leader is not a player: not in the table, the team numbers or the leadership reps', async (t) => {
  const { s, a, ana, lia, mgr } = await setup(t);
  const team = await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie });
  assert.deepEqual(team.json.reps.map((r) => r.id), [ana.id]);
  assert.ok(team.json.others.some((r) => r.id === lia.id));
  assert.equal(team.json.team.players, 1);
  const rep = await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie });
  const names = [...rep.json.table.week.podium, ...rep.json.table.week.rest].map((r) => r.id);
  assert.equal(names.includes(lia.id) || names.includes(mgr.id), false);
  const view = await s.call('GET', `${API}/lead`, undefined, { cookie: a.cookie });
  const listed = view.json.cities.flatMap((c) => c.reps.map((r) => r.id));
  assert.deepEqual(listed, [ana.id]);
});

test('a rep and a signed-out visitor cannot read the leadership view', async (t) => {
  const { s, ana, mgr } = await setup(t);
  const rep = await s.call('GET', `${API}/lead`, undefined, { cookie: ana.cookie });
  assert.deepEqual([rep.status, rep.json.error], [403, 'manager_only']);
  const out = await s.call('GET', `${API}/lead`);
  assert.deepEqual([out.status, out.json.error], [401, 'session']);
  assert.equal((await s.call('GET', `${API}/lead`, undefined, { cookie: mgr.cookie })).status, 200);
  const repHours = await s.call('POST', `${API}/hours`, { weeks: [{ week: '2026-11-16', delivered: 60, accepted: 30 }] }, { cookie: ana.cookie });
  assert.deepEqual([repHours.status, repHours.json.error], [403, 'manager_only']);
});

test('the view lists each city with its sites, counts and reps', async (t) => {
  const { s, a, ana, lia, siteId } = await setup(t);
  await s.addRep(a.cookie, 'beto', { city: '' });
  await s.call('POST', `${API}/log`, logBody('log-visit-0001', { kind: 'absent', lead: { name: 'Panadería Sol' } }), { cookie: ana.cookie });
  const r = await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie });
  assert.equal(r.status, 200);
  const view = r.json;
  assert.deepEqual(view.cities.map((c) => c.city), ['Panama City', '']);
  const pc = view.cities[0];
  assert.deepEqual(pc.sites, [{ id: siteId, name: 'Ferretería La Prueba', state: 'waiting_phones', eligible: 12, consents: 1, phones: 1, workers: 1 }]);
  assert.equal(pc.reps.length, 1);
  assert.equal(pc.reps[0].id, ana.id);
  assert.equal(pc.reps[0].first, 'ana');
  assert.equal(pc.reps[0].photo, null);
  assert.equal(pc.reps[0].isNew, false);
  assert.deepEqual(pc.reps[0].week, { visits: 1, conversations: 0, meetings: 0, contracts: 0 });
  assert.deepEqual(view.cities[1].sites, []);
  assert.equal(view.cities[1].reps.length, 1);
  assert.deepEqual(view.hours, []);
  assert.equal(view.practiceHidden, 0);
});

test('a legacy site shows zero consents and a practice site is counted, not listed', async (t) => {
  const { s, a, ana, lia } = await setup(t);
  await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Taller Antiguo' }, city: 'Panama City', legacy: true }, { cookie: a.cookie });
  await s.call('POST', `${API}/site`, { rep: ana.id, lead: { name: 'Sitio de Práctica' }, city: 'Panama City', practice: true }, { cookie: a.cookie });
  const view = (await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie })).json;
  const sites = view.cities.flatMap((c) => c.sites);
  const legacy = sites.find((x) => x.name === 'Taller Antiguo');
  assert.deepEqual([legacy.state, legacy.consents], ['legacy', 0]);
  assert.equal(sites.some((x) => x.name === 'Sitio de Práctica'), false);
  assert.equal(view.practiceHidden, 1);
});

test('a site event written before this build replays and shows with its facts empty', () => {
  const state = emptyState();
  applyEvent(state, { type: 'rep.created', id: 'r_1', handle: 'ana', email: mail('ana'), name: 'Ana Rep', t: '2026-10-01T10:00:00Z' });
  applyEvent(state, { type: 'site', id: 's_oldsite001', rep: 'r_1', lead: { id: null, name: 'Negocio Viejo' }, t: '2026-10-02T10:00:00Z' });
  const view = leaderView(state, { now: '2026-11-16T15:00:00Z' });
  assert.deepEqual(view.cities.map((c) => c.city), ['']);
  assert.deepEqual(view.cities[0].sites, [{ id: 's_oldsite001', name: 'Negocio Viejo', state: 'waiting_phones', eligible: null, consents: 0, phones: 0, workers: 0 }]);
});

test('the view carries the Scorecard\'s weekly accepted-hours goal, in minutes, from the one named constant', () => {
  const view = leaderView(emptyState(), { now: '2026-11-16T15:00:00Z' });
  assert.equal(SCORECARD_ACCEPTED_GOAL_HOURS, 3750);
  assert.equal(view.goalAccepted, SCORECARD_ACCEPTED_GOAL_HOURS * 60);
});

test('hours pushed by the routine show with their percentage and source', async (t) => {
  const { s, lia } = await setup(t);
  const bad = await s.call('PUT', `${API}/hours`, { weeks: [{ week: '2026-11-16', delivered: 4144, accepted: 3666 }], source: 'scorecard' });
  assert.deepEqual([bad.status, bad.json.error], [401, 'token']);
  const ok = await s.call('PUT', `${API}/hours`, { weeks: [{ week: '2026-11-09', delivered: 0, accepted: 0 }, { week: '2026-11-16', delivered: 4144, accepted: 3666 }], source: 'scorecard' }, { bearer: 'push-token' });
  assert.equal(ok.status, 200);
  const view = (await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie })).json;
  assert.deepEqual(view.hours, [
    { week: '2026-11-16', delivered: 4144, accepted: 3666, pct: 88.5, source: 'scorecard' },
    { week: '2026-11-09', delivered: 0, accepted: 0, pct: null, source: 'scorecard' },
  ]);
  // a later value for the same week replaces the earlier one; the same value again writes nothing
  const n = s.lines().length;
  await s.call('PUT', `${API}/hours`, { weeks: [{ week: '2026-11-16', delivered: 4144, accepted: 3666 }], source: 'scorecard' }, { bearer: 'push-token' });
  assert.equal(s.lines().length, n);
  await s.call('PUT', `${API}/hours`, { weeks: [{ week: '2026-11-16', delivered: 5000, accepted: 2500 }], source: 'scorecard' }, { bearer: 'push-token' });
  const again = (await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie })).json;
  assert.deepEqual(again.hours[0], { week: '2026-11-16', delivered: 5000, accepted: 2500, pct: 50, source: 'scorecard' });
  assert.equal(again.hours.length, 2);
});

test('a manager types one week by hand and it shows with the source manual', async (t) => {
  const { s, mgr, lia } = await setup(t);
  const r = await s.call('POST', `${API}/hours`, { weeks: [{ week: '2026-11-16', delivered: 600, accepted: 300 }] }, { cookie: mgr.cookie });
  assert.equal(r.status, 200);
  const view = (await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie })).json;
  assert.deepEqual(view.hours, [{ week: '2026-11-16', delivered: 600, accepted: 300, pct: 50, source: 'manual' }]);
});

test('a week that is not a Monday, or minutes that are not numbers, are refused and nothing is written', async (t) => {
  const { s, mgr } = await setup(t);
  const n = s.lines().length;
  const put = (weeks, source = 'scorecard') => s.call('PUT', `${API}/hours`, { weeks, source }, { bearer: 'push-token' });
  const week = (over) => ({ week: '2026-11-16', delivered: 60, accepted: 30, ...over });
  for (const [weeks, error] of [
    [[week({ week: '2026-11-17' })], 'week'], [[week({ week: 'next monday' })], 'week'], [[week({ week: '2026-02-30' })], 'week'], [[week({ week: undefined })], 'week'],
    [[week({ delivered: '60' })], 'minutes'], [[week({ accepted: 1.5 })], 'minutes'], [[week({ delivered: -1 })], 'minutes'], [[week({ delivered: 100001 })], 'minutes'], [[week({ accepted: null })], 'minutes'],
    [[week(), week({ week: '2026-11-18' })], 'week'],
    [[], 'fields'], ['x', 'fields'], [undefined, 'fields'],
  ]) {
    const r = await put(weeks);
    assert.deepEqual([r.status, r.json.error], [400, error], JSON.stringify(weeks));
  }
  assert.equal((await put([week()], '')).json.error, 'fields');
  const post = await s.call('POST', `${API}/hours`, { weeks: [week({ week: '2026-11-15' })] }, { cookie: mgr.cookie });
  assert.deepEqual([post.status, post.json.error], [400, 'week']);
  assert.equal(s.lines().length, n);
  assert.equal((await put([week({ delivered: 100000, accepted: 0 })])).status, 200);
});

test('the service token never makes a leader, before or after an admin exists', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const leaders = () => s.lines().filter((e) => e.type === 'rep.created' && e.role === 'leader');
  const ask = (email) => s.call('POST', `${API}/bootstrap`, { email, name: 'Lider Token', role: 'leader' }, { bearer: 'push-token' });
  await ask(mail('lider1'));
  assert.equal(leaders().length, 0);
  await s.admin();
  const after = await ask(mail('lider2'));
  assert.equal(after.json.error, 'bootstrap_closed');
  assert.equal(leaders().length, 0);
  assert.equal(s.lines().some((e) => e.type === 'rep.created' && e.email === mail('lider2')), false);
});

test('hours where accepted is more than delivered are refused, and a manager retyping a week adds nothing', async (t) => {
  const { s, mgr } = await setup(t);
  const n = s.lines().length, weeks = [{ week: '2026-11-16', delivered: 60, accepted: 61 }];
  const put = await s.call('PUT', `${API}/hours`, { weeks, source: 'scorecard' }, { bearer: 'push-token' });
  const post = await s.call('POST', `${API}/hours`, { weeks }, { cookie: mgr.cookie });
  assert.deepEqual([put.status, put.json.error, post.status, post.json.error], [400, 'fields', 400, 'fields']);
  assert.equal(s.lines().length, n);
  const ok = { weeks: [{ week: '2026-11-16', delivered: 60, accepted: 60 }] };
  await s.call('POST', `${API}/hours`, ok, { cookie: mgr.cookie });
  assert.equal(s.lines().length, n + 1);
  await s.call('POST', `${API}/hours`, ok, { cookie: mgr.cookie });
  assert.equal(s.lines().length, n + 1);
});

test('a site event written by hand without a lead still replays: the leadership view and the team view answer 200', async (t) => {
  const { s, a, lia, ana } = await setup(t);
  // wait for the first server to be fully closed before writing its log by hand: closing without waiting raced the
  // hand-written lines against its last writes and failed about one full run in six
  await new Promise((r) => s.srv.close(() => r()));
  const file = path.join(s.dir, 'team', 'events.jsonl'), at = '2026-11-16T15:00:00.000Z';
  appendFileSync(file, [{ type: 'site', id: 's_nolead001', rep: ana.id, by: a.id, t: at }, { type: 'site', id: 's_nolead002', rep: ana.id, lead: 'texto', by: a.id, t: at },
    { type: 'site', id: 's_nolead003', rep: ana.id, lead: { name: 7 }, by: a.id, t: at }].map((e) => `${JSON.stringify(e)}\n`).join(''));
  const again = await start({ dir: s.dir }); t.after(() => again.srv.close());
  const lead = await again.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie });
  assert.equal(lead.status, 200, lead.text);
  const team = await again.call('GET', `${API}/team`, undefined, { cookie: a.cookie });
  assert.equal(team.status, 200, team.text);
  const row = team.json.sites.find((x) => x.id === 's_nolead001');
  assert.deepEqual(row.lead, { id: null, name: '' });
  assert.deepEqual(team.json.sites.find((x) => x.id === 's_nolead003').lead, { id: null, name: '' });
  assert.deepEqual(again.said.filter((m) => m.includes('failed')), []);
});
