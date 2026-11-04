import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { sheetsClient } from '../lib/sheets.mjs';
import { fakeGoogle, fakeServiceAccount } from './fakes.mjs';

const ORIGIN = 'https://mirentor.onrender.com';
const SA = fakeServiceAccount();
const body = (id = '3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b', over = {}) => ({ id, lang: 'es', business: 'Almacenes', workers: '120', industry: 'warehouse',
  city: 'Panama City', country: 'PA', contact: 'Ana', email: 'ana@almacenes.com', whatsapp: '', pay_ack: 'yes', website: '', ...over });

async function start({ google = fakeGoogle(), sheets = true, limit } = {}) {
  const store = openStore(mkdtempSync(path.join(tmpdir(), 'wl-')));
  const srv = createServer({ store, sheets: sheets ? sheetsClient({ sa: SA, sheetId: 'S', fetch: google.fetch }) : null, origins: [ORIGIN], limit });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const post = (b, origin = ORIGIN) => fetch(`${url}/api/waitlist`, { method: 'POST', headers: { 'content-type': 'application/json', origin }, body: JSON.stringify(b) });
  return { srv, url, post, store, google };
}

test('a valid post lands in the sheet once, and a repeat returns the same lead', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const r1 = await s.post(body());
  assert.equal(r1.status, 200);
  assert.deepEqual(await r1.json(), { ok: true, leadId: 'WL-3F2B8C1E', synced: true });
  assert.equal(r1.headers.get('access-control-allow-origin'), ORIGIN);
  const r2 = await s.post(body());
  assert.deepEqual(await r2.json(), { ok: true, leadId: 'WL-3F2B8C1E', synced: true });
  assert.equal(s.google.rows.filter((r) => r[0] === 'WL-3F2B8C1E').length, 1);
});

test('without Google the entry is kept and answered 202', async (t) => {
  const s = await start({ sheets: false }); t.after(() => s.srv.close());
  const r = await s.post(body());
  assert.equal(r.status, 202);
  assert.equal((await r.json()).synced, false);
  assert.equal(s.store.pending().length, 1);
});

test('Google down still keeps the entry and answers 202', async (t) => {
  const s = await start({ google: fakeGoogle({ down: true }) }); t.after(() => s.srv.close());
  assert.equal((await s.post(body())).status, 202);
  assert.equal(s.store.pending().length, 1);
});

test('a bad post gets 400 with the fields to fix', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const r = await s.post(body(undefined, { email: 'x' }));
  assert.equal(r.status, 400);
  assert.deepEqual(await r.json(), { ok: false, errors: ['email'] });
});

test('a honeypot hit answers ok and stores nothing', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const r = await s.post(body(undefined, { website: 'spam.example' }));
  assert.equal(r.status, 200);
  assert.equal(s.store.pending().length + s.google.rows.length, 2);
});

test('another origin gets no CORS headers, and preflight works for ours', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const r = await s.post(body(), 'https://evil.example');
  assert.equal(r.status, 403);
  assert.equal(r.headers.get('access-control-allow-origin'), null);
  const pre = await fetch(`${s.url}/api/waitlist`, { method: 'OPTIONS', headers: { origin: ORIGIN, 'access-control-request-method': 'POST' } });
  assert.equal(pre.status, 204);
  assert.match(pre.headers.get('access-control-allow-headers'), /content-type/);
});

test('more than the limit from one address gets 429', async (t) => {
  const s = await start({ limit: 2 }); t.after(() => s.srv.close());
  const ids = ['a', 'b', 'c'].map((c) => `${c.repeat(8)}-0000-4000-8000-000000000000`);
  const codes = [];
  for (const id of ids) codes.push((await s.post(body(id))).status);
  assert.deepEqual(codes, [200, 200, 429]);
});

test('healthz says whether Google is configured', async (t) => {
  const s = await start({ sheets: false }); t.after(() => s.srv.close());
  const h = await (await fetch(`${s.url}/healthz`)).json();
  assert.deepEqual({ ...h, dataDir: 'x' }, { ok: true, sheets: false, pending: 0, dataDir: 'x', desk: false });
  assert.match(h.dataDir, /wl-/);
});
