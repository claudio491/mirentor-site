// Practice mode: one practice rep a manager or an admin creates, acts as with writes allowed, and removes. Nothing it
// does counts anywhere: not in the table, the team numbers, the feed of others, the leadership view or the export.
// View-as on a real rep stays read-only on the server: a write on behalf of a real person is refused and appends nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody, mail } from './team-helper.mjs';
import { openTeamStore } from '../lib/team/store.mjs';
import { repView } from '../lib/team/view.mjs';

const API = '/equipo/api';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF example bytes'), Buffer.from([0xff, 0xd9])]);
const IMEI_A = '490154203237518';

/** An admin, a real rep (ana), a manager and a leader. */
async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' });
  const lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  const create = (cookie = a.cookie) => s.call('POST', `${API}/practice`, {}, { cookie });
  const asP = (route, id) => `${API}/${route}${route.includes('?') ? '&' : '?'}as=${encodeURIComponent(id)}`;
  return { s, a, ana, mgr, lia, create, asP };
}
const practiceOf = (s) => s.lines().find((e) => e.type === 'rep.practice');

test('a manager or admin creates one practice rep: no email, named by the server; a second is refused', async (t) => {
  const { s, a, mgr, create } = await setup(t);
  const made = await create(mgr.cookie);
  assert.equal(made.status, 200);
  const ev = practiceOf(s);
  assert.ok(ev, 'a rep.practice event is written');
  assert.equal(ev.email, undefined);
  assert.equal(ev.by, (await s.call('GET', `${API}/me`, undefined, { cookie: mgr.cookie })).json.viewer.id);
  assert.deepEqual([made.json.practice.id, made.json.practice.name, made.json.practice.practice], [ev.id, 'Vendedor de práctica', true]);
  // not a player, not a person with access
  assert.equal(made.json.reps.some((r) => r.id === ev.id), false);
  assert.equal(made.json.others.some((r) => r.id === ev.id), false);
  const again = await create(a.cookie);
  assert.deepEqual([again.status, again.json.error], [409, 'practice_exists']);
  assert.equal(s.lines().filter((e) => e.type === 'rep.practice').length, 1);
});

test('a rep and a leader cannot create or remove the practice rep', async (t) => {
  const { s, ana, lia, create } = await setup(t);
  assert.deepEqual([(await create(ana.cookie)).status, (await create(ana.cookie)).json.error], [403, 'manager_only']);
  assert.equal((await create(lia.cookie)).status, 403);
  assert.equal((await s.call('POST', `${API}/practice/remove`, {}, { cookie: lia.cookie })).status, 403);
  assert.equal(s.lines().some((e) => e.type === 'rep.practice'), false);
});

test('a manager writes as the practice rep: each event names the practice rep and carries the real actor', async (t) => {
  const { s, a, create, asP } = await setup(t);
  const P = (await create()).json.practice.id;
  const logged = await s.call('POST', asP('log', P), logBody('practice-log-0001'), { cookie: a.cookie });
  assert.equal(logged.status, 200);
  assert.equal(logged.json.me.me.id, P);
  assert.equal(logged.json.me.viewer.as, P);
  // its own screens show its own points and hand
  assert.ok(logged.json.me.today.points > 0);
  assert.equal(logged.json.me.today.conversations, 1);
  const log = s.lines().find((e) => e.type === 'log');
  assert.deepEqual([log.rep, log.by], [P, a.id]);
  const lead = s.lines().find((e) => e.type === 'practice.lead.added');
  assert.equal(s.lines().some((e) => e.type === 'lead.added'), false);   // never a plain lead.added: an older build would export it
  assert.deepEqual([lead.lead.practice, lead.lead.by, lead.by], [true, P, a.id]);

  assert.equal((await s.call('POST', asP('goal', P), { k: logged.json.me.goalPick.options[0] }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', asP('ladder', P), { step: 'video' }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', asP('seen', P), { video: 'welcome' }, { cookie: a.cookie })).status, 200);
  const closed = await s.call('POST', asP('close', P), { tomorrow: 'Volver a la tienda', blocker: '' }, { cookie: a.cookie });
  assert.equal(closed.status, 200);
  assert.match(closed.json.report, /Vendedor de práctica/);
  for (const type of ['goal.pick', 'ladder.tick', 'video.seen', 'day.close']) {
    const e = s.lines().find((x) => x.type === type);
    assert.deepEqual([e.rep, e.by], [P, a.id], type);
  }
});

