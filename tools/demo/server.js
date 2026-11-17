// server.js: the team's own server code, started inside a page instead of on a machine. It is what lets a copy of the
// app run with no service behind it (tools/team-demo.mjs): the same rules, the same event log, the same answers.
// A request is a plain call, and the event log is a file in memory that the caller may keep (see onSave).
// It only works bundled by tools/team-demo.mjs, where node:fs and friends are the stand-ins in this folder.
// Nothing here is safe for real use: everybody shares one public PIN and nothing leaves the page.
import './buffer.js';
import * as files from './node-fs.js';
import { createTeam } from '../../lib/team/api.mjs';
import { openTeamStore } from '../../lib/team/store.mjs';
import { hashPin } from '../../lib/team/auth.mjs';

const DIR = '/demo', LOG = '/demo/team/events.jsonl';
export const DEMO_PIN = '246813';

/** people: [{ id, handle, name, role, city, country, startDate, photo }]. saved: an event log to go on from, as text.
 *  onSave(text) is called with the whole log after every change. */
export function startServer({ people = [], saved = '', onSave = () => {}, now = () => new Date() } = {}) {
  files.watch(() => {}); files.wipe();
  if (saved) files.preload(LOG, saved);
  else {
    const store = openTeamStore(DIR, { now: () => now().toISOString(), log: () => {} }), t = now().toISOString();
    for (const p of people) {
      store.append({ type: 'rep.created', id: p.id, handle: p.handle, name: p.name, role: p.role || 'rep', country: p.country || 'PA', city: p.city || '', tz: p.tz || 'America/Panama',
        workdays: [1, 2, 3, 4, 5], ...(p.startDate ? { startDate: p.startDate } : {}), lang: 'es', t });
      store.append({ type: 'rep.pin', id: p.id, ...hashPin(DEMO_PIN), t });
      if (p.photo) store.append({ type: 'rep.photo', id: p.id, ext: 'jpg', v: p.photo, t });
    }
  }
  const keep = () => onSave(files.readFileSync(LOG, 'utf8'));
  files.watch((path) => { if (path === LOG) keep(); });
  if (!saved) keep();

  const team = createTeam({ dir: DIR, secret: 'demo-only-not-a-secret', pushToken: '', now, staticDir: '/none', dev: true, log: () => {} });
  let cookie = '', calls = 0;
  /** One request to the team's API. Every call comes from its own address, so the limits meant for strangers never trip. */
  function raw(method, route, body, keepCookie = true) {
    const text = body === undefined ? null : JSON.stringify(body), pathname = `/equipo/api/${route}`.split('?')[0];
    const req = { method, url: `/equipo/api/${route}`, socket: { remoteAddress: 'demo' },
      headers: { host: 'demo', cookie, 'x-forwarded-for': `demo-${calls += 1}`, ...(text === null ? {} : { 'content-type': 'application/json' }) },
      async* [Symbol.asyncIterator]() { if (text !== null) yield Buffer.from(text); } };
    return new Promise((resolve, reject) => {
      const res = { status: 0, headers: {},
        writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
        end(payload) {
          const set = this.headers['set-cookie'];
          if (set && keepCookie) cookie = /Max-Age=0\b/.test(set) ? '' : set.split(';')[0];
          resolve({ status: this.status, type: this.headers['content-type'] || 'application/json', body: payload ?? null });
        } };
      Promise.resolve(team(req, res, pathname)).then((handled) => { if (!handled) resolve({ status: 404, type: 'application/json', body: '{"ok":false,"error":"not_found"}' }); }, reject);
    });
  }
  async function call(method, route, body) {
    const answer = await raw(method, route, body);
    // A new person's link cannot be opened in a copy with no address of its own, so it is used here and now:
    // whoever is created, or given a new link, has the demo PIN at once.
    if (method === 'POST' && answer.status === 200 && /^reps(\/[^/]+\/link)?$/.test(route.split('?')[0])) {
      let link = ''; try { link = JSON.parse(answer.body).setupUrl || ''; } catch { /* not an answer with a link */ }
      const token = link ? new URL(link, 'http://demo').searchParams.get('t') : '';
      if (token) await raw('POST', 'setup', { token, pin: DEMO_PIN }, false);
    }
    return answer;
  }
  /** Who can sign in right now, read back from the log itself. */
  const peopleNow = () => [...openTeamStore(DIR, { log: () => {} }).state.reps.values()].filter((r) => r.active && r.pin)
    .map((r) => ({ id: r.id, handle: r.handle, name: r.name, role: r.role }));
  /** Sign in as someone, in place of whoever was signed in. */
  async function signIn(handle) { await raw('POST', 'logout', {}); return raw('POST', 'login', { handle, pin: DEMO_PIN }); }
  return { call, signIn, people: peopleNow };
}
