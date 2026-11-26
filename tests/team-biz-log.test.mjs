// A log moves its business: on a free one it takes it, with its next step; the holder's log carries the next step, Lost
// with its reason and the phone; another rep's log is kept and moves nothing on the business.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { bizIndex, bizView } from '../lib/team/biz.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const LEADS = [{ id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New' }, { id: 'PA-0002', company: 'Taller Dos', city: 'Panama City', zone: 'Centro', stage: 'New' }];

async function team(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose');
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = (who, id, over = {}) => s.call('POST', `${API}/log`, logBody(id, { lead: { id: 'PA-0001' }, channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: who.cookie });
  const logs = () => s.lines().filter((e) => e.type === 'log');
  /** The business as the server reads it now: the log replayed, the cached list as it was pushed. */
  const view = (id = 'PA-0001') => {
    const state = emptyState(); for (const e of s.lines()) applyEvent(state, e);
    const leads = new Map(JSON.parse(readFileSync(path.join(s.dir, 'team', 'leads.json'), 'utf8')).map((l) => [l.id, l]));
    return bizView(state, leads.get(id), { now: new Date(s.time.now).toISOString(), index: bizIndex(state, leads) });
  };
  return { s, a, mario, jose, log, logs, view };
}
const NEXT = { day: '2026-11-18', step: 'Llamar para agendar la reunión' };

test('a log on a free business takes it, with its next step', async (t) => {
  const { mario, log, logs, view } = await team(t);
  const r = await log(mario, 'take-log-0001', { next: NEXT });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.took, r.json.owned], [true, null]);
  const e = logs().at(-1);
  assert.deepEqual([e.holds, e.took, e.next], [true, true, NEXT]);
  assert.deepEqual([view().holder.id, view().next], [mario.id, NEXT]);
});

test('another rep\'s log is kept and moves nothing on the business', async (t) => {
  const { mario, jose, log, logs, view } = await team(t);
  await log(mario, 'take-log-0001', { next: NEXT });
  const r = await log(jose, 'other-log-001', { kind: 'call', channel: 'call', next: { day: '2026-11-17', step: 'Mío ahora' }, contact: 'Ana Ruiz', phone: '6000-0000' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.took, r.json.owned], [false, { name: 'mario' }]);
  const e = logs().at(-1);
  assert.deepEqual([e.id, 'holds' in e, 'took' in e, 'next' in e, 'lost' in e, e.contact, e.phone], ['other-log-001', false, false, false, false, 'Ana Ruiz', '6000-0000']);
  assert.deepEqual([view().holder.id, view().next, view().contact], [mario.id, NEXT, '']);
  // the same result again by the same rep the same day: still not theirs
  const again = await log(jose, 'other-log-002', { kind: 'call', channel: 'call', next: { day: '2026-11-19', step: 'Otro' } });
  assert.deepEqual([again.json.repeat, again.json.took, again.json.owned], [true, false, { name: 'mario' }]);
  assert.deepEqual(view().next, NEXT);
  // a retry of the same id says whose it is too
  const retry = await log(jose, 'other-log-001', { kind: 'call', channel: 'call' });
  assert.deepEqual([retry.json.repeat, retry.json.owned], [true, { name: 'mario' }]);
});

test('Dato malo takes nothing', async (t) => {
  const { mario, log, logs, view } = await team(t);
  const r = await log(mario, 'bad-data-0001', { kind: 'baddata', channel: 'call', next: NEXT });
  assert.deepEqual([r.status, r.json.took, r.json.owned], [200, false, null]);
  assert.deepEqual(['holds' in logs().at(-1), 'next' in logs().at(-1), view().free], [false, false, true]);
});

test('a queued log replayed two days later keeps its result and drops a next step now in the past', async (t) => {
  const { s, mario, log, logs, view } = await team(t);
  const body = { next: { day: '2026-11-17', step: 'Volver' }, clientAt: new Date(s.time.now).toISOString() };
  s.time.now += 2 * 86400000;
  const r = await log(mario, 'queued-log-01', body);
  assert.equal(r.status, 200, r.text);
  const e = logs().at(-1);
  assert.deepEqual([e.took, 'next' in e], [true, false]);
  assert.deepEqual([view().holder.id, view().next], [mario.id, null]);
});

