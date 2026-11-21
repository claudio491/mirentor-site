import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seed } from '../tools/team-seed.mjs';
import { openTeamStore } from '../lib/team/store.mjs';
import { repView, teamView } from '../lib/team/view.mjs';

const THU_3PM = new Date('2026-11-19T20:00:00Z');   // Thursday 3:00 pm in Panama
const fresh = () => mkdtempSync(path.join(tmpdir(), 'team-seed-'));

test('the seed fills an empty folder with a coherent week and marks it as a sample', () => {
  const dir = fresh(), r = seed(dir, { now: THU_3PM });
  assert.equal(existsSync(path.join(dir, 'team', 'SAMPLE')), true);
  const store = openTeamStore(dir), ctx = { now: THU_3PM.toISOString(), leads: store.leads() };
  const lines = readFileSync(path.join(dir, 'team', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.every((e) => e.t <= THU_3PM.toISOString()), true, 'nothing is dated after the moment of seeding');
  assert.equal(lines.some((e) => /pin|setup/.test(e.type)), false, 'nobody has a PIN: people come in with their account');
  assert.deepEqual([r.reps.length, store.state.reps.get('r_sample_andrea').email], [6, 'andrea@ejemplo.test']);
  const andrea = repView(store.state, 'r_sample_andrea', ctx);
  // Monday and Tuesday are full fingers, Wednesday is one conversation short, Thursday has everything but the closing.
  assert.deepEqual(andrea.week.days.map((d) => d.marks), [4, 4, 3, 3, 0]);
  assert.deepEqual(andrea.week.days[2].habits, [true, false, true, true]);
  assert.deepEqual(andrea.today.habits, [true, true, true, false]);
  assert.deepEqual([andrea.week.fullFingers, andrea.goal.picked, andrea.today.closed, andrea.me.isNew], [2, 4, false, false]);
  assert.equal(andrea.streak.current >= 8, true);
  assert.deepEqual([andrea.table.week.podium.length, andrea.table.week.podium[0].first, andrea.table.week.me.place], [2, 'Omar', 2]);
  assert.equal(andrea.pending.some((p) => p.code === 'meeting_held'), true);
  assert.equal(andrea.feed.some((f) => f.play), true);
  const team = teamView(store.state, ctx);
  assert.equal(team.reps.length, 5);
  assert.deepEqual(team.needs.confirm.map((x) => x.what).sort(), ['contract_sent', 'meeting_held']);
  assert.deepEqual(team.needs.silent.map((x) => x.name), ['Camila Herrera']);
  assert.equal(team.needs.late.length, 1);
  assert.equal(team.needs.pace.some((x) => x.name === 'Camila Herrera'), true);
  assert.equal(team.reps.find((x) => x.handle === 'nadia').isNew, true);
  assert.equal(team.sites.length, 1);
  assert.equal(store.leads().size, 20);
});

test('the seed never touches a folder that already holds events', () => {
  const dir = fresh(); seed(dir, { now: THU_3PM });
  assert.throws(() => seed(dir, { now: THU_3PM }), /already holds events/);
});

test('the practice seed gives the admin a practice site with phones marked and three placeholder workers in three states', () => {
  const dir = fresh(); seed(dir, { now: THU_3PM, practice: true });
  const store = openTeamStore(dir), ctx = { now: THU_3PM.toISOString(), leads: store.leads() };
  const me = repView(store.state, 'r_sample_lider', ctx);
  assert.deepEqual(me.installs, [{ id: 's_sample_practice', name: 'Sitio de práctica', state: 'practice', ready: 1, total: 3, phones: 3, practice: true }]);
  const workers = store.state.sites.get('s_sample_practice').workers.map((id) => store.state.workers.get(id));
  assert.deepEqual(workers.map((w) => [w.name, !!w.consent, !!w.imei]), [['Trabajador 1', true, true], ['Trabajador 2', false, false], ['Trabajador 3', true, false]]);
  assert.equal(existsSync(path.join(dir, 'team', 'consents', `${workers[0].id}.png`)), true);
  // without the option the sample stays as it was
  const plain = fresh(); seed(plain, { now: THU_3PM });
  assert.equal(openTeamStore(plain).state.sites.has('s_sample_practice'), false);
});
