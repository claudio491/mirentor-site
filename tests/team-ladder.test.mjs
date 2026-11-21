import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { LADDER, VIDEOS, STEP_VIDEO } from '../lib/team/rules.mjs';
import { ladderOf } from '../lib/team/ladder.mjs';
import { searchLeads } from '../lib/team/store.mjs';
import { teamView } from '../lib/team/view.mjs';
import { leaderView } from '../lib/team/leader.mjs';

const API = '/equipo/api';
const NOW = '2026-11-18T15:00:00.000Z';
const ctx = { now: NOW };
const done = (state, id = 'r1') => ladderOf(state, id, ctx).filter((s) => s.done).map((s) => s.step);

function world(events = []) {
  const state = emptyState();
  const all = [{ type: 'rep.created', id: 'r1', handle: 'ana', name: 'Ana Rep', role: 'rep', city: 'Panama City', t: '2026-11-02T14:00:00Z' }, ...events];
  for (const e of all) applyEvent(state, e);
  return state;
}
const talk = (id, kind = 'talk', t = '2026-11-16T15:00:00Z') => ({ type: 'log', id, rep: 'r1', lead: { id: `L-${id}`, name: `Negocio ${id}` }, kind, channel: kind === 'talk' ? 'visit' : undefined, t });

test('the ladder starts with nothing done', () => {
  const rows = ladderOf(world(), 'r1', ctx);
  assert.deepEqual(rows.map((r) => r.step), LADDER);
  assert.equal(rows.every((r) => r.done === false), true);
  assert.deepEqual(rows.map((r) => r.by), ['rep', 'rep', 'rep', 'rep', 'app', 'app', 'app', 'app', 'app', 'manager']);
  assert.deepEqual(rows.find((r) => r.step === 'talk').video, STEP_VIDEO.talk);
  assert.equal(rows.find((r) => r.step === 'kit').video, null);
});

test('a rep ticks only video, kit and whatsapp', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), mgr = await s.addRep(a.cookie, 'mara', { role: 'manager' });
  const tick = (body, cookie = ana.cookie) => s.call('POST', `${API}/ladder`, body, { cookie });
  for (const step of ['video', 'kit', 'whatsapp']) assert.equal((await tick({ step })).status, 200);
  const me = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json;
  assert.deepEqual(me.ladder.filter((x) => x.done).map((x) => x.step), ['video', 'kit', 'whatsapp']);
  const before = s.lines().length;
  assert.equal(s.lines().filter((e) => e.type === 'ladder.tick').length, 3);
  // the same tick again appends nothing
  assert.equal((await tick({ step: 'kit' })).status, 200);
  assert.equal(s.lines().length, before);
  // steps the app decides, the manager's step, another rep's ladder and made-up steps
  for (const step of ['zones', 'talk', 'report', 'meeting', 'contract', 'install']) assert.deepEqual([(await tick({ step })).status, (await tick({ step })).json.error], [403, 'step_locked'], step);
  assert.deepEqual([(await tick({ step: 'hour' })).status], [403]);
  assert.deepEqual([(await tick({ step: 'video', rep: mgr.id })).status], [403]);
  const bad = await tick({ step: 'bailar' });
  assert.deepEqual([bad.status, bad.json.error], [400, 'step']);
  assert.equal((await tick({ step: 5 })).status, 400);
  assert.equal(s.lines().length, before, 'nothing else was appended');
});

