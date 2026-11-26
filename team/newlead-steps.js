// newlead-steps.js: a business typed as new in the log sheet. What is asked of the server to find its near twins of the
// city ("¿Es alguno de estos?"), the zones offered with "Otra", the zone it is saved with, when the sheet may save it,
// and what a twin that cannot be picked says. No page and no imports: app.js draws what these decide. The server
// compares the names (lib/team/store.mjs similarLeads) and stays the judge.

/** The text sent to GET leads?similar=: the name as typed, trimmed; null when it has no word of three letters or more
 *  (the server would find nothing to compare). */
export function similarAsk(name) {
  const s = typeof name === 'string' ? name.trim() : '';
  return /\p{L}{3,}/u.test(s) ? s : null;
}

/** The zones of the city to pick from, then "Otra", which opens a field to type one. */
export const zoneOptions = (zones) => [...(Array.isArray(zones) ? zones.filter((z) => typeof z === 'string' && z.trim()) : []), '__other'];
/** The zone shown picked when the city's zones are drawn: the one picked before, if it is still offered; else "Otra"
 *  when a zone was already typed in the field (the zones arrived after the rep typed it, and it is kept); else none.
 *  With no zones to offer, the field itself is the zone. */
export function zonePickFor({ zones, had, typed }) {
  const offered = zoneOptions(zones);
  if (offered.length < 2) return '';
  if (had && offered.includes(had)) return had;
  return String(typed ?? '').trim() ? '__other' : '';
}
/** The zones a sheet opens with: those read before, unless that read failed (then null: they are read again). A city
 *  with no zones is not asked again. */
export const zonesOnOpen = ({ zones, failed }) => (failed ? null : zones);
/** The zone the new business is saved with: the one picked, or the one typed under "Otra". */
export const zoneOf = (pick, typed) => (pick === '__other' ? String(typed ?? '').trim() : String(pick ?? '').trim());

/** Whether a new business may be saved: a name of two letters or more, and either no near twins, or "Es nuevo" tapped
 *  (`sure`), or no signal to ask with (`offline`: the server still finds an exact twin). */
export function newReady({ name, similar, sure = false, offline = false }) {
  if (String(name ?? '').trim().length < 2) return false;
  return !!offline || !!sure || !(Array.isArray(similar) && similar.length);
}

/** What a draft keeps of "Es nuevo": the name it was said for (trimmed), or null. */
export function sureFor({ sure = false, name = '' } = {}) {
  const s = String(name ?? '').trim();
  return sure && s ? s : null;
}
/** A draft of a new business back in the sheet: the near twins of its name are asked again (`ask`, as when the name is
 *  typed) and Guardar waits for the answer (`wait`); a kept "Es nuevo" stands only for the same name. */
export function restoredNew({ isNew = false, name = '', sureFor: kept = null } = {}) {
  const ask = isNew ? similarAsk(name) : null;
  if (!ask) return { ask: null, sure: false, wait: false };
  return { ask, sure: typeof kept === 'string' && kept === String(name).trim(), wait: true };
}

// The stages the server closes a business at, so it cannot be picked (lib/team/store.mjs pickable).
const CLOSED = { 'Contract signed': 'signed', 'Setup day set': 'setup', Live: 'live' };
/** Why a twin cannot be picked, said on its row: a stage that closed it, else "No llamar". Null when it can be picked. */
export function dupNote(row) {
  if (!row || row.pick) return null;
  return CLOSED[row.stage] ? { key: `biz.stage.${CLOSED[row.stage]}` } : { key: 'log.dup.dnc' };
}