test('a write as a real rep is refused with 403 and appends nothing; reads as a real rep still work', async (t) => {
  const { s, a, mgr, ana, create, asP } = await setup(t);
  await create();
  const before = s.lines().length;
  for (const [route, body] of [['log', logBody('real-as-0000001')], ['close', { tomorrow: 'algo', blocker: '' }], ['goal', { k: 1 }], ['ladder', { step: 'video' }], ['zones', { zones: ['A', 'B'] }], ['seen', { video: 'welcome' }], ['lang', { lang: 'en' }]]) {
    for (const who of [a, mgr]) {
      const r = await s.call('POST', asP(route, ana.id), body, { cookie: who.cookie });
      assert.deepEqual([r.status, r.json.error], [403, 'read_only'], route);
    }
  }
  // an id that is nobody is refused the same way
  assert.equal((await s.call('POST', asP('log', 'r_nobody'), logBody('real-as-0000002'), { cookie: a.cookie })).status, 403);
  assert.equal(s.lines().length, before);
  const read = await s.call('GET', asP('me', ana.id), undefined, { cookie: a.cookie });
  assert.deepEqual([read.status, read.json.me.id, read.json.viewer.as], [200, ana.id, ana.id]);
});

test('a rep or a leader cannot act as anyone, the practice rep included', async (t) => {
  const { s, ana, lia, create, asP } = await setup(t);
  const P = (await create()).json.practice.id;
  const before = s.lines().length;
  const byRep = await s.call('POST', asP('log', P), logBody('rep-as-00000001'), { cookie: ana.cookie });
  assert.equal(byRep.status, 403);
  assert.equal((await s.call('POST', asP('lang', P), { lang: 'en' }, { cookie: lia.cookie })).status, 403);
  assert.equal((await s.call('POST', asP('log', P), logBody('lia-as-00000001'), { cookie: lia.cookie })).status, 403);
  assert.equal(s.lines().length, before);
  // a rep's ?as= on a read is ignored, as before: they see their own screens
  const own = await s.call('GET', asP('me', P), undefined, { cookie: ana.cookie });
  assert.deepEqual([own.status, own.json.me.id], [200, ana.id]);
});

test('nobody signs in as the practice rep, and it gives no kudos', async (t) => {
  const { s, a, ana, create, asP } = await setup(t);
  const P = (await create()).json.practice.id;
  await s.call('POST', `${API}/log`, logBody('ana-log-0000001'), { cookie: ana.cookie });
  // the practice rep's own feed holds practice lines only (Task 15): the real line is read from the manager's own screens
  const item = (await s.call('GET', `${API}/me`, undefined, { cookie: a.cookie })).json.feed.find((f) => f.rep === ana.id);
  assert.equal((await s.call('GET', asP('me', P), undefined, { cookie: a.cookie })).json.feed.some((f) => f.rep === ana.id), false);
  const clap = await s.call('POST', asP('kudos', P), { target: item.id }, { cookie: a.cookie });
  assert.deepEqual([clap.status, clap.json.error], [403, 'read_only']);
  assert.equal(s.lines().some((e) => e.type === 'kudos'), false);
});

