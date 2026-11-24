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
