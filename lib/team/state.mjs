// state.mjs: the indexes every derivation reads, built by replaying events in order.
// Nothing here scores anything: it only files each event where score.mjs and view.mjs will look for it.
import { RULES, LOST_TAGS, checkNext, localDay, validTz, validMinutes, isCalendarDay, dayEndIso, KINDS, SELF_STEPS, VIDEOS, checkQ, mergeQ, qualOf, QUAL_KINDS } from './rules.mjs';
import { imeiFor, imeiKey } from './install.mjs';
import { checkDoc } from '../../team/docs-steps.js';
import { isMonday, MAX_RATE_CENTS } from './pay.mjs';
import { checkReport } from './report.mjs';
import { checkAdvance } from '../../team/route-steps.js';

const DEFAULT_TZ = 'America/Panama';
/** Phones asked or shipped at once: a whole number from 1 to 500. */
const phoneCount = (n) => Number.isInteger(n) && n >= 1 && n <= 500;
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
    leadMap: new Map(),       // temporary business id -> the id the CRM gave it (lead.map), kept for what a phone still sends under the old one
    feed: [],                 // { id, type, rep, t, ref } in order
    siteHours: new Map(),     // site id -> Map week (a Monday) -> { accepted, t }: accepted minutes; a later event for the week replaces it
    payRates: [],             // { cents, from, t } in order: cents per accepted hour, in force from the week `from`
    practiceRates: [],        // the same for practice reps only (the example team's rate): never read for a real person
    docs: new Map(),          // document id -> { id, title, note, url, group, lang, step, order, t }: filled at runtime by a manager
    siteReports: new Map(),   // `${site}|${day}` -> { id, siteId, day, by, leadName, report, t }: the newest daily report of a site for that day
    // lead id -> what the app said about a business over the CRM's row (biz.mjs reads it): { owner?, next?, lost?,
    // waitlist?, contact?, dnc?, q?, lower?, synced, at }. `lower: { from, day, t }`: a meeting or a contract that did not
    // happen, the CRM stage it had raised the business to, and the day it was logged. A key that is absent: the app never said anything; null: the app cleared it.
    biz: new Map(),
    qualified: [],            // { lead, rep, logId, t }: each time a business's qualification turned to yes (a void files it again: log.void)
    qSteps: new Map(),        // lead id -> [{ logId, q }] in event order: each answer a log (or its repeat) gave the business
    blockersSeen: new Set(),  // `${rep}|${day}`: a closed day's blocker someone marked seen
    missed: new Map(),        // log id -> { by, t }: a meeting or a contract a manager said never happened ("No ocurrió")
    alive: new Map(),         // log id -> time a manager said a stalled one is still alive ("Sigue viva")
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
      // the day the recipe was made for (a team loaded before this field has none: it reads as from an earlier day)
      state.reps.get(e.id).recipeDay = typeof e.recipeDay === 'string' ? e.recipeDay : null;
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
      // the qualification is kept only as one, and only on a conversation (QUAL_KINDS): a hand-edited line carries none
      if ('q' in log) { const q = QUAL_KINDS.includes(log.kind) ? checkQ(log.q) : null; if (q) log.q = q; else delete log.q; }
      // "Pide demo" is a meeting's, and only as true
      if (log.demo !== true || log.kind !== 'meeting') delete log.demo;
      state.logs.set(log.id, log); state.byRep.get(rep.id).push(log.id);
      // A practice contact never makes a real rep's first contact a follow-up.
      const first = state.leadFirstDay.get(log.lead.id);
      if (!rep.practice && (!first || log.day < first)) state.leadFirstDay.set(log.lead.id, log.day);
      state.feed.push({ id: log.id, type: 'log', rep: rep.id, t: e.t });
      bizFromLog(state, log.lead.id, rep, { ...e, q: log.q }, e.t, log.id);
      break;
    }
    // A row of the CRM's Activities, brought in by the nightly routine for a rep who logs there. Its own event type, so
    // an older build neither shows nor misdates it. It carries a day and no time: it is filed at the last minute of
    // that day (sorting after everything done in the app that day) and every answer shows the day, never that minute.
    case 'crm.log': {
      const rep = state.reps.get(e.rep);
      if (!rep || typeof e.id !== 'string' || state.logs.has(e.id) || !isCalendarDay(e.day) || !e.lead || typeof e.lead.id !== 'string' || !Object.hasOwn(KINDS, e.kind)) break;
      const t = dayEndIso(e.day, rep.tz);
      const log = { ...e, t, day: e.day, crm: true, importedAt: e.t };
      state.logs.set(log.id, log); state.byRep.get(rep.id).push(log.id);
      const first = state.leadFirstDay.get(log.lead.id);
      if (!rep.practice && (!first || log.day < first)) state.leadFirstDay.set(log.lead.id, log.day);
      // its line in the feed goes among that day's, not on top of today's
      const at = state.feed.findIndex((f) => f.t > t);
      state.feed.splice(at < 0 ? state.feed.length : at, 0, { id: log.id, type: 'log', rep: rep.id, t });
      break;
    }
    // Undoing an import: every CRM row of those days leaves exactly, with what hung off it, as if it never came.
    case 'crm.log.removed': {
      if (e.source !== 'crm' || !isCalendarDay(e.from) || !isCalendarDay(e.to)) break;
      for (const log of [...state.logs.values()]) if (log.crm && log.day >= e.from && log.day <= e.to) dropLog(state, log);
      break;
    }
    // A void takes back a "do not call" the log set, and the qualification it gave: the business's answers are folded
    // again from its other logs. It never moves the owner or the next step (a manager releases or gives the business instead).
    case 'log.void': {
      state.voids.set(e.logId, { by: e.by, reason: e.reason || '', t: e.t });
      const log = state.logs.get(e.logId), o = log && state.biz.get(log.lead.id);
      if (o?.dnc && o.dnc.logId === e.logId) bizChange(state, log.lead.id, { dnc: dncOf(state, log.lead.id) }, e.t);
      if (log && (state.qSteps.get(log.lead.id) || []).some((x) => x.logId === log.id)) {
        // "qualified" is true to what is left. When the folded answers still qualify the business, an entry whose own log
        // still stands is kept as it is (voiding another log never moves who qualified it, or when); only when none
        // stands is one filed for the latest step that still stands (its log, that log's rep and time). When they no
        // longer qualify it, its entries leave.
        const leadId = log.lead.id, q = qFold(state, leadId), yes = qualOf(q).state === 'yes';
        const stands = (x) => state.logs.has(x.logId) && !state.voids.has(x.logId);
        const kept = yes ? state.qualified.filter((x) => x.lead === leadId && stands(x)) : [];
        state.qualified = state.qualified.filter((x) => x.lead !== leadId || kept.includes(x));
        bizChange(state, leadId, { q }, e.t);
        const by = yes && !kept.length ? standingSteps(state, leadId).at(-1) : null, from = by && state.logs.get(by.logId);
        if (from) state.qualified.push({ lead: leadId, rep: from.rep, logId: from.id, t: from.t });
      }
      break;
    }
    // The same result on the same business the same day: the first log takes the details typed the second time, and
    // remembers when it last changed (`changedAt`), so the export sends it again after the CRM already had it.
    case 'log.update': {
      const log = state.logs.get(e.logId); if (!log || !e.patch) break;
      for (const k of ['channel', 'voicemail', 'tag', 'note', 'contact', 'phone', 'when', 'time', 'next', 'lost']) if (k in e.patch) log[k] = e.patch[k];
      // the qualification typed the second time joins the first, by the same rule as the business's, on a conversation
      // only (QUAL_KINDS); "Pide demo" is a meeting's
      const pq = QUAL_KINDS.includes(log.kind) ? checkQ(e.patch.q) : null;
      if (pq) log.q = mergeQ(log.q, pq);
      if ('demo' in e.patch && log.kind === 'meeting' && typeof e.patch.demo === 'boolean') { if (e.patch.demo) log.demo = true; else delete log.demo; }
      if (typeof e.t === 'string') log.changedAt = e.t;
      // the holder's repeat moves the business as a log would; a "do not call" marks it whoever writes it
      const rep = state.reps.get(log.rep), p = e.patch;
      if (rep && e.holds === true) bizFromLog(state, log.lead.id, rep, { holds: true, tag: log.tag, next: p.next, lost: p.lost, contact: p.contact, phone: p.phone, q: pq, by: e.by }, e.t, log.id);
      else if (rep && ('tag' in p || pq)) bizFromLog(state, log.lead.id, rep, { tag: log.tag, q: pq }, e.t, log.id);
      break;
    }
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
        practice: e.practice === true, legacy: e.legacy === true, phones: null, phonesAt: null, requested: null, phoneHist: [], prep: { signs: null, zones: null }, closed: null, workers: [] });
      // practice is nobody's news, and a legacy site was signed before the board: neither adds a line
      if (e.practice !== true && e.legacy !== true) state.feed.push({ id: `${e.id}:site_signed`, type: 'site_signed', rep: e.rep, t: e.t, ref: e.id });
    } break;
    // The advance a manager marks on a real site: the whole mark each time (a correction replaces it, both null clears
    // it). Checked again on replay: who wrote it (a manager or an admin), the site (not voided, not practice) and the
    // days (calendar days not after the writer's day): anything else changes nothing.
    case 'site.advance': {
      const s = state.sites.get(e.siteId), by = state.reps.get(e.by);
      if (!s || s.void || s.practice || !by || !['manager', 'admin'].includes(by.role) || typeof e.t !== 'string') break;
      const c = checkAdvance(e, localDay(e.t, by.tz || 'America/Panama'));
      if (!c.mark) break;
      if (c.mark.asked || c.mark.paid) s.advance = c.mark; else delete s.advance;
      break;
    }
    case 'site.step': { const s = state.sites.get(e.siteId); if (s && !s.steps[e.what]) { s.steps[e.what] = e.t; if (!s.practice && !s.legacy) state.feed.push({ id: `${s.id}:site_${e.what}`, type: `site_${e.what}`, rep: s.rep, t: e.t, ref: s.id }); } break; }
    // The first time the phones are marked is the day they arrived; a later count corrects the number, not the day.
    // It stays the correction that sets the total (install.mjs phonesOf replays the three in order).
    case 'site.phones': { const s = state.sites.get(e.siteId); if (s && Number.isInteger(e.count) && e.count >= 0) { s.phones = e.count; if (!s.phonesAt) s.phonesAt = e.t; s.phoneHist.push({ what: 'set', count: e.count, t: e.t }); } break; }
    // How many phones the site needs, said when it is opened or later. A later request replaces the earlier.
    case 'site.request': { const s = state.sites.get(e.siteId); if (s && phoneCount(e.count)) { s.requested = e.count; s.phoneHist.push({ what: 'request', count: e.count, t: e.t }); } break; }
    // A shipment: it adds to the phones that arrived. The first one is the day they arrived, as a first count is.
    case 'site.phones.added': { const s = state.sites.get(e.siteId); if (s && phoneCount(e.count)) { s.phones = (s.phones ?? 0) + e.count; if (!s.phonesAt) s.phonesAt = e.t; s.phoneHist.push({ what: 'added', count: e.count, t: e.t }); } break; }
    case 'site.prep': { const s = state.sites.get(e.siteId); if (s && (e.what === 'signs' || e.what === 'zones') && !s.prep[e.what]) s.prep[e.what] = e.t; break; }
    case 'site.coordinator': { const s = state.sites.get(e.siteId); if (s) s.coordinator = { name: String(e.name || ''), phone: String(e.phone || '') }; break; }
    // Only the practice site can be taken out: a real site stays in the log as it happened.
    case 'site.removed': { const s = state.sites.get(e.siteId); if (s && s.practice) dropSite(state, s); break; }
    // The same worker id again is the same worker, so a retry after a bad connection never doubles anyone.
    case 'worker.added': {
      const s = state.sites.get(e.siteId); if (!s || typeof e.id !== 'string' || state.workers.has(e.id)) break;
      const email = typeof e.email === 'string' ? e.email : '';
      // "No tiene correo": said on purpose, and only with no email
      state.workers.set(e.id, { id: e.id, site: s.id, name: String(e.name || ''), email, ...(e.noEmail === true && !email ? { noEmail: true } : {}), phone: e.phone !== false, consent: null, imei: null, clip: null, addedBy: e.by, t: e.t });
      s.workers.push(e.id);
      break;
    }
    // A past consent loaded on a legacy site may carry the day it was signed (signedOn); any other is signed when it is filed.
    case 'worker.consent': { const w = state.workers.get(e.workerId); if (w && typeof e.v === 'string' && typeof e.ext === 'string') w.consent = { v: e.v, ext: e.ext, form: e.form, t: e.t, ...(isCalendarDay(e.signedOn) ? { signedOn: e.signedOn } : {}) }; break; }
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
    // A name or an email typed wrong is written again. The first spelling stays in the log.
    case 'worker.edited': {
      const w = state.workers.get(e.workerId); if (!w || w.removed) break;
      if (typeof e.name === 'string' && e.name.trim()) w.name = e.name;
      if (typeof e.email === 'string') { w.email = e.email; if (e.noEmail === true && !e.email) w.noEmail = true; else delete w.noEmail; }
      break;
    }
    // A worker who should not be on the site leaves its list and its counts. On a real site they stay filed (their
    // consent photo stays on disk, and its address still answers) so the consent can be proven later; nobody holding a
    // phone leaves. A practice worker goes entirely. An older build ignores this event: the worker shows again there.
    case 'worker.removed': {
      const w = state.workers.get(e.workerId), s = w && state.sites.get(w.site);
      if (!w || !s || w.removed || w.imei) break;
      s.workers = s.workers.filter((id) => id !== w.id);
      if (s.practice) state.workers.delete(w.id); else w.removed = e.t;
      break;
    }
    case 'install.close': { const s = state.sites.get(e.siteId); if (s && !s.closed) s.closed = e.t; break; }
    // The first days' ladder. Only the hand-ticked steps are stored; the others are read from the log (ladder.mjs).
    case 'ladder.tick': {
      const key = `${e.rep}|${e.step}`;
      if (state.reps.has(e.rep) && (SELF_STEPS.includes(e.step) || e.step === 'hour') && !state.ticks.has(key)) state.ticks.set(key, { t: e.t, by: typeof e.by === 'string' ? e.by : null });
      break;
    }
    // A manager takes back the first approved hour ticked by mistake. Only that step is taken back this way; an older
    // build ignores the event and shows the step ticked.
    case 'ladder.untick': { if (e.step === 'hour') state.ticks.delete(`${e.rep}|hour`); break; }
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
    // A manager saw the blocker of a closed day: it leaves "Bloqueos de hoy" once that day is yesterday.
    case 'blocker.seen': if (state.reps.has(e.rep) && isCalendarDay(e.day)) state.blockersSeen.add(`${e.rep}|${e.day}`); break;
    // "No ocurrió", for a meeting or a contract (the one name for both): its pending part leaves, and the business's
    // holder (`rep`) gets the next step (`next`), checked against the holder's day of the event.
    case 'meeting.missed': {
      const log = state.logs.get(e.logId);
      if (!log || (log.kind !== 'meeting' && log.kind !== 'contract') || state.voids.has(log.id) || state.missed.has(log.id) || typeof e.t !== 'string') break;
      // a meeting confirmed held or a contract confirmed signed happened: a hand-edited line cannot say otherwise
      const done = state.confirms.get(log.id) || {};
      if (log.kind === 'meeting' ? done.meeting_held : done.contract_signed) break;
      state.missed.set(log.id, { by: typeof e.by === 'string' ? e.by : null, t: e.t });
      const changes = {};
      const rep = typeof e.rep === 'string' ? state.reps.get(e.rep) : null;
      if (rep && sameWorld(state, log.lead.id, rep)) {
        const c = checkNext(e.next, localDay(e.t, rep.tz));
        if (!c.error && c.next) changes.next = { ...c.next, rep: rep.id, t: e.t };
      }
      // the CRM stage this log had raised the business to (worked out here, never read from the line): the business goes
      // back from it (biz.mjs stageOf) and the export asks the CRM to lower it. A row imported from the CRM raised nothing.
      const author = state.reps.get(log.rep), from = raisedTo(log, state.confirms.get(log.id) || {});
      if (from && !log.crm && author && sameWorld(state, log.lead.id, author)) changes.lower = { from, day: log.day, t: e.t };
      if (Object.keys(changes).length) bizChange(state, log.lead.id, changes, e.t);
      break;
    }
    // "Sigue viva": a stalled meeting or contract leaves "Trabados" for RULES.stalledSnoozeDays.
    case 'stalled.alive': if (state.logs.has(e.logId) && typeof e.t === 'string') state.alive.set(e.logId, e.t); break;
    case 'goal.pick': state.picks.set(`${e.rep}|${e.week}`, e.k); break;
    case 'kudos': { const set = state.kudos.get(e.target) || new Set(); if (e.on) set.add(e.by); else set.delete(e.by); state.kudos.set(e.target, set); break; }
    case 'play': state.plays.set(e.logId, String(e.text || '').slice(0, 280)); break;
    case 'badge.give': state.badges.push({ id: e.id, rep: e.rep, text: e.text, by: e.by, t: e.t }); state.feed.push({ id: `badge:${e.id}`, type: 'badge', rep: e.rep, t: e.t, ref: e.id }); break;
    // The CRM gave a business added in the app its real id: every log and every site that named the temporary one follows.
    // A business the practice rep added has its own event type, so an older build never takes it for a real one. A
    // lead.added that says practice (written in development before that) is read the same way.
    case 'lead.added': if (e.lead && typeof e.lead.id === 'string') state.appLeads.set(e.lead.id, { ...e.lead, createdAt: e.t }); break;
    case 'practice.lead.added': if (e.lead && typeof e.lead.id === 'string') state.appLeads.set(e.lead.id, { ...e.lead, practice: true, createdAt: e.t }); break;
    case 'lead.map': {
      state.appLeads.delete(e.temp);
      // A business mapped to itself is one that leaves (an example team business, on removal): nothing else follows.
      if (e.real === e.temp) { state.biz.delete(e.temp); state.qSteps.delete(e.temp); state.qualified = state.qualified.filter((x) => x.lead !== e.temp); break; }
      // what the app said about it goes to the CRM's id, unless that id already has its own
      if (state.biz.has(e.temp)) { if (!state.biz.has(e.real)) state.biz.set(e.real, state.biz.get(e.temp)); state.biz.delete(e.temp); }
      // the answers given under the temporary id follow it (after any the CRM's id already had, as the overlay does)
      if (state.qSteps.has(e.temp)) { state.qSteps.set(e.real, [...(state.qSteps.get(e.real) || []), ...state.qSteps.get(e.temp)]); state.qSteps.delete(e.temp); }
      // kept for good: a phone that still holds the temporary id (a log in its queue, a screen opened before) is read through it.
      // The id mapped to is the current one, so whatever it pointed to before no longer applies.
      state.leadMap.delete(e.real); state.leadMap.set(e.temp, e.real);
      for (const x of state.qualified) if (x.lead === e.temp) x.lead = e.real;
      // a log that now names the CRM's id has changed: the export sends it, and its stage, again under that id
      for (const log of state.logs.values()) if (log.lead.id === e.temp) { log.lead = { ...log.lead, id: e.real }; if (typeof e.t === 'string') log.changedAt = e.t; }
      // the site opened for it too: its route finds it under the CRM's id, and no second site is opened (and paid) for it
      for (const s of state.sites.values()) if (s.lead.id === e.temp) s.lead = { ...s.lead, id: e.real };
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
      if (c.doc) { Object.assign(d, c.doc); if (!c.doc.body) delete d.body; }   // a text cleared goes
      break;
    }
    case 'doc.removed': state.docs.delete(e.id); break;
    // The daily site report. A later one for the same site and day replaces the earlier; every one stays in the log.
    // Checked again on replay with the rule the API uses, so a hand-edited line never reaches the sheet.
    case 'site.report': {
      const s = state.sites.get(e.siteId);
      if (!s || typeof e.id !== 'string' || !isCalendarDay(e.day)) break;
      const c = checkReport(e.report);
      if (c.report) state.siteReports.set(`${s.id}|${e.day}`, { id: e.id, siteId: s.id, day: e.day, by: typeof e.by === 'string' ? e.by : null, leadName: typeof e.leadName === 'string' ? e.leadName : '', report: c.report, t: e.t });
      break;
    }
    // The business overlay, written outside a log. Each is checked again on replay: a malformed line changes nothing.
    // The holder (or a manager acting as the practice rep) moves the next step.
    case 'biz.next': {
      const rep = state.reps.get(e.rep);
      if (typeof e.lead !== 'string' || !rep || !sameWorld(state, e.lead, rep) || typeof e.t !== 'string') break;
      const c = checkNext(e.next, localDay(e.t, rep.tz));
      if (!c.error && 'next' in c) bizChange(state, e.lead, { next: c.next ? { ...c.next, rep: rep.id, t: e.t } : null }, e.t);
      break;
    }
    // Released (owner: null) or given to an active rep of the business's world.
    case 'biz.owner': {
      if (typeof e.lead !== 'string' || typeof e.t !== 'string') break;
      const rep = e.owner === null ? null : state.reps.get(e.owner);
      if (e.owner !== null && (!rep || rep.role !== 'rep' || !rep.active || !sameWorld(state, e.lead, rep))) break;
      bizChange(state, e.lead, { owner: { rep: rep ? rep.id : null, by: typeof e.by === 'string' ? e.by : null, t: e.t } }, e.t);
      break;
    }
    // Lost or Waitlist taken back, for the rep whose screens wrote it (`rep`; an older line names only `by`).
    case 'biz.reopen': {
      const rep = state.reps.get(typeof e.rep === 'string' ? e.rep : e.by);
      if (typeof e.lead !== 'string' || typeof e.t !== 'string' || !rep || !sameWorld(state, e.lead, rep)) break;
      bizChange(state, e.lead, reopening(state.biz.get(e.lead)), e.t);
      break;
    }
    // A push of the CRM carried the app's value: from now on the CRM's cell is the truth for these fields. `at` stays.
    case 'biz.synced': {
      const o = typeof e.lead === 'string' && state.biz.get(e.lead);
      if (o && Array.isArray(e.fields)) for (const f of e.fields) if (SYNC_FIELDS.includes(f)) o.synced.add(f);
      break;
    }
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

