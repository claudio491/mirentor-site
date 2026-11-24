// One test per finding of the whole-branch review (17 Nov): each one reproduces the behavior a person would hit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createDesk } from '../lib/desk.mjs';
import { startTeam } from '../lib/team/api.mjs';
import { openTeamStore } from '../lib/team/store.mjs';
import { ORIGIN, MON_10, start, logBody } from './team-helper.mjs';

const DAY_MS = 24 * 3600 * 1000;
const B = { bearer: 'push-token' };
const odd = { toString: 1 };   // String(odd) throws: the plain way to break a handler that trusts what it is sent

test('a request with the wrong types is refused, and the service keeps answering', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const st = async (...args) => (await s.call(...args)).status;
  const C = { cookie: m.cookie }, A = { cookie: a.cookie };
  assert.equal(await st('POST', '/equipo/api/bootstrap', { email: odd, name: odd }, B), 400);
  assert.equal(await st('POST', `/equipo/api/reps/${m.id}`, { patch: { email: odd } }, A), 400);
  assert.equal((await s.call('POST', '/equipo/api/log', logBody('aaaa1111', { id: 12345678 }), C)).json.error, 'id');
  assert.equal((await s.call('POST', '/equipo/api/log', logBody('aaaa1112', { kind: ['message'] }), C)).json.error, 'kind');
  assert.equal(await st('POST', '/equipo/api/log', logBody('aaaa1114', { lead: { id: odd } }), C), 400);
  // details that are not text are dropped; the log itself stands
  assert.equal(await st('POST', '/equipo/api/log', logBody('aaaa1113', { note: odd, contact: odd, when: odd, clientAt: odd, channel: odd, tag: odd }), C), 200);
  assert.equal(await st('POST', '/equipo/api/close', { tomorrow: odd, blocker: odd }, C), 400);
  assert.equal(await st('POST', '/equipo/api/held', { logId: odd }, C), 404);
  assert.equal(await st('POST', '/equipo/api/kudos', { target: odd }, C), 400);
  assert.equal(await st('POST', '/equipo/api/play', { logId: 'aaaa1113', text: odd }, C), 400);
  assert.equal(await st('POST', '/equipo/api/reps', { email: odd, name: odd }, A), 400);
  assert.equal(await st('POST', '/equipo/api/reps', { email: odd, name: 'Nombre Bueno' }, A), 400);
  assert.equal(await st('POST', '/equipo/api/dayoff', { scope: odd, date: odd }, A), 400);
  assert.equal(await st('POST', '/equipo/api/void', { logId: odd, reason: odd }, A), 404);
  assert.equal(await st('POST', '/equipo/api/confirm', { logId: odd, what: odd }, A), 404);
  assert.equal(await st('PUT', '/equipo/api/leads', [{ id: odd, company: odd }, { id: 'PA-1', company: 'Uno', city: 'Panama City' }], B), 200);
  assert.equal(await st('GET', '/healthz'), 200);
  const me = await s.call('GET', '/equipo/api/me', undefined, C);
  assert.deepEqual([me.status, me.json.today.points], [200, 8]);
  assert.deepEqual(s.said, []);   // nothing reached the last-resort guard
});

test('a time zone that does not exist is refused when a person is created', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  assert.equal((await s.call('POST', '/equipo/api/bootstrap', { email: 'jefe@equipo.test', name: 'Jefe Uno', tz: 'Panama' }, B)).status, 400);
  const a = await s.admin();
  const bad = await s.call('POST', '/equipo/api/reps', { email: 'mario@equipo.test', name: 'Mario Rep', tz: 'Not/AZone' }, { cookie: a.cookie });
  assert.deepEqual([bad.status, bad.json.error], [400, 'fields']);
  assert.equal(s.lines().filter((e) => e.type === 'rep.created').length, 1);
  assert.equal((await s.call('POST', '/equipo/api/reps', { email: 'mario@equipo.test', name: 'Mario Rep', tz: 'America/Bogota' }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie })).status, 200);
});

