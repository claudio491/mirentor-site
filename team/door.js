// door.js: the board has no sign-in of its own, so the little it decides about its door lives here, apart from the
// screens, where it is tested without a browser (tests/team-queue.test.mjs).

/** The two addresses of the door, relative to the page. HOME is the board's own: opened without a session it shows
 *  the portal's sign-in. LEAVE ends the session and comes back to HOME. The server answers both (lib/team/api.mjs). */
export const HOME = './', LEAVE = 'salir';

/** A trip to the door carries this mark in the address: the service worker always sends it to the network (sw.js), so
 *  an ended session reaches the sign-in page even when the network is slow and a copy of the board is kept. */
const MARK = 'door';
/** The address with the mark (once), keeping what it said. */
export function toDoor(href) {
  const u = new URL(href);
  if (!u.searchParams.has(MARK)) u.searchParams.append(MARK, '1');
  return u.href;
}
/** The address without the mark, or null when it carries none: the app takes it off once it is in. */
export function offDoor(href) {
  const u = new URL(href);
  if (!u.searchParams.has(MARK)) return null;
  u.searchParams.delete(MARK);
  return u.href;
}

/** The tab an address names after its #, when it is one of `known`; null for anything else (a broken escape, a name no
 *  screen has). A link can say anything, and the name ends up in a selector: nothing else gets through. */
export function tabOf(hash, known) {
  if (typeof hash !== 'string' || hash.length < 2) return null;
  let name;
  try { name = decodeURIComponent(hash.slice(1)); } catch { return null; }
  return known.includes(name) ? name : null;
}

/** What the app does when the server says this person cannot go on.
 *  'reload': the session ended, and loading the page again shows the sign-in.
 *  'gate:session': that was tried less than `wait` ms ago, or there is nowhere to remember the last try, so the screen
 *  says it instead of going round in circles.
 *  'gate:team': signed in, but not on the team.
 *  null: the error is not about who is asking. */
export function sessionMove(err, { lastReload, now, wait = 20000 }) {
  if (err && err.code === 'not_on_team') return 'gate:team';
  if (!err || err.status !== 401) return null;
  if (typeof lastReload !== 'number') return 'gate:session';
  return now - lastReload < wait ? 'gate:session' : 'reload';
}
