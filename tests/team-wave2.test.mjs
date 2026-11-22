// The second wave's fixes, on the server. Practice data must never reach the CRM, even after a rollback to the build
// before practice mode; a site a manager opened is the route's site too; a manager or an admin who is not acting
// cannot log as themself; acting touches only practice data; a practice day closed early still takes logs; a rep's
// site takes the rep's city; a document's address carries no account and its order never drops it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { start, logBody } from './team-helper.mjs';
import { openTeamStore } from '../lib/team/store.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';

const API = '/equipo/api';

async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' });
  const asP = (route, id) => `${API}/${route}${route.includes('?') ? '&' : '?'}as=${encodeURIComponent(id)}`;
  const idOf = async (who) => (await s.call('GET', `${API}/me`, undefined, { cookie: who.cookie })).json.viewer.id;
  return { s, a, ana, mgr, asP, idOf };
}

/** What the build before practice mode (0f51f43) makes of a log and a lead cache: the reducer cases it has for
 *  businesses and sites (lead.added, site, site.removed; every other event is unknown to it or not about them), and its
 *  export, which sends every app business on the list (the cache, plus the log's businesses the cache lost). */
function olderBuild(events, cached) {
  const appLeads = new Map(), sites = new Map();
  for (const e of events) {
    switch (e.type) {
      case 'lead.added': if (e.lead && typeof e.lead.id === 'string') appLeads.set(e.lead.id, { ...e.lead, createdAt: e.t }); break;
      case 'site': if (!sites.has(e.id)) sites.set(e.id, { id: e.id, rep: e.rep, practice: e.practice === true }); break;
      case 'site.removed': { const x = sites.get(e.siteId); if (x && x.practice) sites.delete(x.id); break; }
      default: break;
    }
  }
  const leads = new Map(cached.map((l) => [l.id, l]));
  for (const l of appLeads.values()) if (!leads.has(l.id)) leads.set(l.id, { ...l, stage: 'New', app: true });
  return { newLeads: [...leads.values()].filter((l) => l.app).map((l) => l.company), sites: [...sites.keys()] };
}
const cacheOf = (s) => { const f = path.join(s.dir, 'team', 'leads.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : []; };

test('I1: a log written by this build gives the older build no practice business and, once removed, no practice site', async (t) => {
  const { s, a, asP } = await setup(t);
  const P = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  const logged = await s.call('POST', asP('log', P), logBody('wave2-prac-0001', { kind: 'meeting', lead: { name: 'Negocio Demo', zone: 'Centro' } }), { cookie: a.cookie });
  assert.equal(logged.status, 200);
  assert.equal((await s.call('POST', `${API}/site`, { id: 's_wave2-prac-01', rep: P, lead: { name: 'Negocio Demo' } }, { cookie: a.cookie })).status, 200);

  // a practice business is never a plain lead.added, and never in the cache an older build would read and export
  assert.equal(s.lines().some((e) => e.type === 'lead.added'), false);
  const made = s.lines().find((e) => e.type === 'practice.lead.added');
  assert.ok(made, 'the practice business has its own event');
  assert.deepEqual([made.lead.company, made.lead.practice, made.lead.by], ['Negocio Demo', true, P]);
  assert.equal(cacheOf(s).some((l) => l.practice || l.company === 'Negocio Demo'), false);
  assert.deepEqual(olderBuild(s.lines(), cacheOf(s)).newLeads, []);
  // this build still knows it, on the practice rep's own screens and after a restart
  assert.equal(logged.json.me.recentLeads[0].name, 'Negocio Demo');
  const reopened = openTeamStore(s.dir, { log: () => {} });
  const back = [...reopened.leads().values()].find((l) => l.company === 'Negocio Demo');
  assert.deepEqual([back.practice, back.app], [true, true]);
  const exported = await s.call('GET', `${API}/export`, undefined, { bearer: 'push-token' });
  assert.deepEqual(exported.json.newLeads, []);

  // removing the practice rep takes its sites out with an event the older build already understands
  assert.equal((await s.call('POST', `${API}/practice/remove`, {}, { cookie: a.cookie })).status, 200);
  const types = s.lines().map((e) => e.type);
  assert.ok(types.lastIndexOf('site.removed') < types.lastIndexOf('rep.practice.removed'), 'the sites go before the practice rep');
  assert.deepEqual(s.lines().filter((e) => e.type === 'site.removed').map((e) => e.siteId), ['s_wave2-prac-01']);
  const older = olderBuild(s.lines(), cacheOf(s));
  assert.deepEqual([older.newLeads, older.sites], [[], []]);
  // and this build agrees after a restart
  const again = openTeamStore(s.dir, { log: () => {} });
  assert.equal(again.state.sites.size, 0);
  assert.equal([...again.leads().values()].some((l) => l.practice), false);
});

test('I1: a practice business written as lead.added during development is still read as practice', () => {
  // the reducer keeps the flag, so the export and the real reps' search leave it out
  const st = emptyState();
  applyEvent(st, { type: 'lead.added', t: '2026-11-20T15:00:00Z', lead: { id: 'APP-OLD00001', company: 'Negocio Viejo', zone: '', city: '', by: 'r_p', practice: true } });
  applyEvent(st, { type: 'practice.lead.added', t: '2026-11-20T15:00:00Z', lead: { id: 'APP-NEW00001', company: 'Negocio Nuevo', zone: '', city: '', by: 'r_p' } });
  assert.deepEqual([st.appLeads.get('APP-OLD00001').practice, st.appLeads.get('APP-NEW00001').practice], [true, true]);
});

test('I2: a site a manager opened from the form is the route\'s site: the rep cannot open a second one', async (t) => {
  const { s, a, ana, idOf } = await setup(t);
  const r = await s.call('POST', `${API}/log`, logBody('wave2-cont-0001', { kind: 'contract', lead: { name: 'Panadería La Espiga', zone: 'Centro' } }), { cookie: ana.cookie });
  assert.equal(r.status, 200);
  const lead = s.lines().find((e) => e.type === 'log').lead.id;
  for (const what of ['contract_sent', 'contract_signed']) await s.call('POST', `${API}/confirm`, { logId: 'wave2-cont-0001', what }, { cookie: a.cookie });
  // the manager's form as it was: the name only, typed another way
  assert.equal((await s.call('POST', `${API}/site`, { id: 's_wave2-mgr-001', rep: await idOf(ana), lead: { name: 'panaderia la espiga' } }, { cookie: a.cookie })).status, 200);
  const ev = s.lines().find((e) => e.type === 'site');
  assert.equal(ev.lead.id, lead, 'the server links the site to the rep\'s business by its name');
  const before = s.lines().length;
  const second = await s.call('POST', `${API}/route/site`, { id: 's_wave2-rep-001', lead, city: 'Panama City' }, { cookie: ana.cookie });
  assert.deepEqual([second.status, second.json.error], [409, 'site_exists']);
  assert.equal(s.lines().length, before);
  const me = await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie });
  assert.equal(me.json.ledger.filter((e) => e.code === 'site_signed').length, 1, 'paid once');
});

