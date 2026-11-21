// queue.js: what happens to a log that could not be sent. It is kept apart from the screens so the rule can be tested
// without a browser (tests/team-queue.test.mjs). A log is only ever thrown away when sending it again cannot help.

/** 'keep': it waits on the phone and goes out again with the same id. 'drop': the server understood it and said no. */
export function verdict(err) {
  const status = err && typeof err.status === 'number' ? err.status : 0;
  if (!status || (err && err.code === 'offline')) return 'keep';                         // no answer at all
  if (status >= 500 || status === 429 || status === 408 || status === 401) return 'keep'; // restarting, busy, timed out, or signed out
  // Refused for who is asking or from where, not for what the log says: that can be put right, so the log waits.
  if (err.code === 'not_on_team' || err.code === 'origin') return 'keep';
  return 'drop';
}

/** A phone can be shared: each waiting log remembers whose it is, and only its owner sends it. */
export const mine = (queue, repId) => (Array.isArray(queue) ? queue.filter((q) => q && typeof q === 'object' && q.rep === repId && q.body) : []);

/** How long a request may hang before it counts as no signal. A photo goes as its own bytes and can take long on a weak
 *  signal, so it gets ninety seconds; everything else, fifteen. */
export const requestTimeout = (body) => (typeof Blob !== 'undefined' && body instanceof Blob ? 90000 : 15000);
