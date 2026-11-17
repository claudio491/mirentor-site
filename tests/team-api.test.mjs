import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createTeam, teamConfig } from '../lib/team/api.mjs';

const ORIGIN = 'https://mirentor.onrender.com';
const PIN = '482915';
const MON_10 = Date.parse('2026-11-16T15:00:00Z');   // Monday 10:00 in Panama

async function start({ clock = MON_10, sample = false, dev = false, previewOffsetMs = 0 } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-api-'));
  if (sample) { mkdirSync(path.join(dir, 'team')); writeFileSync(path.join(dir, 'team', 'SAMPLE'), 'sample data\n'); }
  const staticDir = path.join(dir, 'static'); mkdirSync(staticDir);
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>t</title><script type="module" src="app.js"></script>');
  writeFileSync(path.join(staticDir, 'app.js'), 'export const ok = 1;');
  mkdirSync(path.join(staticDir, 'fonts')); writeFileSync(path.join(staticDir, 'fonts', 'geist-v1.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]));
  const time = { now: clock };
  const team = createTeam({ dir, secret: 'test-secret', pushToken: 'push-token', now: () => new Date(time.now), staticDir, origins: [ORIGIN], dev, previewOffsetMs });
  const srv = createServer({ store: openStore(dir), sheets: null, origins: [ORIGIN], team });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, p, body, { cookie, bearer, origin, raw } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (origin) headers.origin = origin;
    const r = await fetch(`${url}${p}`, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), redirect: 'manual' });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, text, headers: r.headers, cookie: (r.headers.get('set-cookie') || '').split(';')[0] || null };
  };
  const tokenOf = (setupUrl) => new URL(setupUrl).searchParams.get('t');
  const admin = async () => {
    const b = await call('POST', '/equipo/api/bootstrap', { handle: 'jefe', name: 'Jefe Uno' }, { bearer: 'push-token' });
    const s = await call('POST', '/equipo/api/setup', { token: tokenOf(b.json.setupUrl), pin: PIN });
    return { cookie: s.cookie, setupUrl: b.json.setupUrl };
  };
  const addRep = async (adminCookie, handle, over = {}) => {
    const r = await call('POST', '/equipo/api/reps', { handle, name: `${handle} Rep`, country: 'PA', city: 'Panama City', workdays: [1, 2, 3, 4, 5], startDate: '2026-10-01', ...over }, { cookie: adminCookie });
    const s = await call('POST', '/equipo/api/setup', { token: tokenOf(r.json.setupUrl), pin: PIN });
    return { id: r.json.id, cookie: s.cookie, setupUrl: r.json.setupUrl };
  };
  const lines = () => readFileSync(path.join(dir, 'team', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { srv, url, call, admin, addRep, tokenOf, lines, dir, time };
}
const logBody = (id, over = {}) => ({ id, lead: { name: 'Ferretería El Roble', zone: 'Vía España' }, kind: 'talk', clientAt: new Date(MON_10).toISOString(), ...over });

test('the first manager is created with the bearer token and sets their own PIN through a link that works once', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  assert.equal((await s.call('POST', '/equipo/api/bootstrap', { handle: 'jefe', name: 'Jefe' })).status, 401);
  const a = await s.admin();
  assert.match(a.setupUrl, /\/equipo\/alta\?t=[\w-]{32,}$/);
  const me = await s.call('GET', '/equipo/api/me', undefined, { cookie: a.cookie });
  assert.deepEqual([me.status, me.json.me.handle, me.json.me.role, me.json.today], [200, 'jefe', 'admin', null]);
  assert.equal((await s.call('POST', '/equipo/api/setup', { token: s.tokenOf(a.setupUrl), pin: '775533' })).status, 410);
  assert.equal(JSON.stringify(s.lines()).includes(PIN), false);
});

test('a setup link expires after 72 hours and refuses a weak PIN', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const r = await s.call('POST', '/equipo/api/reps', { handle: 'mario', name: 'Mario Rep', country: 'PA', city: 'Panama City' }, { cookie: a.cookie });
  const token = s.tokenOf(r.json.setupUrl);
  assert.deepEqual([(await s.call('POST', '/equipo/api/setup', { token, pin: '111111' })).status, (await s.call('POST', '/equipo/api/setup', { token, pin: '12345' })).json.error], [400, 'weak_pin']);
  assert.equal((await s.call('GET', `/equipo/api/setup?t=${token}`)).json.first, 'Mario');
  s.time.now += 72 * 3600 * 1000 + 1000;
  assert.equal((await s.call('POST', '/equipo/api/setup', { token, pin: PIN })).status, 410);
});

