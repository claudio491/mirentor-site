// server.js: the team's own server code, started inside a page instead of on a machine. It is what lets a copy of the
// app run with no service behind it (tools/team-demo.mjs): the same rules, the same event log, the same answers.
// A request is a plain call, and the event log is a file in memory that the caller may keep (see onSave).
// It only works bundled by tools/team-demo.mjs, where node:fs and friends are the stand-ins in this folder.
// Nothing here is safe for real use: nobody signs in, the viewer simply chooses who to be, and nothing leaves the page.
import './buffer.js';
import * as files from './node-fs.js';
import { createTeam } from '../../lib/team/api.mjs';
import { openTeamStore } from '../../lib/team/store.mjs';

const DIR = '/demo', LOG = '/demo/team/events.jsonl', BASE = '/equipo';

/** people: [{ id, handle, name, role, city, country, startDate, photo, email? }]. saved: an event log to go on from, as text.
 *  onSave(text) is called with the whole log after every change. */
export function startServer({ people = [], saved = '', onSave = () => {}, now = () => new Date() } = {}) {
  files.watch(() => {}); files.wipe();
  if (saved) files.preload(LOG, saved);
  // A copy opened before goes on from its own log, and the list may have gained since then: a teammate, the address
  // someone signs in with, a photo. The log takes those in, once, and nothing done in the copy is touched: an address
  // or a name changed there stays as it was left.
  const store = openTeamStore(DIR, { now: () => now().toISOString(), log: () => {} }), t = now().toISOString(), { state } = store;
  let added = 0;
  const put = (event) => { store.append({ ...event, t }); added += 1; };
  for (const p of people) {
    const known = state.reps.get(p.id), email = p.email && !state.emails.has(p.email) ? p.email : '';
    if (!known && state.handles.has(p.handle)) continue;   // someone made in the copy already goes by that name
    if (!known) {
      put({ type: 'rep.created', id: p.id, handle: p.handle, ...(email ? { email } : {}), name: p.name, role: p.role || 'rep', country: p.country || 'PA', city: p.city || '', tz: p.tz || 'America/Panama',
        workdays: [1, 2, 3, 4, 5], ...(p.startDate ? { startDate: p.startDate } : {}), lang: 'es' });
    } else if (email && !known.email) put({ type: 'rep.updated', id: p.id, patch: { email } });
    const has = state.reps.get(p.id).photo;
    if (p.photo && (!has || has.v !== p.photo)) put({ type: 'rep.photo', id: p.id, ext: 'jpg', v: p.photo });
  }
  const keep = () => onSave(files.readFileSync(LOG, 'utf8'));
  files.watch((path) => { if (path === LOG) keep(); });
  if (!saved || added) keep();

  let who = '';   // the id of whoever the viewer chose to be
  const team = createTeam({ dir: DIR, base: BASE, identify: () => (who ? { id: who } : null), pushToken: '', now, staticDir: '/none', dev: true, log: () => {} });
  /** One request to the team's API. */
  function call(method, route, body) {
    const text = body === undefined ? null : JSON.stringify(body), pathname = `${BASE}/api/${route}`.split('?')[0];
    const req = { method, url: `${BASE}/api/${route}`, socket: { remoteAddress: 'demo' },
      headers: { host: 'demo', ...(text === null ? {} : { 'content-type': 'application/json' }) },
      async* [Symbol.asyncIterator]() { if (text !== null) yield Buffer.from(text); } };
    return new Promise((resolve, reject) => {
      const res = { status: 0, headers: {},
        writeHead(status, headers = {}) { this.status = status; this.headers = headers; return this; },
        end(payload) { resolve({ status: this.status, type: this.headers['content-type'] || 'application/json', body: payload ?? null }); } };
      Promise.resolve(team(req, res, pathname)).then((handled) => { if (!handled) resolve({ status: 404, type: 'application/json', body: '{"ok":false,"error":"not_found"}' }); }, reject);
    });
  }
  /** Who the viewer can be right now, read back from the log itself. */
  const peopleNow = () => [...openTeamStore(DIR, { log: () => {} }).state.reps.values()].filter((r) => r.active)
    .map((r) => ({ id: r.id, handle: r.handle, name: r.name, role: r.role }));
  /** Be someone, in place of whoever the viewer was. The answer is that person's own first read. */
  async function signIn(handle) { const person = peopleNow().find((p) => p.handle === handle); who = person ? person.id : ''; return call('GET', 'me'); }
  return { call, signIn, people: peopleNow };
}
