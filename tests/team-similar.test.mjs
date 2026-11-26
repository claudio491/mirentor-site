// A typed business shows its near twins of the city first ("¿Es alguno de estos?"), a new one takes the list's spelling
// of its zone, and a worker may have no email when that is said on purpose ("No tiene correo").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { nameKey, similarLeads } from '../lib/team/store.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };

test('Taller Gomez S.A. finds Taller Gómez, of the city only, five at most', async (t) => {
  assert.deepEqual(nameKey('Taller Gomez S.A.'), ['taller', 'gomez']); assert.deepEqual(nameKey('S.A.'), []); assert.deepEqual(nameKey('Gómez y Cía. Ltda'), ['gomez']);
  assert.deepEqual(nameKey('Corporación Sol, Sociedad Anónima'), ['sol']);
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  const LEADS = [
    { id: 'PA-0001', company: 'Taller Gómez', city: 'Panama City', zone: 'Centro', stage: 'New' },
    { id: 'PA-0002', company: 'Taller Pérez', city: 'Panama City', zone: 'Centro', stage: 'New' },
    { id: 'PA-0003', company: 'Gómez y Asociados S.A.', city: 'Panama City', zone: 'Centro', stage: 'Contract signed' },
    { id: 'PA-0004', company: 'Taller Gómez', city: 'David', zone: 'Centro', stage: 'New' },
    { id: 'PA-0005', company: 'Taller Gomez Norte', city: 'Panama City', zone: 'Centro', stage: 'New', doNotCall: true },
  ];
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const similar = async (text) => { const r = await s.call('GET', `${API}/leads?similar=${encodeURIComponent(text)}`, undefined, { cookie: mario.cookie }); assert.equal(r.status, 200, r.text); return r.json.leads; };
  let got = await similar('Taller Gomez S.A.');
  assert.deepEqual([got.map((l) => l.name), got.map((l) => l.pick)], [['Taller Gómez', 'Taller Gomez Norte'], [true, false]]);
  assert.equal(typeof got[0].stage, 'string', 'a row of the list, with pick');
  got = await similar('Gom');
  assert.deepEqual([got.map((l) => l.name), got.map((l) => l.pick)], [['Gómez y Asociados S.A.', 'Taller Gómez', 'Taller Gomez Norte'], [false, true, false]]);
  assert.deepEqual(await similar('Ta'), []);
  // list wins over similar, and similar over q
  const both = await s.call('GET', `${API}/leads?list=free&similar=Gom&q=Pérez`, undefined, { cookie: mario.cookie });
  assert.equal('total' in both.json, true);
  assert.deepEqual((await s.call('GET', `${API}/leads?similar=Gom&q=Pérez`, undefined, { cookie: mario.cookie })).json.leads.length, 3);
  // seven matches give five
  const seven = new Map(Array.from({ length: 7 }, (_, i) => [`X${i}`, { id: `X${i}`, company: `Taller Sol ${i}`, city: 'Panama City' }]));
  assert.equal(similarLeads(seven, 'Taller Sol', 'Panama City', {}).length, 5);
  // no city counts as any; practice stays in its own world
  const mixed = new Map([['A', { id: 'A', company: 'Taller Luna' }], ['B', { id: 'B', company: 'Taller Luna', city: 'Panama City', practice: true }]]);
  assert.deepEqual(similarLeads(mixed, 'Taller Luna', 'Colón', {}).map((l) => l.id), ['A']);
  assert.deepEqual(similarLeads(mixed, 'Taller Luna', 'Panama City', { practice: true }).map((l) => l.id), ['B']);
});

test('a new business takes the list\'s spelling of its zone; a worker may have no email, said on purpose', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('PUT', `${API}/leads`, [{ id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'San Miguelito', stage: 'New' }], B)).status, 200);
  let r = await s.call('POST', `${API}/log`, logBody('zone-log-0001', { lead: { name: 'Ferretería Sol', zone: 'san miguelito' } }), { cookie: mario.cookie });
  assert.equal(r.status, 200, r.text);
  assert.equal(s.lines().filter((e) => e.type === 'lead.added').at(-1).lead.zone, 'San Miguelito');
  r = await s.call('POST', `${API}/log`, logBody('zone-log-0002', { lead: { name: 'Ferretería Luna', zone: 'S. Miguelito' } }), { cookie: mario.cookie });
  assert.equal(r.status, 200, r.text);
  assert.equal(s.lines().filter((e) => e.type === 'lead.added').at(-1).lead.zone, 'S. Miguelito');

  const made = await s.call('POST', `${API}/site`, { id: 's_noemail-site-01', rep: mario.id, lead: { name: 'Ferretería Sol' } }, { cookie: a.cookie });
  assert.equal(made.status, 200, made.text);
  const add = (body) => s.call('POST', `${API}/install/s_noemail-site-01/workers`, { name: 'Ana Ruiz', phone: true, ...body }, { cookie: mario.cookie });
  const before = s.lines().length;
  for (const [body, want] of [[{ id: 'w_noemail-0001', email: '' }, [400, 'email']], [{ id: 'w_noemail-0001', email: '', noEmail: 'yes' }, [400, 'fields']], [{ id: 'w_noemail-0001', noEmail: false }, [400, 'email']]]) {
    const bad = await add(body);
    assert.deepEqual([bad.status, bad.json.error], want, JSON.stringify(body));
  }
  assert.equal(s.lines().length, before);
  r = await add({ id: 'w_noemail-0001', email: '', noEmail: true });
  assert.equal(r.status, 200, r.text);
  const ev = s.lines().at(-1);
  assert.deepEqual([ev.type, ev.email, ev.noEmail], ['worker.added', '', true]);
  assert.deepEqual([r.json.workers[0].email, r.json.workers[0].noEmail], ['', true]);
  r = await add({ id: 'w_noemail-0002', email: 'ana@x.com', noEmail: true });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([s.lines().at(-1).email, 'noEmail' in s.lines().at(-1)], ['ana@x.com', false]);
  assert.equal(r.json.workers[1].noEmail, false);
  // an edit says it too: an email given later drops it
  r = await s.call('POST', `${API}/worker/w_noemail-0001/edit`, { name: 'Ana Ruiz', email: 'ana.ruiz@x.com' }, { cookie: mario.cookie });
  assert.equal(r.status, 200, r.text);
  assert.deepEqual([r.json.workers[0].email, r.json.workers[0].noEmail], ['ana.ruiz@x.com', false]);
  r = await s.call('POST', `${API}/worker/w_noemail-0001/edit`, { name: 'Ana Ruiz', email: '', noEmail: true }, { cookie: mario.cookie });
  assert.deepEqual([r.status, r.json.workers[0].email, r.json.workers[0].noEmail], [200, '', true]);
  const edit = await s.call('POST', `${API}/worker/w_noemail-0001/edit`, { name: 'Ana Ruiz', email: '' }, { cookie: mario.cookie });
  assert.deepEqual([edit.status, edit.json.error], [400, 'email']);
});
