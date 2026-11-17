// door.js: the board has no sign-in of its own, so the little it decides about its door lives here, apart from the
// screens, where it is tested without a browser (tests/team-queue.test.mjs).

/** The two addresses of the door, relative to the page. HOME is the board's own: opened without a session it shows
 *  the portal's sign-in. LEAVE ends the session and comes back to HOME. The server answers both (lib/team/api.mjs). */
export const HOME = './', LEAVE = 'salir';

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
