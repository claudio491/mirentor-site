// A real rep with no access yet: a manager adds a person by name only, so their sites, numbers and activity can be
// shown and filled in, while nobody signs in as them. The event is the existing rep.created with an empty email; the
// handle comes from the name. Adding a work email later (the same domain and uniqueness rules) is what lets them in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, mail, as } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { openTeamStore } from '../lib/team/store.mjs';

const API = '/equipo/api';
const NO_ACCESS = { access: 'none', name: 'Rosa Sin Correo', city: 'Panama City', country: 'PA', workdays: [1, 2, 3, 4, 5], startDate: '2026-10-01' };

async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' });
  return { s, a, ana, mgr };
}

test('a manager creates a rep with no email; a rep cannot; the event is rep.created with email empty and a name handle', async (t) => {
  const { s, ana, mgr } = await setup(t);
  const made = await s.call('POST', `${API}/reps`, NO_ACCESS, { cookie: mgr.cookie });
  assert.equal(made.status, 200);
  const e = s.lines().filter((x) => x.type === 'rep.created').pop();
  assert.deepEqual([e.id, e.email, e.handle, e.role, e.name], [made.json.id, '', 'rosa-sin-correo', 'rep', 'Rosa Sin Correo']);
  // a rep may not create anyone, with or without an email
  const before = s.lines().length;
  const refused = await s.call('POST', `${API}/reps`, { ...NO_ACCESS, name: 'Otra Persona' }, { cookie: ana.cookie });
  assert.equal(refused.status, 403);
  assert.equal(s.lines().length, before);
  // without `access: 'none'`, a missing email is still refused as before
  const noMail = await s.call('POST', `${API}/reps`, { name: 'Sin Nada', city: 'Panama City' }, { cookie: mgr.cookie });
  assert.deepEqual([noMail.status, noMail.json.error], [400, 'fields']);
  assert.equal(s.lines().length, before);
});

test('an admin asking for another role on this path still gets a rep; an email sent along is ignored', async (t) => {
  const { s, a } = await setup(t);
  const made = await s.call('POST', `${API}/reps`, { ...NO_ACCESS, role: 'manager', email: mail('colado') }, { cookie: a.cookie });
  assert.equal(made.status, 200);
  const e = s.lines().filter((x) => x.type === 'rep.created').pop();
  assert.deepEqual([e.role, e.email], ['rep', '']);
  // the address was not taken by this path: it can still be given to someone else
  assert.equal((await s.addRep(a.cookie, 'colado')).id.length > 0, true);
});

test('two reps without email both exist, with unique handles, and no identity reaches either one', async (t) => {
  const { s, mgr } = await setup(t);
  const one = (await s.call('POST', `${API}/reps`, NO_ACCESS, { cookie: mgr.cookie })).json.id;
  const two = (await s.call('POST', `${API}/reps`, { ...NO_ACCESS, name: 'Rosa  Sin Correo' }, { cookie: mgr.cookie })).json.id;
  assert.notEqual(one, two);
  const created = s.lines().filter((x) => x.type === 'rep.created' && x.email === '');
  assert.deepEqual(created.map((x) => x.handle), ['rosa-sin-correo', 'rosa-sin-correo-2']);
  const team = (await s.call('GET', `${API}/team`, undefined, { cookie: mgr.cookie })).json;
  assert.deepEqual(team.reps.filter((r) => r.id === one || r.id === two).map((r) => r.email), ['', '']);
  // no address maps to them, and '' maps to nobody
  const st = openTeamStore(s.dir, { log: () => {} }).state;
  assert.equal(st.emails.has(''), false);
  assert.equal([...st.emails.values()].some((id) => id === one || id === two), false);
  // every way a request can say who it is: no cookie, an empty email, blanks, an address nobody has
  const asks = [undefined, as(''), as('   '), 'who=', as(mail('nadie')), as(`@${'equipo.test'}`)];
  for (const cookie of asks) {
    const me = await s.call('GET', `${API}/me`, undefined, cookie ? { cookie } : {});
    assert.ok([401, 403].includes(me.status), `${cookie}: ${me.status}`);
    assert.equal(JSON.stringify(me.json || {}).includes(one) || JSON.stringify(me.json || {}).includes(two), false);
  }
});

