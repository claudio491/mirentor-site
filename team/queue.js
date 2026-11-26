// queue.js: what happens to a log that could not be sent. It is kept apart from the screens so the rule can be tested
// without a browser (tests/team-queue.test.mjs). A log is only ever thrown away when sending it again cannot help.

/** Whether a failed answer is the server's own: the JSON it writes when it refuses, { ok: false, error: '<code>' }. A
 *  captive portal's page, a proxy's error page or JSON someone else wrote is not, whatever its status: nobody read the
 *  request. */
export const fromServer = (err) => !!err && !!err.data && typeof err.data === 'object' && err.data.ok === false && typeof err.data.error === 'string';

/** 'keep': it waits on the phone and goes out again with the same id. 'drop': the server understood it and said no. */
export function verdict(err) {
  const status = err && typeof err.status === 'number' ? err.status : 0;
  if (!status || (err && err.code === 'offline')) return 'keep';                         // no answer at all
  if (!fromServer(err)) return 'keep';                                                    // an answer, but not the server's
  if (status >= 500 || status === 429 || status === 408 || status === 401) return 'keep'; // restarting, busy, timed out, or signed out
  // Refused for who is asking or from where, not for what the log says: that can be put right, so the log waits.
  if (err.code === 'not_on_team' || err.code === 'origin') return 'keep';
  return 'drop';
}

/** A phone can be shared: each waiting log remembers whose it is, and only its owner sends it. */
export const mine = (queue, repId) => (Array.isArray(queue) ? queue.filter((q) => q && typeof q === 'object' && q.rep === repId && q.body) : []);

/** A language picked with no signal waits on the phone like a log: it remembers whose it is, and only its owner's next
 *  start sends it (a shared phone never hands it to the next account). The language, or null. */
export const langWaiting = (kept, repId, langs) =>
  (kept && typeof kept === 'object' && repId && kept.rep === repId && langs.includes(kept.lang) ? kept.lang : null);
/** Whose a language picked now is: the viewer's, since the server changes the viewer's own (a manager acting as the
 *  practice rep changes theirs). A view kept by an older version names only `me`. */
export const langOwner = (view) => (view && view.viewer && view.viewer.id) || (view && view.me && view.me.id) || null;
/** Whether a language that reached the server clears the one waiting: only when it was this person's (another account
 *  on the same phone leaves it), or when what is kept is not one this version writes. */
export const langDone = (kept, who) => !!kept && (typeof kept !== 'object' || kept.rep === who);

/** How many of the logs just sent were made on an earlier day than `today`. They count for today, the day they reached
 *  the server (it dates every log on arrival, so no phone clock moves a log into another day), and the toast says so.
 *  `dayOf` turns a moment into the person's day. */
export const madeEarlier = (items, today, dayOf) =>
  items.filter((q) => q && q.body && typeof q.body.clientAt === 'string' && dayOf(q.body.clientAt) < today).length;

/** Whether a sent log added something. The server answers `repeat` for a business and result already logged today:
 *  that log added nothing, so no toast announces it as counting for today. */
export const landedNew = (answer) => !(answer && answer.repeat);

/** What the toast after sending waiting logs adds. `items` are the logs that reached the server, each with the
 *  server's `answer` and the business's `name` (null when the phone does not know it). `words`: whose the business is
 *  now, said once each ('log.took', or 'log.owned' with the holder's name), as a live save says it. `late`: the
 *  businesses whose next step's day had passed before the log reached the server (the server keeps the log and drops
 *  that next step), two at most; more than two keep the first and count the rest in `more`, as does a business with
 *  no name known. */
export function sentNotes(items, today) {
  const words = [], late = [];
  for (const it of Array.isArray(items) ? items : []) {
    const a = (it && it.answer) || {};
    if (a.took) { if (!words.some((w) => w.key === 'log.took')) words.push({ key: 'log.took' }); }
    else if (a.owned && a.owned.name && !words.some((w) => w.key === 'log.owned' && w.name === a.owned.name)) words.push({ key: 'log.owned', name: a.owned.name });
    const next = it && it.body ? it.body.next : null;
    if (next && typeof next.day === 'string' && next.day < today) late.push(it.name || null);
  }
  const named = late.filter(Boolean), shown = late.length > 2 ? named.slice(0, 1) : named.slice(0, 2);
  return { words, late: shown, more: late.length - shown.length };
}

/** How long a request may hang before it counts as no signal. A photo goes as its own bytes and can take long on a weak
 *  signal, so it gets ninety seconds; everything else, fifteen. */
export const requestTimeout = (body) => (typeof Blob !== 'undefined' && body instanceof Blob ? 90000 : 15000);
