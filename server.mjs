// server.mjs: the waitlist endpoint. POST /api/waitlist checks the entry, keeps it on disk, then writes it to the
// lead log and reads it back. Google missing or down: the entry waits on disk (202) and the retry loop syncs it.
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { parseEntry } from './lib/entry.mjs';
import { openStore } from './lib/store.mjs';
import { sheetsClient } from './lib/sheets.mjs';
import { syncOne, syncPending } from './lib/sync.mjs';
import { createDesk } from './lib/desk.mjs';

const MAX_BODY = 16 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const SYNC_TIMEOUT_MS = 8000;

const withTimeout = (p, ms) => Promise.race([p, new Promise((_, no) => setTimeout(() => no(new Error('timeout')), ms).unref())]);

export function createServer({ store, sheets, origins, limit = 10, desk = null }) {
  const hits = new Map();

  function limited(ip) {
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    hits.set(ip, recent);
    return recent.length > limit;
  }

  async function sync(entry) {
    if (!sheets) return false;
    try { await withTimeout(syncOne(store, sheets, entry), SYNC_TIMEOUT_MS); return true; } catch (err) {
      console.error(`sync ${entry.leadId}: ${err.message}`);
      return false;
    }
  }

  return http.createServer(async (req, res) => {
    const origin = req.headers.origin || '';
    const allowed = origins.includes(origin);
    const send = (status, body) => {
      const h = { 'content-type': 'application/json', 'cache-control': 'no-store' };
      if (allowed) Object.assign(h, { 'access-control-allow-origin': origin, vary: 'Origin' });
      res.writeHead(status, h).end(body === undefined ? undefined : JSON.stringify(body));
    };
    const { pathname } = new URL(req.url, 'http://x');

    if (req.method === 'GET' && pathname === '/healthz') return send(200, { ok: true, sheets: !!sheets, pending: store.pending().length, dataDir: store.dir, desk: !!desk });
    if (desk && (await desk(req, res, pathname))) return;
    if (pathname !== '/api/waitlist') return send(404, { ok: false });
    if (!allowed) return send(403, { ok: false });
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '600', vary: 'Origin' }).end();
      return;
    }
    if (req.method !== 'POST') return send(405, { ok: false });
    const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress).split(',')[0].trim();
    if (limited(ip)) return send(429, { ok: false });

    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
      if (raw.length > MAX_BODY) return send(413, { ok: false });
    }
    let body;
    try { body = JSON.parse(raw); } catch { return send(400, { ok: false, errors: ['body'] }); }

    const r = parseEntry(body);
    if (!r.ok) return send(400, { ok: false, errors: r.errors });
    if (r.spam) return send(200, { ok: true });

    const kept = store.put(r.entry);
    const synced = kept.row != null || (await sync(kept));
    return send(synced ? 200 : 202, { ok: true, leadId: kept.leadId, synced });
  });
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const store = openStore(process.env.DATA_DIR || './data');
  const sa = process.env.GOOGLE_SA_JSON ? JSON.parse(process.env.GOOGLE_SA_JSON) : null;
  const sheets = sa && process.env.SHEET_ID ? sheetsClient({ sa, sheetId: process.env.SHEET_ID }) : null;
  const origins = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const port = Number(process.env.PORT || 10000);
  const desk = createDesk({ dir: store.dir, password: process.env.DESK_PASSWORD, pushToken: process.env.DESK_PUSH_TOKEN });
  createServer({ store, sheets, origins, desk }).listen(port, () => console.log(`waitlist on ${port}, sheets ${sheets ? 'on' : 'off'}, desk ${desk ? 'on' : 'off'}, ${store.pending().length} pending`));
  if (sheets) { syncPending(store, sheets); setInterval(() => syncPending(store, sheets), 60_000); }
}
