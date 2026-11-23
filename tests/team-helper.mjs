// Shared by the team's API tests: a real server on a free port, a temp data folder and a clock the test moves.
// Who a request is comes from outside the module (in production, the sales portal's Google session): here it is a
// cookie the test writes by hand. The module itself is mounted at its default address, /equipo.
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createTeam } from '../lib/team/api.mjs';

export const ORIGIN = 'https://mirentor.onrender.com';
export const MON_10 = Date.parse('2026-11-16T15:00:00Z');   // Monday 10:00 in Panama
export const DOMAIN = 'equipo.test';   // an ending kept for examples: no address here can be anyone's
export const mail = (handle) => `${handle}@${DOMAIN}`;
/** The cookie that says "this request is that account". */
export const as = (email) => `who=${encodeURIComponent(email)}`;
const identify = (req) => { const m = /(?:^|;\s*)who=([^;]+)/.exec(String(req.headers.cookie || '')); return m ? { email: decodeURIComponent(m[1]) } : null; };

export async function start({ clock = MON_10, sample = false, dev = false, previewOffsetMs = 0, bootstrapOpen = false, desk = null, dir: given = null, guests = [] } = {}) {
  const dir = given || mkdtempSync(path.join(tmpdir(), 'team-api-'));
  if (sample) { mkdirSync(path.join(dir, 'team'), { recursive: true }); writeFileSync(path.join(dir, 'team', 'SAMPLE'), 'sample data\n'); }
  const staticDir = path.join(dir, 'static'); mkdirSync(staticDir, { recursive: true });
  writeFileSync(path.join(staticDir, 'index.html'), '<!doctype html><title>t</title><script type="module" src="app.js"></script>');
  writeFileSync(path.join(staticDir, 'app.js'), 'export const ok = 1;');
  mkdirSync(path.join(staticDir, 'fonts'), { recursive: true }); writeFileSync(path.join(staticDir, 'fonts', 'geist-v1.woff2'), Buffer.from([0x77, 0x4f, 0x46, 0x32, 1, 2, 3]));
  mkdirSync(path.join(staticDir, 'art'), { recursive: true }); writeFileSync(path.join(staticDir, 'art', 'visit.webp'), Buffer.from('RIFF\u0004\u0000\u0000\u0000WEBP', 'latin1'));
  const time = { now: clock };
  const said = [];   // what the service wrote to its error log: a test can check that nothing unexpected happened
  const team = createTeam({ dir, identify, domain: DOMAIN, guests, pushToken: 'push-token', now: () => new Date(time.now), staticDir, origins: [ORIGIN], dev, previewOffsetMs, bootstrapOpen, log: (m) => said.push(String(m)) });
  const srv = createServer({ store: openStore(dir), sheets: null, origins: [ORIGIN], team, desk: desk ? desk(dir) : null, log: (m) => said.push(String(m)) });
  await new Promise((r) => srv.listen(0, r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const call = async (method, p, body, { cookie, bearer, origin, raw } = {}) => {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (cookie) headers.cookie = cookie;
    if (bearer) headers.authorization = `Bearer ${bearer}`;
    if (origin) headers.origin = origin;
    const r = await fetch(`${url}${p}`, { method, headers, body: body === undefined ? undefined : raw ? body : JSON.stringify(body), redirect: 'manual' });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: r.status, json, text, headers: r.headers, cookie: (r.headers.get('set-cookie') || '').split(';')[0] || null };
  };
  /** The first admin, made with the service token. `cookie` is what their signed-in requests carry. */
  const admin = async () => {
    const b = await call('POST', '/equipo/api/bootstrap', { email: mail('jefe'), name: 'Jefe Uno' }, { bearer: 'push-token' });
    return { id: b.json.id, cookie: as(mail('jefe')) };
  };
  /** A person added by a manager, by their work email: <handle>@equipo.test. */
  const addRep = async (adminCookie, handle, over = {}) => {
    const r = await call('POST', '/equipo/api/reps', { email: mail(handle), name: `${handle} Rep`, country: 'PA', city: 'Panama City', workdays: [1, 2, 3, 4, 5], startDate: '2026-10-01', ...over }, { cookie: adminCookie });
    return { id: r.json.id, cookie: as(mail(handle)) };
  };
  const lines = () => readFileSync(path.join(dir, 'team', 'events.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  return { srv, url, call, admin, addRep, as, lines, dir, time, said };
}
export const logBody = (id, over = {}) => ({ id, lead: { name: 'Ferretería El Roble', zone: 'Vía España' }, kind: 'talk', clientAt: new Date(MON_10).toISOString(), ...over });
