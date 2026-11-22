// state.mjs: the indexes every derivation reads, built by replaying events in order.
// Nothing here scores anything: it only files each event where score.mjs and view.mjs will look for it.
import { localDay, validTz, validMinutes, SELF_STEPS, VIDEOS } from './rules.mjs';
import { imeiFor, imeiKey } from './install.mjs';
import { checkDoc } from '../../team/docs-steps.js';
import { isMonday, MAX_RATE_CENTS } from './pay.mjs';

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
    sites: new Map(),         // site id -> { id, rep, lead, t, steps, city, eligible, coordinator, practice, legacy, phones, phonesAt, prep, closed, workers }
    workers: new Map(),       // worker id -> { id, site, name, email, phone, consent, imei, clip, addedBy, t }
    imeis: new Map(),         // imei -> worker id holding that phone now
    phoneLog: [],             // { imei, worker, site, what: 'given' | 'returned', t } in order
    ticks: new Map(),         // `${rep}|${step}` -> { t, by } for the steps a person ticks by hand
    zones: new Map(),         // rep id -> the two zones they picked, as the list spelled them
    seen: new Map(),          // rep id -> Set of training video keys opened
    hours: new Map(),         // week (a Monday) -> { delivered, accepted, source, t }, in minutes; a later event for the week replaces it
    dayoffs: new Set(),       // `${scope}|${date}`; scope is a rep id, a country code or 'all'
    badges: [],
    leadFirstDay: new Map(),  // lead id -> first local day anyone logged it
    appLeads: new Map(),      // businesses added in the app that the CRM has not given an id yet: id -> { id, company, zone, city, by, createdAt }
    feed: [],                 // { id, type, rep, t, ref } in order
    siteHours: new Map(),     // site id -> Map week (a Monday) -> { accepted, t }: accepted minutes; a later event for the week replaces it
    payRates: [],             // { cents, from, t } in order: cents per accepted hour, in force from the week `from`
    practiceRates: [],        // the same for practice reps only (the example team's rate): never read for a real person
    docs: new Map(),          // document id -> { id, title, note, url, group, lang, step, order, t }: filled at runtime by a manager
    count: 0,
  };
}

