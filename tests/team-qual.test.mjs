// A log carries the qualification: how many work with their hands, whether there is Wi-Fi and whether someone
// coordinates. The business keeps the latest known answer per row; "No sé" never erases a yes or a no.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { checkQ, mergeQ, qualOf, QUAL, QUAL_KINDS, WORKERS_FLOOR } from '../lib/team/rules.mjs';
import * as biz from '../lib/team/biz.mjs';
import { scorecardOf } from '../lib/team/scorecard.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const LEADS = [{ id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New' }];

test('checkQ keeps only the three rows and their values; mergeQ never lets unknown replace yes or no', () => {
  assert.deepEqual(checkQ({ workers: '10_29', wifi: 'maybe', lead: 'yes', x: 1 }), { workers: '10_29', lead: 'yes' });
  assert.equal(checkQ({ wifi: 'maybe' }), null); assert.equal(checkQ('yes'), null); assert.equal(checkQ([]), null);
  assert.deepEqual(mergeQ({ wifi: 'yes', lead: 'no' }, { wifi: 'unknown', lead: 'yes', workers: 'lt10' }), { wifi: 'yes', lead: 'yes', workers: 'lt10' });
  assert.deepEqual(mergeQ(undefined, { wifi: 'unknown' }), { wifi: 'unknown' });
  assert.deepEqual(qualOf({ wifi: 'yes', lead: 'yes' }), { state: 'yes', missing: [] });
  assert.deepEqual(qualOf({ wifi: 'no', lead: 'unknown' }), { state: 'no', missing: [] });
  assert.deepEqual(qualOf({ wifi: 'yes' }), { state: 'missing', missing: ['lead'] });
  assert.deepEqual(qualOf(null), { state: 'missing', missing: ['wifi', 'lead'] });
  // the lists, and biz.mjs re-exports the helpers
  assert.deepEqual(QUAL, { workers: ['lt10', '10_29', '30_49', '50plus'], wifi: ['yes', 'no', 'unknown'], lead: ['yes', 'no', 'unknown'] });
  assert.deepEqual(QUAL_KINDS, ['talk', 'call', 'meeting', 'contract']);
  assert.deepEqual(WORKERS_FLOOR, { lt10: 1, '10_29': 10, '30_49': 30, '50plus': 50 });
  assert.deepEqual([biz.qualOf, biz.checkQ, biz.mergeQ], [qualOf, checkQ, mergeQ]);
});

test('a later No sé never replaces a yes or a no, and a partial answer keeps the other rows', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose');
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = (who, id, over = {}, cookie = who.cookie) => s.call('POST', `${API}/log`, logBody(id, { lead: { id: 'PA-0001' }, channel: 'visit', ...over }), { cookie });
  const card = async () => { const r = await s.call('GET', `${API}/biz/PA-0001`, undefined, { cookie: mario.cookie }); assert.equal(r.status, 200, r.text); return r.json.biz; };
  const replay = () => { const st = emptyState(); for (const e of s.lines()) applyEvent(st, e); return st; };

  // mario: workers and Wi-Fi; the log event carries exactly that q
  let r = await log(mario, 'qual-log-0001', { q: { workers: '10_29', wifi: 'yes' } });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(s.lines().at(-1).q, { workers: '10_29', wifi: 'yes' });
  let c = await card();
  assert.deepEqual([c.q, c.qual], [{ workers: '10_29', wifi: 'yes' }, { state: 'missing', missing: ['lead'] }]);

  // jose (another rep, who does not hold it): "No sé" on Wi-Fi keeps the yes; his "yes" on who coordinates is kept
  r = await log(jose, 'qual-log-0002', { kind: 'call', channel: 'call', q: { wifi: 'unknown', lead: 'yes' } });
  assert.equal(r.status, 200, r.text);
  c = await card();
  assert.deepEqual([c.q, c.qual.state], [{ workers: '10_29', wifi: 'yes', lead: 'yes' }, 'yes']);
  assert.deepEqual(replay().qualified.map(({ lead, rep, logId }) => ({ lead, rep, logId })), [{ lead: 'PA-0001', rep: jose.id, logId: 'qual-log-0002' }]);

  // mario's same-day repeat: a log.update that carries the new answer; a "no" on who coordinates: it does not qualify
  r = await log(mario, 'qual-log-0003', { q: { lead: 'no' } });
  assert.deepEqual([r.status, r.json.repeat, r.json.updated], [200, true, true]);
  const up = s.lines().at(-1);
  assert.deepEqual([up.type, up.logId, up.patch.q], ['log.update', 'qual-log-0001', { lead: 'no' }]);
  c = await card();
  assert.deepEqual([c.q, c.qual], [{ workers: '10_29', wifi: 'yes', lead: 'no' }, { state: 'no', missing: [] }]);
  assert.equal(replay().qualified.length, 1, 'turning to no adds nothing');

  // a q sent on a message is not on the event
  r = await log(jose, 'qual-log-0004', { kind: 'message', channel: 'whatsapp', q: { wifi: 'no' } });
  assert.equal(r.status, 200, r.text);
  assert.equal('q' in s.lines().at(-1), false);
  // the practice rep's log with a q on the real business changes nothing
  await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie });
  const prac = s.lines().find((e) => e.type === 'rep.practice').id;
  r = await s.call('POST', `${API}/log?as=${prac}`, logBody('qual-log-0005', { lead: { id: 'PA-0001' }, channel: 'visit', q: { wifi: 'no', lead: 'no', workers: '50plus' } }), { cookie: a.cookie });
  assert.equal(r.status, 200, r.text);
  c = await card();
  assert.deepEqual(c.q, { workers: '10_29', wifi: 'yes', lead: 'no' });

  // a hand-edited line with a q that is not one changes nothing on replay
  const st = replay(), had = structuredClone(st.biz.get('PA-0001').q), at = st.biz.get('PA-0001').at;
  applyEvent(st, { type: 'log', id: 'qual-log-0006', rep: mario.id, lead: { id: 'PA-0001', name: 'Taller Uno' }, kind: 'talk', t: '2026-11-16T16:00:00Z', q: { wifi: 5 } });
  assert.deepEqual([st.biz.get('PA-0001').q, st.biz.get('PA-0001').at], [had, at]);
  applyEvent(st, { type: 'log.update', logId: 'qual-log-0001', patch: { q: { lead: 'maybe' } }, holds: true, t: '2026-11-16T16:30:00Z' });
  assert.deepEqual(st.biz.get('PA-0001').q, had);
});

