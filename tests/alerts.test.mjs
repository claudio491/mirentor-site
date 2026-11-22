import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createAlerts } from '../lib/alerts.mjs';
import { parseEntry } from '../lib/entry.mjs';

// Wed 2026-11-25 10:00 in Panama (UTC-5) is 15:00 UTC.
const WED_10 = Date.parse('2026-11-25T15:00:00Z');
const MIN = 60_000;
const CLAUDIO = 'UCLAUDIO';

const CONFIG = {
  mode: 'live',
  slackToken: 'xoxb-test',
  claudio: CLAUDIO,
  reps: { uno: { name: 'Rep Uno', slack: 'UREP1' }, dos: { name: 'Rep Dos', slack: 'UREP2' }, tres: { name: 'Rep Tres', slack: 'UREP3' } },
  routes: { 'Panama City': ['uno', 'dos', 'tres'] },
};

/** A Slack Web API stand-in: DMs get channel D<user>, every post gets a ts, replies are what the test adds. */
function fakeSlack() {
  const posts = [];
  const replies = new Map();
  let n = 0;
  const api = async (method, payload) => {
    if (method === 'conversations.open') return { ok: true, channel: { id: `D${payload.users}` } };
    if (method === 'chat.postMessage') {
      const ts = `${1000 + ++n}.000`;
      posts.push({ ...payload, ts });
      return { ok: true, ts, channel: payload.channel };
    }
    if (method === 'conversations.replies') return { ok: true, messages: [{ ts: payload.ts, bot_id: 'B1' }, ...(replies.get(payload.ts) || [])] };
    return { ok: false, error: 'unknown_method' };
  };
  const to = (user) => posts.filter((p) => p.channel === `D${user}`);
  const reply = (ts, user, text = 'lo tomo') => replies.set(ts, [...(replies.get(ts) || []), { ts: `${ts}1`, user, text }]);
  return { api, posts, to, reply };
}

function entry(over = {}, id = '3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b') {
  const r = parseEntry({ id, lang: 'es', business: 'Bodega Ejemplo', workers: '120', industry: 'warehouse', city: 'Panamá', country: 'PA',
    contact: 'Contacto Prueba', email: 'prueba@example.com', whatsapp: '+507 6123-4567', pay_ack: 'yes', site_wifi: 'yes', site_lead: 'yes', ...over }, new Date(WED_10));
  return r.entry;
}
const ids = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222', '33333333-3333-4333-8333-333333333333', '44444444-4444-4444-8444-444444444444'];

function setup({ config = CONFIG, dir = mkdtempSync(path.join(tmpdir(), 'al-')), slack = fakeSlack(), at = WED_10 } = {}) {
  const clock = { t: at };
  const alerts = createAlerts({ dir, api: slack.api, now: () => clock.t, log: () => {} });
  if (config) alerts.configure(config);
  return { alerts, slack, clock, dir };
}

test('a sign-up in a routed city reaches the first rep at once, with Claudio copied', async () => {
  const { alerts, slack } = setup();
  await alerts.onEntry(entry());
  const [dm] = slack.to('UREP1');
  assert.ok(dm, 'Rep Uno got a DM');
  assert.match(dm.text, /Bodega Ejemplo/);
  assert.match(dm.text, /Panama City/);
  assert.match(dm.text, /wa\.me\/50761234567/);
  assert.match(dm.text, /lo tomo/);
  assert.match(dm.text, /Rep Dos/, 'names the backup');
  assert.doesNotMatch(dm.text, /[—–]/, 'no em or en dashes');
  assert.equal(slack.to(CLAUDIO).length, 1);
  assert.match(slack.to(CLAUDIO)[0].text, /Rep Uno/);
});

test('sign-ups rotate across the reps of the city, and the rotation survives a restart', async () => {
  const s = setup();
  await s.alerts.onEntry(entry({}, ids[0]));
  await s.alerts.onEntry(entry({}, ids[1]));
  const again = createAlerts({ dir: s.dir, api: s.slack.api, now: () => s.clock.t, log: () => {} });
  await again.onEntry(entry({}, ids[2]));
  await again.onEntry(entry({}, ids[3]));
  assert.deepEqual([s.slack.to('UREP1').length, s.slack.to('UREP2').length, s.slack.to('UREP3').length], [2, 1, 1]);
});

test('the same sign-up is announced only once, even after a restart', async () => {
  const s = setup();
  await s.alerts.onEntry(entry());
  await s.alerts.onEntry(entry());
  const again = createAlerts({ dir: s.dir, api: s.slack.api, now: () => s.clock.t, log: () => {} });
  await again.onEntry(entry());
  assert.equal(s.slack.to('UREP1').length, 1);
});

