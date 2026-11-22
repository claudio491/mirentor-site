// store.mjs: the team's source of truth on disk. Every change is one JSON line in team/events.jsonl, replayed on open.
// The lead list the reps pick from is a cache in team/leads.json, pushed by the nightly CRM routine.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { emptyState, applyEvent } from './state.mjs';

const CLOSED_STAGES = new Set(['Contract signed', 'Setup day set', 'Live']);
export const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** A lead a rep may pick: in their city, not signed, not marked do-not-call. Accents and case are ignored. A business the
 *  practice rep added is offered to the practice rep only (`practice`). */
export function pickable(lead, city, { practice = false } = {}) {
  if (lead.doNotCall || CLOSED_STAGES.has(lead.stage) || (lead.practice && !practice)) return false;
  const where = norm(city);
  return !(where && lead.city && norm(lead.city) !== where);
}

/** Matches by name. With `zones` (the rep's picked areas), leads in those areas come first; the order inside each group is unchanged. */
export function searchLeads(leads, q, city, limit = 20, zones = null, { practice = false } = {}) {
  const needle = norm(q);
  if (!needle) return [];
  const mine = Array.isArray(zones) && zones.length ? new Set(zones.map(norm)) : null;
  const out = [];
  for (const lead of leads.values()) {
    if (!pickable(lead, city, { practice })) continue;
    if (!norm(lead.company).includes(needle)) continue;
    out.push(lead);
    if (!mine && out.length >= limit) break;
  }
  if (!mine) return out;
  return [...out.filter((l) => mine.has(norm(l.zone))), ...out.filter((l) => !mine.has(norm(l.zone)))].slice(0, limit);
}

/** A business already on the list with this name and area in this city, whatever its stage. Typing it again as new finds it.
 *  A practice business is found only for the practice rep: for anyone else the same name is a new business. */
export function findLead(leads, name, zone, city, { practice = false } = {}) {
  const n = norm(name), z = norm(zone), where = norm(city);
  if (!n) return null;
  for (const lead of leads.values()) {
    if (lead.practice && !practice) continue;
    if (norm(lead.company) !== n || norm(lead.zone) !== z) continue;
    if (where && lead.city && norm(lead.city) !== where) continue;
    return lead;
  }
  return null;
}

export function openTeamStore(dir, { now = () => new Date().toISOString(), log = console.error } = {}) {
  const folder = path.join(dir, 'team');
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, 'events.jsonl'), leadsFile = path.join(folder, 'leads.json');
  const state = emptyState();
  let endsClean = true;
  if (existsSync(file)) {
    const text = readFileSync(file, 'utf8');
    endsClean = text === '' || text.endsWith('\n');
    for (const line of text.split('\n')) {
      if (!line) continue;
      let e;
      try { e = JSON.parse(line); } catch { log('team store: skipped a line that is not JSON'); continue; }
      // One line the reducer cannot apply must not keep the whole service from starting.
      try { applyEvent(state, e); } catch (err) { log(`team store: skipped an event the reducer could not apply (${e && e.type}): ${err.message}`); }
    }
  }
  let leads = new Map();
  if (existsSync(leadsFile)) { try { leads = new Map(JSON.parse(readFileSync(leadsFile, 'utf8')).map((l) => [l.id, l])); } catch { log('team store: leads.json unreadable, starting empty'); leads = new Map(); } }
  // The event log is the truth for businesses added in the app: if the cache lost them, they come back from it.
  for (const l of state.appLeads.values()) if (!leads.has(l.id)) leads.set(l.id, { ...l, stage: 'New', app: true });
  // ...and a practice business the log no longer holds (its practice rep was removed) leaves the cache.
  for (const l of [...leads.values()]) if (l.practice && !state.appLeads.has(l.id)) leads.delete(l.id);
  const saveLeads = () => { const tmp = `${leadsFile}.tmp`; writeFileSync(tmp, JSON.stringify([...leads.values()])); renameSync(tmp, leadsFile); };

  function append(e) {
    const ev = { t: e.t || now(), ...e };
    // A write cut short by a crash leaves a line without its newline: start on a fresh line so nothing is glued to it.
    appendFileSync(file, `${endsClean ? '' : '\n'}${JSON.stringify(ev)}\n`);
    endsClean = true;
    applyEvent(state, ev);
    return ev;
  }

  return {
    dir: folder, state, append,
    leads: () => leads,
    /** How many businesses came from the CRM (not added in the app). */
    crmCount: () => [...leads.values()].filter((l) => !l.app).length,
    /** Replace the CRM's leads. Businesses added in the app that the CRM does not know yet are kept. */
    setLeads(list) {
      const next = new Map(list.filter((l) => l && (typeof l.id === 'string' || typeof l.id === 'number') && typeof l.company === 'string' && String(l.id) && l.company.trim()).map((l) => [String(l.id), { ...l, id: String(l.id) }]));
      for (const l of leads.values()) if (l.app && !next.has(l.id)) next.set(l.id, l);
      leads = next; saveLeads();
      return leads.size;
    },
    /** A business a rep adds from the field. It is written to the event log first, so it never depends on the cache.
     *  One the practice rep adds is a practice business: never exported, never offered to a real rep. `actor` is the
     *  manager who typed it while acting as the practice rep. */
    addLead({ company, zone = '', city = '', by = null, practice = false, actor = null }) {
      let id;
      do { id = `APP-${randomBytes(4).toString('hex').toUpperCase()}`; } while (leads.has(id) || state.appLeads.has(id));
      const ev = append({ type: 'lead.added', lead: { id, company: String(company).trim().slice(0, 120), zone: String(zone).trim().slice(0, 80), city, by, ...(practice ? { practice: true } : {}) }, ...(actor ? { by: actor } : {}) });
      const lead = { ...ev.lead, stage: 'New', app: true, createdAt: ev.t };
      leads.set(id, lead); saveLeads();
      return lead;
    },
    /** The practice businesses of a rep that was just removed leave the list with it. */
    dropPracticeLeads(repId) {
      let gone = 0;
      for (const l of [...leads.values()]) if (l.practice && l.by === repId) { leads.delete(l.id); gone += 1; }
      if (gone) saveLeads();
      return gone;
    },
    /** The CRM gave a business added in the app its real id: logs and the list follow. */
    mapLead(temp, real) {
      const lead = leads.get(temp) || state.appLeads.get(temp);
      if (!lead) return false;
      append({ type: 'lead.map', temp, real });
      leads.delete(temp);
      if (!leads.has(real)) leads.set(real, { ...lead, id: real, app: false });   // the CRM's own record, when it is already here, stays as it is
      saveLeads();
      return true;
    },
  };
}
