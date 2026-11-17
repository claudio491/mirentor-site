import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openTeamStore, searchLeads } from '../lib/team/store.mjs';
import { hashPin, checkPin, validPin, newSetupToken, hashToken, sessions, lockout } from '../lib/team/auth.mjs';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'team-'));
const repEvent = (id) => ({ type: 'rep.created', id, handle: id, name: id, role: 'rep', country: 'PA', city: 'Panama City', tz: 'America/Panama', workdays: [1, 2, 3, 4, 5], startDate: '2026-11-02', lang: 'es' });

test('events survive a restart: reopening the folder replays the same state', () => {
  const dir = tmp();
  const a = openTeamStore(dir, { now: () => '2026-11-16T15:00:00.000Z' });
  a.append(repEvent('ana'));
  const saved = a.append({ type: 'log', id: 'g1', rep: 'ana', lead: { id: 'L1', name: 'Uno', zone: 'Z' }, kind: 'talk' });
  assert.equal(saved.t, '2026-11-16T15:00:00.000Z');
  const b = openTeamStore(dir);
  assert.deepEqual([b.state.reps.get('ana').handle, b.state.logs.get('g1').day, b.state.count], ['ana', '2026-11-16', 2]);
  assert.equal(readFileSync(path.join(dir, 'team', 'events.jsonl'), 'utf8').trim().split('\n').length, 2);
});

test('a broken last line (a write cut short) does not stop the replay', () => {
  const dir = tmp();
  const a = openTeamStore(dir);
  a.append(repEvent('ana'));
  appendFileSync(path.join(dir, 'team', 'events.jsonl'), '{"type":"log","id":"g9"');
  const b = openTeamStore(dir);
  assert.equal(b.state.reps.has('ana'), true);
  // The next event still lands on its own line.
  b.append({ type: 'dayoff', scope: 'ana', date: '2026-11-17' });
  assert.equal(openTeamStore(dir).state.dayoffs.has('ana|2026-11-17'), true);
});

test('the lead list is kept on disk, businesses added in the app survive a new list, and a temporary id can be mapped', () => {
  const dir = tmp();
  const a = openTeamStore(dir);
  a.append(repEvent('ana'));
  a.setLeads([{ id: 'PA-0001', company: 'Ferretería El Roble', city: 'Panama City', zone: 'Vía España', stage: 'Contacted', lastContact: '2026-11-10' },
    { id: 'PA-0002', company: 'Taller Pinzón', city: 'Colón', stage: 'New' }, { id: 'PA-0003', company: 'Ferre Firmada', city: 'Panama City', stage: 'Contract signed' },
    { id: 'PA-0004', company: 'Ferre No Llamar', city: 'Panama City', stage: 'New', doNotCall: true }]);
  const tempId = a.addLead({ company: 'Bodega Nueva', zone: 'Calidonia', city: 'Panama City' }).id;
  assert.match(tempId, /^APP-/);
  a.append({ type: 'log', id: 'g1', rep: 'ana', lead: { id: tempId, name: 'Bodega Nueva', zone: 'Calidonia' }, kind: 'talk' });
  a.setLeads([{ id: 'PA-0001', company: 'Ferretería El Roble', city: 'Panama City', stage: 'Contacted' }]);
  const b = openTeamStore(dir);
  assert.equal(b.leads().has(tempId), true);
  assert.deepEqual(searchLeads(b.leads(), 'ferre', 'Panama City').map((l) => l.id), ['PA-0001']);
  b.mapLead(tempId, 'PA-SB-2900');
  const c = openTeamStore(dir);
  assert.equal(c.state.logs.get('g1').lead.id, 'PA-SB-2900');
  assert.deepEqual([c.leads().has(tempId), c.leads().get('PA-SB-2900').company], [false, 'Bodega Nueva']);
});

test('a search ignores accents and case, stays in the rep\'s city and leaves out signed and do-not-call businesses', () => {
  const leads = new Map([['1', { id: '1', company: 'Ferretería El Roble', city: 'Panama City', stage: 'New' }], ['2', { id: '2', company: 'FERRETERIA Colón', city: 'Colón', stage: 'New' }],
    ['3', { id: '3', company: 'Ferre Firmada', city: 'Panama City', stage: 'Live' }], ['4', { id: '4', company: 'Ferre DNC', city: 'Panama City', stage: 'New', doNotCall: true }]]);
  assert.deepEqual(searchLeads(leads, 'FERRETERIA', 'Panama City').map((l) => l.id), ['1']);
  assert.deepEqual(searchLeads(leads, 'ferre', 'Colón').map((l) => l.id), ['2']);
  assert.deepEqual(searchLeads(leads, '', 'Panama City').length, 0);
});

test('a PIN is six digits and not a trivial one', () => {
  for (const bad of ['12345', '1234567', 'abcdef', '111111', '123456', '654321', '']) assert.equal(validPin(bad), false, bad);
  for (const ok of ['482915', '100200']) assert.equal(validPin(ok), true, ok);
});

test('the right PIN passes, a wrong one fails, and the hash never contains the PIN', () => {
  const { salt, hash } = hashPin('482915');
  assert.equal(checkPin('482915', salt, hash), true);
  assert.equal(checkPin('482916', salt, hash), false);
  assert.equal(hash.includes('482915'), false);
  assert.notEqual(hashPin('482915').hash, hash);
});

test('a setup token is random and only its hash is kept', () => {
  const a = newSetupToken(), b = newSetupToken();
  assert.notEqual(a.token, b.token);
  assert.equal(a.tokenHash, hashToken(a.token));
  assert.equal(a.tokenHash.includes(a.token), false);
  assert.equal(a.token.length >= 32, true);
});

test('a session cookie is signed, expires after 30 days and breaks when touched', () => {
  let clock = Date.parse('2026-11-16T15:00:00Z');
  const s = sessions('secret-one', () => clock);
  const value = s.issue('r_ana', 3);
  assert.deepEqual(s.read(value), { repId: 'r_ana', pinVersion: 3 });
  assert.equal(s.read(value.replace('r_ana', 'r_eve')), null);
  assert.equal(s.read(`${value}x`), null);
  assert.equal(sessions('secret-two', () => clock).read(value), null);
  assert.equal(s.read(''), null);
  clock += 31 * 24 * 3600 * 1000;
  assert.equal(s.read(value), null);
});

test('five wrong tries lock a handle for 15 minutes', () => {
  let clock = 0;
  const l = lockout(() => clock);
  for (let i = 0; i < 4; i += 1) l.fail('ana');
  assert.equal(l.blocked('ana'), false);
  l.fail('ana');
  assert.equal(l.blocked('ana'), true);
  assert.equal(l.blocked('beto'), false);
  clock += 15 * 60 * 1000 + 1;
  assert.equal(l.blocked('ana'), false);
  l.fail('ana'); l.clear('ana');
  assert.equal(l.blocked('ana'), false);
});
