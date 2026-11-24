// The example team: four practice reps the server makes from one fixed recipe, with two weeks of activity, sites,
// workers, hours and an example pay rate that pays practice only. They live in a practice world of their own: a real
// viewer never sees them outside the "práctica" block and the practice counts, and removing them puts every real answer
// back as it was, byte for byte. An older build never sees a practice rep, business or site of theirs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { start, logBody } from './team-helper.mjs';
import { openTeamStore } from '../lib/team/store.mjs';

const API = '/equipo/api';
const SLOTS = ['A', 'B', 'C', 'D'];

async function setup(t, opts = {}) {
  const s = await start(opts); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto');
  // some real life before the example team arrives
  await s.call('POST', `${API}/log`, logBody('example-real-0001', { kind: 'meeting' }), { cookie: ana.cookie });
  await s.call('POST', `${API}/log`, logBody('example-real-0002', { kind: 'talk', lead: { name: 'Taller Real', zone: 'Centro' } }), { cookie: beto.cookie });
  const load = (who = a) => s.call('POST', `${API}/practice/example`, {}, { cookie: who.cookie });
  const unload = (who = a) => s.call('POST', `${API}/practice/example/remove`, {}, { cookie: who.cookie });
  const get = (route, who) => s.call('GET', `${API}/${route}`, undefined, { cookie: who.cookie });
  return { s, a, ana, beto, load, unload, get };
}
const examples = (team) => (team.example || []);
/** Every real answer a real viewer reads, as text. */
async function realPayloads(s, a, ana, get) {
  return {
    anaMe: (await get('me', ana)).text, adminMe: (await get('me', a)).text, team: (await get('team', a)).text,
    lead: (await get('lead', a)).text, export: (await s.call('GET', `${API}/export`, undefined, { bearer: 'push-token' })).text,
  };
}

