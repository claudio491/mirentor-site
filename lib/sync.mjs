// sync.mjs: puts one stored entry in the Leads tab exactly once and proves it landed.
import { toCells } from './entry.mjs';

let chain = Promise.resolve();
/** Writes run one at a time, so two sign-ups never pick the same empty row. */
const serial = (fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };

export function syncOne(store, sheets, entry) {
  return serial(async () => {
    let row = await sheets.findLead(entry.leadId);
    if (!row) {
      row = await sheets.nextRow();
      const { aToP, notes, site } = toCells(entry);
      await sheets.writeRow(row, aToP, notes, site);
      const back = await sheets.readRow(row);
      if (back[0] !== aToP[0] || back[1] !== aToP[1] || back[4] !== aToP[4]) throw new Error(`read-back mismatch on row ${row}`);
    }
    store.markSynced(entry.id, row);
    return row;
  });
}

export async function syncPending(store, sheets) {
  for (const e of store.pending()) {
    try { await syncOne(store, sheets, e); } catch (err) { console.error(`sync ${e.leadId}: ${err.message}`); return; }
  }
}
