// sw.js: lets the board open with no signal. Everything is asked of the network first, so a phone with signal always
// runs what the server has; only when the network fails (or a page load hangs past a few seconds on a weak signal) does
// the copy kept from the last visit answer. A page that came from the copy gets its files from the copy too, so an old
// page never runs with new files. The API is never touched here: what a person logs waits in the app's own queue, and
// sessions are the server's business. To retire it, serve a sw.js that unregisters itself (see the README).
// A classic script (not a module), so older iPhones run it; tests/team-sw.test.mjs loads it into a sandbox.

const CACHE = 'cancha-shell-v1';
const PAGE_WAIT = 4000;                                    // a page load that hangs this long is answered from the copy
const PAGE_KEY = 'board-page';                             // the one page kept, whatever the address that asked for it
const DOOR = new Set(['auth', 'salir']);                   // sign-in and sign-out: always the network
const GATED = new Set(['next.html', 'next.css', 'next.js']);   // read only by managers and leaders: never kept on a phone
const fromCopy = new Set();                                // pages (client ids) that were answered from the copy

/** Whether the worker answers for a request: a GET for one of the board's own files, never the API, the door or the
 *  gated sketches, and never anything outside the board. */
function handles(url, method, scope) {
  if (method !== 'GET') return false;
  const base = new URL(scope);
  if (url.origin !== base.origin || !url.pathname.startsWith(base.pathname)) return false;
  const rel = url.pathname.slice(base.pathname.length);
  if (rel.startsWith('api/') || DOOR.has(rel) || GATED.has(rel)) return false;
  return true;
}
/** A trip to the door (an ended session, the gate's way back in) is marked by the app (door.js): it always goes to the
 *  network, so the sign-in page is reached however slow the network is; the copy would only show the board again. */
function isDoorTrip(url) { return url.searchParams.has('door'); }
/** Only the board's own page is kept: when a session has ended, the same address serves the portal's sign-in page. */
function isBoardPage(text) { return typeof text === 'string' && text.includes('id="app"') && text.includes('src="app.js"'); }

const within = (promise, ms) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('slow')), ms);
  promise.then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
});

async function page(event) {
  if (isDoorTrip(new URL(event.request.url))) return fetch(event.request);
  const cache = await caches.open(CACHE);
  try {
    const res = await within(fetch(event.request), PAGE_WAIT);
    if (res.ok && isBoardPage(await res.clone().text())) await cache.put(PAGE_KEY, res.clone());
    return res;
  } catch {
    const kept = await cache.match(PAGE_KEY);
    if (!kept) return Response.error();
    if (event.resultingClientId) fromCopy.add(event.resultingClientId);
    return kept;
  }
}
async function file(event) {
  const cache = await caches.open(CACHE), req = event.request;
  // a page that came from the copy reads its files from the copy first: the same version, whole
  if (fromCopy.has(event.clientId)) { const kept = await cache.match(req, { ignoreSearch: false }); if (kept) return kept; }
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch {
    const kept = await cache.match(req);
    return kept || Response.error();
  }
}

/** The first visit happens before the worker runs, so the app hands it the files it already loaded: they are fetched
 *  once more and kept, and so is the board's page, so the very next start with no signal opens. */
async function warm(list) {
  const cache = await caches.open(CACHE), scope = self.registration.scope;
  for (const href of list.slice(0, 160)) {
    try {
      const url = new URL(href);
      if (!handles(url, 'GET', scope) || url.href === scope || url.pathname.endsWith('index.html') || (await cache.match(url.href))) continue;
      const res = await fetch(url.href, { credentials: 'same-origin' });
      if (res.ok) await cache.put(url.href, res);
    } catch { /* the next one */ }
  }
  try { const res = await fetch(scope, { credentials: 'same-origin' }); if (res.ok && isBoardPage(await res.clone().text())) await cache.put(PAGE_KEY, res); } catch { /* kept on the next page load */ }
}
self.addEventListener('message', (event) => {
  const data = event.data;
  if (data && Array.isArray(data.warm)) event.waitUntil(warm(data.warm.filter((x) => typeof x === 'string')));
});

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('cancha-') && key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (!handles(new URL(req.url), req.method, self.registration.scope)) return;
  event.respondWith(req.mode === 'navigate' ? page(event) : file(event));
});