test('a lost tag without a reason closes it as other; a reason without a lost tag is dropped', async (t) => {
  const { mario, log, logs, view } = await team(t);
  await log(mario, 'take-log-0001', { next: NEXT });
  const r = await log(mario, 'lost-log-0001', { kind: 'call', channel: 'call', tag: 'not_fit', next: NEXT });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([logs().at(-1).lost, logs().at(-1).next], ['other', null]);
  assert.deepEqual([view().stage, view().lost, view().next], ['Lost', { reason: 'other' }, null]);
  // with a reason from the list, it is kept
  await log(mario, 'lost-log-0002', { lead: { id: 'PA-0002' }, tag: 'not_interested', lost: 'no_trust' });
  assert.deepEqual([logs().at(-1).lost, view('PA-0002').lost], ['no_trust', { reason: 'no_trust' }]);
  // a later result reopens the first one
  await log(mario, 'open-log-0001', { kind: 'message', channel: 'whatsapp' });
  assert.deepEqual([logs().at(-1).lost, view().stage, view().lost], [null, 'Contacted', null]);
  // a reason with no lost tag is dropped, and the log stands
  const k = await log(mario, 'nolost-log-01', { lead: { id: 'PA-0002' }, kind: 'noanswer', channel: 'call', lost: 'no_trust' });
  assert.equal(k.status, 200);
  assert.equal(logs().at(-1).lost, null, 'the reopen of PA-0002, not the reason');
  const p = await log(mario, 'nolost-log-02', { lead: { name: 'Bar Nuevo', zone: 'Centro' }, lost: 'privacy' });
  assert.deepEqual([p.status, 'lost' in logs().at(-1)], [200, false]);
});

test('the same result again the same day moves the next step it carries', async (t) => {
  const { mario, log, s, view } = await team(t);
  await log(mario, 'take-log-0001', { next: NEXT });
  const r = await log(mario, 'take-log-0002', { next: { day: '2026-11-20', step: 'Volver el viernes' } });
  assert.deepEqual([r.json.repeat, r.json.updated, r.json.took, r.json.owned], [true, true, false, null]);
  const u = s.lines().filter((e) => e.type === 'log.update').at(-1);
  assert.deepEqual([u.holds, u.patch.next], [true, { day: '2026-11-20', step: 'Volver el viernes' }]);
  assert.deepEqual(view().next, { day: '2026-11-20', step: 'Volver el viernes' });
  // a bad next step on the repeat is dropped, and nothing is written
  const bad = await log(mario, 'take-log-0003', { next: { day: '2026-11-01', step: 'x' } });
  assert.deepEqual([bad.json.repeat, bad.json.updated], [true, false]);
});

test('the contact and the phone stay with every conversation result; a meeting keeps its time', async (t) => {
  const { mario, log, logs, view } = await team(t);
  await log(mario, 'talk-log-0001', { contact: 'Ana Ruiz', phone: ' +507 6000-0000 ', time: '09:30' });
  assert.deepEqual([logs().at(-1).contact, logs().at(-1).phone, logs().at(-1).time], ['Ana Ruiz', '+507 6000-0000', undefined]);
  assert.deepEqual([view().contact, view().phone], ['Ana Ruiz', '+507 6000-0000']);
  await log(mario, 'msg-log-00001', { lead: { id: 'PA-0002' }, kind: 'message', channel: 'whatsapp', contact: 'Ana Ruiz', phone: '6000' });
  assert.deepEqual([logs().at(-1).contact, logs().at(-1).phone], [undefined, undefined]);
  for (const [i, time, kept] of [[1, '09:30', '09:30'], [2, '24:00', undefined], [3, '9:30', undefined], [4, 930, undefined], [5, '23:59', '23:59']]) {
    await log(mario, `meet-time-000${i}`, { lead: { name: `Bar ${i}`, zone: 'Centro' }, kind: 'meeting', channel: 'visit', when: '2026-11-18', time });
    assert.equal(logs().at(-1).time, kept, String(time));
  }
  // a repeat the same day moves the time like the day
  const r = await log(mario, 'meet-time-0009', { lead: { name: 'Bar 1', zone: 'Centro' }, kind: 'meeting', channel: 'visit', when: '2026-11-18', time: '11:00' });
  assert.deepEqual([r.json.repeat, r.json.updated], [true, true]);
});

test('No llamar from any rep: the next log answers do_not_call', async (t) => {
  const { mario, jose, log } = await team(t);
  await log(mario, 'take-log-0001', { next: NEXT });
  const r = await log(jose, 'dnc-log-00001', { kind: 'call', channel: 'call', tag: 'do_not_call' });
  assert.equal(r.status, 200, r.text);
  for (const [who, id] of [[mario, 'after-dnc-001'], [jose, 'after-dnc-002']]) {
    const no = await log(who, id, { kind: 'call', channel: 'call' });
    assert.deepEqual([no.status, no.json.error], [409, 'do_not_call']);
  }
});
