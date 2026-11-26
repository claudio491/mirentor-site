// What the app said about a business goes to the CRM through GET export until a push of the lead list carries it back
// (biz.synced): from then on the CRM's cell wins, so a correction typed in the sheet shows and is not written over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { syncedFields, exportBiz } from '../lib/team/biz.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const LEAD = { id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New' };

async function team(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose');
  assert.equal((await s.call('PUT', `${API}/leads`, [LEAD, { ...LEAD, id: 'PA-0002', company: 'Taller Dos' }], B)).status, 200);
  const log = (who, id, over = {}) => s.call('POST', `${API}/log`, logBody(id, { lead: { id: 'PA-0001' }, channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: who.cookie });
  const exp = async (since = '') => { const r = await s.call('GET', `${API}/export?since=${encodeURIComponent(since)}`, undefined, B); assert.equal(r.status, 200, r.text); return r.json; };
  return { s, a, mario, jose, log, exp };
}

test('a take goes out with its owner, next step, contact and phone, each defused for the sheet', async (t) => {
  const { mario, log, exp } = await team(t);
  const r = await log(mario, 'exp-log-00001', { kind: 'talk', next: { day: '2026-11-18', step: '=1+1 llamar' }, contact: '-Ana', phone: '+507 6000-0000' });
  assert.equal(r.status, 200, r.text);
  const out = await exp();
  assert.deepEqual(out.biz, [{ lead: 'PA-0001', owner: 'mario Rep', next: { day: '2026-11-18', step: "'=1+1 llamar" }, stage: null, reopen: false, reason: null, workers: null, contact: "'-Ana", phone: "'+507 6000-0000",
    qual: null, qualNote: null, lower: null, at: '2026-11-16T15:00:00.000Z', fields: ['owner', 'next', 'contact', 'phone'] }]);
  assert.deepEqual([out.logs[0].next, out.logs[0].time], [{ day: '2026-11-18', step: "'=1+1 llamar" }, null]);
});

test('Lost goes out with its reason, and a release as Libre', async (t) => {
  const { s, mario, log, exp } = await team(t);
  await log(mario, 'exp-log-00001', { next: { day: '2026-11-18', step: 'Volver' } });
  await log(mario, 'exp-log-00002', { kind: 'call', channel: 'call', tag: 'not_interested', lost: 'no_trust' });
  let row = (await exp()).biz[0];
  assert.deepEqual([row.stage, row.reason, row.next, row.fields], ['Lost', 'no_trust', null, ['owner', 'next', 'stage']]);
  await s.call('POST', `${API}/biz/PA-0001`, { release: true }, { cookie: mario.cookie });
  row = (await exp()).biz[0];
  assert.deepEqual([row.owner, row.fields.includes('owner')], ['Libre', true]);
  // a meeting's time goes out on its log row
  await log(mario, 'exp-log-00003', { lead: { id: 'PA-0002' }, kind: 'meeting', when: '2026-11-18', time: '10:30' });
  assert.equal((await exp()).logs.find((l) => l.id === 'exp-log-00003').time, '10:30');
});

test('once the CRM carries the same values back, the fields are synced; then the CRM\'s edit wins and is not exported', async (t) => {
  const { s, mario, log, exp } = await team(t);
  await log(mario, 'exp-log-00001', { next: { day: '2026-11-18', step: '=1+1 llamar' }, contact: '-Ana', phone: '+507 6000-0000' });
  const back = { ...LEAD, owner: 'mario Rep', nextDay: '2026-11-18', nextStep: '=1+1 llamar', contact: '-Ana', phone: '+507 6000-0000' };
  assert.equal((await s.call('PUT', `${API}/leads`, [back, { ...LEAD, id: 'PA-0002', company: 'Taller Dos' }], B)).status, 200);
  const synced = s.lines().filter((e) => e.type === 'biz.synced');
  assert.deepEqual(synced.map((e) => [e.lead, e.fields]), [['PA-0001', ['owner', 'next', 'contact', 'phone']]]);
  assert.deepEqual((await exp()).biz, [], 'a row with nothing left to write is not sent');
  // the same push again appends nothing more
  await s.call('PUT', `${API}/leads`, [back, { ...LEAD, id: 'PA-0002', company: 'Taller Dos' }], B);
  assert.equal(s.lines().filter((e) => e.type === 'biz.synced').length, 1);
  // the CRM edits the next follow-up: it shows, and nothing goes back
  s.time.now += 3600000;
  const since = new Date(s.time.now).toISOString();
  await s.call('PUT', `${API}/leads`, [{ ...back, nextDay: '2026-11-25' }, { ...LEAD, id: 'PA-0002', company: 'Taller Dos' }], B);
  const row = (await s.call('GET', `${API}/leads?q=Taller Uno`, undefined, { cookie: mario.cookie })).json.leads[0];
  assert.deepEqual([row.next, row.owner], [{ day: '2026-11-25', step: '=1+1 llamar' }, { name: 'mario', mine: true }]);
  assert.deepEqual((await exp(since)).biz, []);
});

test('a business Lost in the CRM and reopened in the app goes out as a reopen until the CRM leaves Lost', async (t) => {
  const { s, mario, log, exp } = await team(t);
  const lost = { ...LEAD, stage: 'Lost', owner: 'mario Rep', lastContact: '2026-11-10' }, two = { ...LEAD, id: 'PA-0002', company: 'Taller Dos' };
  assert.equal((await s.call('PUT', `${API}/leads`, [lost, two], B)).status, 200);
  const r = await log(mario, 'reopen-log-001', { kind: 'call', channel: 'call' });
  assert.deepEqual([r.status, s.lines().filter((e) => e.type === 'log').at(-1).lost], [200, null]);
  assert.deepEqual((await exp()).biz.map(({ lead, owner, next, stage, reopen, reason, fields }) => ({ lead, owner, next, stage, reopen, reason, fields })),
    [{ lead: 'PA-0001', owner: null, next: null, stage: null, reopen: true, reason: null, fields: ['stage'] }]);
  // the same push (still Lost) syncs nothing; one at Contacted does
  await s.call('PUT', `${API}/leads`, [lost, two], B);
  assert.equal(s.lines().filter((e) => e.type === 'biz.synced').length, 0);
  await s.call('PUT', `${API}/leads`, [{ ...lost, stage: 'Contacted' }, two], B);
  assert.deepEqual(s.lines().filter((e) => e.type === 'biz.synced').map((e) => e.fields), [['stage']]);
  assert.deepEqual((await exp()).biz, []);
});

test('a practice business never goes out', async (t) => {
  const { s, a, exp } = await team(t);
  await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie });
  const prac = s.lines().find((e) => e.type === 'rep.practice').id;
  const r = await s.call('POST', `${API}/log?as=${prac}`, logBody('prac-exp-0001', { lead: { name: 'Taller de Práctica', zone: 'Centro' }, next: { day: '2026-11-18', step: 'Volver' } }), { cookie: a.cookie });
  assert.equal(r.status, 200, r.text);
  const pid = s.lines().find((e) => e.type === 'practice.lead.added').lead.id;
  assert.equal((await s.call('GET', `${API}/biz/${pid}?as=${prac}`, undefined, { cookie: a.cookie })).json.biz.next.day, '2026-11-18');
  assert.deepEqual((await exp()).biz, []);
});

