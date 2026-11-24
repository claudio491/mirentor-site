// A business added in the app has a temporary id (APP-...) until the CRM bridge gives it the CRM's own (POST leadmap).
// Everything that named the temporary id follows the mapping: the logs, the site opened for it, and what a phone that
// still holds the old id sends afterwards.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };

/** A rep with a signed contract on a business they added in the app. Answers the business's temporary id. */
async function signedNewBusiness(s, a, rep) {
  const log = await s.call('POST', `${API}/log`, logBody('lead-new-0001', { kind: 'contract', lead: { name: 'Hotel Nuevo', zone: 'Centro' } }), { cookie: rep.cookie });
  assert.equal(log.status, 200, log.text);
  for (const what of ['contract_sent', 'contract_signed']) assert.equal((await s.call('POST', `${API}/confirm`, { logId: 'lead-new-0001', what }, { cookie: a.cookie })).status, 200);
  return s.lines().find((e) => e.type === 'lead.added').lead.id;
}

test('leadmap: the site opened for a business added in the app follows it to its CRM id, so it is not opened (and paid) twice', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario'), R = { cookie: m.cookie };
  const temp = await signedNewBusiness(s, a, m);
  assert.equal((await s.call('POST', `${API}/route/site`, { lead: temp, id: 's_first-site-01' }, R)).status, 200);
  assert.equal((await s.call('POST', `${API}/leadmap`, { pairs: [[temp, 'PA-0777']] }, B)).json.mapped, 1);
  const check = async (srv) => {
    const route = (await srv.call('GET', `${API}/route?lead=PA-0777`, undefined, R)).json.route;
    assert.deepEqual([route.site && route.site.id, route.stops[route.at].key, route.stops[route.at].status], ['s_first-site-01', 'phones', 'wait']);
    const second = await srv.call('POST', `${API}/route/site`, { lead: 'PA-0777', id: 's_second-site-1' }, R);
    assert.deepEqual([second.status, second.json.error], [409, 'site_exists']);
    const me = (await srv.call('GET', `${API}/me`, undefined, R)).json;
    assert.equal(me.ledger.filter((e) => e.code === 'site_signed').length, 1);
    assert.deepEqual(me.routes.map((x) => [x.lead.id, x.site && x.site.id]), [['PA-0777', 's_first-site-01']]);
    assert.equal((await srv.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json.sites.find((x) => x.id === 's_first-site-01').lead.id, 'PA-0777');
  };
  await check(s);
  s.srv.close();
  const back = await start({ dir: s.dir, clock: s.time.now }); t.after(() => back.srv.close());
  await check(back);   // the log replays to the same
});
