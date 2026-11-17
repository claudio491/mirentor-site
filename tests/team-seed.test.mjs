import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seed, resetSamplePins, SAMPLE_REPS } from '../tools/team-seed.mjs';
import { openTeamStore } from '../lib/team/store.mjs';
import { repView, teamView } from '../lib/team/view.mjs';
import { checkPin } from '../lib/team/auth.mjs';

const THU_3PM = new Date('2026-11-19T20:00:00Z');   // Thursday 3:00 pm in Panama
const fresh = () => mkdtempSync(path.join(tmpdir(), 'team-seed-'));

test('the seed fills an empty folder with a coherent week and marks it as a sample', () => {
  const dir = fresh(), r = seed(dir, { now: THU_3PM });
  assert.match(r.pin, /^\d{6}$/);
  assert.equal(existsSync(path.join(dir, 'team', 'SAMPLE')), true);
  const store = openTeamStore(dir), ctx = { now: THU_3PM.toISOString(), leads: store.leads() };
  const lines = readFileSync(path.join(dir, 'team', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.every((e) => e.t <= THU_3PM.toISOString()), true, 'nothing is dated after the moment of seeding');
  assert.equal(JSON.stringify(lines).includes(r.pin), false, 'the PIN is kept only as a hash');
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

test('the seed never touches a folder that already holds events, and sample PINs are only reset on a sample folder', () => {
  const dir = fresh(); seed(dir, { now: THU_3PM });
  assert.throws(() => seed(dir, { now: THU_3PM }), /already holds events/);
  const pin = resetSamplePins(dir);
  const store = openTeamStore(dir);
  for (const r of SAMPLE_REPS) { const rep = store.state.reps.get(r.id); assert.equal(checkPin(pin, rep.pin.salt, rep.pin.hash), true); }
  const real = fresh(); mkdirSync(path.join(real, 'team')); writeFileSync(path.join(real, 'team', 'events.jsonl'), '');
  assert.throws(() => resetSamplePins(real), /not a sample folder/);
});