test('the reducer never maps an empty email, on create or on a patch, and a log replays the same twice', () => {
  const st = emptyState(), t = '2026-11-16T15:00:00Z';
  const events = [
    { type: 'rep.created', id: 'r_a', handle: 'uno-sin', email: '', name: 'Uno Sin', role: 'rep', t },
    { type: 'rep.created', id: 'r_b', handle: 'dos-sin', email: '', name: 'Dos Sin', role: 'rep', t },
    { type: 'rep.created', id: 'r_c', handle: 'tres-sin', name: 'Tres Sin', role: 'rep', t },   // no field at all, as an older tool wrote it
    { type: 'rep.updated', id: 'r_a', patch: { email: '' } },
  ];
  for (const e of events) applyEvent(st, e);
  assert.equal(st.emails.size, 0);
  assert.deepEqual(['r_a', 'r_b', 'r_c'].map((id) => st.reps.get(id).email), ['', '', '']);
  applyEvent(st, { type: 'rep.updated', id: 'r_b', patch: { email: 'dos@equipo.test' } });
  assert.deepEqual([...st.emails], [['dos@equipo.test', 'r_b']]);
});

test('a rep with no email counts as a real rep: team view, leadership view and sites, never the practice block', async (t) => {
  const { s, a, mgr } = await setup(t);
  const rosa = (await s.call('POST', `${API}/reps`, NO_ACCESS, { cookie: mgr.cookie })).json.id;
  const site = await s.call('POST', `${API}/site`, { rep: rosa, lead: { name: 'Taller de Prueba' }, city: 'Panama City', eligible: 9 }, { cookie: mgr.cookie });
  assert.equal(site.status, 200);
  const team = (await s.call('GET', `${API}/team`, undefined, { cookie: mgr.cookie })).json;
  const row = team.reps.find((r) => r.id === rosa);
  assert.ok(row, 'listed with the real reps');
  assert.equal(row.practice, undefined);
  assert.equal(team.practice, null);
  const lead = (await s.call('GET', `${API}/lead`, undefined, { cookie: a.cookie })).json;
  const city = lead.cities.find((c) => c.city === 'Panama City');
  assert.ok(city.reps.some((r) => r.id === rosa), 'in the leadership view');
  assert.equal(typeof city.reps.find((r) => r.id === rosa).sites, 'number');   // active sites: one opened is not yet active
  assert.ok(city.sites.some((x) => x.name === 'Taller de Prueba'));
  assert.deepEqual([lead.practiceReps, lead.practiceHidden], [0, 0]);
  // view-as stays read-only, as for any real rep
  const seen = await s.call('GET', `${API}/me?as=${rosa}`, undefined, { cookie: mgr.cookie });
  assert.equal(seen.status, 200);
  const before = s.lines().length;
  const write = await s.call('POST', `${API}/close?as=${rosa}`, { tomorrow: 'x' }, { cookie: mgr.cookie });
  assert.deepEqual([write.status, write.json.error], [403, 'read_only']);
  assert.equal(s.lines().length, before);
});

test('adding an email later lets that account in; a taken or wrong-domain email is refused', async (t) => {
  const { s, ana, mgr } = await setup(t);
  const rosa = (await s.call('POST', `${API}/reps`, NO_ACCESS, { cookie: mgr.cookie })).json.id;
  assert.equal((await s.call('GET', `${API}/me`, undefined, { cookie: as(mail('rosa')) })).status, 403);
  const before = s.lines().length;
  const taken = await s.call('POST', `${API}/reps/${rosa}`, { patch: { email: mail('ana') } }, { cookie: mgr.cookie });
  assert.deepEqual([taken.status, taken.json.error], [409, 'email_taken']);
  const wrong = await s.call('POST', `${API}/reps/${rosa}`, { patch: { email: 'rosa@otro.test' } }, { cookie: mgr.cookie });
  assert.deepEqual([wrong.status, wrong.json.error], [400, 'email_domain']);
  const byRep = await s.call('POST', `${API}/reps/${rosa}`, { patch: { email: mail('rosa') } }, { cookie: ana.cookie });
  assert.equal(byRep.status, 403);
  assert.equal(s.lines().length, before);
  const given = await s.call('POST', `${API}/reps/${rosa}`, { patch: { email: mail('Rosa') } }, { cookie: mgr.cookie });
  assert.equal(given.status, 200);
  const me = await s.call('GET', `${API}/me`, undefined, { cookie: as(mail('rosa')) });
  assert.equal(me.status, 200);
  assert.deepEqual([me.json.viewer.id, me.json.viewer.role], [rosa, 'rep']);
  // the handle stays the one made from the name
  assert.equal(openTeamStore(s.dir, { log: () => {} }).state.reps.get(rosa).handle, 'rosa-sin-correo');
});

test('the practice rules are untouched: the practice rep still has no email and nobody signs in as it', async (t) => {
  const { s, a } = await setup(t);
  const p = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  const e = s.lines().find((x) => x.type === 'rep.practice');
  assert.equal(e.type, 'rep.practice');
  const team = (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json;
  assert.equal(team.reps.some((r) => r.id === p), false);
  assert.equal(team.practice.id, p);
  const lead = (await s.call('GET', `${API}/lead`, undefined, { cookie: a.cookie })).json;
  assert.equal(lead.practiceReps, 1);
});
