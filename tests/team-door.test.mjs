// The board lives inside the sales portal and has no sign-in of its own: these tests run both modules together, the
// way the service mounts them, with Google played by the test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createSales } from '../lib/sales.mjs';
import { startTeam, createTeam } from '../lib/team/api.mjs';
import { LEAVE } from '../team/door.js';

const CLIENT = 'cid.apps.googleusercontent.com', TOKEN = 'a-token-for-this-test';
const BOARD = '/ventas/equipo';
// The "credential" a test posts is the address Google should vouch for.
const google = async (credential) => ({ aud: CLIENT, iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600),
  email_verified: 'true', email: credential, hd: credential.endsWith('@mirentor.com') ? 'mirentor.com' : undefined, given_name: 'X' });

async function start({ env = {}, host = '' } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-door-')), root = path.join(dir, 'portal');
  mkdirSync(root); writeFileSync(path.join(root, 'index.html'), '<p>portal home</p>');
  const said = [];
  const sales = createSales({ clientId: CLIENT, secret: 'a-secret-for-this-test', root, host, verify: google });
  const team = startTeam({ TEAM_ENABLED: '1', TEAM_PUSH_TOKEN: TOKEN, SALES_HOST: host, ...env }, dir, { sales, log: (m) => said.push(String(m)) });
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
  /** A request that names the host it is for, the way a browser on another address would. */
  const from = (hostname, method, p, body, cookie) => new Promise((ok, no) => {
    const text = body === undefined ? null : JSON.stringify(body);
    const req = http.request(`${url}${p}`, { method, headers: { host: hostname, 'x-forwarded-proto': 'https', ...(text === null ? {} : { 'content-type': 'application/json', 'x-sales-login': '1' }), ...(cookie ? { cookie } : {}) } }, (res) => {
      let got = ''; res.on('data', (c) => { got += c; }); res.on('end', () => { let json = null; try { json = JSON.parse(got); } catch { /* a page */ } ok({ status: res.statusCode, text: got, json, location: res.headers.location || null, set: String(res.headers['set-cookie'] || ''), cookie: String(res.headers['set-cookie'] || '').split(';')[0] || null }); });
    });
    req.on('error', no); req.end(text === null ? undefined : text);
  });
  return { srv, url, call, signIn, admin, from, said, dir };
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
  const out = await s.call('GET', `${BOARD}/${LEAVE}`, undefined, { cookie: boss });   // the address the app itself goes to
  assert.equal(out.status, 303);
  assert.match(out.headers.get('set-cookie'), /^msales=; Path=\/ventas; Max-Age=0/);
  // and it comes back to the board's own address, so signing in again lands on the board, not on the portal's home
  assert.equal(out.headers.get('location'), `${BOARD}/`);
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

test('who a request is comes from the portal\'s cookie and from nothing else in the request', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const boss = await s.admin();
  const bossId = (await s.call('GET', `${BOARD}/api/me`, undefined, { cookie: boss })).json.viewer.id;
  await s.call('POST', `${BOARD}/api/reps`, { email: 'vendedor.uno@mirentor.com', name: 'Vendedor Uno', country: 'PA', city: 'Panama City' }, { cookie: boss });
  const rep = (await s.signIn('vendedor.uno@mirentor.com')).cookie;
  const me = await s.call('GET', `${BOARD}/api/me?as=${bossId}&id=${bossId}&quien=${bossId}&email=jefe@mirentor.com`, undefined, { cookie: `${rep}; who=jefe%40mirentor.com; cancha_dev=${bossId}` });
  assert.deepEqual([me.status, me.json.viewer.email, me.json.viewer.role, me.json.viewer.as, me.json.me.name], [200, 'vendedor.uno@mirentor.com', 'rep', null, 'Vendedor Uno']);
  // a second cookie with the admin's name on it is not a session
  const forged = await s.call('GET', `${BOARD}/api/me`, undefined, { cookie: `msales=${Buffer.from('jefe@mirentor.com').toString('base64url')}.9999999999.x` });
  assert.equal(forged.status, 401);
  // naming the person directly is for a preview on one machine: a real mount never takes it
  const dir = mkdtempSync(path.join(tmpdir(), 'team-door-id-'));
  const real = createTeam({ dir, identify: () => ({ id: 'r_x' }), pushToken: TOKEN }), preview = createTeam({ dir: mkdtempSync(path.join(tmpdir(), 'team-door-id-')), identify: () => ({ id: 'r_x' }), pushToken: TOKEN, dev: true });
  const ask = (team) => new Promise((ok) => { const res = { writeHead(status) { this.status = status; return this; }, end(body) { ok([this.status, JSON.parse(body).error]); } }; team({ method: 'GET', url: '/equipo/api/me', headers: {}, socket: {} }, res, '/equipo/api/me'); });
  assert.deepEqual([await ask(real), await ask(preview)], [[401, 'session'], [403, 'not_on_team']]);
});