/** One log leaves with what hangs off it: its void, held mark, confirmations, play, claps and feed lines. The first day
 *  anyone logged its business is worked out again from the logs that stay. */
function dropLog(state, log) {
  const id = log.id;
  state.logs.delete(id);
  state.byRep.set(log.rep, (state.byRep.get(log.rep) || []).filter((x) => x !== id));
  for (const m of [state.voids, state.held, state.confirms, state.plays, state.missed, state.alive]) m.delete(id);
  for (const key of [...state.kudos.keys()]) if (key === id || key.startsWith(`${id}:`)) state.kudos.delete(key);
  state.feed = state.feed.filter((f) => f.id !== id && f.ref !== id && !f.id.startsWith(`${id}:`));
  let first = null;
  for (const l of state.logs.values()) if (l.lead.id === log.lead.id && !state.reps.get(l.rep)?.practice && (!first || l.day < first)) first = l.day;
  if (first) state.leadFirstDay.set(log.lead.id, first); else state.leadFirstDay.delete(log.lead.id);
}

/** A practice site leaves with its workers; their phones are free again. */
function dropSite(state, s) {
  for (const id of s.workers) { const w = state.workers.get(id); if (w?.imei && state.imeis.get(imeiKey(s, w.imei)) === id) state.imeis.delete(imeiKey(s, w.imei)); state.workers.delete(id); }
  state.phoneLog = state.phoneLog.filter((p) => p.site !== s.id);
  state.feed = state.feed.filter((f) => f.ref !== s.id);
  state.siteHours.delete(s.id);
  for (const key of [...state.siteReports.keys()]) if (key.startsWith(`${s.id}|`)) state.siteReports.delete(key);
  state.sites.delete(s.id);
}

