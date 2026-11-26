// sites-steps.js: what the earnings screens decide before they draw, away from the page so it can be tested. Money
// arrives as integer cents and becomes words here, at the display edge only; an amount the server sent as null (no rate
// in force) reads "monto por definir" and no number. Hours are written with `show`, the reader's number format (ui.js
// num), which every caller passes. The server stays the judge of who sees what: a teammate's entry holds site names and
// counts, never a worker.
import { hm } from './leader-steps.js';

/** Cents as US dollars, as Panama writes them: US$1,234.50. Null stays null. */
export function usd(cents) {
  if (cents == null || !Number.isFinite(Number(cents))) return null;
  const c = Math.round(Number(cents)), whole = Math.floor(Math.abs(c) / 100), part = String(Math.abs(c) % 100).padStart(2, '0');
  return `${c < 0 ? '-' : ''}US$${String(whole).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${part}`;
}
/** An amount as a person reads it: dollars to the cent, or "monto por definir". */
export const money = (cents, t) => usd(cents) ?? t('pay.tbd');

/** The headline of "Mis sitios activos": the week's earnings, or, with no pay rate in force, the week's accepted hours
 *  (`hours`), and its support line says the amount is still to be defined. `earn` is me.earn. */
export function sitesHead(earn, t, show) {
  const week = (earn && earn.week) || {}, last = (earn && earn.last) || {}, hours = week.cents == null, l = hm(last.minutes || 0, show);
  return { hours, words: hours ? hm(week.minutes || 0, show) : money(week.cents, t),
    support: hours ? t('sites.support.tbd', { l }) : t('sites.support', { h: hm(week.minutes || 0, show), l }) };
}

/** Where an amount comes from: the accepted hours times the rate per hour. With no rate, why there is no amount. */
export const paySource = (minutes, rate, t, show) => (rate == null ? t('pay.src.none') : t('pay.src', { h: hm(minutes || 0, show), r: usd(rate) }));

/** A teammate's line on the table: active sites, the week's accepted hours, the week's earnings. Only the parts with a
 *  number: no "0 sitios activos", no "0 min", and "monto por definir" only when there are hours to pay for. Null when
 *  nothing is left, and the table shows no line. */
export function mateLine(entry, t, show) {
  if (!entry) return null;
  const sites = Array.isArray(entry.sites) ? entry.sites.length : 0, minutes = Number(entry.minutes) || 0, cents = entry.cents == null ? null : Number(entry.cents) || 0;
  const parts = [sites > 0 ? t('u.active', { n: sites }) : null, minutes > 0 ? hm(minutes, show) : null,
    cents > 0 || (cents == null && minutes > 0) ? money(cents, t) : null].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

/** What sites voided this week still bring, as its own line, so the rows and this line add up to the week's total.
 *  Null when there is none. */
export const goneLine = (gone, t, show) => (gone && gone.minutes > 0 ? t('sites.gone', { h: hm(gone.minutes, show), m: money(gone.cents, t) }) : null);

/** A teammate's card: each active site by name with its workers counted and its hours, the week's total and its source. */
export function mateCard(entry, rate, t, show) {
  return { gone: goneLine(entry.gone, t, show), sites: entry.sites.map((x) => ({ name: x.name, line: `${t('mate.workers', { n: x.workers })} · ${hm(x.minutes || 0, show)}` })),
    hours: hm(entry.minutes || 0, show), total: money(entry.cents, t), source: paySource(entry.minutes, entry.cents == null ? null : rate, t, show) };
}

/** The rows of "Mis sitios activos": who records, the phones on site, the consents, the hours of this week and the last,
 *  and what the site earned this week. */
export const siteRows = (active, t, show) => (active || []).map((x) => ({ id: x.id, name: x.name, practice: !!x.practice,
  facts: [t('sites.f.recording', { n: x.recording }), t('sites.f.phones', { n: x.phones }), t('sites.f.consents', { n: x.consents })].join(' · '),
  week: hm(x.week || 0, show), last: hm(x.last || 0, show), earned: money(x.cents, t) }));

/** Whether the Hoy entry to "Mis sitios activos" shows: only once the person has a site live. */
export const hasSites = (me) => !!(me && Array.isArray(me.active) && me.active.length);