test('a change to the qualification leaves synced; one to the workers leaves workers too; dropPractice and lead.map follow', () => {
  const T = (h) => `2026-11-16T${h}:00:00Z`;
  const st = emptyState();
  for (const e of [
    { type: 'rep.created', id: 'r1', handle: 'r1', email: '', name: 'Mario Paz', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: T(10) },
    { type: 'lead.added', lead: { id: 'APP-0001', company: 'Nuevo', zone: '', city: 'Panama City', by: 'r1' }, t: T(10) },
    { type: 'log', id: 'map-log-0001', rep: 'r1', lead: { id: 'APP-0001', name: 'Nuevo' }, kind: 'talk', t: T(14), q: { wifi: 'yes', lead: 'yes', workers: 'lt10' } },
  ]) applyEvent(st, e);
  const o = st.biz.get('APP-0001');
  o.synced.add('qual'); o.synced.add('workers');
  applyEvent(st, { type: 'log', id: 'map-log-0002', rep: 'r1', lead: { id: 'APP-0001', name: 'Nuevo' }, kind: 'call', t: T(15), q: { wifi: 'unknown' } });
  assert.deepEqual([[...o.synced].sort(), o.at], [['qual', 'workers'], T(14)], 'nothing changed: still synced');
  applyEvent(st, { type: 'log', id: 'map-log-0003', rep: 'r1', lead: { id: 'APP-0001', name: 'Nuevo' }, kind: 'call', t: T(16), q: { lead: 'no' } });
  assert.deepEqual([[...o.synced], o.at], [['workers'], T(16)]);
  applyEvent(st, { type: 'log', id: 'map-log-0004', rep: 'r1', lead: { id: 'APP-0001', name: 'Nuevo' }, kind: 'call', t: T(17), q: { workers: '30_49' } });
  assert.deepEqual([...o.synced], []);
  applyEvent(st, { type: 'lead.map', temp: 'APP-0001', real: 'PA-0100', t: T(18) });
  assert.deepEqual(st.qualified.map((x) => [x.lead, x.rep, x.logId, x.t]), [['PA-0100', 'r1', 'map-log-0001', T(14)]]);
  // a practice rep's qualification leaves with it
  applyEvent(st, { type: 'rep.practice', id: 'rp', handle: 'p', name: 'Vendedor de práctica', tz: 'America/Panama', t: T(10) });
  applyEvent(st, { type: 'practice.lead.added', lead: { id: 'APP-P001', company: 'Práctica', zone: '', city: '', by: 'rp', practice: true }, t: T(10) });
  applyEvent(st, { type: 'log', id: 'prac-log-0001', rep: 'rp', lead: { id: 'APP-P001', name: 'Práctica' }, kind: 'talk', t: T(14), q: { wifi: 'yes', lead: 'yes' } });
  assert.equal(st.qualified.length, 2);
  applyEvent(st, { type: 'rep.practice.removed', id: 'rp', t: T(19) });
  assert.deepEqual(st.qualified.map((x) => x.rep), ['r1']);
});