test('practice data never counts: table, team numbers, the feed of others, needs, leadership view and export', async (t) => {
  const { s, a, ana, lia, create, asP } = await setup(t);
  await s.call('PUT', `${API}/leads`, [{ id: 'L-100', company: 'Taller Real Uno', zone: 'Centro', city: 'Panama City', stage: 'New' }, { id: 'L-200', company: 'Taller Real Dos', zone: 'Centro', city: 'Panama City', stage: 'New' }], { bearer: 'push-token' });
  const P = (await create()).json.practice.id;
  await s.call('POST', `${API}/log`, logBody('ana-log-0000001', { lead: { id: 'L-100' } }), { cookie: ana.cookie });
  await s.call('POST', asP('log', P), logBody('prac-log-000001', { lead: { name: 'Tienda Ensayo', zone: 'Centro' } }), { cookie: a.cookie });
  // a practice meeting on a real business: no stage, no do-not-call reaches the CRM
  await s.call('POST', asP('log', P), logBody('prac-log-000002', { kind: 'meeting', channel: 'visit', lead: { id: 'L-200' }, tag: 'do_not_call' }), { cookie: a.cookie });
  await s.call('POST', asP('close', P), { tomorrow: 'Seguir', blocker: '' }, { cookie: a.cookie });
  await s.call('POST', `${API}/site`, { rep: P, lead: { name: 'Sitio Ensayo' } }, { cookie: a.cookie });

  const anaMe = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json;
  const ids = (T) => [...T.podium, ...T.rest, ...(T.me ? [T.me] : [])].map((r) => r.id);
  for (const period of ['week', 'day', 'month']) assert.equal(ids(anaMe.table[period]).includes(P), false, period);
  assert.equal(anaMe.team.players, 1);
  assert.equal(anaMe.team.meetings, 0);
  assert.equal(anaMe.feed.some((f) => f.rep === P), false);
  const team = (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json;
  assert.equal(team.reps.some((r) => r.id === P), false);
  assert.equal(team.team.players, 1);
  assert.equal(team.needs.confirm.some((x) => x.rep === P), false);
  assert.equal(team.needs.silent.some((x) => x.rep === P), false);
  assert.equal(team.sites.find((x) => x.rep === P).practice, true);
  const adminFeed = (await s.call('GET', `${API}/me`, undefined, { cookie: a.cookie })).json.feed;
  assert.equal(adminFeed.some((f) => f.rep === P), false);
  // its own screens keep its own moves
  const own = (await s.call('GET', asP('me', P), undefined, { cookie: a.cookie })).json;
  assert.equal(own.feed.some((f) => f.rep === P), true);
  assert.equal(own.me.practice, true);

  const lead = (await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie })).json;
  assert.equal(lead.cities.flatMap((c) => c.reps).some((r) => r.id === P), false);
  assert.deepEqual([lead.practiceHidden, lead.practiceReps], [1, 1]);

  const out = (await s.call('GET', `${API}/export?since=2026-01-01T00:00:00Z`, undefined, { bearer: 'push-token' })).json;
  assert.deepEqual(out.logs.map((l) => l.id), ['ana-log-0000001']);
  assert.equal(out.newLeads.some((l) => l.company === 'Tienda Ensayo'), false);
  assert.equal(out.doNotCall.length, 0);
  assert.deepEqual(out.stages, [{ lead: 'L-100', stage: 'Contacted' }]);
});

test('a practice business is never offered to a real rep, and the same name typed by a real rep is a new business', async (t) => {
  const { s, a, ana, create, asP } = await setup(t);
  const P = (await create()).json.practice.id;
  await s.call('POST', asP('log', P), logBody('prac-log-000001', { lead: { name: 'Tienda Ensayo', zone: 'Centro' } }), { cookie: a.cookie });
  const practiceLead = s.lines().find((e) => e.type === 'practice.lead.added').lead.id;
  const found = await s.call('GET', `${API}/leads?q=Ensayo`, undefined, { cookie: ana.cookie });
  assert.deepEqual(found.json.leads, []);
  const byId = await s.call('POST', `${API}/log`, logBody('ana-log-0000001', { lead: { id: practiceLead } }), { cookie: ana.cookie });
  assert.deepEqual([byId.status, byId.json.error], [400, 'lead']);
  await s.call('POST', `${API}/log`, logBody('ana-log-0000002', { lead: { name: 'Tienda Ensayo', zone: 'Centro' } }), { cookie: ana.cookie });
  const real = s.lines().filter((e) => e.type === 'log').find((e) => e.rep === ana.id);
  assert.notEqual(real.lead.id, practiceLead);
});

