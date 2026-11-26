// lead-fields.mjs: what one business of the CRM's lead list may carry when the bridge pushes it (PUT leads). Only the
// CRM's own columns are kept, each in the shape it should have: text trimmed and capped, links only http(s), days only
// real days, numbers only finite numbers. Anything else a push carries (a key the app sets itself, like `app`,
// `practice` or `by`) is dropped, so the cache never holds what the CRM cannot say.
import { isCalendarDay } from './rules.mjs';

/** The keys a pushed business keeps, in the CRM's order. */
export const LEAD_KEYS = ['id', 'company', 'type', 'stage', 'owner', 'nextDay', 'nextStep', 'lastContact', 'contact', 'title', 'phone', 'email', 'industry', 'category', 'city', 'zone',
  'address', 'website', 'maps', 'walkin', 'rating', 'reviews', 'workers', 'doNotCall', 'notes'];

/** The same rule as api.mjs: only a string or a number is read; whitespace collapses, trims and caps. */
const text = (v, max) => (typeof v === 'string' || typeof v === 'number' ? String(v) : '').replace(/\s+/g, ' ').trim().slice(0, max);
const NAME = 120;
const CAPS = { company: NAME, type: NAME, stage: NAME, owner: NAME, contact: NAME, title: NAME, industry: NAME, category: NAME, city: NAME, zone: NAME,
  phone: 40, email: 200, address: 200, nextStep: 200, notes: 600 };
const LINK_MAX = 300;

/** One business as the cache keeps it, or null when it has no id or no name. */
export function cleanLead(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  if (typeof raw.id !== 'string' && typeof raw.id !== 'number') return null;
  const id = String(raw.id), company = typeof raw.company === 'string' ? text(raw.company, NAME) : '';
  if (!id || !company) return null;
  const out = { id };
  for (const key of LEAD_KEYS) {
    if (key === 'id') continue;
    const v = raw[key];
    if (Object.hasOwn(CAPS, key)) { const t = text(v, CAPS[key]); if (t) out[key] = t; continue; }
    if (key === 'website' || key === 'maps') { if (typeof v === 'string' && /^https?:\/\//i.test(v.trim()) && v.trim().length <= LINK_MAX) out[key] = v.trim(); continue; }
    if (key === 'nextDay' || key === 'lastContact') { if (isCalendarDay(v)) out[key] = v; continue; }
    if (key === 'doNotCall') { if (v === true) out[key] = true; continue; }
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;   // walkin, rating, reviews, workers
  }
  return out;
}
