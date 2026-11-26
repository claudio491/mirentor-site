// GET leads answers whose each business is, and lists what is due, coming, unplanned, the rep's own and free.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { addDays } from '../lib/team/rules.mjs';
import { searchLeads } from '../lib/team/store.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const pad = (i) => String(i).padStart(2, '0');
const ROW_KEYS = ['free', 'id', 'known', 'lastDay', 'lastKind', 'lost', 'name', 'next', 'owner', 'stage', 'walkin', 'workers', 'zone'];

// 40 businesses mario holds in the CRM, next days from 2026-11-10 to 2026-11-30, plus 5 free ones over two zones of his
// pick and one he did not pick.
const held = Array.from({ length: 40 }, (_, i) => ({ id: `PA-M${pad(i)}`, company: `Mario ${pad(i)}`, city: 'Panama City', zone: 'Centro', stage: 'Contacted', owner: 'mario Rep',
  lastContact: '2026-11-09', nextDay: addDays('2026-11-10', i % 21), nextStep: `Paso ${pad(i)}` }));
const free = [['F1', 9, 'San Francisco'], ['F2', 7, 'Centro'], ['F3', null, 'Bella Vista'], ['F4', 8, 'San Francisco'], ['F5', 3, 'San Francisco'], ['F6', 2, 'Bella Vista']]
  .map(([k, walkin, zone]) => ({ id: `PA-${k}`, company: `Libre ${k}`, city: 'Panama City', zone, stage: 'New', ...(walkin === null ? {} : { walkin }) }));
const extra = [
  { id: 'PA-LOST', company: 'Mario Perdido', city: 'Panama City', zone: 'Centro', stage: 'Lost', owner: 'mario Rep', lastContact: '2026-11-09' },
  { id: 'PA-NONE', company: 'Mario Sin Paso', city: 'Panama City', zone: 'Centro', stage: 'Contacted', owner: 'mario Rep', lastContact: '2026-11-09' },
  { id: 'PA-WAIT', company: 'Libre Espera', city: 'Panama City', zone: 'Centro', stage: 'Waitlist' },
  { id: 'PA-COLON', company: 'Libre Colón', city: 'Colón', zone: 'Centro', stage: 'New', walkin: 10 },
];

async function team(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose');
  assert.equal((await s.call('PUT', `${API}/leads`, [...held, ...free, ...extra], B)).status, 200);
  assert.equal((await s.call('POST', `${API}/zones`, { zones: ['Centro', 'Bella Vista'] }, { cookie: mario.cookie })).status, 200);
  const get = async (who, p) => { const r = await s.call('GET', `${API}/leads?${p}`, undefined, { cookie: who.cookie }); assert.equal(r.status, 200, r.text); return r.json; };
  return { s, a, mario, jose, get };
}

test('due: what is overdue and due today, oldest first, 30 to a page', async (t) => {
  const { mario, get } = await team(t);
  const due = await get(mario, 'list=due');
  // days 2026-11-10 to 2026-11-16: i and i + 21 for i <= 6, then i + 21 <= 39
  const want = held.filter((l) => l.nextDay <= '2026-11-16').sort((x, y) => (x.nextDay < y.nextDay ? -1 : x.nextDay > y.nextDay ? 1 : x.company.localeCompare(y.company, 'es')));
  assert.deepEqual([due.total, due.offset, due.leads.length], [want.length, 0, want.length]);
  assert.deepEqual(due.leads.map((r) => r.id), want.map((l) => l.id));
  const row = due.leads[0];
  assert.deepEqual(Object.keys(row).sort(), ROW_KEYS);
  assert.deepEqual([row.id, row.owner, row.next, row.stage, row.free, row.lastDay, row.lastKind], ['PA-M00', { name: 'mario', mine: true }, { day: '2026-11-10', step: 'Paso 00' }, 'Contacted', false, '2026-11-09', null]);
  const mine = await get(mario, 'list=mine');
  assert.deepEqual([mine.total, mine.leads.length], [41, 30]);
  assert.deepEqual(mine.leads.slice(0, 2).map((r) => r.next.day), ['2026-11-10', '2026-11-10']);
  const rest = await get(mario, 'list=mine&offset=30');
  assert.deepEqual([rest.total, rest.offset, rest.leads.length, rest.leads.at(-1).id], [41, 30, 11, 'PA-NONE'], 'no next step comes last; Lost is not his to work');
  assert.deepEqual((await get(mario, 'list=mine&offset=-4')).offset, 0);
});

test('soon is the next 7 days; nonext leaves Lost out; jose has none of them', async (t) => {
  const { mario, jose, get } = await team(t);
  const soon = await get(mario, 'list=soon');
  const days = soon.leads.map((r) => r.next.day);
  assert.deepEqual([days[0], days.at(-1), days.every((d) => d >= '2026-11-17' && d <= '2026-11-23'), soon.total], ['2026-11-17', '2026-11-23', true, held.filter((l) => l.nextDay >= '2026-11-17' && l.nextDay <= '2026-11-23').length]);
  const nonext = await get(mario, 'list=nonext');
  assert.deepEqual(nonext.leads.map((r) => r.id), ['PA-NONE']);
  for (const list of ['due', 'soon', 'nonext', 'mine']) assert.equal((await get(jose, `list=${list}`)).total, 0, list);
});

