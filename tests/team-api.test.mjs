import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { teamConfig } from '../lib/team/api.mjs';
import { ORIGIN, MON_10, start, logBody } from './team-helper.mjs';

test('the first manager is made with the bearer token and their work email, and no secret of theirs is kept', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  assert.equal((await s.call('POST', '/equipo/api/bootstrap', { email: 'jefe@equipo.test', name: 'Jefe' })).status, 401);
  const a = await s.admin();
  const me = await s.call('GET', '/equipo/api/me', undefined, { cookie: a.cookie });
  assert.deepEqual([me.status, me.json.me.handle, me.json.viewer.email, me.json.me.role, me.json.today], [200, 'jefe', 'jefe@equipo.test', 'admin', null]);
  assert.deepEqual(s.lines().flatMap((e) => Object.keys(e)).filter((k) => /pin|salt|hash|token|secret/i.test(k)), []);
  // the board has no door of its own any more
  for (const gone of ['login', 'setup', 'logout']) assert.equal((await s.call('POST', `/equipo/api/${gone}`, {})).status, 404, gone);
});

test('a person is added with a work email on the company domain that nobody else has', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const add = (over) => s.call('POST', '/equipo/api/reps', { name: 'Mario Rep', email: 'mario@equipo.test', country: 'PA', city: 'Panama City', ...over }, { cookie: a.cookie });
  const refused = async (over) => { const r = await add(over); return [r.status, r.json.error]; };
  assert.deepEqual(await refused({ email: 'mario@otra.test' }), [400, 'email_domain']);
  assert.deepEqual(await refused({ email: 'mario@equipo.test.evil.io' }), [400, 'email_domain']);
  assert.deepEqual(await refused({ email: 'no es un correo' }), [400, 'fields']);
  assert.deepEqual(await refused({ email: undefined }), [400, 'fields']);
  assert.deepEqual(await refused({ email: 'jefe@equipo.test' }), [409, 'email_taken']);
  // Google answers with the account's own address, so one with a tag after a plus could never open the board
  assert.deepEqual(await refused({ email: 'mario+ventas@equipo.test' }), [400, 'fields']);
  const ok = await add({ email: "  Mario.O'Brien@Equipo.Test " });   // an apostrophe is a letter a company address may carry
  assert.equal(ok.status, 200);
  const made = ok.json.reps.find((r) => r.id === ok.json.id);
  assert.deepEqual([made.email, made.handle, made.name], ["mario.o'brien@equipo.test", 'mario.o-brien', 'Mario Rep']);
  assert.deepEqual(await refused({ email: "MARIO.o'brien@equipo.test" }), [409, 'email_taken']);
  // nothing to hand over: that account opens the board from now on
  assert.equal('setupUrl' in ok.json, false);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as("mario.o'brien@equipo.test") })).status, 200);
  // teammates see each other's names and numbers, not each other's addresses: the only address in a person's view is their own
  await s.addRep(a.cookie, 'jose');
  const seen = await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as('jose@equipo.test') });
  const { viewer, ...rest } = seen.json;
  assert.equal(JSON.stringify(rest).includes('Mario Rep'), true);   // the teammate is there, by name
  assert.deepEqual([viewer.email, JSON.stringify(rest).includes('@')], ['jose@equipo.test', false]);
});

test('nobody signed in gets 401, and an account that is not on the team gets 403 with the address it used', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  await s.admin();
  const none = await s.call('GET', '/equipo/api/me');
  assert.deepEqual([none.status, none.json.error], [401, 'session']);
  const other = await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as('Otra@Equipo.Test') });
  assert.deepEqual(Object.keys(other.json).sort(), ['email', 'error', 'ok']);   // the account it used, and nothing about anyone else
  // an address the board would never add is still someone signed in: it is told the same, not sent round in circles
  const odd = await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as(' Ra!ro+x@Equipo.Test ') });
  assert.deepEqual([odd.status, odd.json.error, odd.json.email], [403, 'not_on_team', 'ra!ro+x@equipo.test']);
  assert.equal((await s.call('GET', '/equipo/', undefined, { cookie: s.as('ra!ro+x@equipo.test') })).status, 200);
  assert.deepEqual([other.status, other.json.error, other.json.email], [403, 'not_on_team', 'otra@equipo.test']);
  assert.equal((await s.call('GET', '/equipo/api/team', undefined, { cookie: s.as('otra@equipo.test') })).status, 403);
  // the page needs someone signed in; mounted without a door, it only says where to go
  assert.equal((await s.call('GET', '/equipo/')).status, 401);
  assert.equal((await s.call('GET', '/equipo/', undefined, { cookie: s.as('otra@equipo.test') })).status, 200);
  const bare = await s.call('GET', '/equipo?as=r_x');
  assert.deepEqual([bare.status, bare.headers.get('location')], [301, '/equipo/?as=r_x']);
  assert.deepEqual([(await s.call('POST', '/equipo/auth', {})).status, (await s.call('GET', '/equipo/salir')).status], [404, 404]);
  assert.deepEqual(s.said, []);
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

