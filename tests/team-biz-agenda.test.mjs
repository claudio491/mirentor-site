// GET me says what is due today and overdue, and the meetings of today and tomorrow; GET team counts each rep's
// businesses and lists the reps with overdue follow-ups.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { repView, teamView } from '../lib/team/view.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
// mario holds 7 in the CRM: 3 overdue, 1 today (Monday 16 Nov), 2 in the coming days and 1 with no next step
const DAYS = ['2026-11-10', '2026-11-12', '2026-11-14', '2026-11-16', '2026-11-18', '2026-11-20', null];
const LEADS = [...DAYS.map((day, i) => ({ id: `PA-A0${i}`, company: `Agenda ${i}`, city: 'Panama City', zone: 'Centro', stage: 'Contacted', owner: 'mario Rep', lastContact: '2026-11-09',
  ...(day ? { nextDay: day, nextStep: `Paso ${i}` } : {}) })), { id: 'PA-FREE', company: 'Libre Uno', city: 'Panama City', zone: 'Centro', stage: 'New' }];

async function team(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose');
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const me = async (who) => { const r = await s.call('GET', `${API}/me`, undefined, { cookie: who.cookie }); assert.equal(r.status, 200, r.text); return r.json; };
  return { s, a, mario, jose, me };
}

test('GET me: the agenda counts the rep\'s businesses and lists what is due, oldest first, and what comes', async (t) => {
  const { mario, jose, me } = await team(t);
  const { agenda } = await me(mario);
  assert.deepEqual(agenda.counts, { overdue: 3, today: 1, soon: 2, nonext: 1, owned: 7 });
  assert.deepEqual(agenda.due.map((r) => r.id), ['PA-A00', 'PA-A01', 'PA-A02', 'PA-A03']);
  assert.deepEqual(agenda.soon.map((r) => r.id), ['PA-A04', 'PA-A05']);
  assert.deepEqual([agenda.due[0].owner, agenda.due[0].next, agenda.meetings], [{ name: 'mario', mine: true }, { day: '2026-11-10', step: 'Paso 0' }, []]);
  assert.deepEqual((await me(jose)).agenda.counts, { overdue: 0, today: 0, soon: 0, nonext: 0, owned: 0 });
});

test('the meetings of today and tomorrow, by day then time, with their contact', async (t) => {
  const { s, mario, me } = await team(t);
  const meet = (id, lead, over) => s.call('POST', `${API}/log`, logBody(id, { lead: { id: lead }, kind: 'meeting', channel: 'visit', ...over }), { cookie: mario.cookie });
  for (const [id, lead, over] of [['meet-agenda-01', 'PA-A05', { when: '2026-11-17', time: '10:00', contact: 'Ana Ruiz' }], ['meet-agenda-02', 'PA-A04', { when: '2026-11-17' }],
    ['meet-agenda-03', 'PA-A03', { when: '2026-11-16', time: '15:00' }], ['meet-agenda-04', 'PA-A06', { when: '2026-11-19', time: '09:00' }]]) assert.equal((await meet(id, lead, over)).status, 200);
  const { meetings } = (await me(mario)).agenda;
  assert.deepEqual(meetings, [
    { logId: 'meet-agenda-03', lead: { id: 'PA-A03', name: 'Agenda 3' }, when: '2026-11-16', time: '15:00', contact: null, demo: false },
    { logId: 'meet-agenda-01', lead: { id: 'PA-A05', name: 'Agenda 5' }, when: '2026-11-17', time: '10:00', contact: 'Ana Ruiz', demo: false },
    { logId: 'meet-agenda-02', lead: { id: 'PA-A04', name: 'Agenda 4' }, when: '2026-11-17', time: null, contact: null, demo: false },
  ]);   // demo: "Pide demo" on the meeting (wave 2, S4)
});

test('GET team: each rep\'s book, and the reps with overdue follow-ups; "do not call" takes one out of the agenda at once', async (t) => {
  const { s, a, mario, jose, me } = await team(t);
  const got = (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json;
  assert.deepEqual(got.reps.find((r) => r.id === mario.id).book, { owned: 7, overdue: 3, today: 1, nonext: 1 });
  assert.deepEqual(got.reps.find((r) => r.id === jose.id).book, { owned: 0, overdue: 0, today: 0, nonext: 0 });
  assert.deepEqual(got.needs.overdue, [{ rep: mario.id, name: 'mario Rep', overdue: 3, oldest: '2026-11-10' }]);
  const dnc = await s.call('POST', `${API}/log`, logBody('dnc-agenda-001', { lead: { id: 'PA-A00' }, kind: 'call', channel: 'call', tag: 'do_not_call' }), { cookie: jose.cookie });
  assert.equal(dnc.status, 200, dnc.text);
  const { agenda } = await me(mario);
  assert.deepEqual([agenda.due.map((r) => r.id), agenda.counts.overdue], [['PA-A01', 'PA-A02', 'PA-A03'], 2]);
});

test('without the lead list, repView and teamView say nothing of businesses', () => {
  const state = emptyState();
  applyEvent(state, { type: 'rep.created', id: 'r_marta', handle: 'marta', email: 'marta@ejemplo.test', name: 'Marta Pineda', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: '2026-10-01T15:00:00Z' });
  const ctx = { now: '2026-11-16T15:00:00Z', lang: 'es' };
  assert.equal(repView(state, 'r_marta', ctx).agenda, null);
  const team = teamView(state, ctx);
  assert.deepEqual([team.reps[0].book, team.needs.overdue], [null, []]);
  assert.deepEqual(Object.keys(repView(state, 'r_marta', { ...ctx, leads: new Map() }).agenda).sort(), ['counts', 'due', 'meetings', 'soon']);
});

test('9000 businesses, 300 held by each of 3 reps: GET me and GET team each answer in under a second', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), reps = [await s.addRep(a.cookie, 'mario'), await s.addRep(a.cookie, 'jose'), await s.addRep(a.cookie, 'luis')];
  const names = ['mario Rep', 'jose Rep', 'luis Rep'];
  const list = Array.from({ length: 9000 }, (_, i) => ({ id: `PA-${String(i).padStart(5, '0')}`, company: `Negocio ${i}`, city: 'Panama City', zone: `Zona ${i % 12}`, stage: 'Contacted',
    contact: 'Ana Ruiz', phone: '+507 6000-0000', address: 'Calle 50', notes: 'n'.repeat(200), walkin: i % 10,
    ...(i < 900 ? { owner: names[i % 3], lastContact: '2026-11-09', nextDay: `2026-11-${String(10 + (i % 15)).padStart(2, '0')}`, nextStep: 'Volver' } : {}) }));
  assert.equal((await s.call('PUT', `${API}/leads`, list, B)).status, 200);
  for (const [who, path] of [[reps[0], 'me'], [a, 'team'], [reps[1], 'leads?list=free']]) {
    const t0 = performance.now();
    const r = await s.call('GET', `${API}/${path}`, undefined, { cookie: who.cookie });
    const ms = performance.now() - t0;
    assert.equal(r.status, 200, r.text);
    assert.ok(ms < 1000, `${path} took ${Math.round(ms)} ms`);
  }
  assert.equal((await s.call('GET', `${API}/me`, undefined, { cookie: reps[0].cookie })).json.agenda.counts.owned, 300);
});