test('five wrong PINs lock the handle for 15 minutes, then the right PIN works', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); await s.addRep(a.cookie, 'mario');
  for (let i = 0; i < 5; i += 1) assert.equal((await s.call('POST', '/equipo/api/login', { handle: 'mario', pin: '000001' })).status, 401);
  assert.equal((await s.call('POST', '/equipo/api/login', { handle: 'mario', pin: PIN })).status, 429);
  s.time.now += 15 * 60 * 1000 + 1000;
  const ok = await s.call('POST', '/equipo/api/login', { handle: ' Mario ', pin: PIN });
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^mteam=/);
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  assert.equal((await s.call('POST', '/equipo/api/login', { handle: 'nadie', pin: PIN })).status, 401);
});

test('a log earns its points once: the same id again, or the same result on the same business the same day, is a repeat', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const one = await s.call('POST', '/equipo/api/log', logBody('11111111-aaaa'), { cookie: m.cookie });
  assert.deepEqual([one.status, one.json.repeat, one.json.gained, one.json.streakUp, one.json.me.today.points], [200, false, 8, true, 8]);
  assert.equal(one.json.tookLead, false);   // nobody else has points yet: there is no lead to take
  const leadId = one.json.me.recentLeads[0].id;
  assert.match(leadId, /^APP-/);
  const again = await s.call('POST', '/equipo/api/log', logBody('11111111-aaaa'), { cookie: m.cookie });
  assert.deepEqual([again.json.repeat, again.json.gained], [true, 0]);
  s.time.now += 3 * 3600 * 1000;
  const later = await s.call('POST', '/equipo/api/log', logBody('22222222-bbbb', { lead: { id: leadId } }), { cookie: m.cookie });
  assert.deepEqual([later.json.repeat, later.json.gained, later.json.me.today.points], [true, 0, 8]);
  assert.equal(s.lines().filter((e) => e.type === 'log').length, 1);
  const call = await s.call('POST', '/equipo/api/log', logBody('33333333-cccc', { lead: { id: leadId }, kind: 'call' }), { cookie: m.cookie });
  assert.deepEqual([call.json.repeat, call.json.gained], [false, 0]);   // the conversation with this business was already counted today
});

test('taking the lead is announced only on earned points', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario'); const j = await s.addRep(a.cookie, 'jose');
  await s.call('POST', '/equipo/api/log', logBody('aaaa0001'), { cookie: j.cookie });
  const pend = await s.call('POST', '/equipo/api/log', logBody('bbbb0001', { kind: 'contract', lead: { name: 'Taller Pinzón', zone: 'Río Abajo' } }), { cookie: m.cookie });
  assert.deepEqual([pend.json.gained, pend.json.pending, pend.json.tookLead], [0, 10, false]);
  const big = await s.call('POST', '/equipo/api/log', logBody('bbbb0002', { kind: 'meeting', lead: { name: 'Bodega Central', zone: 'Calidonia' } }), { cookie: m.cookie });
  assert.deepEqual([big.json.gained, big.json.tookLead], [13, true]);
});

test('a log whose device clock is hours off keeps the server time and is flagged', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('cccc0001', { clientAt: new Date(MON_10 - 3 * 3600 * 1000).toISOString() }), { cookie: m.cookie });
  const e = s.lines().find((x) => x.type === 'log');
  assert.deepEqual([e.t, e.late], [new Date(MON_10).toISOString(), true]);
  assert.equal((await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie })).json.needs.late.length, 1);
});

test('a bad log is refused with the field that is wrong', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const bad = async (over) => (await s.call('POST', '/equipo/api/log', logBody('dddd0001', over), { cookie: m.cookie }));
  assert.deepEqual([(await bad({ kind: 'dance' })).status, (await bad({ kind: 'dance' })).json.error], [400, 'kind']);
  assert.equal((await bad({ lead: { id: 'PA-9999' } })).json.error, 'lead');
  assert.equal((await bad({ lead: { name: 'x' } })).json.error, 'lead');
  assert.equal((await s.call('POST', '/equipo/api/log', { ...logBody('!!') }, { cookie: m.cookie })).json.error, 'id');
  assert.equal((await s.call('POST', '/equipo/api/log', '{"oops"', { cookie: m.cookie, raw: true })).status, 400);
  assert.equal((await bad({ note: 'x'.repeat(20000) })).status, 413);
  assert.equal(s.lines().filter((e) => e.type === 'log').length, 0);
});

