// reads.js: the order of what the board's screens show. They read the person's view again and again (the quiet check,
// after a log goes out) and every write answers with the new view, so answers can come back in any order. Reads and
// adoptions take numbers from one counter in the order they happen, the way the team view does (manager-steps.js
// freshRead): a read whose number is not above the one on screen went out before something already shown (a log saved
// meanwhile, a newer read) and is dropped, so the screen only moves forward. Tested in tests/team-reads.test.mjs.

export function createReads() {
  let seq = 0, shown = 0;
  return {
    /** A read goes out: its number. */
    send: () => ++seq,
    /** Whether that read's answer is still newer than what the screen shows. Asking takes nothing: a read that waits
     *  on something else (the documents) asks again before it is adopted. */
    fresh: (n) => n > shown,
    /** Adopt that read's answer if it is still newer; true when it was. */
    take(n) { if (n <= shown) return false; shown = n; return true; },
    /** Something that is not a read was adopted (a write's answer, a new start): every read out before it is stale. */
    adopted() { shown = ++seq; },
  };
}
