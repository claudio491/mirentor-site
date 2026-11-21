// state.mjs: the indexes every derivation reads, built by replaying events in order.
// Nothing here scores anything: it only files each event where score.mjs and view.mjs will look for it.
import { localDay, validTz } from './rules.mjs';
import { cleanImei } from './install.mjs';

const DEFAULT_TZ = 'America/Panama';
const PATCHABLE = ['name', 'role', 'country', 'city', 'tz', 'workdays', 'startDate', 'lang', 'active', 'slack'];

export function emptyState() {
  return {
    reps: new Map(),          // id -> rep
    handles: new Map(),       // handle -> rep id
    emails: new Map(),        // work email -> rep id: the Google account a person signs in with
    logs: new Map(),          // log id -> log (with its local `day`)
    byRep: new Map(),         // rep id -> log ids, in the order they arrived
    voids: new Map(),         // log id -> { by, reason, t }
    held: new Map(),          // log id -> time the rep said the meeting happened
    confirms: new Map(),      // log id -> { meeting_held, contract_sent, contract_signed } times
    closes: new Map(),        // `${rep}|${day}` -> day.close event
    closesByRep: new Map(),   // rep id -> closed days
    picks: new Map(),         // `${rep}|${week}` -> weekly goal picked
    kudos: new Map(),         // feed id -> Set of rep ids
    plays: new Map(),         // log id -> what worked, in the rep's words
    sites: new Map(),         // site id -> { id, rep, lead, t, steps, city, eligible, coordinator, practice, legacy, phones, prep, closed, workers }
    workers: new Map(),       // worker id -> { id, site, name, email, phone, consent, imei, clip, addedBy, t }
    imeis: new Map(),         // imei -> worker id holding that phone now
    phoneLog: [],             // { imei, worker, site, what: 'given' | 'returned', t } in order
    dayoffs: new Set(),       // `${scope}|${date}`; scope is a rep id, a country code or 'all'
    badges: [],
    leadFirstDay: new Map(),  // lead id -> first local day anyone logged it
    appLeads: new Map(),      // businesses added in the app that the CRM has not given an id yet: id -> { id, company, zone, city, by, createdAt }
    feed: [],                 // { id, type, rep, t, ref } in order
    count: 0,
  };
}

