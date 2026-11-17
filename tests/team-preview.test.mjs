// The preview on one machine: the board at the address production uses, with a list of people in place of the sign-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { seed } from '../tools/team-seed.mjs';
import { previewApp, BASE } from '../tools/team-preview.mjs';

async function start() {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-preview-'));
  const now = () => new Date('2026-11-19T20:00:00Z');   // Thursday 3:00 pm in Panama
  seed(dir, { now: now() });
  const said = [];
  const srv = http.createServer(previewApp({ dir, now, log: (m) => said.push(String(m)) }).listener);
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const get = async (p, cookie) => {
    const r = await fetch(`${url}${p}`, { headers: cookie ? { cookie } : {}, redirect: 'manual' });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* a page */ }
    return { status: r.status, text, json, location: r.headers.get('location'), cookie: (r.headers.get('set-cookie') || '').split(';')[0] || null, set: r.headers.get('set-cookie') || '' };
  };
  return { srv, get, said };
}

test('a preview lists the people where production shows the sign-in, and one tap makes the viewer one of them', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  assert.deepEqual([(await s.get('/')).location, BASE], [`${BASE}/`, '/ventas/equipo']);
  const door = await s.get(`${BASE}/`);
  assert.equal(door.status, 200);
  assert.match(door.text, /href="\/dev\/como\?h=andrea">Andrea Quintero/);
  assert.equal((await s.get(`${BASE}/api/me`)).status, 401);
  const andrea = await s.get('/dev/como?h=andrea');
  assert.deepEqual([andrea.status, andrea.location], [303, `${BASE}/`]);
  const me = await s.get(`${BASE}/api/me`, andrea.cookie);
  assert.deepEqual([me.status, me.json.me.name, me.json.viewer.email], [200, 'Andrea Quintero', 'andrea@ejemplo.test']);
  assert.match((await s.get(`${BASE}/`, andrea.cookie)).text, /src="app\.js"/);
  assert.equal((await s.get('/dev/como?h=nadie')).status, 404);
  assert.deepEqual(s.said, []);
});

test('a preview can be an account that is not on the team, and signing out goes back to the list', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const other = await s.get('/dev/como?correo=Otra@Equipo.Test');
  const me = await s.get(`${BASE}/api/me`, other.cookie);
  assert.deepEqual([me.status, me.json.error, me.json.email], [403, 'not_on_team', 'otra@equipo.test']);
  const out = await s.get(`${BASE}/salir`, other.cookie);
  assert.deepEqual([out.status, out.location], [303, `${BASE}/`]);
  assert.match(out.set, /Max-Age=0/);
  assert.match((await s.get('/ventas/')).text, /portal de ventas\./);
});
