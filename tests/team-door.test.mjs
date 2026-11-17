// The board lives inside the sales portal and has no sign-in of its own: these tests run both modules together, the
// way the service mounts them, with Google played by the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createSales } from '../lib/sales.mjs';
import { startTeam } from '../lib/team/api.mjs';

const CLIENT = 'cid.apps.googleusercontent.com', TOKEN = 'a-token-for-this-test';
const BOARD = '/ventas/equipo';
// The "credential" a test posts is the address Google should vouch for.
const google = async (credential) => ({ aud: CLIENT, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600),
  email_verified: 'true', email: credential, hd: credential.endsWith('@mirentor.com') ? 'mirentor.com' : undefined, given_name: 'X' });

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-door-')), root = path.join(dir, 'portal');
  mkdirSync(root); writeFileSync(path.join(root, 'index.html'), '<p>portal home</p>');
  const said = [];
  const sales = createSales({ clientId: CLIENT, secret: 'a-secret-for-this-test', root, verify: google });
  const team = startTeam({ TEAM_ENABLED: '1', TEAM_PUSH_TOKEN: TOKEN }, dir, { sales, log: (m) => said.push(String(m)) });
  const srv = createServer({ store: openStore(dir), sheets: null, origins: [], sales, team, log: (m) => said.push(String(m)) });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, p, body, { cookie, bearer, headers = {} } = {}) => {
    const h = { ...headers };
    if (body !== undefined) h['content-type'] = 'application/json';
    if (cookie) h.cookie = cookie;
    if (bearer) h.authorization = `Bearer ${bearer}`;
    const r = await fetch(`${url}${p}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: 'manual' });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* a page */ }
    return { status: r.status, json, text, headers: r.headers, cookie: (r.headers.get('set-cookie') || '').split(';')[0] || null };
  };
  /** Google's button on the sign-in page hands the page a credential; the page posts it to the address it is on. */
  const signIn = (email, at = `${BOARD}/auth`) => call('POST', at, { credential: email }, { headers: { 'x-sales-login': '1' } });
  const admin = async () => {
    await call('POST', `${BOARD}/api/bootstrap`, { email: 'jefe@mirentor.com', name: 'Jefe Uno' }, { bearer: TOKEN });
    return (await signIn('jefe@mirentor.com')).cookie;
  };
  return { srv, url, call, signIn, admin, said, dir };
}

test('without a session the board\'s address shows the portal sign-in and tells nothing', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const bare = await s.call('GET', BOARD);
  assert.deepEqual([bare.status, bare.headers.get('location')], [301, `${BOARD}/`]);
  const door = await s.call('GET', `${BOARD}/`);
  assert.equal(door.status, 200);
  assert.match(door.text, /g_id_onload/);
  assert.match(door.headers.get('content-security-policy'), /accounts\.google\.com/);
  const me = await s.call('GET', `${BOARD}/api/me`);
  assert.deepEqual([me.status, me.json.error], [401, 'session']);
  assert.deepEqual(s.said, []);
});

test('one sign-in at the board\'s address opens the board and the portal', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  await s.call('POST', `${BOARD}/api/bootstrap`, { email: 'jefe@mirentor.com', name: 'Jefe Uno' }, { bearer: TOKEN });
  const inn = await s.signIn('jefe@mirentor.com');
  assert.equal(inn.status, 200);
  assert.match(inn.cookie, /^msales=/);
  assert.match(inn.headers.get('set-cookie'), /Path=\/ventas; .*HttpOnly; Secure; SameSite=Lax/);
  const page = await s.call('GET', `${BOARD}/`, undefined, { cookie: inn.cookie });
  assert.equal(page.status, 200);
  assert.match(page.text, /src="app\.js"/);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /google/);
  const me = await s.call('GET', `${BOARD}/api/me`, undefined, { cookie: inn.cookie });
  assert.deepEqual([me.status, me.json.viewer.email, me.json.me.role], [200, 'jefe@mirentor.com', 'admin']);
  assert.equal((await s.call('GET', '/ventas/', undefined, { cookie: inn.cookie })).text, '<p>portal home</p>');
  // The other way round: a session started at the portal's own door opens the board too.
  const viaPortal = await s.signIn('jefe@mirentor.com', '/ventas/auth');
  assert.equal((await s.call('GET', `${BOARD}/api/me`, undefined, { cookie: viaPortal.cookie })).status, 200);
});

test('a company account that is not on the team is told so, with the account it used, and sees nobody\'s numbers', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const boss = await s.admin();
  const other = await s.signIn('otra@mirentor.com');
  assert.equal(other.status, 200);   // the portal lets the whole company in
  const me = await s.call('GET', `${BOARD}/api/me`, undefined, { cookie: other.cookie });
  assert.deepEqual([me.status, me.json.error, me.json.email], [403, 'not_on_team', 'otra@mirentor.com']);
  assert.equal((await s.call('GET', `${BOARD}/api/team`, undefined, { cookie: other.cookie })).status, 403);
  assert.equal((await s.call('POST', `${BOARD}/api/log`, { id: 'aaaa0001', kind: 'talk', lead: { name: 'Uno' } }, { cookie: other.cookie })).status, 403);
  // An account outside the company never gets a session at all.
  const outside = await s.signIn('alguien@otra.test');
  assert.deepEqual([outside.status, outside.cookie], [403, null]);
  assert.equal((await s.call('GET', `${BOARD}/api/me`, undefined, { cookie: boss })).status, 200);
});

test('a person taken off the team loses the board at once and gets it back when they return', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const boss = await s.admin();
  const added = await s.call('POST', `${BOARD}/api/reps`, { email: 'vendedor.uno@mirentor.com', name: 'Vendedor Uno', country: 'PA', city: 'Panama City' }, { cookie: boss });
  assert.equal(added.status, 200);
  const rep = (await s.signIn('vendedor.uno@mirentor.com')).cookie;
  const me = () => s.call('GET', `${BOARD}/api/me`, undefined, { cookie: rep });
  assert.equal((await me()).status, 200);
  await s.call('POST', `${BOARD}/api/reps/${added.json.id}`, { patch: { active: false } }, { cookie: boss });
  assert.deepEqual([(await me()).status, (await me()).json.error], [403, 'not_on_team']);
  await s.call('POST', `${BOARD}/api/reps/${added.json.id}`, { patch: { active: true } }, { cookie: boss });
  assert.equal((await me()).status, 200);
});

test('signing out at the board ends the portal session', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const boss = await s.admin();
  const out = await s.call('GET', `${BOARD}/salir`, undefined, { cookie: boss });
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /^msales=; Path=\/ventas; Max-Age=0/);
});

test('the board stays off without the portal, and says why', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-door-off-')), said = [];
  assert.equal(startTeam({ TEAM_ENABLED: '1' }, dir, { sales: null, log: (m) => said.push(String(m)) }), null);
  assert.equal(said.length, 1);
  assert.match(said[0], /portal/);
  const sales = createSales({ clientId: CLIENT, secret: 'a-secret-for-this-test', root: dir, verify: google });
  assert.equal(startTeam({}, dir, { sales }), null);
  assert.equal(typeof startTeam({ TEAM_ENABLED: 'true' }, dir, { sales }), 'function');
});
