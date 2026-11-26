// craft-steps.js: the few things the craft of the later screens decides, away from the page so they can be tested.
// Which links the profile leads with and what stays under its settings.

/** The rep's work, in the order the profile lists it: their businesses, the first days and Aprender, the sites on the
 *  way and the active ones, and the documents. A link whose screen has nothing for the person is simply absent. */
export const WORK_ORDER = ['book', 'ladder', 'learn', 'ways', 'sites', 'docs'];
/** The profile's work links, in WORK_ORDER: `links` holds each key's buttons (none when that screen has nothing). */
export const inWorkOrder = (links) => WORK_ORDER.flatMap((k) => links[k] || []);

/** What stays under "ajustes": the account and its way out, and how points are earned. The practice rep has no account
 *  of its own; a manager looking at a rep's screens gives a badge there, and reopens the rep's day once it is closed. */
export function settingsKeys({ practice = false, manage = false, email = '', closed = false } = {}) {
  if (practice) return ['rules'];
  if (manage) return ['badge', ...(closed ? ['reopen'] : [])];
  return [...(email ? ['account'] : []), 'rules', 'signout'];
}

// ---- the later screens' illustrated lead (the .robj of Semana's results: a base, a glow, lit when done) ----
const pic = (art, glow, { frame = null, lit = false, dim = false } = {}) => ({ art, glow, frame, lit: !!lit, dim });
/** What an empty list rests on: the rest strip's first frame, from its small file, never lit. */
export const REST = Object.freeze({ ...pic('restThumb', null, { frame: 0 }), rest: true });
/** Which picture a screen leads with and whether it is lit (its state is done), from a few facts about the screen. The
 *  route follows its stop: the meeting while the first stop is next, the contract for the contract's stops, the summit
 *  from the install on. A screen whose giant is a word that fills the width (Aprender, Documentos) leads with none while
 *  it has rows; empty, it rests (REST), as an empty list of the sites does. The Scorecard, the business card and the
 *  screens not listed get none (they are tables and facts). Strips show one frame, from their small file. */
export function leadArt(screen, f = {}) {
  switch (screen) {
    case 'route': { const at = f.at || 0; const art = f.complete || at >= 3 ? 'summit' : at >= 1 ? 'contract' : 'meeting'; return pic(art, `${art}Glow`, { lit: f.complete }); }
    case 'ways': return f.count > 0 ? pic('summit', 'summitGlow', { lit: f.yours === 0 }) : REST;
    case 'sites': return f.count > 0 ? pic('summit', 'summitGlow', { lit: f.minutes > 0 }) : REST;
    case 'install': return pic('hand', 'handLit', { lit: f.of > 0 && f.ready >= f.of });
    case 'docs': return f.count > 0 ? null : REST;
    case 'learn': return f.shown > 0 ? null : REST;
    case 'book': return pic('followThumb', null, { frame: 2, lit: f.owned > 0 && !f.overdue && !f.today });
    default: return null;
  }
}

/** The screens whose giant is short (a number, or a number with a unit): their picture sits to the right of the giant,
 *  in the giant's own band, so it costs no row. */
export const BAND = Object.freeze(['book', 'ways', 'sites', 'route', 'install']);
/** The width a picture needs beside the giant, and the air it keeps from the giant's last letter, in px. */
export const BAND_MIN = 96;
export const BAND_GAP = 12;
/** Under this height a picture beside the giant reads as a smudge, not as art: it is left out. */
export const BAND_FLOOR = 48;
/** How tall the picture beside the giant is: the band's height (the giant's own box), square, so never taller than the
 *  band; left out when the width beside the giant (`room`, from the giant's last letter to the band's edge) is under
 *  96 px or under the picture and its air. The giant is measured, not its words, so the same number in Spanish and in
 *  English gives the same picture. */
export function bandArt({ band = 0, room = 0 } = {}) {
  if (!(band >= BAND_FLOOR) || !(room >= Math.max(BAND_MIN, band + BAND_GAP))) return 0;
  return Math.round(band);
}
/** The picture arrives the first time its screen is opened in a visit; on a return it is simply there. */
export function artArrives(seen, id) {
  if (seen.has(id)) return false;
  seen.add(id);
  return true;
}

/** The worker's consent photo: none on file, on its way, shown, or failed (it then says so and offers a retry). */
export function shotState({ consent = false, loaded = false, failed = false } = {}) {
  if (!consent) return 'none';
  if (failed) return 'failed';
  return loaded ? 'shown' : 'loading';
}

/** The air an illustration keeps above it, in px (its margin). */
export const ART_AIR = 14;
/** Art never costs a tap: what height each illustration above a screen's first action may take. `room` is the space
 *  between the first action's bottom (drawn with no art) and the tab bar, after the air kept there (Infinity when the
 *  screen has no action). The lead takes 160 px, 120 on a small phone (or when 160 does not fit), else nothing; then
 *  each empty list above the first action (`above`, in order) takes 120 while room is left, else nothing. */
export function artFit({ room, width, height, lead = true, above = 0 }) {
  const cap = width < 380 || height < 800 ? 120 : 160;
  let left = room, leadPx = 0;
  if (lead) { leadPx = [cap, 120].find((px) => left >= px + ART_AIR) || 0; if (leadPx) left -= leadPx + ART_AIR; }
  const empties = [];
  for (let i = 0; i < above; i += 1) { const ok = left >= 120 + ART_AIR; empties.push(ok ? 120 : 0); if (ok) left -= 120 + ART_AIR; }
  return { lead: leadPx, empties };
}

// ---- a row that leaves a manager's list ----
/** How a row leaves: it fades and slides 12 px right in 160 ms, then its height closes in 200 ms. */
export const ROW_OUT = Object.freeze({ fade: 160, close: 200, x: 12 });
/** The rows drawn before a change and not after it, in their order, each with the row still drawn that it came after
 *  (null: the first of its list), so it can be put back where it was while it leaves. */
export function goneRows(before, after) {
  const now = new Set(after), out = [];
  before.forEach((key, i) => {
    if (now.has(key)) return;
    let prev = null;
    for (let j = i - 1; j >= 0; j -= 1) if (now.has(before[j])) { prev = before[j]; break; }
    out.push({ key, after: prev });
  });
  return out;
}

/** The groups whose count goes down because rows left (`before` and `after`: each group's row count, by group): each
 *  keeps showing `from` until its rows have gone, then rolls to `to`. A count that goes up is drawn at once. */
export function countRolls(before, after) {
  const out = [];
  for (const [group, from] of before) { const to = after.get(group) ?? 0; if (to < from) out.push({ group, from, to }); }
  return out;
}

// ---- Vendedores: one action per row ----
/** What a person's row on Vendedores offers: "Ver como" stays on the row (a rep only); the rest goes to the sheet that
 *  "Más" opens, in this order: the first approved hour (a rep with first days, active), edit, and switching them off
 *  last (or back on). A rep is edited by any manager; a manager or an admin only by an admin, and nobody edits or
 *  switches off themselves (their own rep row is still edited, as before). */
export function repActions({ isPlayer = false, admin = false, self = false, active = true, role = 'rep', ladder = false, hourDone = false } = {}) {
  const touch = isPlayer || admin, more = [];
  if (isPlayer && active && ladder) more.push(hourDone ? 'hour-undo' : 'hour');
  if (touch && (role === 'rep' || !self)) more.push('edit');
  if (touch && !self) more.push(active ? 'deactivate' : 'activate');
  return { shown: isPlayer ? ['viewas'] : [], more };
}
