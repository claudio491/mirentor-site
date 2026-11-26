// toast-steps.js: how long a toast stays and which edge it comes from, away from the page so they can be tested.

/** How long an error stays when nobody taps it away. */
export const TOAST_ERR_MS = 6000;
/** A toast stays 2.4 s, 40 ms more for each character past 60, 5 s at most. An error stays until it is tapped or 6 s. */
export function toastTime(text, { error = false } = {}) {
  if (error) return TOAST_ERR_MS;
  const n = typeof text === 'string' ? text.length : 0;
  return Math.min(5000, 2400 + Math.max(0, n - 60) * 40);
}

/** The screens whose buttons sit where a bottom toast would land: Hoy's four stops, Pendientes' and Vendedores' rows. */
const UNDER = ['today', 'needs', 'reps'];
/** Where a toast comes from: with a sheet open, the top (the sheet's buttons sit at the bottom); on Hoy, Pendientes and
 *  Vendedores, under the top bar; elsewhere the bottom, over the tab bar, on a phone (a wide screen keeps it on top). */
export function toastEdge(screen, { sheet = false } = {}) {
  if (sheet) return 'top';
  return UNDER.includes(screen) ? 'under' : 'bottom';
}

/** A change of tab or screen takes the toast away, unless it was shown in the last 300 ms: that one tells of the change
 *  itself ("Trabajador quitado", back on the install) and goes along with it. */
export const toastFollows = (age) => age < 300;
