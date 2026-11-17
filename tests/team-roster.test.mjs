import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openTeamStore } from '../lib/team/store.mjs';
import { repView, teamView } from '../lib/team/view.mjs';
import { seedRoster } from '../tools/team-roster.mjs';
import { seed } from '../tools/team-seed.mjs';

const NOW = new Date('2026-11-17T15:00:00Z');   // Tuesday 10:00 in Panama
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF picture bytes'), Buffer.from([0xff, 0xd9])]);
const fresh = (name) => mkdtempSync(path.join(tmpdir(), name));
// Placeholder people: a roster file with real names never lives in the repository.
const PEOPLE = [
  { handle: 'uno', name: 'Persona Uno', role: 'rep', city: 'Panama City', startDate: '2026-11-10', photo: 'uno.jpg' },
  { handle: 'dos', name: 'Persona Dos', role: 'rep', city: 'Panama City', startDate: '2026-11-16' },
  { handle: 'guia', name: 'Persona Guía', role: 'admin', city: 'Panama City', startDate: '2026-10-28', photo: 'missing.jpg' },
];

test('a roster starts an empty folder with those people, their photos, no activity and no sample label', () => {
  const dir = fresh('team-roster-'), photos = fresh('team-roster-photos-');
  writeFileSync(path.join(photos, 'uno.jpg'), JPG);
  const out = seedRoster(dir, { now: NOW, people: PEOPLE, photosDir: photos });
  assert.match(out.pin, /^\d{6}$/);
  assert.deepEqual(out.people, ['uno (rep)', 'dos (rep)', 'guia (admin)']);
  assert.deepEqual(out.skipped, [{ handle: 'guia', why: 'photo' }]);   // the file named for that person is not there

  const { state } = openTeamStore(dir);
  assert.deepEqual([...state.reps.values()].map((p) => [p.handle, p.name, p.role, p.startDate, !!p.pin, !!p.photo]), [
    ['uno', 'Persona Uno', 'rep', '2026-11-10', true, true], ['dos', 'Persona Dos', 'rep', '2026-11-16', true, false], ['guia', 'Persona Guía', 'admin', '2026-10-28', true, false]]);
  assert.equal(state.logs.size, 0);
  assert.equal(existsSync(path.join(dir, 'team', 'SAMPLE')), false);
  const uno = state.handles.get('uno');
  assert.deepEqual(readFileSync(path.join(dir, 'team', 'photos', `${uno}.jpg`)), JPG);

  // what the screens get: real people, nothing earned, nobody ranked
  const ctx = { now: NOW.toISOString() };
  const me = repView(state, uno, ctx);
  assert.deepEqual([me.me.name, me.today.points, me.week.points, me.table.week.ranked], ['Persona Uno', 0, 0, 0]);
  const team = teamView(state, ctx);
  assert.deepEqual(team.reps.map((r) => [r.name, r.week.points, !!r.photo]), [['Persona Dos', 0, false], ['Persona Uno', 0, true]]);
});

test('the roster only fills an empty folder, and names the line it cannot use before writing anything', () => {
  const dir = fresh('team-roster-');
  seedRoster(dir, { now: NOW, people: PEOPLE.slice(0, 1) });
  assert.throws(() => seedRoster(dir, { now: NOW, people: PEOPLE }), /already holds events/);

  const bad = (people, re) => { const d = fresh('team-roster-'); assert.throws(() => seedRoster(d, { now: NOW, people }), re); assert.equal(existsSync(path.join(d, 'team', 'events.jsonl')), false); };
  bad([], /at least one person/);
  bad([{ handle: 'Con Espacio', name: 'Persona Uno' }], /line 1.*handle/);
  bad([PEOPLE[0], { handle: 'dos', name: 'D' }], /line 2.*name/);
  bad([{ handle: 'uno', name: 'Persona Uno', role: 'boss' }], /line 1.*role/);
  bad([{ handle: 'uno', name: 'Persona Uno', startDate: '10/11/2026' }], /line 1.*startDate/);
  bad([PEOPLE[0], { ...PEOPLE[1], handle: 'uno' }], /line 2.*handle/);   // the same handle twice
});

test('the sample people can be shown under other labels and usernames, with the same week of work', () => {
  const plain = fresh('team-seed-'), labeled = fresh('team-seed-');
  const a = seed(plain, { now: NOW });
  const b = seed(labeled, { now: NOW, names: { andrea: 'Vendedor A', lider: 'Líder' }, handles: { andrea: 'vendedor.a', nadia: 'Con Espacio' } });
  assert.equal(a.events, b.events);
  const { state } = openTeamStore(labeled);
  assert.deepEqual(['vendedor.a', 'omar', 'lider'].map((hd) => state.reps.get(state.handles.get(hd)).name), ['Vendedor A', 'Omar Rivas', 'Líder']);
  assert.equal(state.handles.get('vendedor.a'), 'r_sample_andrea');   // the person is the same one, so their week comes along
  assert.equal(state.handles.has('andrea'), false);
  assert.equal(state.handles.get('nadia'), 'r_sample_nadia');   // a username that could not sign in is not taken
});
