// store.mjs: the team's source of truth on disk. Every change is one JSON line in team/events.jsonl, replayed on open.
// The lead list the reps pick from is a cache in team/leads.json, pushed by the nightly CRM routine.
import { appendFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import path from 'node:path';
import { emptyState, applyEvent } from './state.mjs';

const CLOSED_STAGES = new Set(['Contract signed', 'Setup day set', 'Live']);
const norm = (s) => String(s || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();

/** Leads a rep may pick: in their city, not signed, not marked do-not-call. Accents and case are ignored. */
export function searchLeads(leads, q, city, limit = 20) {
  const needle = norm(q);
  if (!needle) return [];
  const where = norm(city), out = [];
  for (const lead of leads.values()) {
    if (lead.doNotCall || CLOSED_STAGES.has(lead.stage)) continue;
    if (where && lead.city && norm(lead.city) !== where) continue;
    if (!norm(lead.company).includes(needle)) continue;
    out.push(lead);
    if (out.length >= limit) break;
  }
  return out;
}

export function openTeamStore(dir, { now = () => new Date().toISOString() } = {}) {
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
      try { e = JSON.parse(line); } catch { console.error('team store: skipped a line that is not JSON'); continue; }
      applyEvent(state, e);
    }
  }
  let leads = new Map();
  if (existsSync(leadsFile)) { try { leads = new Map(JSON.parse(readFileSync(leadsFile, 'utf8')).map((l) => [l.id, l])); } catch { console.error('team store: leads.json unreadable, starting empty'); } }
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
    /** Replace the CRM's leads. Businesses added in the app that the CRM does not know yet are kept. */
    setLeads(list) {
      const next = new Map(list.filter((l) => l && l.id && l.company).map((l) => [String(l.id), { ...l, id: String(l.id) }]));
      for (const l of leads.values()) if (l.app && !next.has(l.id)) next.set(l.id, l);
      leads = next; saveLeads();
      return leads.size;
    },
    addLead({ company, zone = '', city = '', by = null }) {
      let id;
      do { id = `APP-${randomBytes(4).toString('hex').toUpperCase()}`; } while (leads.has(id));
      const lead = { id, company: String(company).trim().slice(0, 120), zone: String(zone).trim().slice(0, 80), city, stage: 'New', app: true, by, createdAt: now() };
      leads.set(id, lead); saveLeads();
      return lead;
    },
    /** The CRM gave a business added in the app its real id: logs and the list follow. */
    mapLead(temp, real) {
      const lead = leads.get(temp);
      if (!lead) return false;
      append({ type: 'lead.map', temp, real });
      leads.delete(temp); leads.set(real, { ...lead, id: real, app: false }); saveLeads();
      return true;
    },
    /** Remember the last contact day, so a later log on this business counts as a follow-up even before the next CRM load. */
    touchLead(id, day) { const l = leads.get(id); if (l && (!l.lastContactApp || l.lastContactApp < day)) { l.lastContactApp = day; } },
  };
}
