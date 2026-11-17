import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openTeamStore, searchLeads } from '../lib/team/store.mjs';

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

test('one address written for two people: when one of them moves, the other keeps the way in', () => {
  // The API refuses a second person with the same address; a list written by hand can still carry one.
  const store = openTeamStore(tmp());
  store.append({ ...repEvent('ana'), email: 'una@equipo.test' });
  store.append({ ...repEvent('beto'), email: 'una@equipo.test' });
  assert.equal(store.state.emails.get('una@equipo.test'), 'beto');
  store.append({ type: 'rep.updated', id: 'ana', patch: { email: 'ana@equipo.test' } });
  assert.deepEqual([store.state.emails.get('una@equipo.test'), store.state.emails.get('ana@equipo.test')], ['beto', 'ana']);
  store.append({ type: 'rep.updated', id: 'beto', patch: { email: '' } });
  assert.deepEqual([store.state.emails.has('una@equipo.test'), store.state.reps.get('beto').email], [false, '']);
});