test('a manager loads the example team: four practice reps A to D; a second press adds nothing; a rep, a leader or someone acting cannot', async (t) => {
  const { s, a, ana, load } = await setup(t);
  const lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  assert.equal((await load(ana)).status, 403);
  assert.equal((await load(lia)).status, 403);
  const made = await load();
  assert.equal(made.status, 200);
  assert.deepEqual(examples(made.json).map((r) => [r.name, r.practice, r.example]), SLOTS.map((x) => [`Vendedor ${x}`, true, x]));
  const reps = s.lines().filter((e) => e.type === 'rep.practice.example');
  assert.equal(reps.length, 4);
  assert.equal(s.lines().some((e) => e.type === 'rep.created' && /Vendedor [A-D]/.test(e.name)), false, 'never an ordinary rep');
  const count = s.lines().length;
  assert.equal((await load()).status, 200);
  assert.equal(s.lines().length, count, 'idempotent');
  // the free practice rep is still one of its own, beside the team of four
  assert.equal((await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).status, 200);
  const P = (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json.practice.id;
  assert.equal((await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.error, 'practice_exists');
  // acting, the button does not exist
  assert.deepEqual([(await s.call('POST', `${API}/practice/example?as=${P}`, {}, { cookie: a.cookie })).json.error], ['read_only']);
});

test('the recipe is deterministic for a fixed clock: the same events, the same consent placeholder', async (t) => {
  const one = await setup(t), two = await setup(t);
  const at1 = one.s.lines().length, at2 = two.s.lines().length;
  await one.load(); await two.load();
  // what the button wrote, leaving out who pressed it (each test server has its own admin id)
  const mine = (s, from) => s.lines().slice(from).map(({ by, ...e }) => e);
  assert.ok(mine(one.s, at1).length > 100, 'two weeks of activity');
  assert.equal(JSON.stringify(mine(one.s, at1)), JSON.stringify(mine(two.s, at2)));
  const consents = (s) => readdirSync(path.join(s.dir, 'team', 'consents')).sort();
  assert.deepEqual(consents(one.s), consents(two.s));
  const f = consents(one.s)[0];
  assert.deepEqual(readFileSync(path.join(one.s.dir, 'team', 'consents', f)), readFileSync(path.join(two.s.dir, 'team', 'consents', f)));
  assert.equal(readFileSync(path.join(one.s.dir, 'team', 'consents', f)).subarray(1, 4).toString(), 'PNG');
});

test('the practice world: acting as Vendedor B, the table, feed and team numbers hold the four and no real rep; earnings at the example rate', async (t) => {
  const { s, a, load, get } = await setup(t);
  const team = (await load()).json, B = examples(team).find((r) => r.example === 'B').id, D = examples(team).find((r) => r.example === 'D').id;
  const asB = await s.call('GET', `${API}/me?as=${B}`, undefined, { cookie: a.cookie });
  assert.equal(asB.status, 200);
  const me = asB.json, W = me.table.week;
  const ids = new Set([...W.podium.map((r) => r.id), ...W.rest.map((r) => r.id), W.me.id]);
  assert.deepEqual([...ids].sort(), examples(team).map((r) => r.id).sort(), 'the four and only them');
  assert.equal(me.team.players, 4);
  const realIds = (await get('team', a)).json.reps.map((r) => r.id);
  for (const f of me.feed) assert.equal(realIds.includes(f.rep), false, 'no real line in the practice feed');
  assert.ok(me.feed.length > 0);
  assert.equal(JSON.stringify(me).includes('ana Rep'), false);
  // one clearly ahead, one new
  assert.equal(W.podium[0].first, 'Vendedor A');
  assert.equal([...W.rest, W.me].find((r) => r.id === D).isNew, true);
  // B's own sites and the crew, at US$1.00 per accepted hour
  assert.equal(me.earn.rate, 100);
  assert.ok(me.active.length >= 1 && me.active.every((x) => x.practice));
  const crew = new Map(me.crew.map((c) => [c.id, c]));
  assert.equal(crew.size, 4);
  const A = examples(team).find((r) => r.example === 'A').id;
  assert.ok(crew.get(A).cents > crew.get(B).cents && crew.get(B).cents > 0);
  assert.deepEqual([crew.get(D).sites, crew.get(D).cents], [[], 0]);
  // a manager writes as an example rep, practice target only
  assert.equal((await s.call('POST', `${API}/log?as=${B}`, logBody('example-prac-0001'), { cookie: a.cookie })).status, 200);
  // English names for an English viewer
  await s.call('POST', `${API}/lang`, { lang: 'en' }, { cookie: a.cookie });
  const en = (await s.call('GET', `${API}/me?as=${B}`, undefined, { cookie: a.cookie })).json;
  assert.equal(en.me.name, 'Rep B');
  const W2 = en.table.week;
  assert.deepEqual([...new Set([...W2.podium, ...W2.rest, W2.me].map((r) => r.first))].sort(), ['Rep A', 'Rep B', 'Rep C', 'Rep D']);
});

test('a real viewer sees none of it; removing the team restores every real answer byte for byte; an older build sees nothing of it', async (t) => {
  const { s, a, ana, load, unload, get } = await setup(t);
  const before = await realPayloads(s, a, ana, get);
  const team = (await load()).json;
  const ids = examples(team).map((r) => r.id);
  const during = await realPayloads(s, a, ana, get);
  for (const k of ['anaMe', 'adminMe', 'export']) {
    assert.equal(during[k], before[k], `${k} unchanged while the team exists`);
  }
  // the manager's team view lists them only in the practice block; the leadership view only counts them
  const tv = JSON.parse(during.team);
  for (const id of ids) assert.equal(JSON.stringify({ ...tv, example: null }).includes(id), false, `team view outside the block: ${id}`);
  const lv = JSON.parse(during.lead);
  assert.equal(lv.practiceReps, 4);
  assert.ok(lv.practiceHidden >= 3);
  for (const id of ids) assert.equal(during.lead.includes(id), false);
  assert.deepEqual({ ...lv, practiceReps: 0, practiceHidden: 0 }, { ...JSON.parse(before.lead), practiceReps: 0, practiceHidden: 0 });
  // removal: two events kinds every build reads, then the team
  const r = await unload();
  assert.equal(r.status, 200);
  assert.equal(r.json.example, null);
  const types = s.lines().map((e) => e.type);
  assert.ok(types.lastIndexOf('site.removed') < types.lastIndexOf('practice.team.removed'));
  const after = await realPayloads(s, a, ana, get);
  assert.deepEqual(after, before, 'every real payload byte for byte');
  assert.equal(existsSync(path.join(s.dir, 'team', 'consents')) ? readdirSync(path.join(s.dir, 'team', 'consents')).length : 0, 0, 'the placeholders go too');
  // a restart agrees
  const again = openTeamStore(s.dir, { log: () => {} });
  assert.equal([...again.state.reps.values()].some((x) => x.practice), false);
  assert.equal([...again.state.sites.values()].some((x) => x.practice), false);
  assert.equal(again.state.practiceRates.length, 0);
  // the build before practice mode, and the build before this task, replaying the log
  const older = olderBuild(s.lines());
  assert.deepEqual([older.reps.filter((x) => /Vendedor [A-D]/.test(x)), older.leads, older.sites], [[], [], []]);
  // and a second removal finds nothing
  assert.equal((await unload()).status, 404);
});

test('a real log that holds an id the recipe would use is never confirmed by the example team, and the team still loads', async (t) => {
  const { s, ana, load } = await setup(t);
  const R = { cookie: ana.cookie };
  // Monday 16 Nov: the recipe's last week is 9 to 13 Nov; Vendedor A books a meeting on the 9th and signs its contract on the 11th
  const real = ['ex-a-2026-11-11-contract', 'ex-a-2026-11-09-5'];
  assert.equal((await s.call('POST', `${API}/log`, logBody(real[0], { kind: 'contract', lead: { name: 'Hotel Real', zone: 'Centro' } }), R)).status, 200);
  assert.equal((await s.call('POST', `${API}/log`, logBody(real[1], { kind: 'meeting', channel: 'visit', lead: { name: 'Clinica Real', zone: 'Centro' } }), R)).status, 200);
  assert.equal((await load()).status, 200);
  assert.deepEqual(s.lines().filter((e) => e.type === 'confirm' && real.includes(e.logId)), [], 'nothing of the recipe lands on a real log');
  const leadId = s.lines().find((e) => e.id === real[0]).lead.id;
  const route = (await s.call('GET', `${API}/route?lead=${leadId}`, undefined, R)).json.route;
  assert.deepEqual([route.contract.sent, route.contract.signed], [null, null]);
  // the example team has its own logs, and their ids are of a shape a phone cannot send
  const theirs = s.lines().filter((e) => e.type === 'log' && e.rep.startsWith('r_ejemplo-')).map((e) => e.id);
  assert.ok(theirs.length > 50);
  assert.equal(s.lines().filter((e) => e.type === 'confirm' && e.what === 'contract_signed' && theirs.includes(e.logId)).length, 2);
  for (const id of [theirs[0], theirs.find((x) => x.endsWith('-contract'))]) assert.deepEqual([(await s.call('POST', `${API}/log`, logBody(id), R)).json.error], ['id']);
});

test('an example team loaded by an older build, with the old log ids, still shows, pays and is brought up to date', async (t) => {
  const { s, a, load } = await setup(t);
  assert.equal((await load()).status, 200);
  // the log as the build before held it: the example team's log ids written with a dash
  const file = path.join(s.dir, 'team', 'events.jsonl'), old = (id) => (id.startsWith('ex_') ? `ex-${id.slice(3)}` : id);
  const lines = s.lines().map((e) => (e.type === 'log' ? { ...e, id: old(e.id) } : e.type === 'confirm' ? { ...e, logId: old(e.logId) } : e));
  assert.ok(lines.some((e) => e.type === 'log' && e.id.startsWith('ex-a-')));
  s.srv.close();
  writeFileSync(file, `${lines.map((e) => JSON.stringify(e)).join('\n')}\n`);
  const back = await start({ dir: s.dir, clock: s.time.now }); t.after(() => back.srv.close());
  const team = (await back.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json;
  const A = examples(team).find((r) => r.example === 'A').id;
  const signed = (me) => me.ledger.filter((e) => e.code === 'contract_signed' && e.status === 'earned').map((e) => e.logId);
  assert.deepEqual(signed((await back.call('GET', `${API}/me?as=${A}`, undefined, { cookie: a.cookie })).json), ['ex-a-2026-11-11-contract']);
  // a day later the button brings it up to date: the old team leaves whole, today's comes with the new ids
  back.time.now += 24 * 3600 * 1000;
  assert.equal((await back.call('POST', `${API}/practice/example`, {}, { cookie: a.cookie })).status, 200);
  const now = (await back.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json;
  assert.equal(examples(now).length, 4);
  const A2 = examples(now).find((r) => r.example === 'A').id;
  assert.deepEqual(signed((await back.call('GET', `${API}/me?as=${A2}`, undefined, { cookie: a.cookie })).json), ['ex_a-2026-11-11-contract']);
});

/** What builds before this task make of the log: the reducer cases they have for people, businesses and sites
 *  (rep.created; rep.practice and rep.practice.removed since Task 12; lead.added; site and site.removed). */
function olderBuild(events) {
  const reps = new Map(), leads = new Map(), sites = new Map();
  for (const e of events) {
    switch (e.type) {
      case 'rep.created': reps.set(e.id, e.name); break;
      case 'rep.practice': if (![...reps.keys()].some((k) => k.startsWith('P:'))) reps.set(`P:${e.id}`, e.name); break;
      case 'rep.practice.removed': reps.delete(`P:${e.id}`); break;
      case 'lead.added': if (e.lead && typeof e.lead.id === 'string') leads.set(e.lead.id, e.lead.company); break;
      case 'site': if (!sites.has(e.id)) sites.set(e.id, { practice: e.practice === true }); break;
      case 'site.removed': { const x = sites.get(e.siteId); if (x && x.practice) sites.delete(e.siteId); break; }
      default: break;
    }
  }
  return { reps: [...reps.values()], leads: [...leads.values()].filter((c) => !['Ferretería El Roble', 'Taller Real'].includes(c)), sites: [...sites.keys()] };
}
