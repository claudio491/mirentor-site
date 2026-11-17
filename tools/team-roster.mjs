// team-roster.mjs: start an EMPTY data folder from a list of real people, with their photos and no activity.
// It is how a preview on this machine shows the actual team instead of the fictional sample: nothing is made up,
// so nobody has points until they log. The list is a JSON file kept out of the repository (data-sample/team.json):
//   { "people": [ { "handle": "nombre", "name": "Nombre Apellido", "role": "rep", "city": "Panama City", "country": "PA",
//                   "startDate": "2026-11-10", "photo": "photos/nombre.jpg", "email": "nombre@mirentor.com" } ], "leads": [ ... ] }
// role is rep, manager or admin; photo is a JPEG, PNG or WebP next to the list, and may be left out. So may email:
// it is the Google account the person signs in with in production, and a preview on this machine does not need it.
// An address that is not in the list is never made up.
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { openTeamStore } from '../lib/team/store.mjs';
import { savePhoto } from '../lib/team/photo.mjs';
import { validTz } from '../lib/team/rules.mjs';

const HANDLE = /^[a-z0-9][a-z0-9._-]{1,39}$/, DAY = /^\d{4}-\d{2}-\d{2}$/, ROLES = ['rep', 'manager', 'admin'];
const EMAIL = /^[a-z0-9][a-z0-9._%+-]{0,63}@[a-z0-9][a-z0-9.-]{0,180}\.[a-z]{2,}$/;

/** Read a roster file. Photo paths in it are relative to the file. */
export function readRoster(file) {
  const data = JSON.parse(readFileSync(file, 'utf8'));
  return { people: Array.isArray(data.people) ? data.people : [], leads: Array.isArray(data.leads) ? data.leads : [], photosDir: path.dirname(file) };
}

function checked(people) {
  if (!Array.isArray(people) || !people.length) throw new Error('the roster needs at least one person');
  const seen = new Set(), mails = new Set();
  return people.map((p, i) => {
    const bad = (field) => new Error(`roster line ${i + 1}: ${field} cannot be used`);
    if (!p || typeof p !== 'object') throw bad('the entry');
    const handle = typeof p.handle === 'string' ? p.handle : '', name = typeof p.name === 'string' ? p.name.trim() : '';
    if (!HANDLE.test(handle) || seen.has(handle)) throw bad('handle');
    if (name.length < 2) throw bad('name');
    const role = p.role === undefined ? 'rep' : p.role;
    if (!ROLES.includes(role)) throw bad('role');
    if (p.startDate !== undefined && !(typeof p.startDate === 'string' && DAY.test(p.startDate))) throw bad('startDate');
    if (p.tz !== undefined && !validTz(p.tz)) throw bad('tz');
    const email = p.email === undefined ? '' : typeof p.email === 'string' ? p.email.trim().toLowerCase() : null;
    if (email === null || (email && (!EMAIL.test(email) || mails.has(email)))) throw bad('email');
    seen.add(handle); if (email) mails.add(email);
    return { handle, email, name, role, city: typeof p.city === 'string' ? p.city : '', country: typeof p.country === 'string' ? p.country : 'PA', tz: p.tz || 'America/Panama',
      startDate: p.startDate || null, lang: p.lang === 'en' ? 'en' : 'es', photo: typeof p.photo === 'string' ? p.photo : null };
  });
}

export function seedRoster(dir, { now = new Date(), people, photosDir = '.', leads = [] } = {}) {
  const list = checked(people);   // every line is checked before anything is written
  const events = path.join(dir, 'team', 'events.jsonl');
  if (existsSync(events) && readFileSync(events, 'utf8').trim()) throw new Error(`${events} already holds events: the roster only fills an empty folder`);
  mkdirSync(path.join(dir, 'team'), { recursive: true });
  const store = openTeamStore(dir), t = now.toISOString(), skipped = [];
  for (const p of list) {
    const id = `r_${p.handle.replace(/[^a-z0-9]/g, '-')}`;
    store.append({ type: 'rep.created', id, handle: p.handle, ...(p.email ? { email: p.email } : {}), name: p.name, role: p.role, country: p.country, city: p.city, tz: p.tz, workdays: [1, 2, 3, 4, 5], ...(p.startDate ? { startDate: p.startDate } : {}), lang: p.lang, t });
    if (!p.photo) continue;
    const file = path.resolve(photosDir, p.photo);
    const kept = existsSync(file) ? savePhoto(dir, id, readFileSync(file)) : null;
    if (kept) store.append({ type: 'rep.photo', id, ext: kept.ext, v: kept.v, t }); else skipped.push({ handle: p.handle, why: 'photo' });
  }
  if (leads.length) store.setLeads(leads);
  return { people: list.map((p) => `${p.handle} (${p.role})`), skipped };
}
