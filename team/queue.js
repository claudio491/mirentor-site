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

/** How long a request may hang before it counts as no signal. A photo goes as its own bytes and can take long on a weak
 *  signal, so it gets ninety seconds; everything else, fifteen. */
/** A language picked with no signal waits on the phone like a log: it remembers whose it is, and only its owner's next
 *  start sends it (a shared phone never hands it to the next account). The language, or null. */
export const langWaiting = (kept, repId, langs) =>
  (kept && typeof kept === 'object' && repId && kept.rep === repId && langs.includes(kept.lang) ? kept.lang : null);
export const requestTimeout = (body) => (typeof Blob !== 'undefined' && body instanceof Blob ? 90000 : 15000);
