// "Trabados": a meeting more than two days past its date that nobody marked held, and a contract out more than seven days
// with no signature. A manager says it never happened ("No ocurrió": its holder gets "Reagendar la reunión" for today and
// the pending part leaves) or that it is still alive ("Sigue viva": hidden for seven days).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { ledger, confirmable } from '../lib/team/score.mjs';
import { RULES } from '../lib/team/rules.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const DAY = 86400000;
const LEADS = ['Taller Uno', 'Taller Dos', 'Taller Tres', 'Taller Cuatro', 'Taller Cinco'].map((company, i) => ({ id: `PA-000${i + 1}`, company, city: 'Panama City', zone: 'Centro', stage: 'New' }));

test('No ocurrió gives the holder Reagendar la reunión for today, once, and the pending part leaves', async (t) => {
  assert.deepEqual([RULES.stalledMeetingDays, RULES.stalledContractDays, RULES.stalledSnoozeDays, RULES.missedStep, RULES.missedStepContract], [2, 7, 7, 'Reagendar la reunión', 'Retomar el contrato']);
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose'), lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = async (who, id, over) => { const r = await s.call('POST', `${API}/log`, logBody(id, { channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: who.cookie }); assert.equal(r.status, 200, r.text); };
  const team = async () => { const r = await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie }); assert.equal(r.status, 200, r.text); return r.json; };
  const stalled = async () => (await team()).needs.stalled;
  const post = (body, who = a) => s.call('POST', `${API}/stalled`, body, { cookie: who.cookie });
  const replay = () => { const st = emptyState(); for (const e of s.lines()) applyEvent(st, e); return st; };
  const now = () => new Date(s.time.now).toISOString();

  // Monday 16: mario books three meetings for today, jose one; mario logs a contract, its sending confirmed
  await log(mario, 'stall-log-0001', { lead: { id: 'PA-0001' }, kind: 'meeting', when: '2026-11-16' });
  await log(mario, 'stall-log-0002', { lead: { id: 'PA-0002' }, kind: 'meeting', when: '2026-11-16' });
  await log(mario, 'stall-log-0003', { lead: { id: 'PA-0003' }, kind: 'meeting', when: '2026-11-16' });
  await log(mario, 'stall-log-0004', { lead: { id: 'PA-0004' }, kind: 'contract' });
  await log(jose, 'stall-log-0005', { lead: { id: 'PA-0005' }, kind: 'meeting', when: '2026-11-16' });
  await log(mario, 'stall-log-0006', { lead: { id: 'PA-0001' }, kind: 'talk' });
  assert.equal((await s.call('POST', `${API}/confirm`, { logId: 'stall-log-0004', what: 'contract_sent' }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/held`, { logId: 'stall-log-0002' }, { cookie: mario.cookie })).status, 200);

  // Wednesday 18: two days is not stalled yet
  s.time.now += 2 * DAY;
  assert.deepEqual(await stalled(), []);
  // Thursday 19: three days
  s.time.now += DAY;
  const list = await stalled();
  assert.deepEqual(list.map((x) => x.logId), ['stall-log-0005', 'stall-log-0001', 'stall-log-0003'], 'oldest first, then by name; the one marked held never stalls');
  assert.deepEqual(list[1], { kind: 'meeting', logId: 'stall-log-0001', rep: mario.id, name: 'mario Rep', lead: { id: 'PA-0001', name: 'Taller Uno' }, since: '2026-11-16', days: 3 });

  // refused, and nothing written
  const before = s.lines().length;
  for (const [body, who, want] of [[{ logId: 'stall-log-0001', what: 'missed' }, lia, [403, 'read_only']], [{ logId: 'stall-log-0001', what: 'missed' }, mario, [403, 'manager_only']],
    [{ logId: 'stall-log-0001', what: 'later' }, a, [400, 'what']], [{ logId: 'stall-log-0006', what: 'missed' }, a, [400, 'what']], [{ logId: 'nope-log-0001', what: 'missed' }, a, [404, 'log']]]) {
    const r = await post(body, who);
    assert.deepEqual([r.status, r.json.error], want, JSON.stringify(body));
  }
  assert.equal(s.lines().length, before);

  // No ocurrió: the holder gets the step for today
  let r = await post({ logId: 'stall-log-0001', what: 'missed' });
  assert.equal(r.status, 200, r.text);
  const ev = s.lines().at(-1);
  assert.deepEqual([ev.type, ev.logId, ev.by, ev.rep, ev.next], ['meeting.missed', 'stall-log-0001', a.id, mario.id, { day: '2026-11-19', step: 'Reagendar la reunión' }]);
  assert.equal(r.json.needs.stalled.some((x) => x.logId === 'stall-log-0001'), false);
  assert.equal(r.json.needs.confirm.some((x) => x.logId === 'stall-log-0001'), false);
  const card = await s.call('GET', `${API}/biz/PA-0001`, undefined, { cookie: mario.cookie });
  assert.deepEqual(card.json.biz.next, { day: '2026-11-19', step: 'Reagendar la reunión' });
  assert.equal(ledger(replay(), mario.id, { now: now() }).some((e) => e.id === 'stall-log-0001:meeting_held'), false, 'neither pending nor expired');
  const way = await s.call('GET', `${API}/route?lead=PA-0001`, undefined, { cookie: mario.cookie });
  assert.equal(way.json.route.stops[0].status, 'now');
  assert.equal(card.json.biz.stage, 'Contacted', 'the stage falls back');
  const n = s.lines().length;
  r = await post({ logId: 'stall-log-0001', what: 'missed' });
  assert.equal(r.status, 200);
  assert.equal(s.lines().length, n, 'the same tap again writes nothing');

  // a released business: No ocurrió writes no next step
  assert.equal((await s.call('POST', `${API}/biz/PA-0005`, { release: true }, { cookie: a.cookie })).status, 200);
  r = await post({ logId: 'stall-log-0005', what: 'missed' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([s.lines().at(-1).type, 'rep' in s.lines().at(-1), 'next' in s.lines().at(-1)], ['meeting.missed', false, false]);

  // Sigue viva: hidden seven days, then back with its age
  r = await post({ logId: 'stall-log-0003', what: 'alive' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([s.lines().at(-1).type, s.lines().at(-1).logId], ['stalled.alive', 'stall-log-0003']);
  assert.equal(r.json.needs.stalled.some((x) => x.logId === 'stall-log-0003'), false);

  // Tuesday 24: the contract out eight days with no signature is stalled
  s.time.now += 5 * DAY;
  let got = await stalled();
  assert.deepEqual(got.map((x) => [x.kind, x.logId, x.since, x.days]), [['contract', 'stall-log-0004', '2026-11-16', 8]]);
  // Wednesday 25: six days after "Sigue viva", still gone
  s.time.now += DAY;
  assert.equal((await stalled()).some((x) => x.logId === 'stall-log-0003'), false);
  // Thursday 26: seven days, back with its new age
  s.time.now += DAY;
  got = await stalled();
  assert.deepEqual(got.find((x) => x.logId === 'stall-log-0003'), { kind: 'meeting', logId: 'stall-log-0003', rep: mario.id, name: 'mario Rep', lead: { id: 'PA-0003', name: 'Taller Tres' }, since: '2026-11-16', days: 10 });

  // the contract never happened: its signature no longer waits; the sending earned stays
  r = await post({ logId: 'stall-log-0004', what: 'missed' });
  assert.equal(r.status, 200, r.text);
  // ...and its holder's next step speaks of the contract, not of a meeting
  assert.deepEqual([s.lines().at(-1).type, s.lines().at(-1).next?.step], ['meeting.missed', 'Retomar el contrato']);
  const entries = ledger(replay(), mario.id, { now: now() }).filter((e) => e.logId === 'stall-log-0004');
  assert.deepEqual(entries.map((e) => [e.code, e.status]), [['contract_sent', 'earned']]);
  assert.equal((await team()).needs.confirm.some((x) => x.logId === 'stall-log-0004'), false);

  // a voided log is not one
  assert.equal((await s.call('POST', `${API}/void`, { logId: 'stall-log-0003', reason: 'otro negocio' }, { cookie: a.cookie })).status, 200);
  const gone = await post({ logId: 'stall-log-0003', what: 'missed' });
  assert.deepEqual([gone.status, gone.json.error], [404, 'log']);

  // a hand-edited line: a missed on a talk, or with a next step for a day already past, moves nothing
  const st = replay(), had = structuredClone(st.biz.get('PA-0002').next ?? null);
  applyEvent(st, { type: 'meeting.missed', logId: 'stall-log-0006', by: a.id, t: now() });
  applyEvent(st, { type: 'meeting.missed', logId: 'stall-log-0002', by: a.id, rep: mario.id, next: { day: '2026-11-01', step: 'x' }, t: now() });
  assert.deepEqual([st.missed.has('stall-log-0006'), st.biz.get('PA-0002').next ?? null], [false, had]);
});

test('Trabados lists only what the app made and a manager can still confirm', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = async (id, over) => { const r = await s.call('POST', `${API}/log`, logBody(id, { channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: mario.cookie }); assert.equal(r.status, 200, r.text); };
  const stalled = async () => { const r = await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie }); assert.equal(r.status, 200, r.text); return r.json.needs.stalled.map((x) => x.logId); };
  const post = (body) => s.call('POST', `${API}/stalled`, body, { cookie: a.cookie });

  // Monday 16: a meeting imported from the CRM's Activities, an app meeting, a contract never sent, a contract sent
  const put = await s.call('PUT', `${API}/activity`, { source: 'crm', rows: [{ id: 'crm_S-0001', rep: mario.id, day: '2026-11-16', kind: 'meeting', channel: 'call', lead: { id: 'PA-0001', name: 'Taller Uno' } }] }, B);
  assert.equal(put.status, 200, put.text);
  await log('stall-win-0002', { lead: { id: 'PA-0002' }, kind: 'meeting', when: '2026-11-16' });
  await log('stall-win-0003', { lead: { id: 'PA-0003' }, kind: 'contract' });
  await log('stall-win-0004', { lead: { id: 'PA-0004' }, kind: 'contract' });
  assert.equal((await s.call('POST', `${API}/confirm`, { logId: 'stall-win-0004', what: 'contract_sent' }, { cookie: a.cookie })).status, 200);

  // Thursday 19: the imported meeting is three days old and is not listed; No ocurrió on it writes nothing
  s.time.now += 3 * DAY;
  assert.deepEqual(await stalled(), ['stall-win-0002']);
  let n = s.lines().length;
  assert.equal((await post({ logId: 'crm_S-0001', what: 'missed' })).status, 200);
  assert.equal((await post({ logId: 'crm_S-0001', what: 'alive' })).status, 200);
  assert.equal(s.lines().length, n, 'an imported row is not the app\'s to mark');

  // Monday 30, 10:00: every window still open (the meeting's closes 14 days after its day ends, the unsent contract's 14 days after its log)
  s.time.now = Date.parse('2026-11-30T15:00:00Z');
  assert.deepEqual(await stalled(), ['stall-win-0002', 'stall-win-0003', 'stall-win-0004']);
  // Tuesday 1 December: the meeting and the unsent contract can no longer be confirmed; the sent one waits its signature 30 days
  s.time.now = Date.parse('2026-12-01T15:00:00Z');
  assert.deepEqual(await stalled(), ['stall-win-0004']);
  n = s.lines().length;
  assert.equal((await post({ logId: 'stall-win-0002', what: 'missed' })).status, 200);
  assert.equal(s.lines().length, n, 'a meeting past its window writes nothing');
  // Thursday 17 December: the signature's window closed too
  s.time.now = Date.parse('2026-12-17T15:00:00Z');
  assert.deepEqual(await stalled(), []);
});

test('a meeting logged again the same day as one that did not happen is a new log', async (t) => {
  const s = await start({ clock: Date.parse('2026-11-19T15:00:00Z') }); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = (id, over) => s.call('POST', `${API}/log`, logBody(id, { channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: mario.cookie });
  // Thursday 19: mario logs Monday's meeting late; a manager says it did not happen
  assert.equal((await log('again-log-0001', { lead: { id: 'PA-0001' }, kind: 'meeting', when: '2026-11-16' })).status, 200);
  assert.equal((await s.call('POST', `${API}/stalled`, { logId: 'again-log-0001', what: 'missed' }, { cookie: a.cookie })).status, 200);
  assert.equal(s.lines().at(-1).type, 'meeting.missed');
  // the same day, booked again: a new log, not an update of the missed one
  const r = await log('again-log-0002', { lead: { id: 'PA-0001' }, kind: 'meeting', when: '2026-11-21' });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.repeat, r.json.logId, s.lines().at(-1).type], [false, 'again-log-0002', 'log']);
  const team = (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json;
  assert.equal(team.needs.meetings.some((m) => m.logId === 'again-log-0002'), true);
});

test('confirmable: what a manager can still confirm on a log, at each window edge', () => {
  const at = (iso, ms = 0) => new Date(Date.parse(iso) + ms).toISOString();
  const T = '2026-11-16T15:00:00.000Z';
  // a meeting waits RULES.pendingDays from its day (the last second of `when`) when that is later than the booking
  const meeting = { kind: 'meeting', t: T, when: '2026-11-18' }, anchor = '2026-11-18T23:59:59.000Z';
  assert.equal(confirmable(meeting, {}, at(anchor, RULES.pendingDays * DAY)), 'meeting_held');
  assert.equal(confirmable(meeting, {}, at(anchor, RULES.pendingDays * DAY + 1)), null);
  assert.equal(confirmable({ kind: 'meeting', t: T }, {}, at(T, RULES.pendingDays * DAY)), 'meeting_held');
  assert.equal(confirmable({ kind: 'meeting', t: T }, {}, at(T, RULES.pendingDays * DAY + 1)), null);
  assert.equal(confirmable(meeting, { meeting_held: T }, T), null);
  // a contract's sending waits RULES.pendingDays from the log
  const contract = { kind: 'contract', t: T };
  assert.equal(confirmable(contract, {}, at(T, RULES.pendingDays * DAY)), 'contract_sent');
  assert.equal(confirmable(contract, {}, at(T, RULES.pendingDays * DAY + 1)), null);
  // its signature RULES.pendingSignDays from the sending
  const sent = at(T, 20 * DAY);
  assert.equal(confirmable(contract, { contract_sent: sent }, at(sent, RULES.pendingSignDays * DAY)), 'contract_signed');
  assert.equal(confirmable(contract, { contract_sent: sent }, at(sent, RULES.pendingSignDays * DAY + 1)), null);
  assert.equal(confirmable(contract, { contract_sent: sent, contract_signed: sent }, sent), null);
  // any other kind has nothing to confirm; `now` may be milliseconds as well
  assert.equal(confirmable({ kind: 'talk', t: T }, {}, T), null);
  assert.equal(confirmable(contract, {}, Date.parse(T)), 'contract_sent');
});