test('picking two zones ticks the zones step and orders the lead search', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  await s.call('PUT', `${API}/leads`, [
    { id: 'P1', company: 'Ferretería Norte', city: 'Panama City', zone: 'Vía España', stage: 'New' },
    { id: 'P2', company: 'Ferretería Sur', city: 'Panama City', zone: 'el Cangrejo', stage: 'New' },
    { id: 'P3', company: 'Ferretería Este', city: 'Panama City', zone: 'Costa del Este', stage: 'New' },
    { id: 'P4', company: 'Ferretería Eco', city: 'Panama City', zone: 'VIA ESPAÑA', stage: 'New' },
    { id: 'P5', company: 'Ferretería Vacía', city: 'Panama City', zone: '', stage: 'New' },
    { id: 'P6', company: 'Ferretería Colón', city: 'Colón', zone: 'Zona Libre', stage: 'New' },
    { id: 'P7', company: 'Ferretería Firmada', city: 'Panama City', zone: 'Obarrio', stage: 'Contract signed' },
  ], { bearer: 'push-token' });
  const list = await s.call('GET', `${API}/zones`, undefined, { cookie: ana.cookie });
  assert.deepEqual(list.json.zones, ['Costa del Este', 'el Cangrejo', 'Vía España']);
  assert.deepEqual(list.json.picked, []);
  const names = async () => (await s.call('GET', `${API}/leads?q=ferre`, undefined, { cookie: ana.cookie })).json.leads.map((l) => l.id);
  assert.deepEqual(await names(), ['P1', 'P2', 'P3', 'P4', 'P5']);
  const pick = await s.call('POST', `${API}/zones`, { zones: ['costa del este', 'VIA España'] }, { cookie: ana.cookie });
  assert.equal(pick.status, 200);
  assert.equal(pick.json.me.ladder.find((x) => x.step === 'zones').done, true);
  assert.deepEqual((await s.call('GET', `${API}/zones`, undefined, { cookie: ana.cookie })).json.picked, ['Costa del Este', 'Vía España']);
  assert.deepEqual(await names(), ['P1', 'P3', 'P4', 'P2', 'P5']);
  // the same pick again appends nothing; a new pick replaces the old one and the step stays done
  const n = s.lines().length;
  await s.call('POST', `${API}/zones`, { zones: ['Vía España', 'Costa del Este'] }, { cookie: ana.cookie });
  assert.equal(s.lines().length, n);
  const again = await s.call('POST', `${API}/zones`, { zones: ['el Cangrejo', 'Vía España'] }, { cookie: ana.cookie });
  assert.equal(again.json.me.ladder.find((x) => x.step === 'zones').done, true);
  assert.deepEqual(await names(), ['P1', 'P2', 'P4', 'P3', 'P5']);
});

test('searchLeads without zones behaves as before and with zones keeps order inside each group', () => {
  const leads = new Map([['1', { id: '1', company: 'Casa A', zone: 'Uno' }], ['2', { id: '2', company: 'Casa B', zone: 'Dos' }], ['3', { id: '3', company: 'Casa C', zone: 'dos' }], ['4', { id: '4', company: 'Casa D', zone: 'Uno' }]]);
  assert.deepEqual(searchLeads(leads, 'casa', '').map((l) => l.id), ['1', '2', '3', '4']);
  assert.deepEqual(searchLeads(leads, 'casa', '', 20, []).map((l) => l.id), ['1', '2', '3', '4']);
  assert.deepEqual(searchLeads(leads, 'casa', '', 20, ['DÓS']).map((l) => l.id), ['2', '3', '1', '4']);
  assert.deepEqual(searchLeads(leads, 'casa', '', 2, ['Dos']).map((l) => l.id), ['2', '3']);
});

test('three zones or a zone outside the city is refused', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  await s.call('PUT', `${API}/leads`, [
    { id: 'P1', company: 'Uno', city: 'Panama City', zone: 'Vía España', stage: 'New' }, { id: 'P2', company: 'Dos', city: 'Panama City', zone: 'Obarrio', stage: 'New' },
    { id: 'P3', company: 'Tres', city: 'Panama City', zone: 'Costa del Este', stage: 'New' }, { id: 'P6', company: 'Seis', city: 'Colón', zone: 'Zona Libre', stage: 'New' },
  ], { bearer: 'push-token' });
  const before = s.lines().length;
  for (const zones of [['Vía España', 'Obarrio', 'Costa del Este'], ['Vía España'], [], ['Vía España', 'Zona Libre'], ['Vía España', 'vía españa'], ['Vía España', 5], 'Vía España', undefined]) {
    const r = await s.call('POST', `${API}/zones`, { zones }, { cookie: ana.cookie });
    assert.deepEqual([r.status, r.json.error], [400, 'zones'], JSON.stringify(zones));
  }
  assert.equal(s.lines().length, before);
});

