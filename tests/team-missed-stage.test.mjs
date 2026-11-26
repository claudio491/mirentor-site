// "No ocurrió" takes the business back a stage, in the app and in the CRM. The bridge raised the CRM's stage within the
// hour of the meeting (or of the contract's sending), so the app keeps on the business's overlay the stage that log had
// raised it to (`lower.from`): while the CRM still says exactly that and no other log raises the business that far, the
// stage is the app's own, and the export asks the CRM to lower it (`lower: { from, to }`) until a push shows it moved.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { bizIndex, bizView, exportBiz } from '../lib/team/biz.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const DAY = 86400000;
const LEADS = [
  { id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New' },
  { id: 'PA-0002', company: 'Taller Dos', city: 'Panama City', zone: 'Centro', stage: 'New' },
];

async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = async (id, over) => { const r = await s.call('POST', `${API}/log`, logBody(id, { channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: mario.cookie }); assert.equal(r.status, 200, r.text); };
  const push = async (over) => assert.equal((await s.call('PUT', `${API}/leads`, LEADS.map((l) => ({ ...l, owner: 'mario Rep', ...(over[l.id] || {}) })), B)).status, 200);
  const card = async (id) => (await s.call('GET', `${API}/biz/${id}`, undefined, { cookie: mario.cookie })).json.biz;
  const row = async (id) => (await s.call('GET', `${API}/export?since=`, undefined, B)).json.biz.find((x) => x.lead === id) || null;
  const missed = async (logId) => { const r = await s.call('POST', `${API}/stalled`, { logId, what: 'missed' }, { cookie: a.cookie }); assert.equal(r.status, 200, r.text); };
  const progress = async () => (await s.call('GET', `${API}/scorecard?week=2026-11-16&rep=${mario.id}&cell=progress`, undefined, { cookie: a.cookie })).json.items.map((x) => x.id);
  return { s, a, mario, log, push, card, row, missed, progress };
}

test('a meeting that did not happen takes the business back to Contacted, here and in the CRM, until a push shows the CRM moved', async (t) => {
  const { s, log, push, card, row, missed, progress } = await setup(t);
  // Monday 16: the meeting is booked, and the bridge raises the CRM to Intro call booked
  await log('miss-log-0001', { lead: { id: 'PA-0001' }, kind: 'meeting', when: '2026-11-16' });
  await push({ 'PA-0001': { stage: 'Intro call booked' } });
  // Thursday 19: three days past, nobody marked it
  s.time.now += 3 * DAY;
  assert.equal((await card('PA-0001')).stage, 'Intro call booked');
  assert.deepEqual(await progress(), ['PA-0001']);
  assert.equal((await row('PA-0001'))?.lower ?? null, null);

  await missed('miss-log-0001');
  assert.equal((await card('PA-0001')).stage, 'Contacted');
  assert.deepEqual(await progress(), [], 'the Scorecard no longer counts it in progress');
  let r = await row('PA-0001');
  assert.deepEqual(r.lower, { from: 'Intro call booked', to: 'Contacted' });
  assert.equal(r.fields.at(-1), 'lower');

  // a push that still says Intro call booked changes nothing
  const synced = () => s.lines().filter((e) => e.type === 'biz.synced' && e.fields.includes('lower'));
  await push({ 'PA-0001': { stage: 'Intro call booked' } });
  assert.equal(synced().length, 0);
  assert.equal((await card('PA-0001')).stage, 'Contacted');
  assert.deepEqual((await row('PA-0001')).lower, { from: 'Intro call booked', to: 'Contacted' });

  // the bridge lowered it: one biz.synced with 'lower', and the export no longer names it
  await push({ 'PA-0001': { stage: 'Contacted' } });
  assert.equal(synced().length, 1);
  r = await row('PA-0001');
  assert.equal(r?.lower ?? null, null);
  assert.equal(r ? r.fields.includes('lower') : false, false);
  assert.equal((await card('PA-0001')).stage, 'Contacted');
});

test('a new meeting logged another day raises the business again, and the export asks no lowering', async (t) => {
  const { s, log, push, card, row, missed } = await setup(t);
  await log('miss-log-0002', { lead: { id: 'PA-0002' }, kind: 'meeting', when: '2026-11-16' });
  await push({ 'PA-0002': { stage: 'Intro call booked' } });
  s.time.now += 3 * DAY;
  await missed('miss-log-0002');
  assert.equal((await card('PA-0002')).stage, 'Contacted');
  assert.deepEqual((await row('PA-0002')).lower, { from: 'Intro call booked', to: 'Contacted' });
  // Friday 20: booked again
  s.time.now += DAY;
  await log('miss-log-0003', { lead: { id: 'PA-0002' }, kind: 'meeting', when: '2026-11-23' });
  assert.equal((await card('PA-0002')).stage, 'Intro call booked');
  const r = await row('PA-0002');
  assert.equal(r.lower, null);
  assert.equal(r.fields.includes('lower'), false);
});

test('a contract that did not happen goes back to the stage the app holds; one never sent, or a made-up from, sets nothing', () => {
  const T = (d, h = 15) => `2026-11-${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const st = emptyState();
  applyEvent(st, { type: 'rep.created', id: 'r1', handle: 'mario', name: 'Mario Paz', role: 'rep', tz: 'America/Panama', t: T(10) });
  const lg = (id, lead, kind, t, over = {}) => applyEvent(st, { type: 'log', id, rep: 'r1', lead: { id: lead, name: lead }, kind, channel: kind === 'meeting' ? 'visit' : undefined, t, holds: true, ...over });
  // PA-1: a meeting held, then a contract sent that never happened
  lg('L1', 'PA-1', 'meeting', T(16), { when: '2026-11-17' });
  applyEvent(st, { type: 'confirm', logId: 'L1', what: 'meeting_held', t: T(18) });
  lg('L2', 'PA-1', 'contract', T(18, 16));
  applyEvent(st, { type: 'confirm', logId: 'L2', what: 'contract_sent', t: T(18, 17) });
  // PA-2: a contract never sent; PA-3: a meeting; both with a hand-edited `from`
  lg('L3', 'PA-2', 'contract', T(16));
  lg('L4', 'PA-3', 'meeting', T(16), { when: '2026-11-16' });
  applyEvent(st, { type: 'meeting.missed', logId: 'L2', by: 'boss', t: T(27) });
  applyEvent(st, { type: 'meeting.missed', logId: 'L3', by: 'boss', from: 'Contract sent', t: T(27) });
  applyEvent(st, { type: 'meeting.missed', logId: 'L4', by: 'boss', from: 'Contract signed', t: T(27) });
  const leads = new Map([['PA-1', 'Contract sent'], ['PA-2', 'Contacted'], ['PA-3', 'Intro call booked']].map(([id, stage]) => [id, { id, company: id, city: 'Panama City', stage }]));
  const index = bizIndex(st, leads), stage = (id) => bizView(st, leads.get(id), { now: T(27, 16), index }).stage;
  const rows = new Map(exportBiz(st, 0, leads).map((x) => [x.lead, x]));
  assert.equal(stage('PA-1'), 'Intro call done');
  assert.deepEqual(rows.get('PA-1').lower, { from: 'Contract sent', to: 'Intro call done' });
  assert.equal(st.biz.get('PA-2')?.lower, undefined, 'the CRM was never raised: nothing to lower');
  assert.equal(stage('PA-2'), 'Contacted');
  assert.equal(rows.get('PA-2')?.lower ?? null, null);
  assert.deepEqual(st.biz.get('PA-3').lower.from, 'Intro call booked', 'the reducer derives `from` itself');
  assert.equal(stage('PA-3'), 'Contacted');
  assert.deepEqual(rows.get('PA-3').lower, { from: 'Intro call booked', to: 'Contacted' });
});

test('a done meeting or a signed contract cannot be marked as not happened on replay, and a stage only goes back to an open one', () => {
  const T = (d, h = 15) => `2026-11-${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const st = emptyState();
  applyEvent(st, { type: 'rep.created', id: 'r1', handle: 'mario', name: 'Mario Paz', role: 'rep', tz: 'America/Panama', t: T(10) });
  const lg = (id, lead, kind, t, over = {}) => applyEvent(st, { type: 'log', id, rep: 'r1', lead: { id: lead, name: lead }, kind, channel: kind === 'meeting' ? 'visit' : undefined, t, holds: true, ...over });
  const missed = (logId) => applyEvent(st, { type: 'meeting.missed', logId, by: 'boss', rep: 'r1', next: { day: '2026-11-27', step: 'Reagendar la reunión' }, t: T(27) });
  // PA-1: a meeting confirmed held; PA-2: a contract confirmed sent and signed; PA-3: a contract only sent
  lg('L1', 'PA-1', 'meeting', T(16), { when: '2026-11-17' });
  applyEvent(st, { type: 'confirm', logId: 'L1', what: 'meeting_held', t: T(18) });
  lg('L2', 'PA-2', 'contract', T(16));
  applyEvent(st, { type: 'confirm', logId: 'L2', what: 'contract_sent', t: T(17) });
  applyEvent(st, { type: 'confirm', logId: 'L2', what: 'contract_signed', t: T(18) });
  lg('L3', 'PA-3', 'contract', T(16));
  applyEvent(st, { type: 'confirm', logId: 'L3', what: 'contract_sent', t: T(17) });
  const before = (id) => { const o = st.biz.get(id); return o ? structuredClone({ ...o, synced: [...o.synced] }) : null; };
  const pa1 = before('PA-1'), pa2 = before('PA-2');
  for (const id of ['L1', 'L2', 'L3']) missed(id);
  assert.deepEqual([st.missed.has('L1'), st.missed.has('L2'), st.missed.has('L3')], [false, false, true]);
  assert.deepEqual([before('PA-1'), before('PA-2')], [pa1, pa2], 'nothing of a refused line reaches the business');
  assert.equal(st.biz.get('PA-3').lower.from, 'Contract sent');

  // an overlay whose lowering would land on a stage a rep can no longer be at asks the CRM for nothing
  const leads = new Map([['PA-3', 'Contract sent'], ['PA-4', 'Contract signed']].map(([id, stage]) => [id, { id, company: id, city: 'Panama City', stage }]));
  lg('L4', 'PA-4', 'contract', T(16));
  applyEvent(st, { type: 'confirm', logId: 'L4', what: 'contract_sent', t: T(17) });
  st.biz.set('PA-4', { synced: new Set(), at: T(27), lower: { from: 'Contract signed', t: T(27) } });
  st.count += 1;
  const rows = new Map(exportBiz(st, 0, leads).map((x) => [x.lead, x]));
  assert.deepEqual(rows.get('PA-3').lower, { from: 'Contract sent', to: 'Contacted' });
  assert.equal(rows.get('PA-4')?.lower ?? null, null, 'Contract sent is not a stage a business goes back to');
});

test('a meeting booked again in the CRM after the one that did not happen keeps the business at Intro call booked', async (t) => {
  const { s, mario, log, push, card, row, missed } = await setup(t);
  // Monday 16: both meetings booked in the app, and the bridge raises the CRM to Intro call booked
  await log('miss-log-0004', { lead: { id: 'PA-0001' }, kind: 'meeting', when: '2026-11-16' });
  await log('miss-log-0005', { lead: { id: 'PA-0002' }, kind: 'meeting', when: '2026-11-16' });
  await push({ 'PA-0001': { stage: 'Intro call booked' }, 'PA-0002': { stage: 'Intro call booked' } });
  // Thursday 19: the sheet's Activities carry a "Meeting booked" row on the 18th for PA-0001, and one on the 15th for PA-0002
  s.time.now += 3 * DAY;
  const r = await s.call('PUT', `${API}/activity`, { source: 'crm', rows: [
    { id: 'crm_M-0001', rep: mario.id, day: '2026-11-18', kind: 'meeting', channel: 'call', lead: { id: 'PA-0001', name: 'Taller Uno' } },
    { id: 'crm_M-0002', rep: mario.id, day: '2026-11-15', kind: 'meeting', channel: 'call', lead: { id: 'PA-0002', name: 'Taller Dos' } },
  ] }, B);
  assert.deepEqual([r.status, r.json.added], [200, 2], r.text);
  await missed('miss-log-0004');
  await missed('miss-log-0005');
  assert.equal((await card('PA-0001')).stage, 'Intro call booked', 'booked again in the sheet after the 16th: the stage stays');
  assert.equal((await row('PA-0001'))?.lower ?? null, null);
  assert.equal((await card('PA-0002')).stage, 'Contacted', 'a row from before the 16th does not stop the lowering');
  assert.deepEqual((await row('PA-0002')).lower, { from: 'Intro call booked', to: 'Contacted' });
});