test('a line the reducer cannot apply is skipped on start, and the rest of the log still loads', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-replay-')); mkdirSync(path.join(dir, 'team'));
  const ev = (o) => `${JSON.stringify(o)}\n`;
  writeFileSync(path.join(dir, 'team', 'events.jsonl'),
    ev({ type: 'rep.created', t: '2026-11-02T13:00:00.000Z', id: 'r_zone', handle: 'zona', name: 'Zona Mala', role: 'rep', tz: 'Panama', startDate: '2026-11-02' })
    + ev({ type: 'rep.created', t: 'not a date', id: 'r_date', handle: 'fecha', name: 'Fecha Mala', role: 'rep' })
    + ev({ type: 'log', t: '2026-11-16T15:00:00.000Z', id: 'log-of-nobody', rep: 'r_ghost', lead: null, kind: 'talk' })
    + ev({ type: 'log', t: '2026-11-16T15:00:00.000Z', id: 'log-no-lead', rep: 'r_zone', kind: 'talk' })
    + ev({ type: 'rep.created', t: '2026-11-02T13:00:00.000Z', id: 'r_ok', handle: 'bueno', name: 'Rep Bueno', role: 'rep', tz: 'America/Panama', startDate: '2026-11-02' }));
  const said = [];
  const store = openTeamStore(dir, { log: (m) => said.push(m) });
  assert.equal(store.state.reps.has('r_ok'), true);
  assert.equal(store.state.reps.get('r_zone').tz, 'America/Panama');   // a bad time zone falls back instead of poisoning every later read
  assert.equal(store.state.reps.has('r_date'), false);
  assert.equal(said.length >= 1, true);
  assert.doesNotThrow(() => store.append({ type: 'log', id: 'ok-log-0001', rep: 'r_ok', lead: { id: 'L1', name: 'Uno', zone: '' }, kind: 'talk' }));
});

