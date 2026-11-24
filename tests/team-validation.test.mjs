// What the API refuses even though the screens never send it: a request is checked whole, whoever made it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';

const API = '/equipo/api';

test('the first approved hour is marked only on an installed site (a legacy one was installed before the app)', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  const site = (body) => s.call('POST', `${API}/site`, body, { cookie: a.cookie });
  const manage = (id, what) => s.call('POST', `${API}/site/${id}`, { what }, { cookie: a.cookie });
  await site({ id: 's_not-installed-1', rep: m.id, lead: { name: 'Sitio Crudo' } });
  const early = await manage('s_not-installed-1', 'first_hour');
  assert.deepEqual([early.status, early.json.error], [409, 'not_installed']);
  assert.equal(s.lines().some((e) => e.type === 'site.step'), false);
  const pending = (await s.call('GET', `${API}/me`, undefined, { cookie: m.cookie })).json.ledger.find((e) => e.code === 'site_first_hour');
  assert.equal(pending.status, 'pending', 'no 30 points for an hour on a site that records nothing yet');
  assert.equal((await manage('s_not-installed-1', 'installed')).status, 200);
  assert.equal((await manage('s_not-installed-1', 'first_hour')).status, 200);
  assert.equal((await s.call('GET', `${API}/me`, undefined, { cookie: m.cookie })).json.ledger.find((e) => e.code === 'site_first_hour').status, 'earned');
  await site({ id: 's_legacy-site-01', rep: m.id, lead: { name: 'Sitio Viejo' }, legacy: true });
  assert.equal((await manage('s_legacy-site-01', 'first_hour')).status, 200);
});

test('a meeting or contract date is kept only as a real day from 30 days back to 120 days ahead; any other is dropped and the log stands', async (t) => {
  const s = await start(); t.after(() => s.srv.close());   // Monday 16 Nov 2026
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  let n = 0;
  const log = (when, kind = 'meeting') => { n += 1; return s.call('POST', `${API}/log`, logBody(`when-log-${String(n).padStart(4, '0')}`, { kind, channel: kind === 'meeting' ? 'call' : undefined, contact: 'Sr. X', when, lead: { name: `Bar ${n}`, zone: 'Centro' } }), { cookie: m.cookie }); };
  const bad = ['2099-12-31', '2026-02-31', '2026-13-01', '2026/11/20', '2026-10-16', '2027-03-17', 20261120, { day: 1 }];
  for (const when of bad) assert.equal((await log(when)).status, 200, JSON.stringify(when));
  assert.equal((await log('2099-12-31', 'contract')).status, 200);
  for (const when of ['2026-10-17', '2027-03-16', undefined, '']) assert.equal((await log(when)).status, 200, String(when));
  const stored = s.lines().filter((e) => e.type === 'log').map((e) => e.when);
  assert.deepEqual(stored, [...bad.map(() => undefined), undefined, '2026-10-17', '2027-03-16', undefined, undefined]);
  // the export never carries a date that is not a real one, and a meeting with none waits from the day it was booked
  const ex = (await s.call('GET', `${API}/export?since=2026-11-01T00:00:00Z`, undefined, { bearer: 'push-token' })).json;
  assert.deepEqual(ex.logs.filter((l) => l.when).map((l) => l.when), ['2026-10-17', '2027-03-16']);
  s.time.now += 15 * 86400000;
  const waiting = (await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json.needs.confirm;
  assert.deepEqual(waiting.map((c) => c.when), ['2027-03-16'], 'the 2099 meeting expired like any other, two weeks after it was booked');
  // a repeat the same day with a bad date keeps the good one
  s.time.now -= 15 * 86400000;
  const again = await s.call('POST', `${API}/log`, logBody('when-log-9999', { kind: 'meeting', channel: 'call', when: '2099-01-01', note: 'otra vez', lead: { name: 'Bar 10', zone: 'Centro' } }), { cookie: m.cookie });
  assert.deepEqual([again.json.repeat, again.json.updated], [true, true]);
  assert.equal(s.lines().filter((e) => e.type === 'log.update').at(-1).patch.when, undefined);
});

test('a site is opened for someone active on the team: never for a leader (who reads only) nor for someone taken off it', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  const lia = await s.addRep(a.cookie, 'lia', { role: 'leader' }), gone = await s.addRep(a.cookie, 'exrep');
  assert.equal((await s.call('POST', `${API}/reps/${gone.id}`, { patch: { active: false } }, { cookie: a.cookie })).status, 200);
  const site = (id, rep) => s.call('POST', `${API}/site`, { id, rep, lead: { name: 'Sitio Uno' } }, { cookie: a.cookie });
  for (const [id, rep] of [['s_leaders-site-01', lia.id], ['s_gone-site-0001', gone.id], ['s_nobody-site-01', 'r_nadie']]) {
    const r = await site(id, rep);
    assert.deepEqual([r.status, r.json.error], [400, 'fields'], rep);
  }
  assert.equal(s.lines().some((e) => e.type === 'site'), false);
  // a rep, the admin (a lone admin opens sites for themself) and the practice rep, as before
  const prac = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.id;
  for (const [id, rep] of [['s_reps-site-0001', m.id], ['s_admins-site-01', a.id], ['s_pracs-site-001', prac]]) assert.equal((await site(id, rep)).status, 200, rep);
});
