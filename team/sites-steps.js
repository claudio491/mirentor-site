// sites-steps.js: what the earnings screens decide before they draw, away from the page so it can be tested. Money
// arrives as integer cents and becomes words here, at the display edge only; an amount the server sent as null (no rate
// in force) reads "monto por definir" and no number. The server stays the judge of who sees what: a teammate's entry
// holds site names and counts, never a worker.
import { hm } from './leader-steps.js';

/** Cents as US dollars, as Panama writes them: US$1,234.50. Null stays null. */
export function usd(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  const c = Math.round(Number(cents)), whole = Math.floor(Math.abs(c) / 100), part = String(Math.abs(c) % 100).padStart(2, '0');
  return `${c < 0 ? '-' : ''}US$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${part}`;
}
/** An amount as a person reads it: dollars to the cent, or "monto por definir". */
export const money = (cents, t) => usd(cents) ?? t('pay.tbd');

/** Where an amount comes from: the accepted hours times the rate per hour. With no rate, why there is no amount. */
export const paySource = (minutes, rate, t) => (rate == null ? t('pay.src.none') : t('pay.src', { h: hm(minutes || 0), r: usd(rate) }));

/** A teammate's line on the table: active sites, the week's accepted hours, the week's earnings. */
export function mateLine(entry, t) {
  if (!entry) return null;
  return [t('u.sites', { n: entry.sites.length }), hm(entry.minutes || 0), money(entry.cents, t)].join(' · ');
}

/** A teammate's card: each active site by name with its workers counted and its hours, the week's total and its source. */
export function mateCard(entry, rate, t) {
  return { sites: entry.sites.map((x) => ({ name: x.name, line: `${t('mate.workers', { n: x.workers })} · ${hm(x.minutes || 0)}` })),
    hours: hm(entry.minutes || 0), total: money(entry.cents, t), source: paySource(entry.minutes, entry.cents == null ? null : rate, t) };
}

/** The rows of "Mis sitios activos": who records, the phones on site, the consents, the hours of this week and the last,
 *  and what the site earned this week. */
export const siteRows = (active, t) => (active || []).map((x) => ({ id: x.id, name: x.name, practice: !!x.practice,
  facts: [t('sites.f.recording', { n: x.recording }), t('sites.f.phones', { n: x.phones }), t('sites.f.consents', { n: x.consents })].join(' · '),
  week: hm(x.week || 0), last: hm(x.last || 0), earned: money(x.cents, t) }));

/** Whether the Hoy entry to "Mis sitios activos" shows: only once the person has a site live. */
export const hasSites = (me) => !!(me && Array.isArray(me.active) && me.active.length);
