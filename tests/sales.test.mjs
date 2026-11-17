import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSales, checkClaims } from '../lib/sales.mjs';

const CLIENT = 'cid.apps.googleusercontent.com';
const nowS = 1_800_000_000;
const good = { aud: CLIENT, iss: 'https://accounts.google.com', exp: String(nowS + 600), email_verified: 'true', email: 'jose@mirentor.com', hd: 'mirentor.com', given_name: 'José' };
const opts = (allow = []) => ({ clientId: CLIENT, domain: 'mirentor.com', allow: new Set(allow), nowS });

test('claims: a verified mirentor.com account gets in', () => {
  assert.deepEqual(checkClaims(good, opts()), { ok: true, email: 'jose@mirentor.com', name: 'José' });
});
test('claims: every wrong field is refused with its reason', () => {
  assert.equal(checkClaims({ ...good, aud: 'other' }, opts()).why, 'aud');
  assert.equal(checkClaims({ ...good, iss: 'evil.com' }, opts()).why, 'iss');
  assert.equal(checkClaims({ ...good, exp: String(nowS - 1) }, opts()).why, 'exp');
  assert.equal(checkClaims({ ...good, email_verified: 'false' }, opts()).why, 'unverified');
  assert.equal(checkClaims({ ...good, email: 'jose@gmail.com', hd: undefined }, opts()).why, 'domain');
  assert.equal(checkClaims({ ...good, email: 'jose@gmail.com' }, opts()).why, 'domain');
  assert.equal(checkClaims(good, opts(['mario@mirentor.com'])).why, 'list');
  assert.equal(checkClaims(null, opts()).why, 'token');
});

function serve(handler) {
  const srv = http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://x');
    if (!(await handler(req, res, pathname))) res.writeHead(404).end('site');
  });
  return new Promise((ok) => srv.listen(0, () => ok(srv)));
}
function root() {
  const d = mkdtempSync(path.join(tmpdir(), 'sales-'));
  writeFileSync(path.join(d, 'index.html'), '<p>hub</p>');
  writeFileSync(path.join(d, 'rutina.html'), '<p>rutina</p>');
  mkdirSync(path.join(d, 'assets'));
  writeFileSync(path.join(d, 'assets', 'a.svg'), '<svg/>');
  writeFileSync(path.join(path.dirname(d), 'secret.txt'), 'nope');
  return d;
}
const cookieOf = (r) => (r.headers.get('set-cookie') || '').split(';')[0];

test('portal: off without a secret or a client', () => {
  assert.equal(createSales({ clientId: CLIENT, root: '/tmp' }), null);
  assert.equal(createSales({ secret: 's', root: '/tmp' }), null);
});

test('portal: login page, Google sign-in, pages, logout', async () => {
  const sales = createSales({ clientId: CLIENT, secret: 's3cret', root: root(), verify: async (t) => (t === 'tok' ? good : null), now: () => nowS * 1000 });
  const srv = await serve(sales);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    let r = await fetch(`${base}/ventas`);
    assert.equal(r.status, 200);
    assert.match(await r.text(), /g_id_onload[\s\S]*data-callback="mirentorSignIn"/);
    r = await fetch(`${base}/ventas/rutina`, { redirect: 'manual' });
    assert.equal(r.status, 303, 'pages need a session');
    assert.equal((await fetch(`${base}/other`)).status, 404, 'the rest of the site is untouched');

    const post = (body, cookie) => fetch(`${base}/ventas/auth`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie }, body });
    r = await post('credential=tok&g_csrf_token=a', 'g_csrf_token=b');
    assert.equal(r.status, 400, 'csrf cookie must match');
    r = await post('credential=bad&g_csrf_token=a', 'g_csrf_token=a');
    assert.equal(r.status, 403);
    r = await post('credential=tok&g_csrf_token=a', 'g_csrf_token=a');
    assert.equal(r.status, 303);
    const c = cookieOf(r);
    assert.match(c, /^msales=/);

    r = await fetch(`${base}/ventas/`, { headers: { cookie: c } });
    assert.equal(await r.text(), '<p>hub</p>');
    r = await fetch(`${base}/ventas/rutina`, { headers: { cookie: c } });
    assert.equal(await r.text(), '<p>rutina</p>');
    r = await fetch(`${base}/ventas/assets/a.svg`, { headers: { cookie: c } });
    assert.equal(r.headers.get('content-type'), 'image/svg+xml');
    r = await fetch(`${base}/ventas/me.json`, { headers: { cookie: c } });
    assert.deepEqual(await r.json(), { email: 'jose@mirentor.com' });
    r = await fetch(`${base}/ventas/..%2fsecret.txt`, { headers: { cookie: c } });
    assert.equal(r.status, 404, 'no way out of the portal folder');
    r = await fetch(`${base}/ventas/x`, { headers: { cookie: c.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A')) }, redirect: 'manual' });
    assert.equal(r.status, 303, 'a forged cookie is a stranger');
    r = await fetch(`${base}/ventas/logout`, { redirect: 'manual', headers: { cookie: c } });
    assert.match(r.headers.get('set-cookie'), /Max-Age=0/);
  } finally { srv.close(); }
});

