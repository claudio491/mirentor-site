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
  // Andrea's meeting this week, and the two she booked the week before last (one for yesterday nobody marked held, one for today)
  // wave 2 adds a meeting three days past nobody marked, a contract out nine days whose signature waits, and the meeting
  // booked yesterday for tomorrow that asks for a demo
  assert.deepEqual(team.needs.confirm.map((x) => x.what).sort(), ['contract_sent', 'contract_signed', 'meeting_held', 'meeting_held', 'meeting_held', 'meeting_held', 'meeting_held']);
  assert.deepEqual(team.needs.silent.map((x) => x.name), ['Camila Herrera']);
  assert.equal(team.needs.late.length, 1);
  assert.equal(team.needs.pace.some((x) => x.name === 'Camila Herrera'), true);
  assert.equal(team.reps.find((x) => x.handle === 'nadia').isNew, true);
  assert.equal(team.sites.length, 2, 'wave 2 adds a site that asked for phones and got none yet');
  // wave 2: phones asked and arrived, what is stalled, the week's meetings with "Pide demo", the day's blockers,
  // the qualification, and a worker with no email on purpose
  assert.deepEqual(team.sites.map((x) => [x.id, x.requested, x.phones, x.owed]), [['s_sample_1', 30, 10, 20], ['s_sample_2', 12, null, 12]]);
  assert.deepEqual(team.needs.stalled.map((x) => [x.kind, x.lead.name, x.days]), [['contract', 'Panadería Doña Tita', 9], ['meeting', 'Refrigeración Polo Norte', 3]]);
  assert.equal(team.needs.meetings.some((m) => m.demo), true);
  assert.deepEqual(team.needs.blockers.map((b) => [b.name, b.day]), [['Nadia Pérez', '2026-11-19'], ['Andrea Quintero', '2026-11-18']]);
  const qual = (key) => store.state.biz.get(`EJ-${key}`)?.q;
  assert.deepEqual([qual('P1'), qual('C1'), qual('P3'), qual('C2')], [{ workers: '10_29', wifi: 'yes', lead: 'yes' }, { wifi: 'no', lead: 'unknown' }, { workers: 'lt10', wifi: 'yes' }, { lead: 'yes' }]);
  assert.deepEqual([store.state.workers.get('w_sampleNoEmail1').email, store.state.workers.get('w_sampleNoEmail1').noEmail], ['', true]);
  assert.equal(store.leads().size, 28);
  // the business in the rep's hand: every state of Andrea's book is there, through events
  assert.deepEqual(andrea.agenda.counts, { overdue: 2, today: 2, soon: 3, nonext: 2, owned: 9 });
  assert.deepEqual(andrea.agenda.meetings.map((m) => m.lead.name), ['Panificadora Santa Rita', 'Carpintería Don Chema']);
  assert.equal(andrea.pending.some((p) => p.code === 'meeting_held' && !p.held && p.when < andrea.today.day), true, 'a meeting of yesterday nobody marked');
  const crm = store.leads().get('EJ-P1');
  assert.deepEqual([crm.phone, /@[a-z0-9-]+\.ejemplo\.test$/.test(crm.email), crm.maps.startsWith('https://maps.example/'), typeof crm.workers, typeof crm.walkin], ['+507 6000-0101', true, true, 'number', 'number']);
  assert.deepEqual(team.needs.overdue.map((x) => x.name), ['Andrea Quintero', 'Luis Batista']);
});

test('the blockers and Pide demo show whatever the weekday the seed runs', () => {
  // Monday 16 to Sunday 22, at 3:00 pm in Panama
  for (let i = 0; i < 7; i += 1) {
    const now = new Date(Date.parse('2026-11-16T20:00:00Z') + i * 86400000), dir = fresh(); seed(dir, { now });
    const store = openTeamStore(dir), today = now.toISOString().slice(0, 10), yesterday = new Date(now - 86400000).toISOString().slice(0, 10);
    const team = teamView(store.state, { now: now.toISOString(), leads: store.leads() });
    assert.deepEqual(team.needs.blockers.map((b) => [b.name, b.day]), [['Nadia Pérez', today], ['Andrea Quintero', yesterday]], today);
    assert.equal(team.needs.meetings.some((m) => m.demo), true, today);
  }
});

