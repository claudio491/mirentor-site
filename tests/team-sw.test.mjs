// The board's service worker lets the app open with no signal: everything is asked of the network first, and the copy
// kept from the last visit answers only when the network fails. Two of its decisions keep it safe, and are pinned here
// by loading the worker's own file into a sandbox: it never touches the API, the sign-in or the sign-out (a log waits
// in the app's own queue, and a session is the server's business), and the only page it keeps is the board itself (when
// a session ends, the same address serves the portal's sign-in page, which must never become the copy).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../team/sw.js', import.meta.url), 'utf8');
const sandbox = { self: { addEventListener() {}, registration: { scope: 'https://www.mirentor.com/ventas/equipo/' } }, caches: {}, URL, Response, setTimeout, clearTimeout };
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const { handles, isBoardPage } = sandbox;
const SCOPE = 'https://www.mirentor.com/ventas/equipo/';
const at = (path) => new URL(path, SCOPE);

test('the worker answers for the board\'s own files, read with GET', () => {
  for (const p of ['./', './app.js', './app.css', './fonts/geist-v1.woff2', './art/visit.webp', './index.html']) assert.equal(handles(at(p), 'GET', SCOPE), true, p);
});

test('it never touches the API, a write, the door, the sketches, or anything outside the board', () => {
  assert.equal(handles(at('./api/me'), 'GET', SCOPE), false);
  assert.equal(handles(at('./api/photo/r_1?v=2'), 'GET', SCOPE), false);
  assert.equal(handles(at('./app.js'), 'POST', SCOPE), false);
  assert.equal(handles(at('./salir'), 'GET', SCOPE), false);
  assert.equal(handles(at('./auth'), 'GET', SCOPE), false);
  assert.equal(handles(at('./next.html'), 'GET', SCOPE), false);
  assert.equal(handles(new URL('https://www.mirentor.com/ventas/'), 'GET', SCOPE), false);
  assert.equal(handles(new URL('https://evil.example/ventas/equipo/app.js'), 'GET', SCOPE), false);
});

test('only the board\'s own page is kept: never the sign-in page served at the same address', () => {
  assert.equal(isBoardPage('<!doctype html><main class="app" id="app"></main><script type="module" src="app.js"></script>'), true);
  assert.equal(isBoardPage('<!doctype html><title>Portal de ventas</title><div id="g_id_onload"></div>'), false);
  assert.equal(isBoardPage(''), false);
});
