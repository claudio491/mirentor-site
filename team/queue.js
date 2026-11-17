// queue.js: what happens to a log that could not be sent. It is kept apart from the screens so the rule can be tested
// without a browser (tests/team-queue.test.mjs). A log is only ever thrown away when sending it again cannot help.

/** 'keep': it waits on the phone and goes out again with the same id. 'drop': the server understood it and said no. */
export function verdict(err) {
  const status = err && typeof err.status === 'number' ? err.status : 0;
  if (!status || (err && err.code === 'offline')) return 'keep';                         // no answer at all
  if (status >= 500 || status === 429 || status === 408 || status === 401) return 'keep'; // restarting, busy, timed out, or signed out
  return 'drop';
}

/** A phone can be shared: each waiting log remembers whose it is, and only its owner sends it. */
export const mine = (queue, repId) => (Array.isArray(queue) ? queue.filter((q) => q && typeof q === 'object' && q.rep === repId && q.body) : []);
