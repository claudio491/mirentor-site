// back-steps.js: what the phone's Back does, and what a log left half done keeps, decided away from the page so it can
// be tested. No page and no imports: app.js keeps the history entries and the sheet; these only decide.
//
// The entries the app adds to the browser's history, from the bottom: one when the rep leaves the home tab (moving
// between other tabs replaces it), one while a deep screen is open (its trail lives in memory), and one per open sheet.
// Back undoes the top one; a traversal the app made itself (a sheet closed by its own controls gives its entry back)
// is skipped.

/** What a Back does: 'skip' (the app's own traversal), 'moment' (close the day's completion, stay on Hoy), 'sheet'
 *  (close the top sheet, stay where the rep was), 'deep' (one screen back inside a zone), 'home' (back to the home tab),
 *  'restart' (the address changed: start again). */
export function backStep({ skip = 0, moment = false, sheets = 0, deep = false, away = false } = {}) {
  if (skip > 0) return 'skip';
  if (moment) return 'moment';
  if (sheets > 0) return 'sheet';
  if (deep) return 'deep';
  if (away) return 'home';
  return 'restart';
}

/** A move to a tab that is not a deep screen: leaving home adds one entry (push), a move between other tabs replaces
 *  it, going home gives it back (back). `away`: whether that entry is there after the move. */
export function tabMove({ to, home, away = false }) {
  if (to === home) return { push: false, back: !!away, away: false };
  return { push: !away, back: false, away: true };
}

/** Back that starts the screens again (the address changed: back from a rep's screens through view-as) lands on an
 *  entry of the history: when it is a tab's (`state`), the screens start away from home, so the next Back comes home
 *  instead of starting the same screen again. */
export const restartAway = (state) => !!state && typeof state === 'object' && state.cancha === 'tab';
/** A page loaded again with a sheet's or the moment's entry on top: neither is open after the load, so that entry is
 *  stepped off at once (its Back event is the app's own) and the first Back the rep makes does something. */
export const reloadSkip = (state) => !!state && typeof state === 'object' && (state.cancha === 'sheet' || state.cancha === 'moment');

/** The day's moment closes. It holds one entry above the `held` ones under it (a tab's, a deep screen's). Closed in
 *  place (a tap outside, Escape, "Listo."): its own entry goes and nothing else changes (`away` null). Closed toward the
 *  week ("Ver mi semana"): exactly one entry stays above home, the week's, so nothing is traversed from Hoy (a traversal
 *  and a push in the same task leave the push forward of the current entry) and only what is under the moment goes
 *  from elsewhere. */
export function momentClose({ go = false, held = 0 } = {}) {
  if (!go) return { pop: 1, away: null };
  return { pop: Math.max(0, held), away: true };
}

/** How long a log left half done waits, and where the tab keeps it (session storage). */
export const DRAFT_MS = 30 * 60000;
export const DRAFT_KEY = 'cancha.logDraft.v1';

/** Whether the sheet holds anything worth keeping: a business, a result, a word typed, a qualification tapped. */
function worth(f) {
  if (!f || typeof f !== 'object') return false;
  if (f.lead || f.kind || f.tag) return true;
  for (const k of ['note', 'contact', 'phone', 'when', 'time', 'newName']) if (typeof f[k] === 'string' && f[k].trim()) return true;
  return !!f.qual && Object.values(f.qual).some(Boolean);
}
/** The draft of a log sheet closed without saving: for the rep (`rep`) on their own screens (`own`: never through
 *  view-as or for a leader), on that day, at that time. Nothing worth keeping keeps nothing, and a saved log
 *  (`saved`) keeps nothing. */
export function keepDraft({ rep, day, now, own, saved = false, fields }) {
  if (saved || !own || !rep || !day || !worth(fields)) return null;
  return { rep, day, at: now, fields };
}
/** The draft back, when it is the same rep's, the same day's and under 30 minutes old. Opened for a named business
 *  (`lead`, its id), only a draft of that same business comes back. Where the earlier sheet was opened from never
 *  comes back: the sheet opened now says where a save lands. */
export function takeDraft(draft, { rep, day, now, lead = null }) {
  if (!draft || typeof draft !== 'object' || draft.rep !== rep || draft.day !== day || !Number.isFinite(draft.at)) return null;
  if (now - draft.at > DRAFT_MS || now < draft.at - 60000) return null;
  const f = draft.fields;
  if (!f || typeof f !== 'object') return null;
  if (lead && !(f.lead && f.lead.id === lead)) return null;
  const rest = { ...f };
  delete rest.from;
  return rest;
}