test('behind the site\'s rewrite a write passes when its origin is one the service allows, and only then', async (t) => {
  const s = await start({ env: { ALLOWED_ORIGINS: 'https://www.mirentor.com' } }); t.after(() => s.srv.close());
  const boss = await s.admin();
  const add = (n, origin) => s.call('POST', `${BOARD}/api/reps`, { email: `persona.${n}@mirentor.com`, name: `Persona ${n}`, country: 'PA', city: 'Panama City' }, { cookie: boss, headers: origin ? { origin } : {} });
  // the browser is on www, the service sees its own address as the host
  assert.equal((await add(1, 'https://www.mirentor.com')).status, 200);
  const evil = await add(2, 'https://evil.example');
  assert.deepEqual([evil.status, evil.json.error], [403, 'origin']);
  assert.equal((await add(3, 'null')).status, 403);
  // opened at the service's own address, the origin is the host: no list is needed for that
  assert.equal((await add(4, s.url)).status, 200);
  const plain = await start(); t.after(() => plain.srv.close());
  const boss2 = await plain.admin();
  const add2 = (origin) => plain.call('POST', `${BOARD}/api/reps`, { email: 'persona.5@mirentor.com', name: 'Persona 5', country: 'PA', city: 'Panama City' }, { cookie: boss2, headers: { origin } });
  assert.deepEqual([(await add2('https://www.mirentor.com')).status, (await add2(plain.url)).status], [403, 200]);
});

test('on the portal\'s own host the board borrows the door where the portal keeps it there', async (t) => {
  const HOST = 'ventas.ejemplo.test';
  const s = await start({ host: HOST }); t.after(() => s.srv.close());
  await s.call('POST', `${BOARD}/api/bootstrap`, { email: 'jefe@mirentor.com', name: 'Jefe Uno' }, { bearer: TOKEN });
  const door = await s.from(HOST, 'GET', `${BOARD}/`);
  assert.equal(door.status, 200);
  assert.match(door.text, /g_id_onload/);
  const inn = await s.from(HOST, 'POST', `${BOARD}/auth`, { credential: 'jefe@mirentor.com' });
  assert.equal(inn.status, 200);
  assert.match(inn.set, /^msales=[^;]+; Path=\/; /);   // on its own host the portal sits at the root, and so does its cookie
  assert.equal((await s.from(HOST, 'GET', `${BOARD}/api/me`, undefined, inn.cookie)).json.viewer.email, 'jefe@mirentor.com');
  const out = await s.from(HOST, 'GET', `${BOARD}/salir`, undefined, inn.cookie);
  assert.deepEqual([out.status, out.location], [303, `${BOARD}/`]);
  assert.match(out.set, /^msales=; Path=\/; Max-Age=0/);
  // the same service asked by another name keeps the portal under /ventas, as before
  assert.match((await s.signIn('jefe@mirentor.com')).headers.get('set-cookie'), /Path=\/ventas; /);
});

test('the board\'s own key, and the desk\'s while the callers move over: the desk\'s is named in the log, then refused once TEAM_TOKEN_ONLY is set', async (t) => {
  const moving = await start({ env: { DESK_PUSH_TOKEN: 'the-desk-key' } }); t.after(() => moving.srv.close());
  assert.equal((await moving.call('GET', `${BOARD}/api/export?since=2026-11-01T00:00:00Z`, undefined, { bearer: TOKEN })).status, 200);
  assert.equal(moving.said.some((m) => /desk key/.test(m)), false, 'its own key is not worth a line');
  assert.equal((await moving.call('GET', `${BOARD}/api/export?since=2026-11-01T00:00:00Z`, undefined, { bearer: 'the-desk-key' })).status, 200);
  assert.ok(moving.said.some((m) => /export/.test(m) && /desk key/.test(m)), 'who still uses the desk key shows in the log, never the key');
  assert.equal(moving.said.some((m) => m.includes('the-desk-key') || m.includes(TOKEN)), false);
  const only = await start({ env: { DESK_PUSH_TOKEN: 'the-desk-key', TEAM_TOKEN_ONLY: '1' } }); t.after(() => only.srv.close());
  assert.equal((await only.call('GET', `${BOARD}/api/export?since=2026-11-01T00:00:00Z`, undefined, { bearer: 'the-desk-key' })).status, 401);
  assert.equal((await only.call('GET', `${BOARD}/api/export?since=2026-11-01T00:00:00Z`, undefined, { bearer: TOKEN })).status, 200);
});