test('a practice contact on a real business never makes a real rep\'s first contact a follow-up', async (t) => {
  const { s, a, ana, create, asP } = await setup(t);
  await s.call('PUT', `${API}/leads`, [{ id: 'L-100', company: 'Taller Real Uno', zone: 'Centro', city: 'Panama City', stage: 'New' }], { bearer: 'push-token' });
  const P = (await create()).json.practice.id;
  await s.call('POST', asP('log', P), logBody('prac-log-000001', { lead: { id: 'L-100' } }), { cookie: a.cookie });
  s.time.now += 24 * 3600 * 1000;   // Tuesday
  const r = await s.call('POST', `${API}/log`, logBody('ana-log-0000001', { lead: { id: 'L-100' }, clientAt: new Date(s.time.now).toISOString() }), { cookie: ana.cookie });
  assert.equal(r.status, 200);
  assert.equal(r.json.me.ledger.some((e) => e.code === 'followup'), false);
  assert.equal(r.json.me.recentLeads[0].id, 'L-100');
});

test('a site opened for the practice rep is always a practice site', async (t) => {
  const { s, a, create } = await setup(t);
  const P = (await create()).json.practice.id;
  const r = await s.call('POST', `${API}/site`, { rep: P, lead: { name: 'Sitio Ensayo' } }, { cookie: a.cookie });
  assert.equal(r.status, 200);
  assert.equal(s.lines().find((e) => e.type === 'site').practice, true);
  const legacy = await s.call('POST', `${API}/site`, { rep: P, lead: { name: 'Sitio Ensayo Dos' }, legacy: true }, { cookie: a.cookie });
  assert.equal(legacy.status, 200);
  const second = s.lines().filter((e) => e.type === 'site')[1];
  assert.deepEqual([second.practice, second.legacy], [true, undefined]);
});