test('a reply in the thread counts as taken: Claudio hears who and how fast, nobody else is paged', async () => {
  const { alerts, slack, clock } = setup();
  await alerts.onEntry(entry());
  const dm = slack.to('UREP1')[0];
  clock.t += 6 * MIN;
  slack.reply(dm.ts, 'UREP1');
  await alerts.tick();
  clock.t += 20 * MIN;
  await alerts.tick();
  assert.equal(slack.to('UREP2').length, 0);
  const last = slack.to(CLAUDIO).at(-1);
  assert.match(last.text, /Rep Uno lo tomó en 6 min/);
  assert.equal(alerts.list()[0].takenBy, 'uno');
});

test('no answer in 15 minutes passes it to the backup; no answer in 30 tells Claudio nobody took it', async () => {
  const { alerts, slack, clock } = setup();
  await alerts.onEntry(entry());
  clock.t += 14 * MIN;
  await alerts.tick();
  assert.equal(slack.to('UREP2').length, 0, 'not yet at 14 minutes');
  clock.t += 1 * MIN;
  await alerts.tick();
  assert.equal(slack.to('UREP2').length, 1, 'backup paged at 15');
  assert.match(slack.to('UREP2')[0].text, /Rep Uno no respondió/);
  await alerts.tick();
  assert.equal(slack.to('UREP2').length, 1, 'paged once');
  clock.t += 15 * MIN;
  await alerts.tick();
  assert.match(slack.to(CLAUDIO).at(-1).text, /Nadie tomó/);
  await alerts.tick();
  assert.equal(slack.to(CLAUDIO).filter((p) => /Nadie tomó/.test(p.text)).length, 1);
});

test('after the backup is paged, a late reply from the first rep still counts', async () => {
  const { alerts, slack, clock } = setup();
  await alerts.onEntry(entry());
  clock.t += 16 * MIN;
  await alerts.tick();
  slack.reply(slack.to('UREP1')[0].ts, 'UREP1');
  await alerts.tick();
  assert.equal(alerts.list()[0].takenBy, 'uno');
});

test('outside working hours the alert waits for 8:00 Panama time and the clock starts then', async () => {
  // Sat 2026-11-28 19:30 Panama = Sun 00:30 UTC; Sunday is off, so it goes out Monday 8:00 (13:00 UTC).
  const { alerts, slack, clock } = setup({ at: Date.parse('2026-11-29T00:30:00Z') });
  await alerts.onEntry(entry());
  assert.equal(slack.to('UREP1').length, 0);
  assert.match(slack.to(CLAUDIO)[0].text, /lunes 8:00/);
  clock.t = Date.parse('2026-11-30T12:59:00Z');
  await alerts.tick();
  assert.equal(slack.to('UREP1').length, 0);
  clock.t = Date.parse('2026-11-30T13:00:00Z');
  await alerts.tick();
  assert.equal(slack.to('UREP1').length, 1);
  clock.t += 15 * MIN;
  await alerts.tick();
  assert.equal(slack.to('UREP2').length, 1);
});

test('a city with no rep goes to Claudio alone', async () => {
  const { alerts, slack } = setup();
  await alerts.onEntry(entry({ city: 'Lima', country: 'PE' }));
  assert.equal(slack.posts.length, 1);
  assert.equal(slack.posts[0].channel, `D${CLAUDIO}`);
  assert.match(slack.posts[0].text, /Lima/);
  assert.match(slack.posts[0].text, /sin vendedor/);
});

test('test mode sends every message to Claudio only, saying who it would have reached', async () => {
  const { alerts, slack, clock } = setup({ config: { ...CONFIG, mode: 'test' } });
  await alerts.onEntry(entry());
  clock.t += 15 * MIN;
  await alerts.tick();
  assert.ok(slack.posts.length >= 3);
  assert.ok(slack.posts.every((p) => p.channel === `D${CLAUDIO}`));
  assert.match(slack.posts[0].text, /PRUEBA.*Rep Uno/);
  assert.ok(slack.posts.some((p) => /PRUEBA.*Rep Dos/.test(p.text)));
});

test('in test mode Claudio replying in the thread stands in for the rep', async () => {
  const { alerts, slack, clock } = setup({ config: { ...CONFIG, mode: 'test' } });
  await alerts.onEntry(entry());
  clock.t += 3 * MIN;
  slack.reply(slack.posts[0].ts, CLAUDIO);
  await alerts.tick();
  assert.equal(alerts.list()[0].takenBy, 'uno');
});

test('off or without a config nothing is sent; a Slack failure never throws', async () => {
  const off = setup({ config: null });
  await off.alerts.onEntry(entry());
  assert.equal(off.slack.posts.length, 0);
  const failing = setup({ slack: { api: async () => { throw new Error('network'); }, posts: [], to: () => [] } });
  await failing.alerts.onEntry(entry());
  await failing.alerts.tick();
});