/** Everything that was the practice rep's own: its logs and what hangs off them, its closed days, goals, ticks, zones,
 *  videos, badges, sites and businesses, and its lines in the feed. */
function dropPractice(state, rep) {
  const id = rep.id, mine = (key) => key.startsWith(`${id}|`);
  for (const logId of state.byRep.get(id) || []) {
    for (const m of [state.logs, state.voids, state.held, state.confirms, state.plays, state.missed, state.alive]) m.delete(logId);
    for (const key of [...state.kudos.keys()]) if (key === logId || key.startsWith(`${logId}:`)) state.kudos.delete(key);
  }
  for (const m of [state.closes, state.picks, state.ticks]) for (const key of [...m.keys()]) if (mine(key)) m.delete(key);
  for (const key of [...state.dayoffs]) if (mine(key)) state.dayoffs.delete(key);
  for (const set of state.kudos.values()) set.delete(id);
  for (const s of [...state.sites.values()]) if (s.rep === id) dropSite(state, s);
  for (const [leadId, lead] of [...state.appLeads]) if (lead.by === id) { state.appLeads.delete(leadId); state.biz.delete(leadId); state.qSteps.delete(leadId); }
  state.badges = state.badges.filter((b) => b.rep !== id);
  state.qualified = state.qualified.filter((x) => x.rep !== id);
  state.feed = state.feed.filter((f) => f.rep !== id);
  for (const m of [state.byRep, state.closesByRep, state.zones, state.seen]) m.delete(id);
  state.handles.delete(rep.handle); state.reps.delete(id);
}