test('a first conversation, close, meeting and signed contract tick their steps without anyone asking', () => {
  assert.deepEqual(done(world([talk('l-a1', 'absent')])), []);   // a visit with nobody there is not a conversation
  assert.deepEqual(done(world([talk('l-a1', 'noanswer')])), []);
  assert.deepEqual(done(world([talk('l-a1')])), ['talk']);
  assert.deepEqual(done(world([talk('l-a1'), { type: 'log.void', logId: 'l-a1', by: 'x' }])), []);
  assert.deepEqual(done(world([{ type: 'day.close', rep: 'r1', day: '2026-11-16', t: '2026-11-16T23:00:00Z' }])), ['report']);
  assert.deepEqual(done(world([talk('l-m1', 'meeting')])), ['talk', 'meeting']);
  const sent = talk('l-c1', 'contract');
  assert.deepEqual(done(world([sent])), []);
  assert.deepEqual(done(world([sent, { type: 'confirm', logId: 'l-c1', what: 'contract_sent', t: '2026-11-17T15:00:00Z' }])), []);
  assert.deepEqual(done(world([sent, { type: 'confirm', logId: 'l-c1', what: 'contract_signed', t: '2026-11-17T15:00:00Z' }])), ['contract']);
});

test('an install on a practice site does not tick the install step', () => {
  const site = (id, over = {}) => ({ type: 'site', id, rep: 'r1', lead: { name: `Sitio ${id}` }, t: '2026-11-10T15:00:00Z', ...over });
  const close = (id) => ({ type: 'install.close', siteId: id, by: 'r1', t: '2026-11-11T15:00:00Z' });
  assert.deepEqual(done(world([site('s_practice1', { practice: true }), close('s_practice1')])), []);
  assert.deepEqual(done(world([site('s_real0001'), close('s_real0001')])), ['install']);
  // closed by someone else, or on a site voided afterwards, or never closed
  assert.deepEqual(done(world([site('s_real0001'), { type: 'install.close', siteId: 's_real0001', by: 'other', t: '2026-11-11T15:00:00Z' }])), []);
  assert.deepEqual(done(world([site('s_real0001'), close('s_real0001'), { type: 'site.void', siteId: 's_real0001', t: '2026-11-12T15:00:00Z' }])), []);
  assert.deepEqual(done(world([site('s_real0001')])), []);
  // a real site closed after a practice one still ticks
  assert.deepEqual(done(world([site('s_practice1', { practice: true }), close('s_practice1'), site('s_real0001'), close('s_real0001')])), ['install']);
  // a removed practice site leaves nothing behind
  assert.deepEqual(done(world([site('s_practice1', { practice: true }), close('s_practice1'), { type: 'site.removed', siteId: 's_practice1' }])), []);
});

test('only a manager ticks the first approved hour', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto'), mgr = await s.addRep(a.cookie, 'mara', { role: 'manager' });
  const lia = (await s.call('POST', `${API}/reps`, { email: 'lia@equipo.test', name: 'Lia Lider', role: 'leader' }, { cookie: a.cookie }));
  const post = (body, cookie) => s.call('POST', `${API}/ladder`, body, { cookie });
  assert.deepEqual([(await post({ step: 'hour', rep: ana.id }, ana.cookie)).status], [403]);
  assert.deepEqual([(await post({ step: 'hour' }, ana.cookie)).status], [403]);
  assert.deepEqual([(await post({ step: 'hour', rep: ana.id }, beto.cookie)).status], [403]);
  assert.equal(s.lines().some((e) => e.type === 'ladder.tick'), false);
  const noRep = await post({ step: 'hour' }, mgr.cookie);
  assert.deepEqual([noRep.status, noRep.json.error], [400, 'rep']);
  const ghost = await post({ step: 'hour', rep: 'r_nadie' }, mgr.cookie);
  assert.deepEqual([ghost.status, ghost.json.error], [404, 'rep']);
  const selfStep = await post({ step: 'video', rep: ana.id }, mgr.cookie);
  assert.deepEqual([selfStep.status, selfStep.json.error], [403, 'step_locked']);
  assert.equal((await post({ step: 'hour', rep: ana.id }, mgr.cookie)).status, 200);
  const n = s.lines().length;
  assert.equal((await post({ step: 'hour', rep: ana.id }, mgr.cookie)).status, 200);
  assert.equal(s.lines().length, n, 'a second tick appends nothing');
  const mine = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.ladder;
  assert.equal(mine.find((x) => x.step === 'hour').done, true);
  assert.equal(mine.find((x) => x.step === 'hour').by, 'manager');
  const other = (await s.call('GET', `${API}/me`, undefined, { cookie: beto.cookie })).json.ladder;
  assert.equal(other.find((x) => x.step === 'hour').done, false);
  void lia;
});