test('closing the day writes the agreed report, locks the day and cannot be done twice', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('eeee0001'), { cookie: m.cookie });
  const empty = await s.call('POST', '/equipo/api/close', { tomorrow: '  ', blocker: '' }, { cookie: m.cookie });
  assert.deepEqual([empty.status, empty.json.error], [400, 'tomorrow']);
  assert.equal(s.lines().some((e) => e.type === 'day.close'), false);
  assert.match((await s.call('POST', '/equipo/api/close', { tomorrow: '', blocker: '', preview: true }, { cookie: m.cookie })).json.report, /\nMañana: …\n/);
  const pre = await s.call('POST', '/equipo/api/close', { tomorrow: 'Volver a El Roble', blocker: '', preview: true }, { cookie: m.cookie });
  assert.equal(pre.json.me, undefined);
  const done = await s.call('POST', '/equipo/api/close', { tomorrow: 'Volver a El Roble', blocker: '' }, { cookie: m.cookie });
  assert.equal(done.status, 200);
  assert.equal(done.json.report, ['Reporte de hoy · mario Rep', 'Visitas: 1 · Conversaciones con dueño o encargado: 1 · Reuniones agendadas: 0 · Contratos enviados: 0', 'Semana: 0 de 3 reuniones', 'Mañana: Volver a El Roble', 'Bloqueo: ninguno'].join('\n'));
  assert.equal(pre.json.report, done.json.report);
  assert.deepEqual([done.json.me.today.closed, done.json.me.today.habits[3], done.json.me.today.points], [true, true, 10]);
  assert.equal((await s.call('POST', '/equipo/api/close', { tomorrow: '', blocker: '' }, { cookie: m.cookie })).status, 409);
  const again = await s.call('POST', '/equipo/api/close', { preview: true }, { cookie: m.cookie });
  assert.deepEqual([again.status, again.json.closed, again.json.report], [200, true, done.json.report]);   // the closed report can be read again, to copy it
  assert.equal(pre.json.closed, false);
  const after = await s.call('POST', '/equipo/api/log', logBody('eeee0002', { lead: { name: 'Otro Negocio', zone: 'Z' } }), { cookie: m.cookie });
  assert.deepEqual([after.status, after.json.error], [409, 'day_closed']);
});

test('a manager confirms a meeting and a contract, voids a log and gives a day off; a rep cannot', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('ffff0001', { kind: 'meeting' }), { cookie: m.cookie });
  await s.call('POST', '/equipo/api/log', logBody('ffff0002', { kind: 'contract', lead: { name: 'Taller Pinzón', zone: 'Río Abajo' } }), { cookie: m.cookie });
  assert.equal((await s.call('GET', '/equipo/api/team', undefined, { cookie: m.cookie })).status, 403);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'ffff0001', what: 'meeting_held' }, { cookie: m.cookie })).status, 403);
  assert.equal((await s.call('GET', '/equipo/api/team')).status, 401);
  assert.equal((await s.call('POST', '/equipo/api/held', { logId: 'ffff0001' }, { cookie: m.cookie })).status, 200);
  const team = await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie });
  assert.deepEqual(team.json.needs.confirm.map((x) => [x.what, x.held]), [['meeting_held', true], ['contract_sent', false]]);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'ffff0002', what: 'contract_signed' }, { cookie: a.cookie })).status, 409);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'ffff0001', what: 'contract_sent' }, { cookie: a.cookie })).status, 400);
  assert.equal((await s.call('POST', '/equipo/api/confirm', { logId: 'ffff0001', what: 'meeting_held' }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json.today.points, 23);
  assert.equal((await s.call('POST', '/equipo/api/void', { logId: 'ffff0001', reason: 'no ocurrió' }, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json.today.points, 0);
  assert.equal((await s.call('POST', '/equipo/api/dayoff', { scope: 'PA', date: '2026-11-17' }, { cookie: a.cookie })).status, 200);
  const as = await s.call('GET', `/equipo/api/me?as=${m.id}`, undefined, { cookie: a.cookie });
  assert.deepEqual([as.json.me.handle, as.json.viewer.role, as.json.week.days[1].kind], ['mario', 'admin', 'rest']);
  assert.deepEqual([as.json.viewer.lang, as.json.viewer.first, as.json.viewer.as], ['es', 'Jefe', m.id]);
  assert.equal((await s.call('GET', `/equipo/api/me?as=${m.id}`, undefined, { cookie: m.cookie })).json.viewer.as, null);
});

test('a new setup link signs the rep out and the old PIN stops working', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const link = await s.call('POST', `/equipo/api/reps/${m.id}/link`, {}, { cookie: a.cookie });
  assert.match(link.json.setupUrl, /alta\?t=/);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).status, 401);
  assert.equal((await s.call('POST', '/equipo/api/login', { handle: 'mario', pin: PIN })).status, 401);
  assert.equal((await s.call('POST', '/equipo/api/reps', { handle: 'mario', name: 'Otro', country: 'PA', city: 'Colón' }, { cookie: a.cookie })).json.error, 'handle_taken');
  assert.equal((await s.call('POST', `/equipo/api/reps/${m.id}`, { patch: { workdays: [1, 3, 5], city: 'Colón' } }, { cookie: a.cookie })).status, 200);
  const team = await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie });
  assert.deepEqual([team.json.reps[0].workdays, team.json.reps[0].city, team.json.reps[0].setupPending], [[1, 3, 5], 'Colón', true]);
});

