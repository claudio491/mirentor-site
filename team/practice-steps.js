// practice-steps.js: what practice mode decides on the phone, away from the page so it can be tested. A rep's screens
// are open in one of three ways: a person's own ('self'), a manager reading a real rep's screens ('view', read only),
// or a manager acting as the practice rep ('practice', writes allowed). The server stays the judge: it takes a write
// "as" another person only for the practice rep, and only from a manager or an admin.

/** How the screens are open. `as` is whose screens the address asked for; `me` is the server's answer. Only an answer
 *  that is the practice rep itself opens writes: anything else asked for through `as` is read only. */
export function actingMode(as, me) {
  if (!as) return 'self';
  const who = me && me.me;
  return who && who.practice === true && who.id === as ? 'practice' : 'view';
}

/** View-as on a real rep reads only. */
export const readOnlyIn = (mode) => mode === 'view';

/** The controls a rep's screens offer. Through view-as on a real rep nothing writes (`manage` is the manager's own
 *  controls on that rep: a badge, reopening a day, undoing a row). As the practice rep everything a rep does is there,
 *  with its note that nothing counts, except a clap on a real person's line and signing out, which would end the
 *  manager's own session. */
export function repControls(mode) {
  const write = mode !== 'view';
  return { log: write, close: write, goal: write, held: write, play: write, lang: write,
    kudos: mode === 'self', signOut: mode === 'self', manage: mode === 'view', note: mode === 'practice' };
}

/** The address of a request made while acting as the practice rep: it names the practice rep with `as`, once. A
 *  person's own request and a read-only view-as send it as it is (a view-as read already carries its own `as`). */
export function withAs(path, mode, as) {
  if (mode !== 'practice' || !as || /[?&]as=/.test(path)) return path;
  return `${path}${path.includes('?') ? '&' : '?'}as=${encodeURIComponent(as)}`;
}

/** The practice row of the Vendedores screen, for a manager or an admin: create when there is none; view-as and remove
 *  (two taps) when there is one. */
export function practiceActions(team, role) {
  if (!team || (role !== 'manager' && role !== 'admin')) return [];
  return team.practice ? ['view', 'remove'] : ['create'];
}
