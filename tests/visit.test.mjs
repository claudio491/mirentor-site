import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';

const ORIGIN = 'https://www.mirentor.com';
const TOKEN = 'admin-token';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X)';

async function start({ limit } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'wl-'));
  const store = openStore(dir);
  const srv = createServer({ store, sheets: null, origins: [ORIGIN], visitLimit: limit, adminToken: TOKEN });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  // The page sends a beacon: text/plain, so the browser sends no preflight.
  const visit = (b, h = {}) => fetch(`${url}/api/visit`, { method: 'POST', headers: { 'content-type': 'text/plain;charset=UTF-8', origin: ORIGIN, 'user-agent': UA, 'cf-ipcountry': 'PA', ...h }, body: typeof b === 'string' ? b : JSON.stringify(b) });
  return { srv, url, visit, store, dir };
}

test('a visit with an email code is kept with the country, page and how, and answered 204', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const r = await s.visit({ c: 'k7m2qx', page: '/', how: 'interact' });
  assert.equal(r.status, 204);
  const [v] = s.store.visits();
  assert.equal(s.store.visits().length, 1);
  assert.deepEqual({ c: v.c, country: v.country, page: v.page, how: v.how, ua: v.ua }, { c: 'k7m2qx', country: 'PA', page: '/', how: 'interact', ua: UA });
  assert.match(v.at, /^\d{4}-\d{2}-\d{2}T/);
});

test('visits survive a restart', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  await s.visit({ c: 'k7m2qx', page: '/en/', how: 'timer' });
  assert.equal(openStore(s.dir).visits()[0].page, '/en/');
});

test('a bad code, page or how is refused and stores nothing', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  for (const b of [{ c: 'PA-0023', page: '/', how: 'interact' }, { c: 'k7m2q', page: '/', how: 'interact' }, { c: 'k7m2qx', page: 'https://evil.example/', how: 'interact' },
    { c: 'k7m2qx', page: '/', how: 'click' }, 'not json']) {
    assert.equal((await s.visit(b)).status, 400, JSON.stringify(b));
  }
  assert.equal(s.store.visits().length, 0);
});

test('a visit from another origin is refused', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  assert.equal((await s.visit({ c: 'k7m2qx', page: '/', how: 'interact' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal(s.store.visits().length, 0);
});

test('more visits than the limit from one address get 429', async (t) => {
  const s = await start({ limit: 2 }); t.after(() => s.srv.close());
  const b = { c: 'k7m2qx', page: '/', how: 'interact' };
  assert.equal((await s.visit(b)).status, 204);
  assert.equal((await s.visit(b)).status, 204);
  assert.equal((await s.visit(b)).status, 429);
  assert.equal(s.store.visits().length, 2);
});

test('the visit list needs the admin token', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  await s.visit({ c: 'k7m2qx', page: '/', how: 'interact' });
  assert.equal((await fetch(`${s.url}/api/visits`)).status, 401);
  assert.equal((await fetch(`${s.url}/api/visits`, { headers: { authorization: 'Bearer wrong' } })).status, 401);
  const r = await fetch(`${s.url}/api/visits`, { headers: { authorization: `Bearer ${TOKEN}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.deepEqual(j.visits.map((v) => v.c), ['k7m2qx']);
});

test('without an admin token the visit list is off', async (t) => {
  const store = openStore(mkdtempSync(path.join(tmpdir(), 'wl-')));
  const srv = createServer({ store, sheets: null, origins: [ORIGIN] });
  await new Promise((r) => srv.listen(0, r)); t.after(() => srv.close());
  const r = await fetch(`http://127.0.0.1:${srv.address().port}/api/visits`, { headers: { authorization: 'Bearer ' } });
  assert.equal(r.status, 404);
});