test('a voided log takes its qualification with it', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('PUT', `${API}/leads`, [...LEADS, { ...LEADS[0], id: 'PA-0002', company: 'Taller Dos' }], B)).status, 200);
  const log = async (id, over) => { const r = await s.call('POST', `${API}/log`, logBody(id, { channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: mario.cookie }); assert.equal(r.status, 200, r.text); };
  const voidIt = async (logId) => assert.equal((await s.call('POST', `${API}/void`, { logId, reason: 'otro negocio' }, { cookie: a.cookie })).status, 200);
  const card = async (id) => (await s.call('GET', `${API}/biz/${id}`, undefined, { cookie: mario.cookie })).json.biz;
  const row = async (id) => (await s.call('GET', `${API}/export?since=`, undefined, B)).json.biz.find((x) => x.lead === id) || null;
  const replay = () => { const st = emptyState(); for (const e of s.lines()) applyEvent(st, e); return st; };

  // the wrong business, qualified, then voided: nothing of it is left
  await log('qv-log-0001', { lead: { id: 'PA-0001' }, q: { workers: '50plus', wifi: 'yes', lead: 'yes' } });
  assert.equal((await card('PA-0001')).qual.state, 'yes');
  assert.equal(replay().qualified.some((x) => x.logId === 'qv-log-0001'), true);
  await voidIt('qv-log-0001');
  let c = await card('PA-0001');
  assert.deepEqual([c.q, c.qual.state], [null, 'missing']);
  const r = await row('PA-0001');
  assert.equal(r?.qualNote ?? null, null, 'the CRM gets no qualification line');
  assert.equal(r ? r.fields.includes('qual') || r.fields.includes('workers') : false, false);
  assert.equal(replay().qualified.some((x) => x.logId === 'qv-log-0001'), false);

  // an earlier log's answer stays
  await log('qv-log-0002', { lead: { id: 'PA-0002' }, q: { wifi: 'no' } });
  s.time.now += 3600000;
  await log('qv-log-0003', { lead: { id: 'PA-0002' }, kind: 'call', channel: 'call', q: { workers: '50plus', wifi: 'yes', lead: 'yes' } });
  assert.equal((await card('PA-0002')).qual.state, 'yes');
  await voidIt('qv-log-0003');
  c = await card('PA-0002');
  assert.deepEqual([c.q, c.qual.state], [{ wifi: 'no' }, 'no']);
  assert.equal((await row('PA-0002')).qualNote, 'Qualification: Wi-Fi no');
});

test('on replay a qualification is kept only on a conversation: a message line with one changes nothing', () => {
  const T = (h) => `2026-11-16T${h}:00:00Z`;
  const st = emptyState();
  applyEvent(st, { type: 'rep.created', id: 'r1', handle: 'r1', email: '', name: 'Mario Paz', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: T(10) });
  applyEvent(st, { type: 'log', id: 'kind-log-0001', rep: 'r1', lead: { id: 'PA-0001', name: 'Uno' }, kind: 'message', channel: 'whatsapp', t: T(14), q: { wifi: 'no' } });
  assert.equal('q' in st.logs.get('kind-log-0001'), false);
  assert.equal(st.biz.get('PA-0001')?.q, undefined);
  applyEvent(st, { type: 'log.update', logId: 'kind-log-0001', patch: { q: { lead: 'yes' } }, t: T(15) });
  assert.equal('q' in st.logs.get('kind-log-0001'), false);
  assert.equal(st.biz.get('PA-0001')?.q, undefined);
  // a talk keeps it, as before
  applyEvent(st, { type: 'log', id: 'kind-log-0002', rep: 'r1', lead: { id: 'PA-0001', name: 'Uno' }, kind: 'talk', t: T(16), q: { wifi: 'no' } });
  assert.deepEqual(st.biz.get('PA-0001').q, { wifi: 'no' });
});