test('goal, applause, plays and language are the rep\'s own to set', async (t) => {
  const s = await start({ clock: MON_10 }); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario'); const j = await s.addRep(a.cookie, 'jose');
  const g0 = (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  assert.deepEqual([g0.goalPick.which, g0.goalPick.week, g0.goalPick.options], ['this', '2026-11-16', [3, 4, 5]]);
  assert.equal((await s.call('POST', '/equipo/api/goal', { k: 5 }, { cookie: m.cookie })).json.me.goal.picked, 5);
  assert.equal((await s.call('POST', '/equipo/api/goal', { k: 9 }, { cookie: m.cookie })).status, 400);
  await s.call('POST', '/equipo/api/log', logBody('abab0001'), { cookie: m.cookie });
  assert.equal((await s.call('POST', '/equipo/api/kudos', { target: 'abab0001', on: true }, { cookie: m.cookie })).status, 400);
  const clap = await s.call('POST', '/equipo/api/kudos', { target: 'abab0001', on: true }, { cookie: j.cookie });
  assert.deepEqual([clap.json.me.feed[0].kudos, clap.json.me.feed[0].clapped], [1, true]);
  assert.equal((await s.call('POST', '/equipo/api/play', { logId: 'abab0001', text: 'Pregunté por el encargado.' }, { cookie: j.cookie })).status, 403);
  assert.equal((await s.call('POST', '/equipo/api/play', { logId: 'abab0001', text: 'Pregunté por el encargado.' }, { cookie: m.cookie })).json.me.feed[0].play, 'Pregunté por el encargado.');
  assert.equal((await s.call('POST', '/equipo/api/lang', { lang: 'en' }, { cookie: m.cookie })).json.me.me.lang, 'en');
  assert.equal((await s.call('POST', '/equipo/api/lang', { lang: 'fr' }, { cookie: m.cookie })).status, 400);
  s.time.now += 2 * 24 * 3600 * 1000;   // Wednesday: the week's goal is settled
  assert.deepEqual([(await s.call('POST', '/equipo/api/goal', { k: 3 }, { cookie: m.cookie })).status, (await s.call('POST', '/equipo/api/goal', { k: 3 }, { cookie: m.cookie })).json.error], [409, 'goal_locked']);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json.goalPick, null);
  s.time.now += 2 * 24 * 3600 * 1000;   // Friday: next week's goal opens
  const fri = await s.call('POST', '/equipo/api/goal', { k: 4 }, { cookie: m.cookie });
  assert.deepEqual([fri.status, fri.json.me.goalPick.which, fri.json.me.goalPick.week, fri.json.me.goalPick.picked, fri.json.me.goal.picked], [200, 'next', '2026-11-23', 4, 5]);
});