test('open steps: a practice site takes DEMO-0001 as an IMEI once, after a consent; a real site refuses it', async (t) => {
  const { s, a, ana, create, asP } = await setup(t);
  const P = (await create()).json.practice.id;
  await s.call('POST', `${API}/site`, { id: 's_practice001', rep: P, lead: { name: 'Sitio Ensayo' } }, { cookie: a.cookie });
  await s.call('POST', `${API}/site`, { id: 's_realsite001', rep: ana.id, lead: { name: 'Taller Real' } }, { cookie: a.cookie });
  const add = (site, id, cookie) => s.call('POST', asP(`install/${site}/workers`, P), { id, name: `Persona ${id.slice(-1)}`, email: `p${id.slice(-1)}@equipo.test` }, { cookie });
  const upload = (id, cookie) => fetch(`${s.url}${asP(`worker/${id}/consent`, P)}`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie }, body: JPG });
  const phone = (id, imei, cookie) => s.call('POST', asP(`worker/${id}/phone`, P), { imei }, { cookie });
  assert.equal((await add('s_practice001', 'w_prac00001', a.cookie)).status, 200);
  assert.equal((await add('s_practice001', 'w_prac00002', a.cookie)).status, 200);
  // the consent lock stays on, on practice too
  assert.deepEqual([(await phone('w_prac00001', 'DEMO-0001', a.cookie)).json.error], ['consent_first']);
  assert.equal((await upload('w_prac00001', a.cookie)).status, 200);
  assert.equal((await upload('w_prac00002', a.cookie)).status, 200);
  const ok = await phone('w_prac00001', 'DEMO-0001', a.cookie);
  assert.equal(ok.status, 200);
  assert.equal(ok.json.workers.find((w) => w.id === 'w_prac00001').imei, 'DEMO-0001');
  const e = s.lines().find((x) => x.type === 'worker.phone');
  assert.deepEqual([e.imei, e.by], ['DEMO-0001', a.id]);
  // not the same value twice on that site
  const twice = await phone('w_prac00002', 'demo-0001', a.cookie);
  assert.deepEqual([twice.status, twice.json.error], [409, 'imei_taken']);
  // too short, or a character that is not a letter, digit, space or dash
  for (const bad of ['D1', 'DEMO_0001', 'x'.repeat(21)]) assert.equal((await phone('w_prac00002', bad, a.cookie)).status, 400, bad);
  // the real site keeps the real check, and a practice value never blocks a real IMEI
  await s.call('POST', `${API}/install/s_realsite001/workers`, { id: 'w_real00001', name: 'Persona R', email: 'pr@equipo.test' }, { cookie: ana.cookie });
  await fetch(`${s.url}${API}/worker/w_real00001/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: ana.cookie }, body: JPG });
  const real = await s.call('POST', `${API}/worker/w_real00001/phone`, { imei: 'DEMO-0001' }, { cookie: ana.cookie });
  assert.deepEqual([real.status, real.json.error], [400, 'imei']);
  assert.equal((await phone('w_prac00002', IMEI_A, a.cookie)).status, 200);
  assert.equal((await s.call('POST', `${API}/worker/w_real00001/phone`, { imei: IMEI_A }, { cookie: ana.cookie })).status, 200);
});

test('removing the practice rep clears it from every view; the events stay; a new one can be made', async (t) => {
  const { s, a, ana, lia, create, asP } = await setup(t);
  const P = (await create()).json.practice.id;
  await s.call('POST', asP('log', P), logBody('prac-log-000001', { lead: { name: 'Tienda Ensayo', zone: 'Centro' } }), { cookie: a.cookie });
  await s.call('POST', asP('close', P), { tomorrow: 'Seguir', blocker: '' }, { cookie: a.cookie });
  await s.call('POST', asP('ladder', P), { step: 'kit' }, { cookie: a.cookie });
  await s.call('POST', `${API}/site`, { id: 's_practice001', rep: P, lead: { name: 'Sitio Ensayo' } }, { cookie: a.cookie });
  await s.call('POST', `${API}/install/s_practice001/workers`, { id: 'w_prac00001', name: 'Persona Uno', email: 'p1@equipo.test' }, { cookie: a.cookie });
  await fetch(`${s.url}${API}/worker/w_prac00001/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: a.cookie }, body: JPG });
  await s.call('POST', `${API}/worker/w_prac00001/phone`, { imei: 'DEMO-0001' }, { cookie: a.cookie });
  const before = s.lines().length;
  const gone = await s.call('POST', `${API}/practice/remove`, {}, { cookie: a.cookie });
  assert.equal(gone.status, 200);
  assert.equal(gone.json.practice, null);
  assert.equal(gone.json.sites.some((x) => x.rep === P), false);
  // its site leaves first with an event every build knows, then the practice rep
  assert.deepEqual(s.lines().slice(before).map((e) => [e.type, e.siteId || e.id]), [['site.removed', 's_practice001'], ['rep.practice.removed', P]]);
  assert.equal((await s.call('GET', asP('me', P), undefined, { cookie: a.cookie })).status, 404);
  assert.equal((await s.call('POST', asP('log', P), logBody('prac-log-000009'), { cookie: a.cookie })).status, 403);
  const lead = (await s.call('GET', `${API}/lead`, undefined, { cookie: lia.cookie })).json;
  assert.deepEqual([lead.practiceHidden, lead.practiceReps], [0, 0]);
  const anaMe = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json;
  assert.equal(anaMe.feed.some((f) => f.rep === P), false);
  assert.equal((await s.call('POST', `${API}/practice/remove`, {}, { cookie: a.cookie })).status, 404);
  // the state rebuilt from the log agrees: nothing of it is left, and its IMEI and business went with it
  const store = openTeamStore(s.dir);
  assert.equal(store.state.reps.has(P), false);
  assert.equal([...store.state.logs.values()].some((l) => l.rep === P), false);
  assert.equal([...store.state.closes.keys()].some((k) => k.startsWith(`${P}|`)), false);
  assert.equal(store.state.ticks.has(`${P}|kit`), false);
  assert.equal(store.state.sites.has('s_practice001'), false);
  assert.equal(store.state.workers.has('w_prac00001'), false);
  assert.equal([...store.leads().values()].some((l) => l.company === 'Tienda Ensayo'), false);
  assert.equal(repView(store.state, ana.id, { now: new Date(s.time.now).toISOString() }).feed.some((f) => f.rep === P), false);
  const next = await create();
  assert.equal(next.status, 200);
  assert.notEqual(next.json.practice.id, P);
});

test('the practice rep is not on the lead list a manager edits, and its person record cannot be patched', async (t) => {
  const { s, a, create } = await setup(t);
  const P = (await create()).json.practice.id;
  const r = await s.call('POST', `${API}/reps/${P}`, { patch: { email: mail('nadie') } }, { cookie: a.cookie });
  assert.equal(r.status, 404);
  assert.equal(s.lines().some((e) => e.type === 'rep.updated' && e.id === P), false);
});