test('after a void, a business counts as qualified only if what is left says so, filed on the latest step that stands', () => {
  const T = (d, h = 15) => `2026-11-${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const now = T(20, 20), week = '2026-11-16', leads = new Map([['PA-0001', { id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', stage: 'New' }]]);
  const fresh = () => {
    const st = emptyState();
    for (const [id, handle] of [['r1', 'mario'], ['r2', 'jose']]) applyEvent(st, { type: 'rep.created', id, handle, email: '', name: `${handle} Rep`, role: 'rep', city: 'Panama City', tz: 'America/Panama', t: T(10) });
    return st;
  };
  const lg = (st, id, rep, t, q) => applyEvent(st, { type: 'log', id, rep, lead: { id: 'PA-0001', name: 'Taller Uno' }, kind: 'talk', t, q });
  const voidIt = (st, logId) => applyEvent(st, { type: 'log.void', logId, by: 'boss', reason: 'otro negocio', t: T(20, 16) });
  const entries = (st) => st.qualified.filter((x) => x.lead === 'PA-0001').map((x) => [x.rep, x.logId, x.t]);
  const qual = (st) => qualOf(st.biz.get('PA-0001')?.q).state;

  // a1 gives Wi-Fi, a2 gives who coordinates: it qualifies through a2; a1 voided, it no longer does
  let st = fresh();
  lg(st, 'a1', 'r1', T(16), { wifi: 'yes' });
  lg(st, 'a2', 'r1', T(17), { lead: 'yes' });
  assert.deepEqual(entries(st), [['r1', 'a2', T(17)]]);
  assert.equal(scorecardOf(st, 'r1', week, { now, leads }).qualified, 1);
  voidIt(st, 'a1');
  assert.equal(qual(st), 'missing');
  assert.deepEqual(entries(st), []);
  assert.equal(scorecardOf(st, 'r1', week, { now, leads }).qualified, 0);

  // the reverse: a1 qualifies it alone, a2 (another day, another rep) adds the workers; a1 voided, it does not qualify
  st = fresh();
  lg(st, 'a1', 'r1', T(16), { wifi: 'yes', lead: 'yes' });
  lg(st, 'a2', 'r2', T(17), { workers: '10_29' });
  voidIt(st, 'a1');
  assert.equal(qual(st), 'missing');
  assert.deepEqual(entries(st), []);

  // both qualify it: a1 voided, it still qualifies, with one entry, a2's
  st = fresh();
  lg(st, 'a1', 'r1', T(16), { wifi: 'yes', lead: 'yes' });
  lg(st, 'a2', 'r2', T(17), { wifi: 'yes', lead: 'yes' });
  assert.deepEqual(entries(st), [['r1', 'a1', T(16)]]);
  voidIt(st, 'a1');
  assert.equal(qual(st), 'yes');
  assert.deepEqual(entries(st), [['r2', 'a2', T(17)]]);
  assert.deepEqual([scorecardOf(st, 'r1', week, { now, leads }).qualified, scorecardOf(st, 'r2', week, { now, leads }).qualified], [0, 1]);
});

// Final round (N7): voiding a log that only added an answer moved the business's "qualified" to whichever step was
// latest, so another rep (and another week) got the Scorecard's headline number.
test('voiding another rep\'s log never moves who qualified a business, or when', () => {
  const T = (d, h = 15) => `2026-11-${d}T${String(h).padStart(2, '0')}:00:00.000Z`;
  const week = '2026-11-16', now = T(21, 20), leads = new Map([['PA-0001', { id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', stage: 'New' }]]);
  const st = emptyState();
  for (const [id, handle] of [['r1', 'mario'], ['r2', 'jose']]) applyEvent(st, { type: 'rep.created', id, handle, email: '', name: `${handle} Rep`, role: 'rep', city: 'Panama City', tz: 'America/Panama', t: T(10) });
  const lg = (id, rep, t, q) => applyEvent(st, { type: 'log', id, rep, lead: { id: 'PA-0001', name: 'Taller Uno' }, kind: 'talk', t, q });
  const entries = () => st.qualified.filter((x) => x.lead === 'PA-0001').map((x) => [x.rep, x.logId, x.t]);
  lg('a1', 'r1', T(16), { wifi: 'yes', lead: 'yes' });   // Monday: mario qualifies it
  lg('b0', 'r2', T(18), { workers: 'lt10' });              // Wednesday: jose says the workers' range
  lg('b1', 'r2', T(19), { workers: '10_29' });             // Thursday: jose again, only the range
  assert.deepEqual(entries(), [['r1', 'a1', T(16)]]);
  applyEvent(st, { type: 'log.void', logId: 'b1', by: 'boss', reason: 'otro negocio', t: T(20, 16) });
  assert.equal(qualOf(st.biz.get('PA-0001').q).state, 'yes');
  assert.deepEqual(entries(), [['r1', 'a1', T(16)]], 'mario\'s entry, its rep and its time are unchanged');
  assert.equal(scorecardOf(st, 'r1', week, { now, leads }).qualified, 1);
  assert.equal(scorecardOf(st, 'r2', week, { now, leads }).qualified, 0);
});
