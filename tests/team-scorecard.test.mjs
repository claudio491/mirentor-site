// The CRM's Rep Scorecard, out of the app's events: twenty columns per rep and for the team, each cell the sum of the
// list it opens, in each rep's own week. The "live now" columns exist for the current week only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { bookOf, agendaOf } from '../lib/team/biz.mjs';
import { teamView } from '../lib/team/view.mjs';
import { SCORECARD_COLS, NOW_ONLY, scorecardWeeks, scorecardItems, scorecardOf, scorecardView } from '../lib/team/scorecard.mjs';
import { start, logBody } from './team-helper.mjs';

const TZ = 'America/Panama';
const at = (day, hhmm) => new Date(`${day}T${hhmm}:00-05:00`).toISOString();
const rep = (id, name, over = {}) => ({ type: 'rep.created', id, handle: id, email: '', name, role: 'rep', country: 'PA', city: 'Panama City', tz: TZ, workdays: [1, 2, 3, 4, 5], startDate: '2026-10-01', lang: 'es', t: at('2026-10-01', '08:00'), ...over });
const lead = (n) => ({ id: `PA-${n}`, name: `Negocio ${n}`, zone: 'Centro' });
const log = (id, r, n, kind, day, hhmm, over = {}) => ({ type: 'log', id, rep: r, lead: lead(n), kind, t: at(day, hhmm), ...over });
const LEADS = new Map([1, 2, 3, 4, 5, 6, 7].map((n) => [`PA-${n}`, { id: `PA-${n}`, company: `Negocio ${n}`, city: 'Panama City', zone: 'Centro', stage: 'New' }]));
const REPORT = { people: 3, allOk: true, phones: { out: 8, back: 8, broken: 0, working: 8 } };

function fixture() {
  const events = [
    rep('r1', 'Mario Paz'), rep('r2', 'José Ruiz'), { type: 'rep.practice', id: 'p1', handle: 'p1', name: 'Vendedor de práctica', tz: TZ, t: at('2026-10-01', '08:00') },
    log('L1', 'r1', 1, 'talk', '2026-11-16', '09:00', { channel: 'visit', took: true, q: { wifi: 'yes', lead: 'yes' } }),
    log('L2', 'r1', 2, 'call', '2026-11-16', '10:00', { channel: 'call', took: true }),
    log('L3', 'r1', 3, 'noanswer', '2026-11-16', '11:00', { channel: 'call' }),
    log('L4', 'r1', 4, 'message', '2026-11-17', '09:00', { channel: 'whatsapp' }),
    log('L5', 'r1', 1, 'meeting', '2026-11-17', '10:00', { channel: 'visit', holds: true, when: '2026-11-18' }),
    { type: 'confirm', logId: 'L5', what: 'meeting_held', t: at('2026-11-18', '17:00') },
    log('L6', 'r1', 2, 'contract', '2026-11-17', '15:00', { holds: true }),
    { type: 'confirm', logId: 'L6', what: 'contract_sent', t: at('2026-11-18', '09:00') },
    log('L7', 'r1', 5, 'talk', '2026-11-17', '16:00', { channel: 'visit' }),
    { type: 'log.void', logId: 'L7', by: 'boss', reason: 'otro', t: at('2026-11-17', '17:00') },
    { type: 'site', id: 's1', rep: 'r1', lead: { id: 'PA-2', name: 'Negocio 2' }, city: 'Panama City', t: at('2026-11-18', '11:00') },
    { type: 'site.request', siteId: 's1', count: 30, t: at('2026-11-18', '11:01') },
    { type: 'site.phones.added', siteId: 's1', count: 4, t: at('2026-11-19', '09:00') },
    { type: 'site.phones.added', siteId: 's1', count: 6, t: at('2026-11-19', '10:00') },
    { type: 'worker.added', siteId: 's1', id: 'w1', name: 'Ana Obrera', email: 'ana@ejemplo.test', phone: true, t: at('2026-11-19', '11:00') },
    { type: 'worker.consent', workerId: 'w1', v: 'v1', ext: 'jpg', form: 'v1', t: at('2026-11-19', '11:10') },
    { type: 'install.close', siteId: 's1', t: at('2026-11-19', '12:00') },
    { type: 'site.step', siteId: 's1', what: 'installed', t: at('2026-11-19', '13:00') },
    { type: 'site.report', id: 'sr1', siteId: 's1', day: '2026-11-20', report: REPORT, by: 'r1', t: at('2026-11-20', '18:00') },
    log('L8', 'r2', 6, 'talk', '2026-11-16', '09:00', { channel: 'visit' }),
    { type: 'log', id: 'L9', rep: 'r2', lead: lead(7), kind: 'talk', channel: 'visit', t: '2026-11-23T04:30:00Z' },   // Sunday 23:30 in Panama
    { type: 'practice.lead.added', lead: { id: 'APP-P1', company: 'Práctica', zone: '', city: '', by: 'p1', practice: true }, t: at('2026-11-16', '08:00') },
    { type: 'log', id: 'P1', rep: 'p1', lead: { id: 'APP-P1', name: 'Práctica' }, kind: 'talk', channel: 'visit', t: at('2026-11-16', '09:00') },
  ];
  const state = emptyState();
  for (const e of events) applyEvent(state, e);
  return state;
}