test('free: the rep\'s two zones first, then the highest walk-in score, none last; zone= keeps one zone', async (t) => {
  const { mario, get } = await team(t);
  const got = await get(mario, 'list=free');
  assert.deepEqual(got.leads.map((r) => r.id), ['PA-F2', 'PA-F6', 'PA-F3', 'PA-F1', 'PA-F4', 'PA-F5']);
  assert.deepEqual([got.leads[0].free, got.leads[0].owner, got.leads[0].walkin, got.leads[2].walkin], [true, null, 7, null]);
  assert.deepEqual((await get(mario, 'list=free&zone=san francisco')).leads.map((r) => r.id), ['PA-F1', 'PA-F4', 'PA-F5']);
});

test('a do_not_call on a free one takes it out of free and out of ?q= at once; an unknown list is refused', async (t) => {
  const { s, mario, jose, get } = await team(t);
  assert.deepEqual((await get(mario, 'q=Libre F1')).leads.map((r) => r.id), ['PA-F1']);
  const r = await s.call('POST', `${API}/log`, logBody('dnc-free-0001', { lead: { id: 'PA-F1' }, kind: 'call', channel: 'call', tag: 'do_not_call' }), { cookie: jose.cookie });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual((await get(mario, 'q=Libre F1')).leads, []);
  assert.equal((await get(mario, 'list=free')).leads.some((l) => l.id === 'PA-F1'), false);
  const bad = await s.call('GET', `${API}/leads?list=bogus`, undefined, { cookie: mario.cookie });
  assert.deepEqual([bad.status, bad.json.error], [400, 'list']);
  // a void brings it back
  await s.call('POST', `${API}/void`, { logId: 'dnc-free-0001', reason: 'otro negocio' }, { cookie: (await s.admin()).cookie });
  assert.deepEqual((await get(mario, 'q=Libre F1')).leads.map((l) => l.id), ['PA-F1']);
});

test('a search row says whose each business is', async (t) => {
  const { mario, jose, get } = await team(t);
  const ofMario = (await get(mario, 'q=Mario 00')).leads[0], ofJose = (await get(jose, 'q=Mario 00')).leads[0];
  assert.deepEqual(Object.keys(ofMario).sort(), ROW_KEYS);
  assert.deepEqual([ofMario.owner, ofJose.owner], [{ name: 'mario', mine: true }, { name: 'mario', mine: false }]);
  assert.deepEqual([(await get(jose, 'q=Libre F2')).leads[0].free, (await get(jose, 'q=Libre F2')).leads[0].owner], [true, null]);
  assert.equal((await get(jose, 'list=due&q=Mario')).total, 0, 'list wins over q');
});

test('searchLeads: skip drops a business, any ignores the city and still keeps practice out', () => {
  const leads = new Map([['1', { id: '1', company: 'Casa Uno', city: 'Panama City' }], ['2', { id: '2', company: 'Casa Dos', city: 'Colón' }], ['3', { id: '3', company: 'Casa Tres', city: 'Panama City', practice: true }]]);
  assert.deepEqual(searchLeads(leads, 'casa', 'Panama City', 20, null, { skip: (l) => l.id === '1' }).map((l) => l.id), []);
  assert.deepEqual(searchLeads(leads, 'casa', '', 20, null, { any: true }).map((l) => l.id), ['1', '2']);
});

test('a business the app holds as Contract signed is never offered as free, even released, until the CRM says so', async (t) => {
  const { s, a, mario, jose, get } = await team(t);
  const r = await s.call('POST', `${API}/log`, logBody('sign-free-0001', { lead: { id: 'PA-F2' }, kind: 'contract' }), { cookie: mario.cookie });
  assert.equal(r.status, 200, r.text);
  for (const what of ['contract_sent', 'contract_signed']) assert.equal((await s.call('POST', `${API}/confirm`, { logId: 'sign-free-0001', what }, { cookie: a.cookie })).status, 200);
  const go = await s.call('POST', `${API}/biz/PA-F2`, { release: true }, { cookie: a.cookie });
  assert.deepEqual([go.status, go.json.biz.free, go.json.biz.stage], [200, true, 'Contract signed']);
  assert.equal((await get(jose, 'list=free')).leads.some((l) => l.id === 'PA-F2'), false);
  assert.equal((await get(jose, 'list=free')).leads.some((l) => l.id === 'PA-F6'), true);
  // the search does not find it, the near twins say it may not be picked, and a log cannot take it, by id or by name
  assert.deepEqual((await get(jose, 'q=Libre')).leads.map((l) => l.id).includes('PA-F2'), false);
  assert.equal((await get(jose, 'q=Libre')).leads.some((l) => l.id === 'PA-F6'), true);
  const twins = (await get(jose, `similar=${encodeURIComponent('Libre F2')}`)).leads;
  assert.deepEqual([twins.find((l) => l.id === 'PA-F2')?.pick, twins.find((l) => l.id === 'PA-F1')?.pick], [false, true]);
  const n = s.lines().length;
  const byId = await s.call('POST', `${API}/log`, logBody('sign-free-0002', { lead: { id: 'PA-F2' } }), { cookie: jose.cookie });
  assert.deepEqual([byId.status, byId.json.error], [400, 'lead']);
  const byName = await s.call('POST', `${API}/log`, logBody('sign-free-0003', { lead: { name: 'Libre F2', zone: 'Centro' } }), { cookie: jose.cookie });
  assert.deepEqual([byName.status, byName.json.error], [400, 'lead']);
  assert.equal(s.lines().length, n, 'nothing written');
});