test('a manager fixes a person\'s email, city and days, and the old address stops opening the board', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const patch = (id, p) => s.call('POST', `/equipo/api/reps/${id}`, { patch: p }, { cookie: a.cookie });
  assert.equal((await patch(m.id, { email: 'mario.rep@equipo.test' })).status, 200);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).status, 403);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as('mario.rep@equipo.test') })).status, 200);
  assert.deepEqual([(await patch(m.id, { email: 'jefe@equipo.test' })).json.error, (await patch(m.id, { email: 'mario@otra.test' })).json.error], ['email_taken', 'email_domain']);
  // nobody moves their own way in: a slip would lock them out
  assert.equal((await patch(a.id, { email: 'otro@equipo.test' })).json.error, 'patch');
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', '/equipo/api/reps', { email: 'mario.rep@equipo.test', name: 'Otro', country: 'PA', city: 'Colón' }, { cookie: a.cookie })).json.error, 'email_taken');
  assert.equal((await s.call('POST', `/equipo/api/reps/${m.id}/link`, {}, { cookie: a.cookie })).status, 404);
  assert.equal((await patch(m.id, { workdays: [1, 3, 5], city: 'Colón' })).status, 200);
  const team = await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie });
  assert.deepEqual([team.json.reps[0].workdays, team.json.reps[0].city, team.json.reps[0].email], [[1, 3, 5], 'Colón', 'mario.rep@equipo.test']);
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
  // The rule of the search holds for a request that names an id directly: own city only, and nothing already signed.
  for (const id of ['PA-0002', 'PA-0003']) { const no = await s.call('POST', '/equipo/api/log', logBody(`cdcd9${id.slice(-3)}`, { lead: { id } }), { cookie: m.cookie }); assert.deepEqual([id, no.status, no.json.error], [id, 400, 'lead']); }
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

test('with bootstrap opened by name, the bearer token makes another admin, and never takes over a rep', async (t) => {
  const s = await start({ bootstrapOpen: true }); t.after(() => s.srv.close());
  const a = await s.admin(); await s.addRep(a.cookie, 'mario');
  const B = { bearer: 'push-token' };
  const same = await s.call('POST', '/equipo/api/bootstrap', { email: 'jefe@equipo.test', name: 'Jefe Uno' }, B);
  assert.deepEqual([same.status, same.json.id], [200, a.id]);
  assert.equal((await s.call('POST', '/equipo/api/bootstrap', { email: 'jefa@equipo.test', name: 'Jefa Dos' }, B)).status, 200);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as('jefa@equipo.test') })).json.me.role, 'admin');
  const taken = await s.call('POST', '/equipo/api/bootstrap', { email: 'mario@equipo.test', name: 'Mario' }, B);
  assert.deepEqual([taken.status, taken.json.error], [409, 'email_taken']);
  assert.equal((await s.call('POST', '/equipo/api/bootstrap', { email: 'x@otra.test', name: 'Equis' }, B)).json.error, 'email_domain');
  assert.equal(s.lines().filter((e) => e.type === 'rep.created').length, 3);
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
  const page = await s.call('GET', '/equipo/', undefined, { cookie: m.cookie });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(page.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal((await s.call('GET', '/equipo/alta')).status, 404);   // the one-time links are gone with the PIN
  const js = await s.call('GET', '/equipo/app.js');
  assert.deepEqual([js.status, js.headers.get('content-type'), js.headers.get('cache-control')], [200, 'text/javascript; charset=utf-8', 'no-cache']);
  assert.equal((await fetch(`${s.url}/equipo/app.js`, { headers: { 'if-none-match': js.headers.get('etag') } })).status, 304);
  const font = await s.call('GET', '/equipo/fonts/geist-v1.woff2');
  assert.deepEqual([font.status, font.headers.get('content-type'), font.headers.get('cache-control')], [200, 'font/woff2', 'public, max-age=31536000, immutable']);
  // The illustrations travel as they are: an image that is already compressed is not compressed again.
  const art = await fetch(`${s.url}/equipo/art/visit.webp`, { headers: { cookie: m.cookie, 'accept-encoding': 'br' } });
  assert.deepEqual([art.status, art.headers.get('content-type'), art.headers.get('content-encoding'), art.headers.get('cache-control')], [200, 'image/webp', null, 'no-cache']);
  assert.equal(page.headers.get('cache-control'), 'no-store');
  assert.equal((await s.call('GET', '/equipo/../server.mjs')).status, 404);
  assert.equal((await s.call('GET', '/equipo/%2e%2e/package.json')).status, 404);
  assert.deepEqual([(await s.call('GET', '/equipo/api/nope')).status, (await s.call('GET', '/equipo/api/nope')).json.ok], [404, false]);
});

