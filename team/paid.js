// paid.js: what a result promises when it is saved, and the part a log did not earn, away from the page so it can be
// tested. The server is the judge (lib/team/score.mjs): a business pays its visit, its conversation and its reply once a
// day, and messages stop paying at the day's cap. A follow-up is left out: whether a log is one is decided on the server.

/** The paying parts of a result, as the ledger names them. */
export function promised(kind, channel) {
  switch (kind) {
    case 'talk': return ['visit', 'conversation'];
    case 'absent': return ['visit'];
    case 'call': return ['conversation'];
    case 'message': return ['message'];
    case 'reply': return ['reply'];
    case 'meeting': return channel === 'visit' ? ['visit', 'conversation', 'meeting_booked'] : ['conversation', 'meeting_booked'];
    default: return [];
  }
}

/** The parts this log was promised and did not earn, in the order they are told. */
export function shortfall(kind, channel, earned) {
  const got = new Set(earned || []);
  return promised(kind, channel).filter((code) => !got.has(code));
}
