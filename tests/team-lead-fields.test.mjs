// What a push of the CRM's lead list may carry: the CRM's own fields, each trimmed and capped, and nothing else. The
// list now weighs more (27 columns per business), so its body limit is 12 MB.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { cleanLead, LEAD_KEYS } from '../lib/team/lead-fields.mjs';
import { start } from './team-helper.mjs';

const API = '/equipo/api';

test('a pushed business keeps only the CRM fields, trimmed and capped', () => {
  const out = cleanLead({ id: 'PA-0001', company: '  Taller   Uno ', owner: 'Marta Pineda', nextDay: '2026-11-31', nextStep: 'x'.repeat(250), lastContact: '2026-11-20',
    contact: 'Ana Ruiz', phone: '6'.repeat(60), email: 'e'.repeat(250), address: 'a'.repeat(230), website: 'javascript:alert(1)', maps: 'https://maps.app.goo.gl/abc',
    walkin: '8', rating: 4.5, reviews: 120, workers: 12, doNotCall: 'yes', notes: 'n'.repeat(700), app: true, practice: true, by: 'r_x', evil: 1 });
  assert.equal(out.company, 'Taller Uno');
  assert.deepEqual([out.nextDay, out.website, out.walkin, out.doNotCall, out.app, out.practice, out.by, out.evil], [undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined]);
  assert.deepEqual([out.nextStep.length, out.phone.length, out.email.length, out.address.length, out.notes.length], [200, 40, 200, 200, 600]);
  assert.deepEqual([out.maps, out.lastContact, out.rating, out.reviews, out.workers], ['https://maps.app.goo.gl/abc', '2026-11-20', 4.5, 120, 12]);
  assert.equal(cleanLead({ id: 7, company: 'X Y' }).id, '7');
  assert.equal(cleanLead({ id: 'A', company: 'B', doNotCall: true }).doNotCall, true);
  assert.equal(cleanLead({ id: '', company: 'x' }), null); assert.equal(cleanLead({ id: 'A', company: '  ' }), null);
  assert.equal(cleanLead({ id: 'A', company: 'B', website: 'http://x.example/' + 'p'.repeat(400) }).website, undefined);   // over 300 is dropped, never cut into a broken link
});

test('only the 25 keys, in the CRM order; the numbers must be finite numbers; names cap at 120', () => {
  assert.deepEqual(LEAD_KEYS, ['id', 'company', 'type', 'stage', 'owner', 'nextDay', 'nextStep', 'lastContact', 'contact', 'title', 'phone', 'email', 'industry', 'category', 'city', 'zone',
    'address', 'website', 'maps', 'walkin', 'rating', 'reviews', 'workers', 'doNotCall', 'notes']);
  const out = cleanLead({ id: 'A', company: 'c'.repeat(200), zone: 'z'.repeat(200), walkin: Infinity, rating: NaN, reviews: null, workers: '12', city: '   ', website: 'HTTPS://x.example', lastContact: 20261120 });
  assert.deepEqual([out.company.length, out.zone.length, out.walkin, out.rating, out.reviews, out.workers, 'city' in out, out.website, out.lastContact], [120, 120, undefined, undefined, undefined, undefined, false, 'HTTPS://x.example', undefined]);
  assert.equal(cleanLead(null), null); assert.equal(cleanLead('x'), null); assert.equal(cleanLead({ id: { a: 1 }, company: 'B' }), null);
  assert.equal(cleanLead({ id: 'A', company: ['x'] }), null);
});

test('PUT leads keeps the fields and takes 9 MB; over 12 MB is answered 413', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  const B = { bearer: 'push-token' };
  const list = Array.from({ length: 9000 }, (_, i) => ({ id: `PA-${String(i).padStart(5, '0')}`, company: `Negocio ${i}`, city: 'Panama City', zone: 'Centro', stage: 'New', notes: 'n'.repeat(900), app: true }));
  const body = JSON.stringify(list);
  assert.ok(body.length > 8 * 1024 * 1024 && body.length < 12 * 1024 * 1024, String(body.length));
  const put = await s.call('PUT', `${API}/leads`, list, B);
  assert.deepEqual([put.status, put.json.count], [200, 9000]);
  const found = await s.call('GET', `${API}/leads?q=Negocio 8999`, undefined, { cookie: m.cookie });
  assert.deepEqual(found.json.leads.map((l) => l.id), ['PA-08999']);
  const saved = JSON.parse(readFileSync(path.join(s.dir, 'team', 'leads.json'), 'utf8'));
  assert.deepEqual([saved.length, saved[0].notes.length, 'app' in saved[0]], [9000, 600, false]);
  const huge = await fetch(`${s.url}${API}/leads`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer push-token' }, body: JSON.stringify([{ id: 'X', company: 'y'.repeat(13 * 1024 * 1024) }]) });
  assert.deepEqual([huge.status, (await huge.json()).error], [413, 'too_large']);
  assert.deepEqual(s.said, []);
});