export function applyEvent(state, e) {
  state.count += 1;
  switch (e.type) {
    case 'rep.created': {
      const tz = validTz(e.tz) ? e.tz : DEFAULT_TZ;   // a name the runtime does not know would break every later read
      const rep = { id: e.id, handle: e.handle, email: typeof e.email === 'string' ? e.email : '', name: e.name, role: e.role || 'rep', country: e.country || 'PA', city: e.city || '', tz,
        workdays: e.workdays?.length ? [...e.workdays] : [1, 2, 3, 4, 5], startDate: e.startDate || localDay(e.t, tz), lang: e.lang || 'es',
        active: true, photo: null, createdAt: e.t };
      state.reps.set(rep.id, rep); state.handles.set(rep.handle, rep.id);
      if (rep.email) state.emails.set(rep.email, rep.id);
      if (!state.byRep.has(rep.id)) state.byRep.set(rep.id, []);
      if (!state.closesByRep.has(rep.id)) state.closesByRep.set(rep.id, []);
      break;
    }
    case 'rep.updated': {
      const rep = state.reps.get(e.id); if (!rep) break;
      const p = e.patch || {};
      for (const k of PATCHABLE) if (k in p && (k !== 'tz' || validTz(p.tz))) rep[k] = p[k];
      if (p.handle && p.handle !== rep.handle) { state.handles.delete(rep.handle); rep.handle = p.handle; state.handles.set(p.handle, rep.id); }
      // A new address moves the person's way in: the old account stops opening the board on its next request.
      if (typeof p.email === 'string' && p.email !== rep.email) { if (rep.email && state.emails.get(rep.email) === rep.id) state.emails.delete(rep.email); rep.email = p.email; if (p.email) state.emails.set(p.email, rep.id); }
      break;
    }
    // The bytes are a file beside this log (lib/team/photo.mjs); the log only says who has one and which version.
    case 'rep.photo': { const rep = state.reps.get(e.id); if (rep && typeof e.v === 'string' && typeof e.ext === 'string') rep.photo = { v: e.v, ext: e.ext }; break; }
    case 'rep.photo.removed': { const rep = state.reps.get(e.id); if (rep) rep.photo = null; break; }
    case 'dayoff': state.dayoffs.add(`${e.scope}|${e.date}`); break;
    case 'dayoff.undo': state.dayoffs.delete(`${e.scope}|${e.date}`); break;
    case 'log': {
      const rep = state.reps.get(e.rep); if (!rep || state.logs.has(e.id) || !e.lead || typeof e.lead.id !== 'string') break;
      const log = { ...e, day: localDay(e.t, rep.tz) };
      state.logs.set(log.id, log); state.byRep.get(rep.id).push(log.id);
      const first = state.leadFirstDay.get(log.lead.id);
      if (!first || log.day < first) state.leadFirstDay.set(log.lead.id, log.day);
      state.feed.push({ id: log.id, type: 'log', rep: rep.id, t: e.t });
      break;
    }
    case 'log.void': state.voids.set(e.logId, { by: e.by, reason: e.reason || '', t: e.t }); break;
    // The same result on the same business the same day: the first log takes the details typed the second time.
    case 'log.update': { const log = state.logs.get(e.logId); if (log && e.patch) for (const k of ['channel', 'voicemail', 'tag', 'note', 'contact', 'when']) if (k in e.patch) log[k] = e.patch[k]; break; }
    case 'log.held': if (!state.held.has(e.logId)) state.held.set(e.logId, e.t); break;
    case 'confirm': {
      const c = state.confirms.get(e.logId) || {};
      if (!c[e.what]) { c[e.what] = e.t; state.confirms.set(e.logId, c); const log = state.logs.get(e.logId); if (log) state.feed.push({ id: `${e.logId}:${e.what}`, type: e.what, rep: log.rep, t: e.t, ref: e.logId }); }
      break;
    }
    // A confirmation made by mistake is taken back: the part waits again and its line leaves the feed.
    case 'confirm.undo': { const c = state.confirms.get(e.logId); if (c && c[e.what]) { delete c[e.what]; state.feed = state.feed.filter((f) => f.id !== `${e.logId}:${e.what}`); } break; }
    case 'site.void': { const s = state.sites.get(e.siteId); if (s && !s.void) { s.void = e.t; state.feed = state.feed.filter((f) => f.ref !== s.id); } break; }
    case 'site': if (!state.sites.has(e.id)) {
      state.sites.set(e.id, { id: e.id, rep: e.rep, lead: e.lead, t: e.t, steps: {},
        city: typeof e.city === 'string' ? e.city : '', eligible: Number.isInteger(e.eligible) && e.eligible >= 0 ? e.eligible : null,
        coordinator: e.coordinator && typeof e.coordinator === 'object' ? { name: String(e.coordinator.name || ''), phone: String(e.coordinator.phone || '') } : null,
        practice: e.practice === true, legacy: e.legacy === true, phones: null, prep: { signs: null, zones: null }, closed: null, workers: [] });
      state.feed.push({ id: `${e.id}:site_signed`, type: 'site_signed', rep: e.rep, t: e.t, ref: e.id });
    } break;
    case 'site.step': { const s = state.sites.get(e.siteId); if (s && !s.steps[e.what]) { s.steps[e.what] = e.t; state.feed.push({ id: `${s.id}:site_${e.what}`, type: `site_${e.what}`, rep: s.rep, t: e.t, ref: s.id }); } break; }
    case 'site.phones': { const s = state.sites.get(e.siteId); if (s && Number.isInteger(e.count) && e.count >= 0) s.phones = e.count; break; }
    case 'site.prep': { const s = state.sites.get(e.siteId); if (s && (e.what === 'signs' || e.what === 'zones') && !s.prep[e.what]) s.prep[e.what] = e.t; break; }
    case 'site.coordinator': { const s = state.sites.get(e.siteId); if (s) s.coordinator = { name: String(e.name || ''), phone: String(e.phone || '') }; break; }
    // Only the practice site can be taken out: a real site stays in the log as it happened.
    case 'site.removed': {
      const s = state.sites.get(e.siteId); if (!s || !s.practice) break;
      for (const id of s.workers) { const w = state.workers.get(id); if (w?.imei && state.imeis.get(w.imei) === id) state.imeis.delete(w.imei); state.workers.delete(id); }
      state.phoneLog = state.phoneLog.filter((p) => p.site !== s.id);
      state.feed = state.feed.filter((f) => f.ref !== s.id);
      state.sites.delete(s.id);
      break;
    }
    // The same worker id again is the same worker, so a retry after a bad connection never doubles anyone.
    case 'worker.added': {
      const s = state.sites.get(e.siteId); if (!s || typeof e.id !== 'string' || state.workers.has(e.id)) break;
      state.workers.set(e.id, { id: e.id, site: s.id, name: String(e.name || ''), email: typeof e.email === 'string' ? e.email : '', phone: e.phone !== false, consent: null, imei: null, clip: null, addedBy: e.by, t: e.t });
      s.workers.push(e.id);
      break;
    }
    case 'worker.consent': { const w = state.workers.get(e.workerId); if (w && typeof e.v === 'string' && typeof e.ext === 'string') w.consent = { v: e.v, ext: e.ext, form: e.form, t: e.t }; break; }
    // The lock lives here: no phone without a consent on file, none for a coworker without a phone, and one IMEI is one worker's at a time.
    case 'worker.phone': {
      const w = state.workers.get(e.workerId), imei = cleanImei(e.imei);
      if (!w || !w.consent || !w.phone || w.imei || !imei || state.imeis.has(imei)) break;
      w.imei = imei; state.imeis.set(imei, w.id);
      state.phoneLog.push({ imei, worker: w.id, site: w.site, what: 'given', t: e.t });
      break;
    }
    case 'worker.phone.returned': {
      const w = state.workers.get(e.workerId); if (!w || !w.imei) break;
      state.phoneLog.push({ imei: w.imei, worker: w.id, site: w.site, what: 'returned', t: e.t });
      state.imeis.delete(w.imei); w.imei = null; w.clip = null;
      break;
    }
    case 'worker.clip': { const w = state.workers.get(e.workerId); if (w && w.imei && !w.clip) w.clip = e.t; break; }
    case 'install.close': { const s = state.sites.get(e.siteId); if (s && !s.closed) s.closed = e.t; break; }
    case 'day.close': {
      const key = `${e.rep}|${e.day}`; if (state.closes.has(key)) break;
      state.closes.set(key, e); (state.closesByRep.get(e.rep) || state.closesByRep.set(e.rep, []).get(e.rep)).push(e.day);
      state.feed.push({ id: `close:${e.rep}:${e.day}`, type: 'day_closed', rep: e.rep, t: e.t });
      break;
    }
    // A day closed by mistake is opened again by a manager: the rep can log, and can close it again later.
    case 'day.reopen': {
      const key = `${e.rep}|${e.day}`; if (!state.closes.has(key)) break;
      state.closes.delete(key); state.closesByRep.set(e.rep, (state.closesByRep.get(e.rep) || []).filter((d) => d !== e.day));
      state.feed = state.feed.filter((f) => f.id !== `close:${e.rep}:${e.day}`);
      break;
    }
    case 'goal.pick': state.picks.set(`${e.rep}|${e.week}`, e.k); break;
    case 'kudos': { const set = state.kudos.get(e.target) || new Set(); if (e.on) set.add(e.by); else set.delete(e.by); state.kudos.set(e.target, set); break; }
    case 'play': state.plays.set(e.logId, String(e.text || '').slice(0, 280)); break;
    case 'badge.give': state.badges.push({ id: e.id, rep: e.rep, text: e.text, by: e.by, t: e.t }); state.feed.push({ id: `badge:${e.id}`, type: 'badge', rep: e.rep, t: e.t, ref: e.id }); break;
    // The CRM gave a business added in the app its real id: every log that named the temporary one follows.
    case 'lead.added': if (e.lead && typeof e.lead.id === 'string') state.appLeads.set(e.lead.id, { ...e.lead, createdAt: e.t }); break;
    case 'lead.map': {
      state.appLeads.delete(e.temp);
      for (const log of state.logs.values()) if (log.lead.id === e.temp) log.lead = { ...log.lead, id: e.real };
      const a = state.leadFirstDay.get(e.temp), b = state.leadFirstDay.get(e.real);
      if (a) { state.leadFirstDay.set(e.real, b && b < a ? b : a); state.leadFirstDay.delete(e.temp); }
      break;
    }
    default: break;   // unknown events are kept on disk and ignored here, so an older build can read a newer log
  }
  return state;
}

export const isOff = (state, rep, day) => state.dayoffs.has(`${rep.id}|${day}`) || state.dayoffs.has(`${rep.country}|${day}`) || state.dayoffs.has(`all|${day}`);