test('portal: on its own host it sits at the root', async () => {
  const sales = createSales({ clientId: CLIENT, secret: 's', host: 'sales.mirentor.com', root: root(), verify: async () => good, now: () => nowS * 1000 });
  const srv = await serve(sales);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const get = (host) => new Promise((ok, no) => http.get(`${base}/`, { headers: { host, 'x-forwarded-proto': 'https' } }, (res) => {
      let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => ok({ status: res.statusCode, body: b }));
    }).on('error', no));
    assert.match((await get('sales.mirentor.com')).body, /data-callback="mirentorSignIn"/);
    assert.equal((await get('www.mirentor.com')).status, 404);
  } finally { srv.close(); }
});

test('portal: a narrowed list locks out someone who already has a cookie', async () => {
  const mk = (allow) => createSales({ clientId: CLIENT, secret: 's', allow, root: root(), verify: async () => good, now: () => nowS * 1000 });
  let srv = await serve(mk(''));
  let base = `http://127.0.0.1:${srv.address().port}`;
  const r = await fetch(`${base}/ventas/auth`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'g_csrf_token=a' }, body: 'credential=t&g_csrf_token=a' });
  const c = cookieOf(r);
  srv.close();
  srv = await serve(mk('mario@mirentor.com'));
  base = `http://127.0.0.1:${srv.address().port}`;
  try {
    assert.equal((await fetch(`${base}/ventas/rutina`, { headers: { cookie: c }, redirect: 'manual' })).status, 303);
  } finally { srv.close(); }
});

test('portal: files arrive by PUT with the push token and are then served', async () => {
  const d = root();
  const sales = createSales({ clientId: CLIENT, secret: 's', pushToken: 'push', root: d, verify: async () => good, now: () => nowS * 1000 });
  const srv = await serve(sales);
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const put = (p, auth) => fetch(`${base}/ventas/_files/${p}`, { method: 'PUT', headers: auth ? { authorization: `Bearer ${auth}` } : {}, body: '<p>new</p>' });
    assert.equal((await put('nuevo.html')).status, 401);
    assert.equal((await put('nuevo.html', 'wrong')).status, 401);
    assert.equal((await put('..%2fx.html', 'push')).status, 400);
    assert.equal((await put('x.exe', 'push')).status, 400);
    assert.equal((await put('sub/nuevo.html', 'push')).status, 200);
    const r = await fetch(`${base}/ventas/auth`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: 'g_csrf_token=a' }, body: 'credential=t&g_csrf_token=a' });
    const page = await fetch(`${base}/ventas/sub/nuevo`, { headers: { cookie: cookieOf(r) } });
    assert.equal(await page.text(), '<p>new</p>');
  } finally { srv.close(); }
});

test('portal: the popup login posts JSON with its header and gets the cookie', async () => {
  const sales = createSales({ clientId: CLIENT, secret: 's', root: root(), verify: async (c) => (c === 'tok' ? good : null), now: () => nowS * 1000 });
  const srv = await serve(sales);
  const base = `http://127.0.0.1:${srv.address().port}`;
  const post = (body, hdr = { 'x-sales-login': '1' }) => fetch(`${base}/ventas/auth`, { method: 'POST', headers: { 'content-type': 'application/json', ...hdr }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ credential: 'tok' }, {})).status, 400, 'no header, no login');
    const bad = await post({ credential: 'nope' });
    assert.equal(bad.status, 403);
    assert.match((await bad.json()).error, /confirmar/);
    const r = await post({ credential: 'tok' });
    assert.equal(r.status, 200);
    assert.match(r.headers.get('set-cookie'), /^msales=/);
  } finally { srv.close(); }
});
