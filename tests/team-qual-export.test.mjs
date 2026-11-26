// The workers' range and the qualification go to the CRM (GET export, biz rows) until a push of the lead list shows
// the CRM holds them: Hands-on workers no longer empty, the qualification line in Notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';
import { qualNote } from '../lib/team/biz.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const LEAD = { id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New' };
const NOTE = 'Qualification: 10 to 29 hands-on workers, Wi-Fi yes, coordinator yes';

test('workers and qualification go out until the CRM holds them', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('PUT', `${API}/leads`, [LEAD], B)).status, 200);
  const log = (id, over = {}) => s.call('POST', `${API}/log`, logBody(id, { lead: { id: 'PA-0001' }, channel: 'visit', clientAt: new Date(s.time.now).toISOString(), ...over }), { cookie: mario.cookie });
  const exp = async () => { const r = await s.call('GET', `${API}/export?since=`, undefined, B); assert.equal(r.status, 200, r.text); return r.json.biz; };

  assert.equal((await log('qx-log-0001', { q: { workers: '10_29', wifi: 'yes', lead: 'yes' } })).status, 200);
  let row = (await exp())[0];
  assert.deepEqual([row.workers, row.qual, row.qualNote], [10, { workers: '10_29', wifi: 'yes', lead: 'yes' }, NOTE]);
  assert.deepEqual(row.fields, ['owner', 'workers', 'qual']);

  // the CRM pushes back a number in Hands-on workers (its own, 12) and the line in Notes
  const back = { ...LEAD, owner: 'mario Rep', workers: 12, notes: `x | ${NOTE}` };
  assert.equal((await s.call('PUT', `${API}/leads`, [back], B)).status, 200);
  const synced = s.lines().filter((e) => e.type === 'biz.synced');
  assert.equal(synced.length, 1);
  assert.deepEqual([synced[0].fields.includes('workers'), synced[0].fields.includes('qual')], [true, true]);
  assert.deepEqual(await exp(), [], 'nothing left to write: the row is not sent');

  // a later call says nobody coordinates: the qualification goes out again, the workers do not
  s.time.now += 3600000;
  assert.equal((await log('qx-log-0002', { kind: 'call', channel: 'call', q: { lead: 'no' } })).status, 200);
  row = (await exp())[0];
  assert.deepEqual([row.fields.includes('qual'), row.fields.includes('workers'), row.qualNote.endsWith('coordinator no')], [true, false, true]);
  assert.equal(row.qualNote, 'Qualification: 10 to 29 hands-on workers, Wi-Fi yes, coordinator no');
  const at = row.at;

  // "No sé" on Wi-Fi changes nothing: the overlay keeps its time
  s.time.now += 3600000;
  assert.equal((await log('qx-log-0003', { kind: 'meeting', channel: 'visit', q: { wifi: 'unknown' } })).status, 200);
  row = (await exp())[0];
  assert.deepEqual([row.at, row.qual], [at, { workers: '10_29', wifi: 'yes', lead: 'no' }]);
});

test('qualNote names only the rows known', () => {
  assert.equal(qualNote({ workers: 'lt10' }), 'Qualification: fewer than 10 hands-on workers');
  assert.equal(qualNote({ wifi: 'no', lead: 'unknown' }), 'Qualification: Wi-Fi no, coordinator unknown');
  assert.equal(qualNote({ workers: '50plus' }), 'Qualification: 50 or more hands-on workers');
  assert.equal(qualNote({ workers: '30_49', lead: 'yes' }), 'Qualification: 30 to 49 hands-on workers, coordinator yes');
  assert.equal(qualNote(null), null);
});