test('syncedFields: a release meets a CRM owner who holds nothing; a reopen meets a stage that is open', () => {
  const s = emptyState();
  for (const e of [
    { type: 'rep.created', id: 'r_marta', handle: 'marta', email: 'marta@ejemplo.test', name: 'Marta Pineda', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: '2026-10-01T15:00:00Z' },
    { type: 'biz.owner', lead: 'PA-0001', owner: null, by: 'r_x', t: '2026-11-16T15:00:00Z' },
    { type: 'biz.reopen', lead: 'PA-0001', rep: 'r_marta', by: 'r_x', t: '2026-11-16T15:00:00Z' },
  ]) applyEvent(s, e);
  assert.deepEqual(syncedFields(s, 'PA-0001', { ...LEAD, owner: 'Marta Pineda', stage: 'Lost' }), []);
  assert.deepEqual(syncedFields(s, 'PA-0001', { ...LEAD, owner: 'Libre (correo automático)', stage: 'Contacted' }), ['owner', 'stage']);
  assert.deepEqual(syncedFields(s, 'PA-0009', LEAD), []);
  assert.deepEqual(exportBiz(s, Date.parse('2026-11-16T15:00:00Z'), new Map()).map((b) => [b.owner, b.stage, b.reopen, b.fields]), [['Libre', null, false, ['owner']]]);
  assert.deepEqual(exportBiz(s, Date.parse('2026-11-16T15:00:00Z'), new Map([['PA-0001', { ...LEAD, stage: 'Lost' }]])).map((b) => [b.stage, b.reopen, b.fields]), [[null, true, ['owner', 'stage']]]);
  assert.deepEqual(exportBiz(s, Date.parse('2026-11-16T15:00:01Z'), new Map()), []);
  // a name that starts like a formula is defused too
  applyEvent(s, { type: 'rep.created', id: 'r_odd', handle: 'odd', email: 'odd@ejemplo.test', name: '=Raro Uno', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: '2026-10-01T15:00:00Z' });
  applyEvent(s, { type: 'biz.owner', lead: 'PA-0002', owner: 'r_odd', by: 'r_x', t: '2026-11-16T16:00:00Z' });
  assert.equal(exportBiz(s, Date.parse('2026-11-16T16:00:00Z'), new Map())[0].owner, "'=Raro Uno");
});