export function applyEvent(state, e) {
  state.count += 1;
  switch (e.type) {
    case 'rep.created': addRep(state, e); break;
    // The practice rep: a rep with no address, so nobody signs in as it, and never more than one at a time. Its own event
    // type, so an older build ignores it and everything written for it.
    case 'rep.practice': {
      if (typeof e.id !== 'string' || state.reps.has(e.id) || [...state.reps.values()].some((r) => r.practice && !r.example)) break;
      addRep(state, { ...e, email: '', role: 'rep', practice: true });
      break;
    }
    // The example team: four practice reps, one per letter, made by the server from a fixed recipe. Its own event type,
    // so no older build sees them (nor, therefore, anything written for them).
    case 'rep.practice.example': {
      if (typeof e.id !== 'string' || state.reps.has(e.id) || !['A', 'B', 'C', 'D'].includes(e.slot) || [...state.reps.values()].some((r) => r.example === e.slot)) break;
      addRep(state, { ...e, email: '', role: 'rep', practice: true });
      state.reps.get(e.id).example = e.slot;
      break;
    }
    // The whole example team leaves at once, with its example rate. Its sites already left with site.removed.
    case 'practice.team.removed': {
      for (const rep of [...state.reps.values()]) if (rep.example) dropPractice(state, rep);
      state.practiceRates = [];
      break;
    }
    // Removing it takes out everything that was its own; the events stay in the log and are ignored from here on.
    case 'rep.practice.removed': {
      const rep = state.reps.get(e.id); if (!rep || !rep.practice) break;
      dropPractice(state, rep);
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
      // A practice contact never makes a real rep's first contact a follow-up.
      const first = state.leadFirstDay.get(log.lead.id);
      if (!rep.practice && (!first || log.day < first)) state.leadFirstDay.set(log.lead.id, log.day);
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
    // A voided site gives back every phone it held, at the void's time: the IMEI is free for another site.
    case 'site.void': {
      const s = state.sites.get(e.siteId); if (!s || s.void) break;
      s.void = e.t; state.feed = state.feed.filter((f) => f.ref !== s.id);
      for (const id of s.workers) {
        const w = state.workers.get(id); if (!w || !w.imei) continue;
        state.phoneLog.push({ imei: w.imei, worker: w.id, site: s.id, what: 'returned', t: e.t });
        if (state.imeis.get(imeiKey(s, w.imei)) === w.id) state.imeis.delete(imeiKey(s, w.imei));
        w.imei = null; w.clip = null;
      }
      break;
    }
    case 'site': if (!state.sites.has(e.id)) {
      // A site written without a usable lead (a hand-edited log) still replays, with no name, so no read of it throws.
      const lead = e.lead && typeof e.lead === 'object' && typeof e.lead.name === 'string' ? { id: typeof e.lead.id === 'string' ? e.lead.id : null, name: e.lead.name } : { id: null, name: '' };
      state.sites.set(e.id, { id: e.id, rep: e.rep, lead, t: e.t, steps: {},
        city: typeof e.city === 'string' ? e.city : '', eligible: Number.isInteger(e.eligible) && e.eligible >= 0 ? e.eligible : null,
        coordinator: e.coordinator && typeof e.coordinator === 'object' ? { name: String(e.coordinator.name || ''), phone: String(e.coordinator.phone || '') } : null,
        practice: e.practice === true, legacy: e.legacy === true, phones: null, phonesAt: null, prep: { signs: null, zones: null }, closed: null, workers: [] });
      // practice is nobody's news, and a legacy site was signed before the board: neither adds a line
      if (e.practice !== true && e.legacy !== true) state.feed.push({ id: `${e.id}:site_signed`, type: 'site_signed', rep: e.rep, t: e.t, ref: e.id });
    } break;
    case 'site.step': { const s = state.sites.get(e.siteId); if (s && !s.steps[e.what]) { s.steps[e.what] = e.t; if (!s.practice && !s.legacy) state.feed.push({ id: `${s.id}:site_${e.what}`, type: `site_${e.what}`, rep: s.rep, t: e.t, ref: s.id }); } break; }
    // The first time the phones are marked is the day they arrived; a later count corrects the number, not the day.
    case 'site.phones': { const s = state.sites.get(e.siteId); if (s && Number.isInteger(e.count) && e.count >= 0) { s.phones = e.count; if (!s.phonesAt) s.phonesAt = e.t; } break; }
    case 'site.prep': { const s = state.sites.get(e.siteId); if (s && (e.what === 'signs' || e.what === 'zones') && !s.prep[e.what]) s.prep[e.what] = e.t; break; }
    case 'site.coordinator': { const s = state.sites.get(e.siteId); if (s) s.coordinator = { name: String(e.name || ''), phone: String(e.phone || '') }; break; }
    // Only the practice site can be taken out: a real site stays in the log as it happened.
    case 'site.removed': { const s = state.sites.get(e.siteId); if (s && s.practice) dropSite(state, s); break; }
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
      const w = state.workers.get(e.workerId), site = w && state.sites.get(w.site), imei = w ? imeiFor(site, e.imei) : null;
      if (!w || !w.consent || !w.phone || w.imei || !imei || state.imeis.has(imeiKey(site, imei))) break;
      w.imei = imei; state.imeis.set(imeiKey(site, imei), w.id);
      state.phoneLog.push({ imei, worker: w.id, site: w.site, what: 'given', t: e.t });
      break;
    }
    case 'worker.phone.returned': {
      const w = state.workers.get(e.workerId); if (!w || !w.imei) break;
      state.phoneLog.push({ imei: w.imei, worker: w.id, site: w.site, what: 'returned', t: e.t });
      state.imeis.delete(imeiKey(state.sites.get(w.site), w.imei)); w.imei = null; w.clip = null;
      break;
    }
    case 'worker.clip': { const w = state.workers.get(e.workerId); if (w && w.imei && !w.clip) w.clip = e.t; break; }
    case 'install.close': { const s = state.sites.get(e.siteId); if (s && !s.closed) s.closed = e.t; break; }
    // The first days' ladder. Only the hand-ticked steps are stored; the others are read from the log (ladder.mjs).
    case 'ladder.tick': {
      const key = `${e.rep}|${e.step}`;
      if (state.reps.has(e.rep) && (SELF_STEPS.includes(e.step) || e.step === 'hour') && !state.ticks.has(key)) state.ticks.set(key, { t: e.t, by: typeof e.by === 'string' ? e.by : null });
      break;
    }
    case 'zones.pick': if (state.reps.has(e.rep) && Array.isArray(e.zones) && e.zones.length === 2 && e.zones.every((z) => typeof z === 'string' && z)) state.zones.set(e.rep, [...e.zones]); break;
    case 'video.seen': {
      if (!state.reps.has(e.rep) || !Object.hasOwn(VIDEOS, e.video)) break;
      (state.seen.get(e.rep) || state.seen.set(e.rep, new Set()).get(e.rep)).add(e.video);
      break;
    }
    // Minutes of video delivered and accepted in one week. The newest event for a week is the number.
    case 'hours.week': {
      if (typeof e.week === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(e.week) && validMinutes(e.delivered) && validMinutes(e.accepted)) state.hours.set(e.week, { delivered: e.delivered, accepted: e.accepted, source: typeof e.source === 'string' ? e.source : '', t: e.t });
      break;
    }
    // Accepted minutes of one site in one week. The newest event for the site and week is the number.
    case 'site.hours': {
      const s = state.sites.get(e.siteId);
      if (s && isMonday(e.week) && validMinutes(e.accepted)) (state.siteHours.get(s.id) || state.siteHours.set(s.id, new Map()).get(s.id)).set(e.week, { accepted: e.accepted, t: e.t });
      break;
    }
    // The pay per accepted hour, in cents, from a week on. The practice rate is its own event type and its own list.
    case 'pay.rate': case 'practice.pay.rate':
      if (Number.isInteger(e.cents) && e.cents > 0 && e.cents <= MAX_RATE_CENTS && isMonday(e.from)) (e.type === 'pay.rate' ? state.payRates : state.practiceRates).push({ cents: e.cents, from: e.from, t: e.t });
      break;
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
    // A business the practice rep added has its own event type, so an older build never takes it for a real one. A
    // lead.added that says practice (written in development before that) is read the same way.
    case 'lead.added': if (e.lead && typeof e.lead.id === 'string') state.appLeads.set(e.lead.id, { ...e.lead, createdAt: e.t }); break;
    case 'practice.lead.added': if (e.lead && typeof e.lead.id === 'string') state.appLeads.set(e.lead.id, { ...e.lead, practice: true, createdAt: e.t }); break;
    case 'lead.map': {
      state.appLeads.delete(e.temp);
      for (const log of state.logs.values()) if (log.lead.id === e.temp) log.lead = { ...log.lead, id: e.real };
      const a = state.leadFirstDay.get(e.temp), b = state.leadFirstDay.get(e.real);
      if (a) { state.leadFirstDay.set(e.real, b && b < a ? b : a); state.leadFirstDay.delete(e.temp); }
      break;
    }
    // The documents. Each event is checked again on replay with the rule the API uses, so one that does not hold (a
    // hand-edited log, a bad address) is ignored instead of reaching a screen.
    case 'doc.added': {
      if (typeof e.id !== 'string' || state.docs.has(e.id)) break;
      const c = checkDoc(e);
      if (c.doc) state.docs.set(e.id, { id: e.id, ...c.doc, order: Number.isInteger(e.order) && e.order >= 0 ? e.order : 0, t: e.t });
      break;
    }
    case 'doc.updated': {
      const d = state.docs.get(e.id); if (!d || !e.patch || typeof e.patch !== 'object') break;
      const c = checkDoc({ ...d, ...e.patch });
      if (c.doc) Object.assign(d, c.doc);
      break;
    }
    case 'doc.removed': state.docs.delete(e.id); break;
    default: break;   // unknown events are kept on disk and ignored here, so an older build can read a newer log
  }
  return state;
}

