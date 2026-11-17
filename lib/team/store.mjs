// store.mjs: the team's source of truth on disk. Every change is one JSON line in team/events.jsonl, replayed on open.
// The lead list the reps pick from is a cache in team/leads.json, pushed by the nightly CRM routine.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { emptyState, applyEvent } from './state.mjs';

const CLOSED_STAGES = new Set(['Contract signed', 'Setup day set', 'Live']);
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** A lead a rep may pick: in their city, not signed, not marked do-not-call. Accents and case are ignored. */
export function pickable(lead, city) {
  if (lead.doNotCall || CLOSED_STAGES.has(lead.stage)) return false;
  const where = norm(city);
  return !(where && lead.city && norm(lead.city) !== where);
}

export function searchLeads(leads, q, city, limit = 20) {
  const needle = norm(q);
  if (!needle) return [];
  const out = [];
  for (const lead of leads.values()) {
    if (!pickable(lead, city)) continue;
    if (!norm(lead.company).includes(needle)) continue;
    out.push(lead);
    if (out.length >= limit) break;
  }
  return out;
}

/** A business already on the list with this name and area in this city, whatever its stage. Typing it again as new finds it. */
export function findLead(leads, name, zone, city) {
  const n = norm(name), z = norm(zone), where = norm(city);
  if (!n) return null;
  for (const lead of leads.values()) {
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
    /** A business a rep adds from the field. It is written to the event log first, so it never depends on the cache. */
    addLead({ company, zone = '', city = '', by = null }) {
      let id;
      do { id = `APP-${randomBytes(4).toString('hex').toUpperCase()}`; } while (leads.has(id) || state.appLeads.has(id));
      const ev = append({ type: 'lead.added', lead: { id, company: String(company).trim().slice(0, 120), zone: String(zone).trim().slice(0, 80), city, by } });
      const lead = { ...ev.lead, stage: 'New', app: true, createdAt: ev.t };
      leads.set(id, lead); saveLeads();
      return lead;
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