test('the seed never touches a folder that already holds events', () => {
  const dir = fresh(); seed(dir, { now: THU_3PM });
  assert.throws(() => seed(dir, { now: THU_3PM }), /already holds events/);
});

test('the practice seed gives the first rep a practice site with phones marked and three placeholder workers in three states', () => {
  const dir = fresh(); seed(dir, { now: THU_3PM, practice: true });
  const store = openTeamStore(dir), ctx = { now: THU_3PM.toISOString(), leads: store.leads() };
  const me = repView(store.state, 'r_sample_andrea', ctx);
  assert.deepEqual(me.installs, [{ id: 's_sample_practice', name: 'Sitio de práctica', state: 'practice', ready: 1, total: 3, phones: 3, practice: true, closed: false }]);
  const workers = store.state.sites.get('s_sample_practice').workers.map((id) => store.state.workers.get(id));
  assert.deepEqual(workers.map((w) => [w.name, !!w.consent, !!w.imei]), [['Trabajador 1', true, true], ['Trabajador 2', false, false], ['Trabajador 3', true, false]]);
  assert.equal(existsSync(path.join(dir, 'team', 'consents', `${workers[0].id}.${workers[0].consent.v}.png`)), true);   // <worker id>.<version>.<ext>
  // without the option the sample stays as it was
  const plain = fresh(); seed(plain, { now: THU_3PM });
  assert.equal(openTeamStore(plain).state.sites.has('s_sample_practice'), false);
});

test('the leader seed gives the leadership view a leader, two weeks of hours and, in one city, a legacy site and one installed with the app', async () => {
  const { leaderView } = await import('../lib/team/leader.mjs');
  const dir = fresh(); seed(dir, { now: THU_3PM, practice: true, leader: true });
  const store = openTeamStore(dir), view = leaderView(store.state, { now: THU_3PM.toISOString(), leads: store.leads() });
  assert.equal([...store.state.reps.values()].filter((r) => r.role === 'leader').length, 1);
  assert.deepEqual(view.hours.map((x) => [x.week, x.source]), [['2026-11-09', 'scorecard'], ['2026-11-02', 'manual']]);
  const pc = view.cities.find((c) => c.city === 'Panama City');
  assert.deepEqual(pc.sites.map((x) => [x.name, x.state, x.eligible, x.consents, x.phones, x.workers]),
    [['Sitio de ejemplo A', 'legacy', 9, 0, 0, 0], ['Sitio de ejemplo B', 'installed', 7, 4, 3, 4]]);
  assert.equal(view.practiceHidden, 1);
  // the practice worker kept its phone: the leader seed uses other IMEIs
  assert.equal(store.state.workers.get('w_sampleWorker1').imei, '490154203237518');
  // without the option the sample has no leader and no hours
  const plain = fresh(); seed(plain, { now: THU_3PM });
  assert.deepEqual([[...openTeamStore(plain).state.reps.values()].some((r) => r.role === 'leader'), openTeamStore(plain).state.hours.size], [false, 0]);
});

test('the lone seed is one admin and nothing else, so the screens can be seen as a team that has not started', () => {
  const dir = fresh(), r = seed(dir, { now: THU_3PM, lone: true });
  const store = openTeamStore(dir), ctx = { now: THU_3PM.toISOString(), leads: store.leads() };
  assert.deepEqual([...store.state.reps.values()].map((x) => [x.handle, x.role]), [['lider', 'admin']]);
  assert.deepEqual(r.reps, ['lider (admin)']);
  assert.deepEqual([store.state.sites.size, store.state.logs.size, store.state.feed.length], [0, 0, 0]);
  const team = teamView(store.state, ctx);
  assert.deepEqual([team.reps.length, team.others.map((x) => x.id)], [0, ['r_sample_lider']]);
  // the default seed still has its six people
  assert.equal(seed(fresh(), { now: THU_3PM }).reps.length, 6);
});