function addRep(state, e) {
  const tz = validTz(e.tz) ? e.tz : DEFAULT_TZ;   // a name the runtime does not know would break every later read
  const rep = { id: e.id, handle: e.handle, email: typeof e.email === 'string' ? e.email : '', name: e.name, role: e.role || 'rep', country: e.country || 'PA', city: e.city || '', tz,
    workdays: e.workdays?.length ? [...e.workdays] : [1, 2, 3, 4, 5], startDate: e.startDate || localDay(e.t, tz), lang: e.lang || 'es',
    active: true, photo: null, createdAt: e.t };
  if (e.practice === true) rep.practice = true;
  state.reps.set(rep.id, rep); state.handles.set(rep.handle, rep.id);
  if (rep.email) state.emails.set(rep.email, rep.id);
  if (!state.byRep.has(rep.id)) state.byRep.set(rep.id, []);
  if (!state.closesByRep.has(rep.id)) state.closesByRep.set(rep.id, []);
}

/** A practice site leaves with its workers; their phones are free again. */
function dropSite(state, s) {
  for (const id of s.workers) { const w = state.workers.get(id); if (w?.imei && state.imeis.get(imeiKey(s, w.imei)) === id) state.imeis.delete(imeiKey(s, w.imei)); state.workers.delete(id); }
  state.phoneLog = state.phoneLog.filter((p) => p.site !== s.id);
  state.feed = state.feed.filter((f) => f.ref !== s.id);
  state.siteHours.delete(s.id);
  state.sites.delete(s.id);
}

/** Everything that was the practice rep's own: its logs and what hangs off them, its closed days, goals, ticks, zones,
 *  videos, badges, sites and businesses, and its lines in the feed. */
function dropPractice(state, rep) {
  const id = rep.id, mine = (key) => key.startsWith(`${id}|`);
  for (const logId of state.byRep.get(id) || []) {
    for (const m of [state.logs, state.voids, state.held, state.confirms, state.plays]) m.delete(logId);
    for (const key of [...state.kudos.keys()]) if (key === logId || key.startsWith(`${logId}:`)) state.kudos.delete(key);
  }
  for (const m of [state.closes, state.picks, state.ticks]) for (const key of [...m.keys()]) if (mine(key)) m.delete(key);
  for (const key of [...state.dayoffs]) if (mine(key)) state.dayoffs.delete(key);
  for (const set of state.kudos.values()) set.delete(id);
  for (const s of [...state.sites.values()]) if (s.rep === id) dropSite(state, s);
  for (const [leadId, lead] of [...state.appLeads]) if (lead.by === id) state.appLeads.delete(leadId);
  state.badges = state.badges.filter((b) => b.rep !== id);
  state.feed = state.feed.filter((f) => f.rep !== id);
  for (const m of [state.byRep, state.closesByRep, state.zones, state.seen]) m.delete(id);
  state.handles.delete(rep.handle); state.reps.delete(id);
}

export const isOff = (state, rep, day) => state.dayoffs.has(`${rep.id}|${day}`) || state.dayoffs.has(`${rep.country}|${day}`) || state.dayoffs.has(`all|${day}`);