// ---- the business overlay (biz.mjs reads it) ----

/** The fields a push of the CRM can carry back: once it does, the CRM's cell wins for that field. */
const SYNC_FIELDS = ['owner', 'next', 'stage', 'contact', 'phone', 'workers', 'qual', 'lower'];
/** Which synced field each overlay key is. */
const FIELD = { owner: 'owner', next: 'next', lost: 'stage', waitlist: 'stage', lower: 'lower' };
/** The CRM stage an app log raised its business to (what the export's stages sent for it), or null when it raised it no
 *  further than Contacted: a meeting to Intro call booked (done once confirmed held), a contract to Contract sent (signed
 *  once confirmed) only once its sending was confirmed. */
const raisedTo = (log, conf) => (log.kind === 'meeting' ? (conf.meeting_held ? 'Intro call done' : 'Intro call booked')
  : log.kind === 'contract' && conf.contract_sent ? (conf.contract_signed ? 'Contract signed' : 'Contract sent') : null);
/** A practice rep writes on practice businesses only, and a real rep on real ones. */
const sameWorld = (state, leadId, rep) => !!rep.practice === !!state.appLeads.get(leadId)?.practice;
const textOf = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : '').slice(0, max);
/** Whether two values of one overlay key say the same (the time they were said aside). */
function same(key, a, b) {
  if (a === undefined || b === undefined) return a === b;
  if (a === null || b === null) return a === b;
  if (key === 'owner') return a.rep === b.rep;
  if (key === 'next') return a.day === b.day && a.step === b.step;
  if (key === 'lost') return a.reason === b.reason;
  if (key === 'dnc') return a.logId === b.logId;
  if (key === 'lower') return a.from === b.from && a.day === b.day;
  if (key === 'q') return ['workers', 'wifi', 'lead'].every((k) => a[k] === b[k]);
  return key === 'waitlist' || a === b;
}
/** What a reopen changes: Lost and Waitlist are taken back. Said again after the CRM took the first one, it counts again. */
function reopening(o) {
  const out = {};
  if (o?.lost !== null || o.synced.has('stage')) out.lost = null;
  if (o?.waitlist) out.waitlist = null;
  return out;
}
/** The newest "do not call" on a business that still stands, or null. */
function dncOf(state, leadId) {
  let hit = null;
  for (const l of state.logs.values()) {
    const rep = state.reps.get(l.rep);
    if (l.lead.id === leadId && l.tag === 'do_not_call' && !state.voids.has(l.id) && rep && sameWorld(state, leadId, rep) && (!hit || l.t >= hit.t)) hit = l;
  }
  return hit ? { logId: hit.id, t: hit.t } : null;
}
/** Lays `changes` over a business's overlay. A key counts when its value really changes, or when its field is synced
 *  (the CRM's cell is in force, so the same value said again wins again): it leaves `synced` (the app holds a value the
 *  CRM does not have yet) and the overlay's `at` becomes `t`. Nothing changes, nothing is made. */