test('each cell is the sum of the list it opens, in each rep\'s week', () => {
  const state = fixture(), ctx = { now: '2026-11-23T15:00:00Z', leads: LEADS };
  assert.deepEqual(SCORECARD_COLS, ['touches', 'calls', 'visits', 'touched', 'talks', 'replies', 'booked', 'held', 'owned', 'overdue', 'progress', 'out', 'ready',
    'signed', 'installed', 'live', 'consents', 'working', 'owed', 'qualified']);
  assert.deepEqual(NOW_ONLY, ['owned', 'overdue', 'progress', 'out', 'ready']);
  const c = scorecardOf(state, 'r1', '2026-11-16', ctx);
  assert.deepEqual(c, { touches: 5, calls: 2, visits: 2, touched: 4, talks: 2, replies: 0, booked: 1, held: 1, owned: null, overdue: null, progress: null, out: null, ready: null,
    signed: 1, installed: 1, live: 1, consents: 1, working: 8, owed: 20, qualified: 1 });
  const v = scorecardView(state, '2026-11-16', ctx);
  assert.deepEqual(v.reps.map((r) => [r.id, r.cells.touches]), [['r2', 2], ['r1', 5]]);   // by name, practice absent
  assert.equal(v.team.touches, 7); assert.equal(v.team.owned, null);
  for (const col of SCORECARD_COLS) assert.equal(v.team[col], NOW_ONLY.includes(col) ? null : v.reps.reduce((a, r) => a + r.cells[col], 0), col);
  for (const r of v.reps) for (const col of SCORECARD_COLS) { const got = scorecardItems(state, state.reps.get(r.id), '2026-11-16', col, ctx);
    assert.equal(r.cells[col], got.kind === null ? null : got.items.reduce((a, x) => a + x.n, 0), `${r.id} ${col}`); }
  assert.deepEqual(scorecardWeeks('2026-11-23'), ['2026-11-23', '2026-11-16', '2026-11-09', '2026-11-02']);
  // the items say what they are
  const touches = scorecardItems(state, state.reps.get('r1'), '2026-11-16', 'touches', ctx);
  assert.deepEqual([touches.kind, touches.items[0]], ['logs', { id: 'L1', day: '2026-11-16', rep: 'Mario', lead: { id: 'PA-1', name: 'Negocio 1' }, kind: 'talk', channel: 'visit', n: 1 }]);
  assert.deepEqual(scorecardItems(state, state.reps.get('r1'), '2026-11-16', 'owed', ctx), { kind: 'sites', items: [{ id: 's1', name: 'Negocio 2', city: 'Panama City', rep: 'Mario', n: 20 }] });
  assert.deepEqual(scorecardItems(state, state.reps.get('r1'), '2026-11-16', 'consents', ctx).items, [{ id: 'w1', name: 'Ana Obrera', site: { id: 's1', name: 'Negocio 2' }, rep: 'Mario', n: 1 }]);
  // the week after is not this one: L9 stays in its own week
  assert.equal(scorecardOf(state, 'r2', '2026-11-23', ctx).touches, 0);
  // this week: the live columns are there, as the rep's book has them
  const now = scorecardOf(state, 'r1', '2026-11-23', ctx);
  assert.equal(now.owned, bookOf(state, LEADS, { now: ctx.now }).get('r1')?.owned ?? 0);
  assert.notEqual(now.owned, null);
});

