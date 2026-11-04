import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createDesk } from '../lib/desk.mjs';
import http from 'node:http';

// fetch cannot set Host, so these go through node:http.
function asHost(url, host, { method = 'GET', path: p = '/', headers = {}, body } = {}) {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request({ hostname: u.hostname, port: u.port, method, path: p, headers: { host, ...headers } }, (res) => {
      let text = ''; res.setEncoding('utf8'); res.on('data', (c) => { text += c; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

const PASSWORD = 'orange-lens-glove-42';
const TOKEN = 'push-token-0123456789abcdef';
const PAGE = '<title>Prentis Team Desk</title>\n<script id="app-js">(async () => { const d = await window.claude.use("db"); })();</script>';
const snapshot = (over = {}) => ({
  pushedAt: '2026-11-04T16:20:00Z',
  collections: { cards: { T1: { num: 1, title: 'Primer', status: 'done' } }, decisions: { D1: { num: 1, question: 'Ok?' } }, signals: {}, routines: {}, tools: {} },
  docs: { 'meta/desk': { updatedAt: '2026-11-04T16:12:33Z', updatedVia: 'prentis-desk-sync' } },
  names: { u_x: 'Claudio' },
  ...over,
});

async function start({ desk = true, clock, host } = {}) {
  const store = openStore(mkdtempSync(path.join(tmpdir(), 'desk-')));
  const now = clock ? () => clock.t : undefined;
  const d = desk ? createDesk({ dir: store.dir, password: PASSWORD, pushToken: TOKEN, limit: 3, now, host }) : null;
  const srv = createServer({ store, sheets: null, origins: [], desk: d });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const login = (password) => fetch(`${url}/desk/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ password }) });
  const push = (body, token = TOKEN) => fetch(`${url}/desk/snapshot`, { method: 'PUT', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const cookieOf = (r) => r.headers.get('set-cookie').split(';')[0];
  return { srv, url, login, push, cookieOf, store };
}

test('without a password configured, /desk does not exist', async (t) => {
  const s = await start({ desk: false }); t.after(() => s.srv.close());
  assert.equal((await fetch(`${s.url}/desk`)).status, 404);
});

test('createDesk stays off unless both secrets are set', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'desk-'));
  assert.equal(createDesk({ dir, password: '', pushToken: TOKEN }), null);
  assert.equal(createDesk({ dir, password: PASSWORD, pushToken: undefined }), null);
});

test('a visitor without the cookie gets the password form, never the data', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  await s.push({ snapshot: snapshot(), page: PAGE });
  const r = await fetch(`${s.url}/desk`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.match(html, /name="password"/);
  assert.doesNotMatch(html, /Primer/);
  assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow');
  assert.equal(r.headers.get('cache-control'), 'no-store');
  assert.equal((await fetch(`${s.url}/desk/data.json`)).status, 401);
});

test('the wrong password is refused, the right one sets a cookie that opens the desk', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  await s.push({ snapshot: snapshot(), page: PAGE });
  const bad = await s.login('nope');
  assert.equal(bad.status, 401);
  assert.equal(bad.headers.get('set-cookie'), null);
  const ok = await s.login(PASSWORD);
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.get('location'), '/desk');
  assert.match(ok.headers.get('set-cookie'), /HttpOnly; Secure; SameSite=Lax/);
  const page = await (await fetch(`${s.url}/desk`, { headers: { cookie: s.cookieOf(ok) } })).text();
  assert.match(page, /^<!doctype html>/);
  assert.match(page, /<meta name="robots" content="noindex,nofollow">/);
  assert.match(page, /id="desk-snapshot">\{"pushedAt"/);
  assert.match(page, /window\.claude = \{ use:/);
  assert.ok(page.indexOf('window.claude = { use:') < page.indexOf('<script id="app-js">'), 'the shim runs before the page');
  assert.ok(page.endsWith('\n</body></html>'));
  const data = await (await fetch(`${s.url}/desk/data.json`, { headers: { cookie: s.cookieOf(ok) } })).json();
  assert.deepEqual(data, snapshot());
});

test('a forged or expired cookie is refused', async (t) => {
  const clock = { t: Date.parse('2026-11-04T16:00:00Z') };
  const s = await start({ clock }); t.after(() => s.srv.close());
  await s.push({ snapshot: snapshot(), page: PAGE });
  const exp = Math.floor(clock.t / 1000) + 3600;
  assert.equal((await fetch(`${s.url}/desk/data.json`, { headers: { cookie: `mdesk=${exp}.forged` } })).status, 401);
  const cookie = s.cookieOf(await s.login(PASSWORD));
  assert.equal((await fetch(`${s.url}/desk/data.json`, { headers: { cookie } })).status, 200);
  clock.t += 31 * 24 * 3600 * 1000;
  assert.equal((await fetch(`${s.url}/desk/data.json`, { headers: { cookie } })).status, 401);
});

test('repeated wrong passwords from one address are slowed down', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  for (let i = 0; i < 3; i++) assert.equal((await s.login('nope')).status, 401);
  assert.equal((await s.login(PASSWORD)).status, 429);
});

test('only the push token can replace the copy, and a bad snapshot is refused whole', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  assert.equal((await s.push({ snapshot: snapshot(), page: PAGE }, 'wrong')).status, 401);
  const empty = await s.push({ snapshot: snapshot({ collections: { ...snapshot().collections, cards: {} } }), page: PAGE });
  assert.equal(empty.status, 400);
  assert.deepEqual((await empty.json()).errors, ['collections.cards']);
  const noMeta = await s.push({ snapshot: snapshot({ docs: {} }), page: PAGE });
  assert.deepEqual((await noMeta.json()).errors, ['docs']);
  const noPage = await s.push({ snapshot: snapshot(), page: '<p>hi</p>' });
  assert.deepEqual((await noPage.json()).errors, ['page']);
  const cookie = s.cookieOf(await s.login(PASSWORD));
  assert.equal((await fetch(`${s.url}/desk/data.json`, { headers: { cookie } })).status, 404, 'nothing was stored');
  const ok = await s.push({ snapshot: snapshot(), page: PAGE });
  assert.equal(ok.status, 200);
  const r = await ok.json();
  assert.deepEqual(r.counts, { cards: 1, decisions: 1, signals: 0, routines: 0, tools: 0 });
  assert.match(r.sha256, /^[0-9a-f]{64}$/);
});

test('a snapshot from an older desk sync never replaces a newer one', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const at = (updatedAt) => snapshot({ docs: { 'meta/desk': { updatedAt, updatedVia: 'prentis-desk-sync' } } });
  assert.equal((await s.push({ snapshot: at('2026-11-04T16:33:26Z'), page: PAGE })).status, 200);
  const old = await s.push({ snapshot: at('2026-11-04T16:12:33Z'), page: PAGE });
  assert.equal(old.status, 409);
  assert.deepEqual((await old.json()).errors, ['stale']);
  assert.equal((await s.push({ snapshot: at('2026-11-04T16:33:26Z'), page: PAGE })).status, 200, 'the same sync can push again');
  const cookie = s.cookieOf(await s.login(PASSWORD));
  const data = await (await fetch(`${s.url}/desk/data.json`, { headers: { cookie } })).json();
  assert.equal(data.docs['meta/desk'].updatedAt, '2026-11-04T16:33:26Z');
});

test('the copy survives a restart', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  await s.push({ snapshot: snapshot(), page: PAGE });
  const again = createDesk({ dir: s.store.dir, password: PASSWORD, pushToken: TOKEN });
  const srv = createServer({ store: s.store, sheets: null, origins: [], desk: again });
  await new Promise((r) => srv.listen(0, r)); t.after(() => srv.close());
  const url = `http://127.0.0.1:${srv.address().port}`;
  const ok = await fetch(`${url}/desk/login`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=' + encodeURIComponent(PASSWORD) });
  const data = await (await fetch(`${url}/desk/data.json`, { headers: { cookie: ok.headers.get('set-cookie').split(';')[0] } })).json();
  assert.equal(data.pushedAt, snapshot().pushedAt);
});

test('a "</script>" inside desk text cannot break out of the embedded snapshot', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const snap = snapshot({ collections: { ...snapshot().collections, cards: { T1: { title: '</script><script>alert(1)</script>' } } } });
  assert.equal((await s.push({ snapshot: snap, page: PAGE })).status, 200);
  const cookie = s.cookieOf(await s.login(PASSWORD));
  const page = await (await fetch(`${s.url}/desk`, { headers: { cookie } })).text();
  assert.doesNotMatch(page, /<\/script><script>alert/);
  assert.match(page, /\\u003c\/script>/);
});

test('the waitlist endpoint still answers next to the desk', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  assert.equal((await fetch(`${s.url}/healthz`)).status, 200);
  assert.equal((await fetch(`${s.url}/api/waitlist`, { method: 'POST', headers: { origin: 'https://evil.example' } })).status, 403);
});

test('on its own host the desk sits at the root, with a root cookie, and nothing else is served there', async (t) => {
  const s = await start({ host: 'desk.mirentor.com' }); t.after(() => s.srv.close());
  await s.push({ snapshot: snapshot(), page: PAGE });
  const H = 'desk.mirentor.com';
  const form = await asHost(s.url, H);
  assert.equal(form.status, 200);
  assert.match(form.text, /action="\/login"/);
  const bad = await asHost(s.url, H, { method: 'POST', path: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'password=nope' });
  assert.equal(bad.status, 401);
  const ok = await asHost(s.url, H, { method: 'POST', path: '/login', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `password=${encodeURIComponent(PASSWORD)}` });
  assert.equal(ok.status, 303);
  assert.equal(ok.headers.location, '/');
  assert.match(ok.headers['set-cookie'][0], /Path=\/;/);
  const cookie = ok.headers['set-cookie'][0].split(';')[0];
  const page = await asHost(s.url, H, { headers: { cookie } });
  assert.match(page.text, /const BASE = "\/", DATA = \(BASE === "\/" \? "" : BASE\) \+ "\/data\.json"/);
  const data = await asHost(s.url, H, { path: '/data.json', headers: { cookie } });
  assert.equal(data.status, 200);
  assert.deepEqual(JSON.parse(data.text), snapshot());
  assert.equal((await asHost(s.url, H, { path: '/api/waitlist', method: 'POST' })).status, 404);
  assert.equal((await asHost(s.url, H, { path: '/healthz' })).status, 200);
  // The onrender address keeps working under /desk with its own cookie path.
  const old = await s.login(PASSWORD);
  assert.match(old.headers.get('set-cookie'), /Path=\/desk;/);
  assert.equal(old.headers.get('location'), '/desk');
});

test('the Documents collection is optional, and an unknown collection is still refused', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const withDocs = snapshot({ collections: { ...snapshot().collections, docs: { 'lead-log': { title: 'Lead log', url: 'https://docs.google.com/x' } } } });
  const ok = await s.push({ snapshot: withDocs, page: PAGE });
  assert.equal(ok.status, 200);
  assert.deepEqual((await ok.json()).counts, { cards: 1, decisions: 1, signals: 0, routines: 0, tools: 0, docs: 1 });
  const bad = await s.push({ snapshot: snapshot({ collections: { ...snapshot().collections, secrets: {} } }), page: PAGE });
  assert.deepEqual((await bad.json()).errors, ['collections.secrets']);
});