test('the nightly routine pushes leads, reads the day\'s logs and maps new businesses', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const B = { bearer: 'push-token' };
  assert.equal((await s.call('PUT', '/equipo/api/leads', [])).status, 401);
  const put = await s.call('PUT', '/equipo/api/leads', [
    { id: 'PA-0001', company: 'Ferretería El Roble', city: 'Panama City', zone: 'Vía España', stage: 'Contacted', lastContact: '2026-11-10' },
    { id: 'PA-0002', company: 'Ferretería Colón', city: 'Colón', stage: 'New' }, { id: 'PA-0003', company: 'Ferre Firmada', city: 'Panama City', stage: 'Contract signed' },
    { id: 'PA-0004', company: 'Ferre No Llamar', city: 'Panama City', stage: 'New', doNotCall: true }], B);
  assert.deepEqual([put.status, put.json.count], [200, 4]);
  const found = await s.call('GET', '/equipo/api/leads?q=ferre', undefined, { cookie: m.cookie });
  assert.deepEqual(found.json.leads.map((l) => [l.id, l.name, l.known]), [['PA-0001', 'Ferretería El Roble', true]]);
  const dnc = await s.call('POST', '/equipo/api/log', logBody('cdcd0000', { lead: { id: 'PA-0004' } }), { cookie: m.cookie });
  assert.deepEqual([dnc.status, dnc.json.error], [409, 'do_not_call']);
  const known = await s.call('POST', '/equipo/api/log', logBody('cdcd0001', { lead: { id: 'PA-0001' } }), { cookie: m.cookie });
  assert.equal(known.json.gained, 10);
  await s.call('POST', '/equipo/api/log', logBody('cdcd0002', { lead: { name: 'Bodega Nueva', zone: 'Calidonia' }, kind: 'message', channel: 'email' }), { cookie: m.cookie });
  const ex = await s.call('GET', '/equipo/api/export?since=2026-11-16T00:00:00Z', undefined, B);
  assert.deepEqual(ex.json.logs.map((l) => [l.lead.id.slice(0, 3), l.owner, l.crm && l.crm.channel, l.crm && l.crm.outcome]), [['PA-', 'mario Rep', 'In-person visit', 'Visited, spoke with owner'], ['APP', 'mario Rep', 'Email', 'Email sent']]);
  assert.deepEqual(ex.json.stages, [{ lead: 'PA-0001', stage: 'Contacted' }]);
  assert.equal(ex.json.newLeads.length, 1);
  const temp = ex.json.newLeads[0].id;
  assert.equal((await s.call('POST', '/equipo/api/leadmap', { pairs: [[temp, 'PA-SB-2901']] }, B)).json.mapped, 1);
  assert.equal((await s.call('GET', '/equipo/api/export?since=2026-11-16T00:00:00Z', undefined, B)).json.logs[1].lead.id, 'PA-SB-2901');
});

test('the bearer token gives the first manager a new link when the PIN is lost, and never takes over a rep', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); await s.addRep(a.cookie, 'mario');
  const again = await s.call('POST', '/equipo/api/bootstrap', { handle: 'jefe', name: 'Jefe Uno' }, { bearer: 'push-token' });
  assert.match(again.json.setupUrl, /\/equipo\/alta\?t=[\w-]{32,}$/);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: a.cookie })).status, 401);
  const back = await s.call('POST', '/equipo/api/setup', { token: s.tokenOf(again.json.setupUrl), pin: '775533' });
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: back.cookie })).json.me.role, 'admin');
  const taken = await s.call('POST', '/equipo/api/bootstrap', { handle: 'mario', name: 'Mario' }, { bearer: 'push-token' });
  assert.deepEqual([taken.status, taken.json.error], [409, 'handle_taken']);
  assert.equal(s.lines().filter((e) => e.type === 'rep.created').length, 2);
});

test('a new PIN set through a fresh link lifts the lock at once', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  for (let i = 0; i < 5; i += 1) await s.call('POST', '/equipo/api/login', { handle: 'mario', pin: '000001' });
  assert.equal((await s.call('POST', '/equipo/api/login', { handle: 'mario', pin: PIN })).status, 429);
  const link = await s.call('POST', `/equipo/api/reps/${m.id}/link`, {}, { cookie: a.cookie });
  assert.equal((await s.call('POST', '/equipo/api/setup', { token: s.tokenOf(link.json.setupUrl), pin: '775533' })).status, 200);
  assert.equal((await s.call('POST', '/equipo/api/login', { handle: 'mario', pin: '775533' })).status, 200);
});