test('an exception inside a handler answers 500 and the service stays up', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-boom-'));
  const said = [];
  const team = async (req, res, pathname) => { if (!pathname.startsWith('/equipo')) return false; throw new Error('boom'); };
  const srv = createServer({ store: openStore(dir), sheets: null, origins: [ORIGIN], team, log: (m) => said.push(String(m)) });
  await new Promise((r) => srv.listen(0, r)); t.after(() => srv.close());
  const url = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(`${url}/equipo/api/me`);
  assert.deepEqual([r.status, (await r.json()).ok], [500, false]);
  // the older routes sit behind the same guard: a body built to break String() used to end the process
  const w = await fetch(`${url}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: JSON.stringify({ business: odd, website: odd }) });
  assert.equal(w.status, 500);
  assert.equal((await fetch(`${url}/healthz`)).status, 200);
  assert.equal(said.length, 2);
});

test('the service starts with the team off when the team module cannot start', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-noboot-'));
  writeFileSync(path.join(dir, 'team'), 'a file where the folder should be');
  const env = { TEAM_ENABLED: '1', TEAM_PUSH_TOKEN: 'a-token-for-this-test' };
  const sales = Object.assign(async () => false, { who: () => null });   // the portal, as far as starting goes
  const said = [];
  assert.equal(startTeam(env, dir, { sales, log: (m) => said.push(m) }), null);
  assert.match(said.join(' '), /could not start/);
  assert.equal(typeof startTeam(env, mkdtempSync(path.join(tmpdir(), 'team-boot-')), { sales }), 'function');
  assert.equal(startTeam({}, dir, { sales }), null);
});

test('a follow-up is decided when the log is made: pushing the lead list again does not move points already earned', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const list = (lastContact) => [{ id: 'PA-0001', company: 'Ferretería El Roble', city: 'Panama City', zone: 'Vía España', stage: 'Contacted', lastContact }];
  await s.call('PUT', '/equipo/api/leads', list('2026-11-10'), B);
  const first = await s.call('POST', '/equipo/api/log', logBody('fafa0001', { lead: { id: 'PA-0001' } }), { cookie: m.cookie });
  assert.deepEqual([first.json.gained, first.json.me.today.habits[2]], [10, true]);
  await s.call('PUT', '/equipo/api/leads', list('2026-11-16'), B);   // the nightly copy writes this very log back as the lead's last contact
  s.time.now += DAY_MS;
  const next = (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  assert.deepEqual([next.week.days[0].habits, next.week.points, next.level.xp, next.ledger.some((e) => e.code === 'followup')], [[true, false, true, false], 10, 10, true]);
});

test('an empty lead list, or one that shrinks to less than half, is refused unless it is forced', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const many = (n) => Array.from({ length: n }, (_, i) => ({ id: `PA-${i}`, company: `Negocio ${i}`, city: 'Panama City', stage: 'New' }));
  assert.equal((await s.call('PUT', '/equipo/api/leads', many(40), B)).json.count, 40);
  const none = await s.call('PUT', '/equipo/api/leads', [], B);
  assert.deepEqual([none.status, none.json.error], [400, 'empty']);
  const few = await s.call('PUT', '/equipo/api/leads', many(10), B);
  assert.deepEqual([few.status, few.json.error], [409, 'shrink']);
  assert.equal((await s.call('PUT', '/equipo/api/leads', many(30), B)).json.count, 30);
  assert.equal((await s.call('PUT', '/equipo/api/leads?force=1', many(10), B)).json.count, 10);
});

test('a business added in the app is in the event log: it survives the loss of the lead cache', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('caca0001'), { cookie: m.cookie });
  assert.equal(s.lines().filter((e) => e.type === 'lead.added').length, 1);
  s.srv.close();
  writeFileSync(path.join(s.dir, 'team', 'leads.json'), 'not json');
  const again = await start({ dir: s.dir }); t.after(() => again.srv.close());
  const ex = await again.call('GET', '/equipo/api/export?since=2026-11-16T00:00:00Z', undefined, B);
  assert.deepEqual(ex.json.newLeads.map((l) => [l.company, l.zone, l.city]), [['Ferretería El Roble', 'Vía España', 'Panama City']]);
});

test('a business typed as new a second time is the same business', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const C = { cookie: m.cookie };
  const one = await s.call('POST', '/equipo/api/log', logBody('dada0001', { lead: { name: 'Taller Pinzón', zone: 'Río Abajo' } }), C);
  s.time.now += 4 * 3600 * 1000;
  const two = await s.call('POST', '/equipo/api/log', logBody('dada0002', { lead: { name: '  taller pinzon ', zone: 'RIO ABAJO' } }), C);
  assert.deepEqual([one.json.gained, two.json.repeat, two.json.gained, two.json.me.today.points, two.json.me.today.visits], [8, true, 0, 8, 1]);
  const other = await s.call('POST', '/equipo/api/log', logBody('dada0004', { lead: { name: 'Taller Pinzón', zone: 'Calidonia' } }), C);
  assert.deepEqual([other.json.repeat, other.json.gained], [false, 8]);   // the same name in another area is another business
  const ex = await s.call('GET', '/equipo/api/export?since=2026-11-16T00:00:00Z', undefined, B);
  assert.equal(ex.json.newLeads.length, 2);
});

test('a day with nothing logged cannot be closed, so a tap after midnight does not close the wrong day', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('eaea0001'), { cookie: m.cookie });
  s.time.now = Date.parse('2026-11-17T05:10:00Z');   // 12:10 am on Tuesday in Panama
  const early = await s.call('POST', '/equipo/api/close', { tomorrow: 'Volver a El Roble', blocker: '' }, { cookie: m.cookie });
  assert.deepEqual([early.status, early.json.error], [409, 'nothing_to_close']);
  assert.equal(s.lines().some((e) => e.type === 'day.close'), false);
});

test('the preview of the close says when the day has nothing to report yet, before the rep writes anything', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const before = await s.call('POST', '/equipo/api/close', { preview: true, tomorrow: '', blocker: '' }, { cookie: m.cookie });
  assert.deepEqual([before.status, before.json.empty], [200, true]);
  await s.call('POST', '/equipo/api/log', logBody('ecec0001'), { cookie: m.cookie });
  const after = await s.call('POST', '/equipo/api/close', { preview: true, tomorrow: '', blocker: '' }, { cookie: m.cookie });
  assert.deepEqual([after.status, after.json.empty], [200, false]);
});

test('a manager reopens a day closed by mistake: the points for closing go and the rep can log again', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('ebeb0001'), { cookie: m.cookie });
  await s.call('POST', '/equipo/api/close', { tomorrow: 'Volver a El Roble', blocker: '' }, { cookie: m.cookie });
  assert.equal((await s.call('POST', '/equipo/api/reopen', { rep: m.id, day: '2026-11-16' }, { cookie: m.cookie })).status, 403);
  assert.equal((await s.call('POST', '/equipo/api/reopen', { rep: m.id, day: '2026-11-16' }, { cookie: a.cookie })).status, 200);
  const me = (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  assert.deepEqual([me.today.closed, me.today.points, me.feed.some((f) => f.code === 'day_closed')], [false, 8, false]);
  assert.equal((await s.call('POST', '/equipo/api/log', logBody('ebeb0002', { lead: { name: 'Otro Negocio', zone: 'Z' } }), { cookie: m.cookie })).status, 200);
  const twice = await s.call('POST', '/equipo/api/reopen', { rep: m.id, day: '2026-11-16' }, { cookie: a.cookie });
  assert.deepEqual([twice.status, twice.json.error], [409, 'not_closed']);
  assert.equal((await s.call('POST', '/equipo/api/close', { tomorrow: 'Ahora sí', blocker: '' }, { cookie: m.cookie })).status, 200);
});

test('the manager still sees a meeting to confirm when its date is weeks after the booking, and a confirmation after the wait is refused', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('gaga0001', { kind: 'meeting', when: '2026-12-04' }), { cookie: m.cookie });
  await s.call('POST', '/equipo/api/log', logBody('gaga0002', { kind: 'meeting', lead: { name: 'Sin Fecha', zone: 'Z' } }), { cookie: m.cookie });
  s.time.now = Date.parse('2026-12-02T17:00:00Z');
  const team = await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie });
  assert.deepEqual(team.json.needs.confirm.map((x) => x.logId), ['gaga0001']);
  const me = (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  assert.deepEqual(me.ledger.filter((e) => e.code === 'meeting_held').map((e) => [e.logId, e.status]).sort(), [['gaga0001', 'pending'], ['gaga0002', 'expired']]);
  const late = await s.call('POST', '/equipo/api/confirm', { logId: 'gaga0002', what: 'meeting_held' }, { cookie: a.cookie });
  assert.deepEqual([late.status, late.json.error], [409, 'expired']);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'gaga0001', what: 'meeting_held' }, { cookie: a.cookie })).status, 200);
});

test('working days are Monday to Friday: the hand has five fingers', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const r = await s.call('POST', '/equipo/api/reps', { email: 'sabado@equipo.test', name: 'Rep Sabado', city: 'Panama City', workdays: [2, 3, 4, 5, 6, 7] }, { cookie: a.cookie });
  const team = await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie });
  assert.deepEqual(team.json.reps.find((x) => x.id === r.json.id).workdays, [2, 3, 4, 5]);
  const patch = await s.call('POST', `/equipo/api/reps/${r.json.id}`, { patch: { workdays: [6, 7] } }, { cookie: a.cookie });
  // refused, and since 24 Nov with the reason that says what to do: at least one working day (it was the generic 'patch')
  assert.deepEqual([patch.status, patch.json.error], [400, 'workdays']);
});

test('a site posted twice with the same id is one site, and a manager can void it', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const body = { id: 's_0123456789abcdef', rep: m.id, lead: { name: 'Astillero El Faro' } };
  await s.call('POST', '/equipo/api/site', body, { cookie: a.cookie });
  const again = await s.call('POST', '/equipo/api/site', body, { cookie: a.cookie });
  assert.equal(again.json.sites.length, 1);
  const me = async () => (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  assert.equal((await me()).week.points, 40);
  const gone = await s.call('POST', '/equipo/api/site/s_0123456789abcdef', { what: 'void' }, { cookie: a.cookie });
  assert.deepEqual([gone.status, gone.json.sites.length], [200, 0]);
  const after = await me();
  assert.deepEqual([after.week.points, after.level.xp, after.feed.some((f) => f.code === 'site_signed'), after.ledger.some((e) => e.code.startsWith('site_'))], [0, 0, false, false]);
});

test('a manager can undo a confirmation made by mistake', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const A = { cookie: a.cookie };
  await s.call('POST', '/equipo/api/log', logBody('haha0001', { kind: 'meeting' }), { cookie: m.cookie });
  await s.call('POST', '/equipo/api/log', logBody('haha0002', { kind: 'contract', lead: { name: 'Taller Pinzón', zone: 'Río Abajo' } }), { cookie: m.cookie });
  const pts = async () => (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  await s.call('POST', '/equipo/api/confirm', { logId: 'haha0001', what: 'meeting_held' }, A);
  assert.equal((await pts()).today.points, 23);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'haha0001', what: 'meeting_held', undo: true }, { cookie: m.cookie })).status, 403);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'haha0001', what: 'meeting_held', undo: true }, A)).status, 200);
  const back = await pts();
  assert.deepEqual([back.today.points, back.pending.some((p) => p.logId === 'haha0001'), back.feed.some((f) => f.code === 'meeting_held')], [13, true, false]);
  await s.call('POST', '/equipo/api/confirm', { logId: 'haha0002', what: 'contract_sent' }, A);
  await s.call('POST', '/equipo/api/confirm', { logId: 'haha0002', what: 'contract_signed' }, A);
  const order = await s.call('POST', '/equipo/api/confirm', { logId: 'haha0002', what: 'contract_sent', undo: true }, A);
  assert.deepEqual([order.status, order.json.error], [409, 'order']);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'haha0002', what: 'contract_signed', undo: true }, A)).status, 200);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'haha0002', what: 'contract_sent', undo: true }, A)).status, 200);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'haha0002', what: 'contract_sent', undo: true }, A)).status, 400);
  assert.equal((await pts()).today.points, 13);
});

test('the same result on the same business the same day updates the first log instead of being thrown away', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const C = { cookie: m.cookie }, lead = { name: 'Bodega Central', zone: 'Calidonia' };
  await s.call('POST', '/equipo/api/log', logBody('abcd0001', { kind: 'meeting', lead, channel: 'visit', when: '2026-11-19', contact: 'Sra. Ana' }), C);
  const again = await s.call('POST', '/equipo/api/log', logBody('abcd0002', { kind: 'meeting', lead, when: '2026-11-20', contact: 'Sra. Ana, dueña', note: 'Llevar muestra' }), C);
  assert.deepEqual([again.json.repeat, again.json.updated, again.json.gained, again.json.logId], [true, true, 0, 'abcd0001']);
  const ex = await s.call('GET', '/equipo/api/export?since=2026-11-16T00:00:00Z', undefined, B);
  assert.deepEqual(ex.json.logs.map((l) => [l.id, l.when, l.contact, l.note, l.crm.channel]), [['abcd0001', '2026-11-20', 'Sra. Ana, dueña', 'Llevar muestra', 'In-person visit']]);
  const same = await s.call('POST', '/equipo/api/log', logBody('abcd0003', { kind: 'meeting', lead, when: '2026-11-20' }), C);
  assert.deepEqual([same.json.repeat, same.json.updated], [true, false]);   // nothing new typed: nothing written
  const retry = await s.call('POST', '/equipo/api/log', logBody('abcd0001', { kind: 'meeting', lead, when: '2026-12-01' }), C);
  assert.deepEqual([retry.json.repeat, retry.json.updated], [true, false]);   // the same id again is a retry, never an edit
  assert.deepEqual([s.lines().filter((e) => e.type === 'log').length, s.lines().filter((e) => e.type === 'log.update').length], [1, 1]);
});

test('the team view lists the cities of the lead list and how many businesses each rep can pick', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario'); const j = await s.addRep(a.cookie, 'jose', { city: 'Ciudad de Panamá' });
  await s.call('PUT', '/equipo/api/leads', [
    { id: 'PA-1', company: 'Uno', city: 'Panama City', stage: 'New' }, { id: 'PA-2', company: 'Dos', city: 'Panama City', stage: 'Contacted' },
    { id: 'PA-3', company: 'Tres', city: 'Panama City', stage: 'Contract signed' }, { id: 'PA-4', company: 'Cuatro', city: 'Colón', stage: 'New' }], B);
  const team = (await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie })).json;
  assert.deepEqual(team.cities, ['Colón', 'Panama City']);
  assert.deepEqual([team.reps.find((r) => r.id === m.id).leadsInCity, team.reps.find((r) => r.id === j.id).leadsInCity], [2, 0]);
});

test('bootstrap closes once the team has an admin, unless it is opened by name', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const first = await s.call('POST', '/equipo/api/bootstrap', { email: 'jefe@equipo.test', name: 'Jefe Uno' }, B);
  assert.equal(first.status, 200);
  const other = await s.call('POST', '/equipo/api/bootstrap', { email: 'intruso@equipo.test', name: 'Otro Admin' }, B);
  const same = await s.call('POST', '/equipo/api/bootstrap', { email: 'jefe@equipo.test', name: 'Jefe Uno' }, B);
  assert.deepEqual([other.status, other.json.error, same.status], [409, 'bootstrap_closed', 409]);
  assert.equal(s.lines().filter((e) => e.type === 'rep.created').length, 1);
  const open = await start({ bootstrapOpen: true }); t.after(() => open.srv.close());
  await open.admin();
  assert.equal((await open.call('POST', '/equipo/api/bootstrap', { email: 'segundo@equipo.test', name: 'Segundo Admin' }, B)).status, 200);
});

test('the feed shows points only on the viewer\'s own moves, and all of them to a manager', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario'); const j = await s.addRep(a.cookie, 'jose');
  await s.call('POST', '/equipo/api/log', logBody('iaia0001'), { cookie: m.cookie });
  const feed = async (cookie) => (await s.call('GET', '/equipo/api/me', undefined, { cookie })).json.feed[0];
  assert.deepEqual([(await feed(m.cookie)).pts, (await feed(j.cookie)).pts, (await feed(a.cookie)).pts], [8, null, 8]);
});

test('the desk and the waitlist answer as before with the team module on', async (t) => {
  const s = await start({ desk: (dir) => createDesk({ dir, password: 'desk-password-for-this-test', pushToken: 'desk-token-for-this-test' }) }); t.after(() => s.srv.close());
  const d = await s.call('GET', '/desk');
  assert.deepEqual([d.status, /text\/html/.test(d.headers.get('content-type'))], [200, true]);
  assert.equal((await s.call('GET', '/healthz')).json.desk, true);
  assert.equal((await s.call('GET', '/equipo/app.js')).status, 200);
  const wl = await fetch(`${s.url}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}' });
  assert.equal(wl.status, 400);
  void MON_10;
});