function bizChange(state, leadId, changes, t, by = null) {
  let o = state.biz.get(leadId);
  const contactKey = (k) => k === 'contact' || k === 'phone';
  // the qualification counts only when an answer really changes: the same answers said again are not news to the CRM
  const changed = Object.keys(changes).filter((k) => (k !== 'q' && o && o.synced.has(contactKey(k) ? k : FIELD[k]))
    || (contactKey(k) ? o?.contact?.[k === 'contact' ? 'name' : 'phone'] !== changes[k] : !same(k, o?.[k], changes[k])));
  if (!changed.length) return;
  if (!o) { o = { synced: new Set(), at: t }; state.biz.set(leadId, o); }
  for (const k of changed) {
    if (contactKey(k)) { o.contact = { ...o.contact, [k === 'contact' ? 'name' : 'phone']: changes[k] }; o.synced.delete(k); continue; }
    if (k === 'q') {
      // a change leaves 'qual' (and 'workers', when the range changed) for the export; turning to yes is filed once.
      // A void can leave no answer at all (null).
      if (o.q?.workers !== changes.q?.workers) o.synced.delete('workers');
      o.synced.delete('qual');
      if (qualOf(o.q).state !== 'yes' && qualOf(changes.q).state === 'yes' && by) state.qualified.push({ lead: leadId, rep: by.rep, logId: by.logId, t });
      o.q = changes.q;
      continue;
    }
    o[k] = changes[k];
    if (FIELD[k]) o.synced.delete(FIELD[k]);
  }
  o.at = t;
}
/** What one log (or its same-day repeat) does to its business. A "do not call" marks it whoever logs it. Everything else
 *  moves only when the log holds the business (`holds`) or takes it (`took`): the take, the next step, Lost with its
 *  reason, Waitlist, a reopen, and the contact and phone. Each value is checked again here, so a malformed line changes
 *  nothing; a log of the other world (practice on a real business, or the reverse) changes nothing at all. */