test('a lead list of a few megabytes keeps every accent', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const list = Array.from({ length: 30000 }, (_, i) => ({ id: `PA-${i}`, company: `Panadería Ñandú Nº ${i} · Vía España`, city: 'Panama City', stage: 'New' }));
  const put = await s.call('PUT', '/equipo/api/leads', list, { bearer: 'push-token' });
  assert.deepEqual([put.status, put.json.count], [200, 30000]);
  const saved = readFileSync(path.join(s.dir, 'team', 'leads.json'), 'utf8');
  assert.equal(saved.includes('�'), false);
  assert.equal(JSON.parse(saved)[29999].company, 'Panadería Ñandú Nº 29999 · Vía España');
});

test('requests from another site are refused, and the page ships with a strict policy', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('POST', '/equipo/api/log', logBody('efef0001'), { cookie: m.cookie, origin: 'https://evil.example' })).status, 403);
  assert.equal((await s.call('POST', '/equipo/api/log', logBody('efef0001'), { cookie: m.cookie, origin: ORIGIN })).status, 200);
  const page = await s.call('GET', '/equipo');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await s.call('GET', '/equipo/alta?t=abc')).text, page.text);
  const js = await s.call('GET', '/equipo/app.js');
  assert.deepEqual([js.status, js.headers.get('content-type'), js.headers.get('cache-control')], [200, 'text/javascript; charset=utf-8', 'no-cache']);
  assert.equal((await fetch(`${s.url}/equipo/app.js`, { headers: { 'if-none-match': js.headers.get('etag') } })).status, 304);
  const font = await s.call('GET', '/equipo/fonts/geist-v1.woff2');
  assert.deepEqual([font.status, font.headers.get('content-type'), font.headers.get('cache-control')], [200, 'font/woff2', 'public, max-age=31536000, immutable']);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await s.call('GET', '/equipo/../server.mjs')).status, 404);
  assert.equal((await s.call('GET', '/equipo/%2e%2e/package.json')).status, 404);
  assert.deepEqual([(await s.call('GET', '/equipo/api/nope')).status, (await s.call('GET', '/equipo/api/nope')).json.ok], [404, false]);
});

