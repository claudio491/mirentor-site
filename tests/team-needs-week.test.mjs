// What a manager needs without asking: the meetings of today and the next six days (with "Pide demo"), and the
// blockers the reps wrote when they closed the day, today's and yesterday's until someone marks them seen.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { RULES, NO_BLOCKER } from '../lib/team/rules.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const LEADS = ['PA-0001', 'PA-0002', 'PA-0003', 'PA-0004', 'PA-0005'].map((id, i) => ({ id, company: `Taller ${i + 1}`, city: 'Panama City', zone: 'Centro', stage: 'New' }));

test('the week\'s meetings come with their time, contact and Pide demo; the day\'s blockers stay until seen', async (t) => {
  assert.equal(RULES.meetingsAheadDays, 6);
  assert.deepEqual(NO_BLOCKER, ['', 'ninguno', 'ninguna', 'nada', 'no', 'none', 'n/a']);
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose'), lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = async (who, id, over) => { const r = await s.call('POST', `${API}/log`, logBody(id, { channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: who.cookie }); assert.equal(r.status, 200, r.text); return r; };
  const needs = async () => { const r = await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie }); assert.equal(r.status, 200, r.text); return r.json.needs; };

  await log(mario, 'week-log-0001', { lead: { id: 'PA-0001' }, kind: 'meeting', when: '2026-11-18', time: '09:30', contact: 'Sra. Ruiz', demo: true });
  assert.equal(s.lines().at(-1).demo, true);
  await log(jose, 'week-log-0002', { lead: { id: 'PA-0002' }, kind: 'meeting', when: '2026-11-16' });
  await log(mario, 'week-log-0003', { lead: { id: 'PA-0003' }, kind: 'meeting', when: '2026-11-23' });   // eight days ahead: out
  await log(mario, 'week-log-0004', { lead: { id: 'PA-0004' }, kind: 'meeting', when: '2026-11-17' });
  assert.equal((await s.call('POST', `${API}/void`, { logId: 'week-log-0004', reason: 'otro negocio' }, { cookie: a.cookie })).status, 200);
  await log(jose, 'week-log-0005', { lead: { id: 'PA-0005' }, kind: 'talk', demo: true });
  assert.equal('demo' in s.lines().at(-1), false, 'demo is a meeting\'s only');

  const n = await needs();
  assert.deepEqual(n.meetings.map((m) => [m.rep, m.when, m.time, m.demo]), [[jose.id, '2026-11-16', null, false], [mario.id, '2026-11-18', '09:30', true]]);
  const m = n.meetings[1];
  assert.deepEqual(Object.keys(m).sort(), ['contact', 'demo', 'held', 'lead', 'logId', 'name', 'rep', 'time', 'when']);
  assert.deepEqual([m.logId, m.name, m.lead, m.contact, m.held], ['week-log-0001', 'mario Rep', { id: 'PA-0001', name: 'Taller 1' }, 'Sra. Ruiz', false]);
  // a meeting the rep said happened is marked held
  assert.equal((await s.call('POST', `${API}/held`, { logId: 'week-log-0002' }, { cookie: jose.cookie })).status, 200);
  assert.equal((await needs()).meetings[0].held, true);

  // the day's blockers: "ninguno" is none
  for (const [who, blocker] of [[mario, 'Falta el contrato en Documentos'], [jose, 'ninguno']]) {
    const r = await s.call('POST', `${API}/close`, { tomorrow: 'Seguir con la zona', blocker }, { cookie: who.cookie });
    assert.equal(r.status, 200, r.text);
  }
  const today = { rep: mario.id, name: 'mario Rep', day: '2026-11-16', text: 'Falta el contrato en Documentos', seen: false };
  assert.deepEqual((await needs()).blockers, [today]);

  // the next day: yesterday's stays until someone marks it seen
  s.time.now += 86400000;
  assert.deepEqual((await needs()).blockers, [today]);
  // the agenda of the rep says "Pide demo" on tomorrow's meeting
  const me = await s.call('GET', `${API}/me`, undefined, { cookie: mario.cookie });
  assert.deepEqual(me.json.agenda.meetings.map((x) => [x.lead.id, x.demo]), [['PA-0001', true]]);
  // refused: an unknown rep, a day that is not one, a day not closed; nothing written
  const before = s.lines().length;
  for (const [body, want] of [[{ rep: 'r_nobody0000', day: '2026-11-16' }, [404, 'rep']], [{ rep: mario.id, day: '16-11-2026' }, [400, 'day']], [{ rep: mario.id, day: '2026-11-15' }, [409, 'not_closed']]]) {
    const r = await s.call('POST', `${API}/blocker`, body, { cookie: a.cookie });
    assert.deepEqual([r.status, r.json.error], want, JSON.stringify(body));
  }
  assert.equal(s.lines().length, before);
  let r = await s.call('POST', `${API}/blocker`, { rep: mario.id, day: '2026-11-16' }, { cookie: a.cookie });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.needs.blockers, []);
  assert.deepEqual(s.lines().filter((e) => e.type === 'blocker.seen').map((e) => [e.rep, e.day, e.by]), [[mario.id, '2026-11-16', a.id]]);
  r = await s.call('POST', `${API}/blocker`, { rep: mario.id, day: '2026-11-16' }, { cookie: a.cookie });
  assert.equal(r.status, 200);
  assert.equal(s.lines().filter((e) => e.type === 'blocker.seen').length, 1, 'a second one writes nothing');

  // a leader writes nothing; a manager acting as the practice rep writes nothing here either
  const no = await s.call('POST', `${API}/blocker`, { rep: mario.id, day: '2026-11-16' }, { cookie: lia.cookie });
  assert.deepEqual([no.status, no.json.error], [403, 'read_only']);
  await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie });
  const prac = s.lines().find((e) => e.type === 'rep.practice').id;
  const acting = await s.call('POST', `${API}/blocker?as=${prac}`, { rep: mario.id, day: '2026-11-16' }, { cookie: a.cookie });
  assert.deepEqual([acting.status, acting.json.error], [403, 'read_only']);
});

test('a rep who is no longer active brings no blocker; a booked meeting still shows', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  assert.equal((await s.call('POST', `${API}/log`, logBody('gone-log-0001', { lead: { id: 'PA-0001' }, kind: 'meeting', channel: 'visit', when: '2026-11-18' }), { cookie: mario.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/close`, { tomorrow: 'Seguir con la zona', blocker: 'Falta el contrato' }, { cookie: mario.cookie })).status, 200);
  const needs = async () => (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json.needs;
  assert.equal((await needs()).blockers.length, 1);
  assert.equal((await s.call('POST', `${API}/reps/${mario.id}`, { patch: { active: false } }, { cookie: a.cookie })).status, 200);
  const n = await needs();
  assert.deepEqual([n.blockers.length, n.meetings.map((m) => m.logId)], [0, ['gone-log-0001']]);
});