test('I3: a manager or an admin who is not acting cannot log, close, pick a goal or mark a meeting as themself; their ladder preview still saves', async (t) => {
  const { s, a, ana, mgr, asP } = await setup(t);
  const before = s.lines().length;
  for (const who of [a, mgr]) {
    for (const [route, body] of [['log', logBody('wave2-boss-0001', { lead: { name: 'Negocio Fantasma', zone: 'Centro' } })], ['close', { tomorrow: 'Visitar más' }], ['goal', { k: 'meetings' }],
      ['play', { logId: 'x', text: 'algo' }], ['held', { logId: 'x' }]]) {
      const r = await s.call('POST', `${API}/${route}`, body, { cookie: who.cookie });
      assert.deepEqual([r.status, r.json.error], [403, 'not_a_player'], route);
    }
  }
  assert.equal(s.lines().length, before, 'nothing appended, no business made');
  // what the manager's own ladder preview sends is unchanged
  assert.equal((await s.call('POST', `${API}/seen`, { video: 'welcome' }, { cookie: a.cookie })).status, 200);
  // a rep logs; acting as the practice rep logs
  assert.equal((await s.call('POST', `${API}/log`, logBody('wave2-rep-00001'), { cookie: ana.cookie })).status, 200);
  const P = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  assert.equal((await s.call('POST', asP('log', P), logBody('wave2-prac-0002'), { cookie: a.cookie })).status, 200);
});