test('the rest of the service is untouched while the team module is on', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const h = await s.call('GET', '/healthz');
  assert.deepEqual([h.status, h.json.ok, h.json.desk, h.json.team], [200, true, false, true]);   // the health page says the board is on
  const wl = await fetch(`${s.url}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN }, body: '{}' });
  assert.equal(wl.status, 400);
  assert.equal((await s.call('GET', '/desk')).status, 404);
  assert.equal((await s.call('GET', '/equipox')).status, 404);
});

test('a folder of sample data says so on every view', async (t) => {
  const s = await start({ sample: true, dev: true }); t.after(() => s.srv.close());
  const a = await s.admin();
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: a.cookie })).json.sample, true);
  const real = await start(); t.after(() => real.srv.close());
  const b = await real.admin();
  assert.equal((await real.call('GET', '/equipo/api/me', undefined, { cookie: b.cookie })).json.sample, false);
});

test('a preview whose clock runs days away from the real one does not flag every log as late', async (t) => {
  const offset = 3 * 24 * 3600 * 1000, real = MON_10 - offset;   // the phone says Friday morning, the preview says Monday
  const s = await start({ sample: true, dev: true, previewOffsetMs: offset }); t.after(() => s.srv.close());
  const a = await s.admin();
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
  // a rep who leaves: their account stops opening the board, and the table forgets them
  const off = await s.call('POST', `/equipo/api/reps/${j.id}`, { patch: { active: false } }, { cookie: a.cookie });
  assert.deepEqual([off.status, off.json.reps.map((r) => r.handle), off.json.others.some((r) => r.handle === 'jose' && !r.active)], [200, ['mario'], true]);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: j.cookie })).status, 403);
  assert.equal((await s.call('POST', `/equipo/api/reps/${a.cookie ? 'r_nope' : ''}`, { patch: { active: false } }, { cookie: a.cookie })).status, 404);
});

test('the module stays off until it is switched on by name, and keeps no secret of its own', () => {
  const desk = { DESK_PASSWORD: 'desk-pass', DESK_PUSH_TOKEN: 'desk-token', DATA_DIR: '/var/data' };
  assert.equal(teamConfig({}), null);
  assert.equal(teamConfig(desk), null);                                  // a deploy for any other reason must not publish the board
  assert.equal(teamConfig({ ...desk, TEAM_ENABLED: '0' }), null);
  assert.deepEqual(teamConfig({ TEAM_ENABLED: '1' }), { pushToken: '', origins: [], bootstrapOpen: false, guests: [] });
  assert.deepEqual(teamConfig({ ...desk, TEAM_ENABLED: '1', ALLOWED_ORIGINS: 'https://www.mirentor.com, https://mirentor.onrender.com' }),
    { pushToken: 'desk-token', origins: ['https://www.mirentor.com', 'https://mirentor.onrender.com'], bootstrapOpen: false, guests: [] });
  assert.deepEqual(teamConfig({ ...desk, TEAM_ENABLED: 'true', TEAM_PUSH_TOKEN: 'own-token', TEAM_BOOTSTRAP: '1' }), { pushToken: 'own-token', origins: [], bootstrapOpen: true, guests: [] });
});

/** A data folder that already holds people, written the way a list or an older log would: straight to the file. */
function folderWith(events) {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-api-seeded-'));
  mkdirSync(path.join(dir, 'team'), { recursive: true });
  const person = (id, over = {}) => ({ type: 'rep.created', t: '2026-11-02T13:00:00.000Z', id, handle: id.slice(2), name: `${id.slice(2)} Rep`, role: 'rep', country: 'PA', city: 'Panama City', tz: 'America/Panama', workdays: [1, 2, 3, 4, 5], startDate: '2026-11-02', lang: 'es', ...over });
  writeFileSync(path.join(dir, 'team', 'events.jsonl'), `${events(person).map((e) => JSON.stringify(e)).join('\n')}\n`);
  return dir;
}

test('saving a person again with the address they already have changes only what changed', async (t) => {
  // one person with no address and one with an address from somewhere else: only a list can make them, and both must stay editable
  const dir = folderWith((p) => [p('r_jefe', { role: 'admin', email: 'jefe@equipo.test' }), p('r_sin'), p('r_otro', { email: 'otro@ejemplo.test' })]);
  const s = await start({ dir }); t.after(() => s.srv.close());
  const boss = s.as('jefe@equipo.test');
  const patch = (id, p) => s.call('POST', `/equipo/api/reps/${id}`, { patch: p }, { cookie: boss });
  const last = () => s.lines().at(-1);
  // the form sends the address back along with everything else
  assert.equal((await patch('r_sin', { email: '', city: 'Colón' })).status, 200);
  assert.deepEqual(last().patch, { city: 'Colón' });
  assert.equal((await patch('r_otro', { email: ' Otro@Ejemplo.Test ', city: 'Colón' })).status, 200);
  assert.deepEqual(last().patch, { city: 'Colón' });
  assert.equal((await patch('r_otro', { email: 'otro@ejemplo.test' })).json.error, 'patch');   // nothing changed
  // a new address is checked like any other
  assert.equal((await patch('r_sin', { email: 'sin@otra.test' })).json.error, 'email_domain');
  assert.equal((await patch('r_sin', { email: 'jefe@equipo.test' })).json.error, 'email_taken');
  assert.equal((await patch('r_sin', { email: 'Sin@Equipo.Test' })).status, 200);
  assert.deepEqual(last().patch, { email: 'sin@equipo.test' });
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as('sin@equipo.test') })).status, 200);
});

test('a manager who is not an admin cannot make an admin, nor move an admin\'s address', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const lead = await s.addRep(a.cookie, 'lider', { role: 'manager' });
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: lead.cookie })).json.viewer.role, 'manager');
  const made = await s.call('POST', '/equipo/api/reps', { email: 'nuevo@equipo.test', name: 'Nuevo Rep', country: 'PA', city: 'Panama City', role: 'admin' }, { cookie: lead.cookie });
  assert.deepEqual([made.status, made.json.reps.find((r) => r.id === made.json.id).role], [200, 'rep']);
  // the address is who a person is: moving the admin's would hand the board to another account
  const move = await s.call('POST', `/equipo/api/reps/${a.id}`, { patch: { email: 'nuevo.jefe@equipo.test' } }, { cookie: lead.cookie });
  assert.deepEqual([move.status, move.json.error], [403, 'admin_only']);
  assert.deepEqual([(await s.call('GET', '/equipo/api/me', undefined, { cookie: a.cookie })).status, (await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as('nuevo.jefe@equipo.test') })).status], [200, 403]);
  // an admin can correct a manager's
  assert.equal((await s.call('POST', `/equipo/api/reps/${lead.id}`, { patch: { email: 'lider.dos@equipo.test' } }, { cookie: a.cookie })).status, 200);
});

test('an admin who was taken off the team does not keep the first door shut', async (t) => {
  const dir = folderWith((p) => [p('r_jefe', { role: 'admin', email: 'jefe@equipo.test' }), { type: 'rep.updated', t: '2026-11-03T13:00:00.000Z', id: 'r_jefe', patch: { active: false } }]);
  const s = await start({ dir }); t.after(() => s.srv.close());
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: s.as('jefe@equipo.test') })).status, 403);
  const again = await s.call('POST', '/equipo/api/bootstrap', { email: 'jefa@equipo.test', name: 'Jefa Dos' }, { bearer: 'push-token' });
  assert.equal(again.status, 200);
  assert.equal((await s.call('POST', '/equipo/api/bootstrap', { email: 'tercero@equipo.test', name: 'Tercero' }, { bearer: 'push-token' })).json.error, 'bootstrap_closed');
});

test('next.html is not served to a rep or without a session', async (t) => {
  // The sketches of what comes next: a manager, an admin or a leader reads them; nobody else gets a byte of the page or its style.
  const dir = mkdtempSync(path.join(tmpdir(), 'team-next-'));
  mkdirSync(path.join(dir, 'static'), { recursive: true });
  for (const f of ['next.html', 'next.css', 'next.js']) writeFileSync(path.join(dir, 'static', f), `sketch ${f}`);
  const s = await start({ dir }); t.after(() => s.srv.close());
  const a = await s.admin(), rep = await s.addRep(a.cookie, 'mario');
  await s.call('POST', '/equipo/api/reps', { email: 'mara@equipo.test', name: 'Mara Manager', role: 'manager' }, { cookie: a.cookie });
  await s.call('POST', '/equipo/api/reps', { email: 'lia@equipo.test', name: 'Lia Lider', role: 'leader', city: '' }, { cookie: a.cookie });
  const off = await s.addRep(a.cookie, 'ido');
  await s.call('POST', `/equipo/api/reps/${off.id}`, { patch: { active: false } }, { cookie: a.cookie });
  for (const f of ['next.html', 'next.css', 'next.js']) {
    const get = (cookie) => s.call('GET', `/equipo/${f}`, undefined, { cookie });
    const none = await get();
    assert.deepEqual([none.status, none.text.includes('sketch')], [401, false], `${f} signed out`);
    for (const [who, cookie] of [['rep', rep.cookie], ['not on the team', s.as('otra@equipo.test')], ['taken off the team', off.cookie]]) {
      const r = await get(cookie);
      assert.deepEqual([r.status, r.text.includes('sketch')], [403, false], `${f} for ${who}`);
    }
    for (const [who, cookie] of [['admin', a.cookie], ['manager', s.as('mara@equipo.test')], ['leader', s.as('lia@equipo.test')]]) {
      const r = await get(cookie);
      assert.deepEqual([r.status, r.text, r.headers.get('cache-control')], [200, `sketch ${f}`, 'no-store'], `${f} for ${who}`);
    }
    assert.equal((await s.call('HEAD', `/equipo/${f}`, undefined, { cookie: rep.cookie })).status, 403, `${f} HEAD for a rep`);
  }
  // every other file is served as before: the code and the fonts need no session
  assert.equal((await s.call('GET', '/equipo/app.js')).status, 200);
  assert.equal((await s.call('GET', '/equipo/fonts/geist-v1.woff2')).status, 200);
  assert.equal((await s.call('GET', '/equipo/nope.html', undefined, { cookie: a.cookie })).status, 404);
});

test('the sketches page holds five sketches, each says it is one, in both languages, with no em dash, no amount and nothing from another host', async () => {
  const { DICT } = await import('../team/i18n.js');
  const page = readFileSync(new URL('../team/next.html', import.meta.url), 'utf8');
  const style = readFileSync(new URL('../team/next.css', import.meta.url), 'utf8');
  const script = readFileSync(new URL('../team/next.js', import.meta.url), 'utf8');
  const keys = [...page.matchAll(/data-t="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(keys.includes('next.sketch') && keys.includes('next.notbuilt'));
  // five sketches, each stamped as one and saying it is not built
  const sketches = page.split('<section class="nx-sketch').slice(1);
  assert.equal(sketches.length, 5);
  sketches.forEach((one, i) => {
    assert.match(one, new RegExp(`<span class="nx-stamp"><span data-t="next.sketch"></span> 0${i + 1}</span>`), `sketch ${i + 1} stamp`);
    assert.match(one, /data-t="next.notbuilt"/, `sketch ${i + 1} not-built line`);
  });
  // money per rep shows no amount: every amount is the words for "to be defined"
  assert.equal(/US\$|\$\s?\d|\d+[.,]\d{2}/.test(sketches[4]), false);
  assert.ok((sketches[4].match(/data-t="next.pay.amount"/g) || []).length >= 3);
  assert.deepEqual([DICT.es['next.pay.amount'], DICT.en['next.pay.amount']], ['monto por definir', 'amount to be defined']);
  for (const lang of ['es', 'en']) for (const k of [...keys, 'next.open']) assert.equal(typeof DICT[lang][k], 'string', `${lang} ${k}`);
  const words = [page, style, script, ...Object.entries(DICT.es).concat(Object.entries(DICT.en)).filter(([k]) => k.startsWith('next.')).map(([, v]) => v)].join('\n');
  assert.equal(words.includes('\u2014'), false);
  assert.doesNotMatch([page, style, script].join('\n'), /https?:\/\/|\/\/[a-z0-9-]+\./i);
});
