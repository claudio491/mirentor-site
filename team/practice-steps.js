// practice-steps.js: what practice mode decides on the phone, away from the page so it can be tested. A rep's screens
// are open in one of three ways: a person's own ('self'), a manager reading a real rep's screens ('view', read only),
// or a manager acting as the practice rep ('practice', writes allowed). The server stays the judge: it takes a write
// "as" another person only for the practice rep, and only from a manager or an admin.

/** How the screens are open. `as` is whose screens the address asked for; `me` is the server's answer. Only an answer
 *  that is the practice rep itself opens writes: anything else asked for through `as` is read only. With no `as` but
 *  an answer that is still someone else's (leaving practice mode or a view-as, before the person's own answer
 *  arrives), the screens read only too: a write then would go as the manager, on screens that are not theirs. */
export function actingMode(as, me) {
  if (!as) return me && me.viewer && me.viewer.as ? 'view' : 'self';
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

/** The example team's row of the Vendedores screen, for a manager or an admin: load it when there is none; view each of
 *  the four and remove them all (two taps) when there is; and update it when it was made for an earlier day (its week
 *  is not this one). */
export function exampleActions(team, role) {
  if (!team || (role !== 'manager' && role !== 'admin')) return [];
  if (!(Array.isArray(team.example) && team.example.length)) return ['load'];
  return team.exampleStale ? ['view', 'refresh', 'remove'] : ['view', 'remove'];
}

/** Whether a closed day stops a new log. It does on every rep's screens but the practice rep's: a demonstration goes
 *  on after its day is closed (the server takes those logs too). */
export const logLocked = (today, mode) => !!(today && today.closed) && mode !== 'practice';

/** An answer that says the rep the address names is gone (the practice rep was removed, then Back or a reload): the
 *  address is dropped and the screens start as the person. */
export const staleAs = (err, as) => !!as && !!err && err.status === 404 && err.code === 'rep';