test('M1: while acting, every manager route is refused and nothing is appended', async (t) => {
  const { s, a, ana, asP, idOf } = await setup(t);
  const P = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  const anaId = await idOf(ana);
  await s.call('POST', `${API}/log`, logBody('wave2-real-0001', { kind: 'meeting' }), { cookie: ana.cookie });
  await s.call('POST', `${API}/site`, { id: 's_wave2-real-01', rep: anaId, lead: { name: 'Taller Real' } }, { cookie: a.cookie });
  const before = s.lines().length;
  const calls = [['GET', 'team'], ['POST', 'confirm', { logId: 'wave2-real-0001', what: 'meeting_held' }], ['POST', 'void', { logId: 'wave2-real-0001' }],
    ['POST', 'reopen', { rep: anaId, day: '2026-11-16' }], ['POST', 'reps', { email: 'nuevo@equipo.test', name: 'Nuevo Rep' }], ['POST', `reps/${anaId}`, { patch: { name: 'Otro Nombre' } }],
    ['POST', 'dayoff', { scope: 'all', date: '2026-11-20' }], ['POST', 'site', { rep: anaId, lead: { name: 'Otro Sitio' } }], ['POST', 'site/s_wave2-real-01', { what: 'void' }],
    ['POST', 'badge', { rep: anaId, text: 'Bien' }], ['POST', 'hours', { weeks: [{ week: '2026-11-16', delivered: 60, accepted: 30 }] }], ['POST', 'practice'], ['POST', 'practice/remove']];
  for (const [method, route, body] of calls) {
    const r = await s.call(method, asP(route, P), method === 'POST' ? (body || {}) : undefined, { cookie: a.cookie });
    assert.deepEqual([r.status, r.json.error], [403, 'read_only'], route);
  }
  // acting touches the practice rep's own things only: a real site's install and a real rep's ladder are refused too
  const w = await s.call('POST', asP('install/s_wave2-real-01/workers', P), { id: 'w_wave2real01', name: 'Persona Real', email: 'persona@equipo.test' }, { cookie: a.cookie });
  assert.deepEqual([w.status, w.json.error], [403, 'read_only']);
  const tick = await s.call('POST', asP('ladder', P), { step: 'hour', rep: anaId }, { cookie: a.cookie });
  assert.deepEqual([tick.status, tick.json.error], [403, 'read_only']);
  assert.equal(s.lines().length, before);
  // the same manager calls on the admin's own screens work as before
  assert.equal((await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/practice/remove`, {}, { cookie: a.cookie })).status, 200);
});

test('M3: a practice day closed early still takes logs; a real rep\'s closed day stays locked', async (t) => {
  const { s, a, ana, asP } = await setup(t);
  const P = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  assert.equal((await s.call('POST', asP('log', P), logBody('wave2-prac-0101'), { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', asP('close', P), { tomorrow: 'Seguir mostrando' }, { cookie: a.cookie })).status, 200);
  const after = await s.call('POST', asP('log', P), logBody('wave2-prac-0102', { kind: 'contract', lead: { name: 'Negocio Demo', zone: 'Centro' } }), { cookie: a.cookie });
  assert.equal(after.status, 200);
  assert.equal(after.json.me.today.closed, true);
  assert.equal((await s.call('POST', `${API}/log`, logBody('wave2-rep-00101'), { cookie: ana.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/close`, { tomorrow: 'Visitar más' }, { cookie: ana.cookie })).status, 200);
  const locked = await s.call('POST', `${API}/log`, logBody('wave2-rep-00102', { kind: 'call' }), { cookie: ana.cookie });
  assert.deepEqual([locked.status, locked.json.error], [409, 'day_closed']);
});

test('M5: a site a rep opens with no city typed takes the rep\'s city', async (t) => {
  const { s, a, ana } = await setup(t);
  await s.call('POST', `${API}/log`, logBody('wave2-cont-0201', { kind: 'contract', lead: { name: 'Café Sin Ciudad', zone: 'Centro' } }), { cookie: ana.cookie });
  const lead = s.lines().find((e) => e.type === 'log').lead.id;
  for (const what of ['contract_sent', 'contract_signed']) await s.call('POST', `${API}/confirm`, { logId: 'wave2-cont-0201', what }, { cookie: a.cookie });
  assert.equal((await s.call('POST', `${API}/route/site`, { id: 's_wave2-city-01', lead, city: '' }, { cookie: ana.cookie })).status, 200);
  assert.equal(s.lines().find((e) => e.type === 'site').city, 'Panama City');
});

test('M6: a document address with an account in it is refused; a document past the last order is kept, not dropped', async (t) => {
  const { s, a } = await setup(t);
  const doc = (over = {}) => ({ title: { es: 'Documento de ejemplo', en: 'Sample document' }, note: { es: '', en: '' }, url: 'https://example.com/ejemplo-1', group: 'vender', lang: 'both', ...over });
  for (const url of ['https://usuario:clave@example.com/x', 'https://usuario@example.com/x']) {
    const r = await s.call('POST', `${API}/docs`, doc({ url }), { cookie: a.cookie });
    assert.deepEqual([r.status, r.json.error], [400, 'doc_url'], url);
  }
  assert.equal((await s.call('POST', `${API}/docs`, doc({ order: 9999 }), { cookie: a.cookie })).status, 200);
  s.time.now += 1000;   // two documents at the end share the last number and sort by age
  const r = await s.call('POST', `${API}/docs`, doc({ url: 'https://example.com/ejemplo-2', title: { es: 'Segundo ejemplo', en: 'Second sample' } }), { cookie: a.cookie });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.groups[0].docs.map((d) => d.title.es), ['Documento de ejemplo', 'Segundo ejemplo']);
});