test('the live columns count what the rep holds now, by the stage the app reads', () => {
  const now = '2026-11-23T15:00:00Z', state = emptyState();
  applyEvent(state, rep('r3', 'Rita Gomez'));
  const crm = (id, stage) => [id, { id, company: `Negocio ${id}`, city: 'Panama City', zone: 'Centro', stage, owner: 'Rita Gomez', lastContact: '2026-11-20', nextDay: '2026-11-20', nextStep: 'Llamar' }];
  const leads = new Map([crm('PA-B', 'Intro call booked'), crm('PA-S', 'Contract sent'), crm('PA-G', 'Contract signed'), crm('PA-L', 'Lost')]);
  const ctx = { now, leads };
  const c = scorecardOf(state, 'r3', '2026-11-23', ctx);
  assert.deepEqual([c.owned, c.overdue, c.progress, c.out, c.ready], [3, 3, 1, 1, 1]);
  for (const col of NOW_ONLY) {
    const got = scorecardItems(state, state.reps.get('r3'), '2026-11-23', col, ctx);
    assert.deepEqual([got.kind, got.items.reduce((a, x) => a + x.n, 0)], ['biz', c[col]], col);
  }
  assert.deepEqual(scorecardItems(state, state.reps.get('r3'), '2026-11-23', 'ready', ctx).items, [{ id: 'PA-G', name: 'Negocio PA-G', rep: 'Rita', next: { day: '2026-11-20', step: 'Llamar' }, n: 1 }]);
  // last week has no number for them
  assert.deepEqual(NOW_ONLY.map((col) => scorecardOf(state, 'r3', '2026-11-16', ctx)[col]), [null, null, null, null, null]);
});

const API = '/equipo/api';
const B = { bearer: 'push-token' };

test('GET scorecard: managers, admins, leaders and the token read it; a rep does not; weeks and cells are checked', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  const eq = await s.addRep(a.cookie, 'eq', { name: '=Cuenta Rara' });
  const LIST = Array.from({ length: 9000 }, (_, i) => ({ id: `PA-${String(i).padStart(5, '0')}`, company: `Negocio ${i}`, city: 'Panama City', zone: `Zona ${i % 12}`,
    stage: ['New', 'Contacted', 'Intro call booked', 'Contract sent', 'Lost'][i % 5], ...(i % 3 ? { owner: i % 2 ? 'mario Rep' : '=Cuenta Rara', lastContact: '2026-11-10', nextDay: '2026-11-12', nextStep: 'Paso' } : {}) }));
  assert.equal((await s.call('PUT', `${API}/leads`, LIST, B)).status, 200);
  for (let i = 0; i < 28; i += 1) await s.addRep(a.cookie, `rep${i}`);
  for (const [id, n, kind] of [['sc-log-00001', 1, 'talk'], ['sc-log-00002', 3, 'call'], ['sc-log-00003', 6, 'meeting']]) {
    const r = await s.call('POST', `${API}/log`, logBody(id, { lead: { id: `PA-0000${n}` }, kind, channel: kind === 'call' ? 'call' : 'visit', q: { wifi: 'yes', lead: 'yes' } }), { cookie: mario.cookie });
    assert.equal(r.status, 200, r.text);
  }
  const get = (p, who = a) => s.call('GET', `${API}/scorecard${p}`, undefined, who === B ? B : { cookie: who.cookie });

  assert.deepEqual([(await get('?week=2026-10-19')).status, (await get('?week=2026-10-19')).json.error], [400, 'week']);
  assert.equal((await get('?week=2026-10-26')).status, 200);
  const t0 = Date.now(), table = await get('');
  assert.ok(Date.now() - t0 < 1000, `answered in ${Date.now() - t0} ms`);
  assert.equal(table.status, 200, table.text);
  assert.deepEqual([table.json.week, table.json.weeks, table.json.cols], ['2026-11-16', ['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-26'], SCORECARD_COLS]);
  assert.equal(table.json.reps.length, 30);
  assert.deepEqual(table.json.reps.find((r) => r.id === mario.id).cells.touches, 3);
  assert.deepEqual([(await get('?cell=nope&rep=team')).status, (await get('?cell=nope&rep=team')).json.error], [400, 'fields']);
  assert.deepEqual([(await get('?cell=touches&rep=r_nobody0000')).status, (await get('?cell=touches&rep=r_nobody0000')).json.error], [404, 'rep']);
  const rep = await get('', mario);
  assert.deepEqual([rep.status, rep.json.error], [403, 'manager_only']);
  assert.equal((await get('', lia)).status, 200);
  const token = await get('', B);
  assert.equal(token.status, 200, token.text);
  assert.equal(token.json.reps.find((r) => r.id === eq.id).name, "'=Cuenta Rara");
  assert.equal(table.json.reps.find((r) => r.id === eq.id).name, '=Cuenta Rara');
  const before = s.lines().length;
  const post = await s.call('POST', `${API}/scorecard`, {}, { cookie: lia.cookie });
  assert.deepEqual([post.status, post.json.error], [403, 'read_only']);
  assert.equal(s.lines().length, before);

  // every cell opens into its list, and the team's into the team's
  for (const r of table.json.reps) {
    for (const col of SCORECARD_COLS) {
      const got = await get(`?week=2026-11-16&rep=${r.id}&cell=${col}`);
      assert.equal(got.status, 200, got.text);
      assert.equal(got.json.total, r.cells[col], `${r.id} ${col}`);
    }
  }
  for (const col of SCORECARD_COLS) assert.equal((await get(`?rep=team&cell=${col}`)).json.total, table.json.team[col], `team ${col}`);
  const one = (await get(`?rep=${mario.id}&cell=touches`)).json;
  assert.deepEqual(Object.keys(one).sort(), ['cell', 'items', 'kind', 'ok', 'rep', 'total', 'week']);
});