test('a video with no address reports hasVideo false', () => {
  const rows = ladderOf(world(), 'r1', ctx);
  for (const r of rows) assert.equal(r.hasVideo, false);
  assert.equal(Object.values(VIDEOS).every((v) => v === null), true);
  VIDEOS.welcome = 'https://videos.equipo.test/bienvenida.mp4';
  try {
    const row = ladderOf(world(), 'r1', ctx).find((r) => r.step === 'video');
    assert.deepEqual([row.video, row.hasVideo], ['welcome', true]);
    assert.equal(ladderOf(world(), 'r1', ctx).find((r) => r.step === 'talk').hasVideo, false);
  } finally { VIDEOS.welcome = null; }
});

test('a seen video is listed for the manager, once, and a made-up one is refused', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), mgr = await s.addRep(a.cookie, 'mara', { role: 'manager' });
  const seen = (video, cookie = ana.cookie) => s.call('POST', `${API}/seen`, { video }, { cookie });
  assert.equal((await seen('pitch')).status, 200);
  const n = s.lines().length;
  assert.equal((await seen('pitch')).status, 200);
  assert.equal(s.lines().length, n);
  for (const v of ['bailar', '', 7, undefined, '__proto__', 'toString']) { const r = await seen(v); assert.deepEqual([r.status, r.json.error], [400, 'video'], String(v)); }
  assert.equal(s.lines().length, n);
  assert.deepEqual((await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.seen, ['pitch']);
  const team = (await s.call('GET', `${API}/team`, undefined, { cookie: mgr.cookie })).json;
  const row = team.reps.find((r) => r.id === ana.id);
  assert.deepEqual([row.seen, row.ladderDone], [['pitch'], 0]);
});

test('the leader view carries seen and ladderDone, and a leader may not touch any of it', async (t) => {
  const state = world([{ type: 'video.seen', rep: 'r1', video: 'welcome' }, { type: 'ladder.tick', rep: 'r1', step: 'video' }, talk('l-a1')]);
  const lead = leaderView(state, ctx).cities.flatMap((c) => c.reps).find((r) => r.id === 'r1');
  assert.deepEqual([lead.seen, lead.ladderDone], [['welcome'], 2]);
  assert.deepEqual([teamView(state, ctx).reps[0].seen, teamView(state, ctx).reps[0].ladderDone], [['welcome'], 2]);
  // unknown steps and videos in an old or hand-written log are ignored
  const odd = world([{ type: 'ladder.tick', rep: 'r1', step: 'talk' }, { type: 'ladder.tick', rep: 'r1', step: 'bogus' }, { type: 'video.seen', rep: 'r1', video: 'bogus' }, { type: 'zones.pick', rep: 'r1', zones: ['solo una'] }]);
  assert.deepEqual(done(odd), []);

  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const made = await s.call('POST', `${API}/reps`, { email: 'lia@equipo.test', name: 'Lia Lider', role: 'leader' }, { cookie: a.cookie });
  assert.equal(made.status, 200);
  const cookie = 'who=lia%40equipo.test', before = s.lines().length;
  for (const [method, p, body] of [['GET', 'zones'], ['POST', 'zones', { zones: ['a', 'b'] }], ['POST', 'ladder', { step: 'video' }], ['POST', 'ladder', { step: 'hour', rep: ana.id }], ['POST', 'seen', { video: 'pitch' }]]) {
    const r = await s.call(method, `${API}/${p}`, body, { cookie });
    assert.deepEqual([r.status, r.json?.error], [403, 'read_only'], `${method} ${p}`);
  }
  assert.equal(s.lines().length, before);
});
