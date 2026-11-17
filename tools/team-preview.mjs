// team-preview.mjs: the board the way a preview on one machine serves it. It is mounted where production mounts it
// (/ventas/equipo), but nobody signs in: in production the only way in is the sales portal's Google sign-in, and here
// the same address lists the people and the viewer chooses who to be.
//   /dev/como?h=<handle>        be that person, in one step (what the filming and capture tools use)
//   /dev/como?correo=<address>  be a signed-in account by its address, whether or not it is on the team
// Never mount this on a service: it trusts whoever asks.
import { randomBytes } from 'node:crypto';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createTeam } from '../lib/team/api.mjs';
import { openTeamStore } from '../lib/team/store.mjs';

export const BASE = '/ventas/equipo';
const COOKIE = 'cancha_dev';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const page = (title, body) => `<!doctype html><html lang="es"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="icon" href="data:,"><title>${title}</title>
<style>body{margin:0;background:#1b1d20;color:#e9ebec;font:16px/1.5 system-ui,sans-serif}main{max-width:440px;margin:0 auto;padding:48px 20px}h1{font-size:30px;letter-spacing:-.02em;margin:0 0 8px}
p{color:#a9b0b6;margin:0 0 20px}a{display:block;color:#e9ebec;text-decoration:none;border:1.5px solid rgba(233,235,236,.24);border-radius:12px;padding:14px 16px;margin:0 0 10px}
a:hover,a:focus-visible{border-color:#ff5a36;outline:none}small{color:#a9b0b6}</style><main>${body}</main></html>`;
const html = (res, text) => res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(text);

/** dir: a data folder already seeded. Answers { listener, people }: `listener` goes to http.createServer. */
export function previewApp({ dir, now = () => new Date(), previewOffsetMs = 0, log = console.error } = {}) {
  /** Who is on the team right now, read back from the log itself: people added in the preview are here too. */
  const people = () => [...openTeamStore(dir, { log: () => {} }).state.reps.values()].filter((r) => r.active);
  const chosen = (req) => { const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(String(req.headers.cookie || '')); return m ? decodeURIComponent(m[1]) : ''; };
  const identify = (req) => { const who = chosen(req); return !who ? null : who.startsWith('mail:') ? { email: who.slice(5) } : { id: who }; };
  const be = (res, value) => res.writeHead(303, { location: `${BASE}/`, 'set-cookie': `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax` }).end();
  // The door of a preview: where production shows the portal's Google sign-in, this lists the people.
  const door = (req, res, what) => {
    if (what === 'out') { res.writeHead(303, { location: `${BASE}/`, 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` }).end(); return true; }
    if (what !== 'page') return false;
    const list = people().map((r) => `<a href="/dev/como?h=${encodeURIComponent(r.handle)}">${esc(r.name)} <small>· ${esc(r.role)}</small></a>`).join('');
    html(res, page('Vista local', `<h1>elige quién ser.</h1><p>Vista en esta máquina: nadie inicia sesión. En producción, en esta dirección aparece la entrada con Google del portal de ventas.</p>${list}`));
    return true;
  };
  const team = createTeam({ dir, base: BASE, identify, door, pushToken: randomBytes(24).toString('hex'), dev: true, now, previewOffsetMs, log });
  const app = createServer({ store: openStore(dir), sheets: null, origins: [], team, log });
  const listener = (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/') { res.writeHead(302, { location: `${BASE}/` }).end(); return; }
    if (url.pathname === '/dev/como') {
      const mail = String(url.searchParams.get('correo') || '').trim().toLowerCase();
      if (mail) { be(res, `mail:${mail}`); return; }
      const person = people().find((r) => r.handle === url.searchParams.get('h'));
      if (!person) { res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('No such person in this preview.'); return; }
      be(res, person.id);
      return;
    }
    // The portal itself is not part of a preview: its address says so and points back.
    if (url.pathname === '/ventas' || url.pathname === '/ventas/') { html(res, page('Portal de ventas', `<h1>portal de ventas.</h1><p>En producción aquí están los materiales del equipo. Esta vista local solo trae el tablero.</p><a href="${BASE}/">Volver al tablero</a>`)); return; }
    app.emit('request', req, res);
  };
  return { listener, people };
}