function bizFromLog(state, leadId, rep, f, t, logId) {
  if (!sameWorld(state, leadId, rep) || typeof t !== 'string') return;
  const o = state.biz.get(leadId), changes = {};
  if (f.tag === 'do_not_call') changes.dnc = { logId, t };
  else if (o?.dnc && o.dnc.logId === logId) changes.dnc = dncOf(state, leadId);   // its repeat changed the tag
  if (f.holds === true || f.took === true) {
    if (f.took === true) changes.owner = { rep: rep.id, by: typeof f.by === 'string' ? f.by : rep.id, t };
    if (LOST_TAGS.includes(f.tag)) {
      if (RULES.lostReasons.includes(f.lost)) { changes.lost = { reason: f.lost, rep: rep.id, t }; changes.next = null; if (o?.waitlist) changes.waitlist = null; }
    } else if (f.tag === 'waitlist') {
      changes.waitlist = { rep: rep.id, t }; changes.next = null;
      if (o?.lost) changes.lost = null;
    } else {
      // a later result opens a Lost or Waitlist business again: one the app closed (and the CRM has not taken over), or
      // one the API saw closed (lost: null, the CRM's Lost included)
      if (f.lost === null || ((o?.lost || o?.waitlist) && !o.synced.has('stage'))) Object.assign(changes, reopening(o));
      const c = checkNext(f.next, localDay(t, rep.tz));
      if (!c.error && 'next' in c) changes.next = c.next ? { ...c.next, rep: rep.id, t } : null;
    }
    const name = textOf(f.contact, 120), phone = textOf(f.phone, 40);
    if (name) changes.contact = name;
    if (phone) changes.phone = phone;
  }
  // the qualification is a fact about the business, not a move of it: any log of its world says it
  const q = checkQ(f.q);
  if (q) {
    changes.q = mergeQ(o?.q, q);
    (state.qSteps.get(leadId) || state.qSteps.set(leadId, []).get(leadId)).push({ logId, q });
  }
  bizChange(state, leadId, changes, t, { rep: rep.id, logId });
}
/** A business's qualification folded again (mergeQ, in event order) from the answers its logs gave that still stand:
 *  a voided log's are left out. Null when none is left. */
function qFold(state, leadId) {
  let q = null;
  for (const x of standingSteps(state, leadId)) q = mergeQ(q, x.q);
  return q;
}
/** A business's answer steps whose log still stands (filed, not voided), in event order. */
const standingSteps = (state, leadId) => (state.qSteps.get(leadId) || []).filter((x) => state.logs.has(x.logId) && !state.voids.has(x.logId));

/** The id a business has now: a temporary id the CRM has since mapped (once or more) reads as the CRM's own. Any other
 *  id is answered as it is. */
export function realLeadId(state, id) {
  let at = id;
  for (let i = 0; i < 20 && state.leadMap.has(at); i += 1) at = state.leadMap.get(at);
  return at;
}

export const isOff = (state, rep, day) => state.dayoffs.has(`${rep.id}|${day}`) || state.dayoffs.has(`${rep.country}|${day}`) || state.dayoffs.has(`all|${day}`);
