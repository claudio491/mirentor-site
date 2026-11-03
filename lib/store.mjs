// store.mjs: the source of truth. Every entry and every sync is one JSON line in entries.jsonl, replayed on open,
// so a restart (or a Google outage) never loses a sign-up. On Render the folder is the mounted disk.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

export function openStore(dir) {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'entries.jsonl');
  const byId = new Map();
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const rec = JSON.parse(line);
      if (rec.type === 'entry' && !byId.has(rec.entry.id)) byId.set(rec.entry.id, { ...rec.entry, row: null });
      if (rec.type === 'synced' && byId.has(rec.id)) byId.get(rec.id).row = rec.row;
    }
  }
  const write = (rec) => appendFileSync(file, `${JSON.stringify(rec)}\n`);
  return {
    get: (id) => byId.get(id) || null,
    put(entry) {
      if (byId.has(entry.id)) return byId.get(entry.id);
      write({ type: 'entry', entry });
      byId.set(entry.id, { ...entry, row: null });
      return byId.get(entry.id);
    },
    markSynced(id, row) {
      write({ type: 'synced', id, row, at: new Date().toISOString() });
      byId.get(id).row = row;
    },
    pending: () => [...byId.values()].filter((e) => e.row == null),
  };
}