test('the config file is private and the token never comes back out', async () => {
  const { alerts, dir } = setup();
  assert.equal(statSync(path.join(dir, 'alerts-config.json')).mode & 0o777, 0o600);
  const shown = JSON.stringify(alerts.publicConfig());
  assert.doesNotMatch(shown, /xoxb/);
  assert.match(shown, /"slackToken":"set"/);
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'alerts-config.json'), 'utf8')).slackToken, 'xoxb-test');
});

test('configure rejects a route to an unknown rep and a bad mode', () => {
  const { alerts } = setup({ config: null });
  assert.throws(() => alerts.configure({ ...CONFIG, routes: { 'Panama City': ['ghost'] } }), /ghost/);
  assert.throws(() => alerts.configure({ ...CONFIG, mode: 'loud' }), /mode/);
});

test('a partial configure keeps the stored token', () => {
  const { alerts } = setup();
  alerts.configure({ mode: 'test' });
  assert.equal(alerts.publicConfig().slackToken, 'set');
  assert.equal(alerts.publicConfig().mode, 'test');
});

// ---- through the server ----
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';

const ORIGIN = 'https://mirentor.onrender.com';
async function serve() {
  const dir = mkdtempSync(path.join(tmpdir(), 'als-'));
  const slack = fakeSlack();
  const alerts = createAlerts({ dir, api: slack.api, now: () => WED_10, log: () => {} });
  const srv = createServer({ store: openStore(dir), sheets: null, origins: [ORIGIN], adminToken: 'admin-secret', alerts });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (over = {}) => fetch(`${url}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ id: ids[0], lang: 'es', business: 'Bodega Ejemplo', workers: '120', industry: 'warehouse', city: 'Panamá', country: 'PA',
      contact: 'Contacto', email: 'prueba@example.com', whatsapp: '', pay_ack: 'yes', site_wifi: 'yes', site_lead: 'no', website: '', ...over }) });
  const admin = (p, init = {}, token = 'admin-secret') => fetch(`${url}${p}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers || {}) } });
  return { srv, slack, post, admin, alerts };
}
const settle = () => new Promise((r) => setTimeout(r, 20));

test('server: the config endpoint needs the token, takes a PUT and never shows the Slack token', async (t) => {
  const s = await serve(); t.after(() => s.srv.close());
  assert.equal((await s.admin('/api/alerts/config', {}, 'wrong')).status, 401);
  assert.equal((await fetch(`http://127.0.0.1:${s.srv.address().port}/api/alerts/config`)).status, 401);
  const put = await s.admin('/api/alerts/config', { method: 'PUT', body: JSON.stringify(CONFIG) });
  assert.equal(put.status, 200);
  const got = await (await s.admin('/api/alerts/config')).json();
  assert.equal(got.config.slackToken, 'set');
  assert.doesNotMatch(JSON.stringify(got), /xoxb/);
  const bad = await s.admin('/api/alerts/config', { method: 'PUT', body: JSON.stringify({ mode: 'loud' }) });
  assert.equal(bad.status, 400);
});

test('server: a new sign-up alerts once, a repeat post does not, and the visitor is answered either way', async (t) => {
  const s = await serve(); t.after(() => s.srv.close());
  await s.admin('/api/alerts/config', { method: 'PUT', body: JSON.stringify(CONFIG) });
  assert.equal((await s.post()).status, 202);
  assert.equal((await s.post()).status, 202);
  await settle();
  assert.equal(s.slack.to('UREP1').length, 1);
  assert.match(s.slack.to('UREP1')[0].text, /no cumple todavía/);
  const list = await (await s.admin('/api/alerts')).json();
  assert.equal(list.alerts.length, 1);
});

test('the daily form check (city TEST) is ignored unless TEST has a route', async () => {
  const s = setup();
  await s.alerts.onEntry(entry({ city: 'TEST', country: 'other' }));
  assert.equal(s.slack.posts.length, 0);
  const r = setup({ config: { ...CONFIG, mode: 'test', routes: { ...CONFIG.routes, TEST: ['uno', 'dos'] } } });
  await r.alerts.onEntry(entry({ city: 'TEST', country: 'other' }));
  assert.match(r.slack.posts[0].text, /PRUEBA.*Rep Uno/);
});

test('slackApi sends a form with the token as a header, so read methods accept it', async () => {
  const { slackApi } = await import('../lib/alerts.mjs');
  let seen;
  const api = slackApi(async (url, init) => { seen = { url, init }; return new Response('{"ok":true}'); });
  const r = await api('conversations.replies', { channel: 'D1', ts: '1.2', limit: 20 }, 'xoxb-t');
  assert.equal(r.ok, true);
  assert.equal(seen.url, 'https://slack.com/api/conversations.replies');
  assert.equal(seen.init.headers.authorization, 'Bearer xoxb-t');
  assert.equal(seen.init.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.equal(String(seen.init.body), 'channel=D1&ts=1.2&limit=20');
});