test('overdue and owned mean the same in the agenda, in Pendientes and in the Scorecard', () => {
  const st = emptyState(); applyEvent(st, rep('r1', 'Mario Paz'));
  const now = '2026-11-23T15:00:00.000Z', base = { city: 'Panama City', zone: 'Centro', owner: 'Mario Paz', lastContact: '2026-11-20' };
  const leads = new Map([
    { id: 'PA-OPEN', company: 'Abierto', stage: 'Contacted', nextDay: '2026-11-20', nextStep: 'Llamar' },
    { id: 'PA-WAIT1', company: 'Espera Uno', stage: 'Waitlist', nextDay: '2026-11-21', nextStep: 'Volver a preguntar' },
    { id: 'PA-WAIT2', company: 'Espera Dos', stage: 'Waitlist' },
    { id: 'PA-LOST', company: 'Perdido', stage: 'Lost', nextDay: '2026-11-20', nextStep: 'x' },
    { id: 'PA-DNC', company: 'No Llamar', stage: 'Contacted', doNotCall: true, nextDay: '2026-11-20', nextStep: 'x' },
  ].map((l) => [l.id, { ...base, ...l }]));
  const r1 = st.reps.get('r1'), ctx = { now, leads };
  const agenda = agendaOf(st, r1, { now, leads, name: (r) => r.name });
  assert.deepEqual([agenda.counts.overdue, agenda.counts.owned, agenda.counts.nonext], [2, 3, 0]);
  assert.deepEqual(agenda.due.map((x) => x.id), ['PA-OPEN', 'PA-WAIT1']);
  const team = teamView(st, { now, lang: 'es', leads });
  assert.deepEqual(team.needs.overdue.map((x) => [x.rep, x.overdue, x.oldest]), [['r1', 2, '2026-11-20']]);
  assert.deepEqual(team.reps[0].book, { owned: 3, overdue: 2, today: 0, nonext: 0 });
  const cells = scorecardOf(st, 'r1', '2026-11-23', ctx);
  assert.deepEqual([cells.overdue, cells.owned], [2, 3]);
  const items = (col) => scorecardItems(st, r1, '2026-11-23', col, ctx).items;
  assert.deepEqual(items('overdue').map((x) => x.id), ['PA-OPEN', 'PA-WAIT1']);
  assert.deepEqual(items('owned').map((x) => x.id), ['PA-OPEN', 'PA-WAIT2', 'PA-WAIT1'], 'by name');
  for (const col of ['overdue', 'owned']) assert.equal(cells[col], items(col).reduce((a, x) => a + x.n, 0), col);
  const book = bookOf(st, leads, { now }).get('r1');
  assert.deepEqual([book.overdue, book.owned, book.nonext], [cells.overdue, cells.owned, 0]);
});