test('the rest of the service is untouched while the team module is on', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const h = await s.call('GET', '/healthz');
  assert.deepEqual([h.status, h.json.ok, h.json.desk], [200, true, false]);
  const wl = await fetch(`${s.url}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}' });
  assert.equal(wl.status, 400);
  assert.equal((await s.call('GET', '/desk')).status, 404);
  assert.equal((await s.call('GET', '/equipox')).status, 404);
});

test('a folder of sample data says so on every view, and a local preview signs in over plain http', async (t) => {
  const s = await start({ sample: true, dev: true }); t.after(() => s.srv.close());
  const b = await s.call('POST', '/equipo/api/bootstrap', { handle: 'jefe', name: 'Jefe Uno' }, { bearer: 'push-token' });
  const set = await s.call('POST', '/equipo/api/setup', { token: s.tokenOf(b.json.setupUrl), pin: PIN });
  assert.equal(/Secure/.test(set.headers.get('set-cookie')), false);
  assert.match(set.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: set.cookie })).json.sample, true);
  const real = await start(); t.after(() => real.srv.close());
  const a = await real.admin();
  assert.equal((await real.call('GET', '/equipo/api/me', undefined, { cookie: a.cookie })).json.sample, false);
});

test('a preview whose clock runs days away from the real one does not flag every log as late', async (t) => {
  const offset = 3 * 24 * 3600 * 1000, real = MON_10 - offset;   // the phone says Friday morning, the preview says Monday
  const s = await start({ sample: true, dev: true, previewOffsetMs: offset }); t.after(() => s.srv.close());
  const b = await s.call('POST', '/equipo/api/bootstrap', { handle: 'jefe', name: 'Jefe Uno' }, { bearer: 'push-token' });
  const a = await s.call('POST', '/equipo/api/setup', { token: s.tokenOf(b.json.setupUrl), pin: PIN });
  const m = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/log', logBody('face0001', { clientAt: new Date(real).toISOString() }), { cookie: m.cookie });
  await s.call('POST', '/equipo/api/log', logBody('face0002', { clientAt: new Date(real - 3 * 3600 * 1000).toISOString(), lead: { name: 'Otro Negocio', zone: 'Z' } }), { cookie: m.cookie });
  const logs = s.lines().filter((e) => e.type === 'log');
  assert.deepEqual(logs.map((e) => [e.late === true, e.clientAt]), [[false, new Date(MON_10).toISOString()], [true, new Date(MON_10 - 3 * 3600 * 1000).toISOString()]]);
});

test('a manager records a signed site, marks its steps, gives a recognition and deactivates a rep', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario'); const j = await s.addRep(a.cookie, 'jose');
  assert.equal((await s.call('POST', '/equipo/api/site', { rep: m.id, lead: { name: 'Astillero El Faro' } }, { cookie: m.cookie })).status, 403);
  assert.equal((await s.call('POST', '/equipo/api/site', { rep: m.id, lead: { name: 'x' } }, { cookie: a.cookie })).status, 400);
  const site = await s.call('POST', '/equipo/api/site', { rep: m.id, lead: { name: 'Astillero El Faro' } }, { cookie: a.cookie });
  assert.deepEqual([site.status, site.json.sites.length, site.json.sites[0].lead.name], [200, 1, 'Astillero El Faro']);
  const id = site.json.sites[0].id;
  const me = async () => (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  let v = await me();
  assert.deepEqual([v.week.points, v.table.month.podium[0].sites, v.ledger.filter((e) => e.status === 'pending').map((e) => e.code).sort()], [40, 1, ['site_first_hour', 'site_installed']]);
  assert.equal((await s.call('POST', `/equipo/api/site/${id}`, { what: 'painted' }, { cookie: a.cookie })).status, 400);
  assert.equal((await s.call('POST', '/equipo/api/site/s_nope', { what: 'installed' }, { cookie: a.cookie })).status, 404);
  assert.equal((await s.call('POST', `/equipo/api/site/${id}`, { what: 'installed' }, { cookie: a.cookie })).status, 200);
  await s.call('POST', `/equipo/api/site/${id}`, { what: 'installed' }, { cookie: a.cookie });   // a second tap changes nothing
  v = await me();
  assert.equal(v.week.points, 70);
  assert.equal((await s.call('POST', '/equipo/api/badge', { rep: m.id, text: '' }, { cookie: a.cookie })).status, 400);
  assert.equal((await s.call('POST', '/equipo/api/badge', { rep: m.id, text: 'Volvió tres veces hasta encontrar al dueño.' }, { cookie: a.cookie })).status, 200);
  const seen = (await s.call('GET', '/equipo/api/me', undefined, { cookie: j.cookie })).json.feed[0];
  assert.deepEqual([seen.code, seen.name, seen.play], ['badge', 'mario', 'Volvió tres veces hasta encontrar al dueño.']);
  // a rep who leaves: the session ends, the PIN stops working, and the table forgets them
  const off = await s.call('POST', `/equipo/api/reps/${j.id}`, { patch: { active: false } }, { cookie: a.cookie });
  assert.deepEqual([off.status, off.json.reps.map((r) => r.handle), off.json.others.some((r) => r.handle === 'jose' && !r.active)], [200, ['mario'], true]);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: j.cookie })).status, 401);
  assert.equal((await s.call('POST', '/equipo/api/login', { handle: 'jose', pin: PIN })).status, 401);
  assert.equal((await s.call('POST', `/equipo/api/reps/${a.cookie ? 'r_nope' : ''}`, { patch: { active: false } }, { cookie: a.cookie })).status, 404);
});

test('the module stays off until it is switched on by name, even when the keys it could use are there', () => {
  const desk = { DESK_PASSWORD: 'desk-pass', DESK_PUSH_TOKEN: 'desk-token', DATA_DIR: '/var/data' };
  assert.equal(teamConfig({}), null);
  assert.equal(teamConfig(desk), null);                                  // a deploy for any other reason must not publish /equipo
  assert.equal(teamConfig({ TEAM_ENABLED: '1' }), null);                 // switched on but with nothing to sign sessions with
  assert.equal(teamConfig({ ...desk, TEAM_ENABLED: '0' }), null);
  assert.deepEqual(teamConfig({ ...desk, TEAM_ENABLED: '1', ALLOWED_ORIGINS: 'https://www.mirentor.com, https://mirentor.onrender.com' }),
    { secret: 'desk-pass|desk-token', pushToken: 'desk-token', origins: ['https://www.mirentor.com', 'https://mirentor.onrender.com'], publicBase: '' });
  assert.deepEqual(teamConfig({ ...desk, TEAM_ENABLED: 'true', TEAM_SECRET: 'own-secret', TEAM_PUSH_TOKEN: 'own-token', TEAM_PUBLIC_BASE: 'https://www.mirentor.com/' }),
    { secret: 'own-secret', pushToken: 'own-token', origins: [], publicBase: 'https://www.mirentor.com' });
});
