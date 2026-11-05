// entry.mjs: turns a form post into a checked entry, and an entry into Leads tab cells.
// The checks mirror the site's own (src/js/chapters/ch09.js), so a visitor who passed the page passes here.

const MAX = 200;
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const PHONE = /^(\+|00)[1-9]\d{7,14}$/;

export const INDUSTRY = {
  warehouse: 'Warehouse or logistics',
  construction: 'Construction',
  workshop: 'Workshop or manufacturing',
  other: 'Other hands-on work',
  office: 'Office or services',
};
export const COUNTRY = { PA: 'Panama', CO: 'Colombia', PE: 'Peru', MX: 'Mexico', US: 'United States', other: 'Other' };
const LANGUAGE = { es: 'Spanish', en: 'English' };

const text = (v) => String(v ?? '').trim().replace(/\s+/g, ' ').slice(0, MAX);
/** A site answer: 'yes', 'no', '' when the page did not ask (one cached from before the question), or null when bad. */
const yesNo = (v) => { const s = text(v).toLowerCase(); return s === 'yes' || s === 'no' || s === '' ? s : null; };

/** The whole number people type ("120", "1.200", "1,200", "1 200"); NaN when it is not one. */
export function parseWorkers(raw) {
  const s = text(raw);
  const n = /^\d+$/.test(s) ? Number(s) : /^\d{1,3}([.,\s]\d{3})+$/.test(s) ? Number(s.replace(/[.,\s]/g, '')) : NaN;
  return Number.isInteger(n) && n > 0 ? n : NaN;
}

export function parseEntry(body, now = new Date()) {
  const b = body && typeof body === 'object' ? body : {};
  if (text(b.website)) return { ok: true, spam: true };

  const entry = {
    id: text(b.id).toLowerCase(),
    lang: b.lang === 'en' ? 'en' : 'es',
    business: text(b.business),
    workers: parseWorkers(b.workers),
    industry: text(b.industry),
    city: text(b.city),
    country: text(b.country),
    contact: text(b.contact),
    email: text(b.email).toLowerCase(),
    whatsapp: text(b.whatsapp),
    payAck: b.pay_ack === 'yes' || b.pay_ack === true,
    siteWifi: yesNo(b.site_wifi),
    siteLead: yesNo(b.site_lead),
  };

  const errors = [];
  if (!ID.test(entry.id)) errors.push('id');
  if (!entry.business) errors.push('business');
  if (!Number.isFinite(entry.workers)) errors.push('workers');
  if (!INDUSTRY[entry.industry]) errors.push('industry');
  if (!entry.city) errors.push('city');
  if (!COUNTRY[entry.country]) errors.push('country');
  if (!entry.contact) errors.push('contact');
  if (!EMAIL.test(entry.email)) errors.push('email');
  if (entry.whatsapp && !PHONE.test(entry.whatsapp.replace(/[\s().-]/g, ''))) errors.push('whatsapp');
  if (!entry.payAck) errors.push('pay_ack');
  if (entry.siteWifi === null) errors.push('site_wifi');
  if (entry.siteLead === null) errors.push('site_lead');
  if (errors.length) return { ok: false, errors };

  entry.leadId = `WL-${entry.id.replace(/-/g, '').slice(0, 8).toUpperCase()}`;
  entry.submittedAt = now.toISOString();
  return { ok: true, entry };
}

/** Column Z, "Site criteria": the two things a site needs (Wi-Fi and a person to run the program) in plain words. */
export function siteCriteria(wifi = '', lead = '') {
  if (!wifi || !lead) return '';
  const missing = [wifi === 'no' && 'Wi-Fi', lead === 'no' && 'program lead'].filter(Boolean);
  return missing.length ? `Missing ${missing.join(' and ')}` : 'Meets';
}

/** Leads columns A to P (Q to T are formulas and never written), the Notes cell (Y) and Site criteria (Z). */
export function toCells(e) {
  const language = LANGUAGE[e.lang];
  const aToP = [
    e.leadId, e.business, e.contact, '', e.email, e.whatsapp, '',
    e.city, COUNTRY[e.country], INDUSTRY[e.industry], e.workers, 'Waitlist form',
    `Site form, ${e.submittedAt.slice(0, 10)}, ${language} page`, language, '', 'Waitlist',
  ];
  const answered = e.siteWifi && e.siteLead;
  const notes = `Pay rule acknowledged on the form.${answered ? ` Site: Wi-Fi ${e.siteWifi}, program lead ${e.siteLead}.` : ''}`;
  return { aToP, notes, site: siteCriteria(e.siteWifi, e.siteLead) };
}
