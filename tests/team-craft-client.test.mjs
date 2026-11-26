// Track K, the craft of the screens built after Hoy: the few decisions it makes live in team/craft-steps.js, away from
// the page, so they can be tested here; how the page uses them is pinned by its source.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { WORK_ORDER, settingsKeys, leadArt, artFit, ART_AIR, REST, shotState, goneRows, ROW_OUT } from '../team/craft-steps.js';
import { ART } from '../team/art.js';
import { DICT } from '../team/i18n.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

// K1: the profile leads with the rep's work.
test('the profile lists the work first, in a fixed order, and keeps only the account things under settings', () => {
  assert.deepEqual(WORK_ORDER, ['book', 'ladder', 'learn', 'ways', 'sites', 'docs']);
  assert.deepEqual(settingsKeys({ email: 'a@b.test' }), ['account', 'rules', 'signout']);
  assert.deepEqual(settingsKeys({}), ['rules', 'signout'], 'a copy with no session has no account to show');
  assert.deepEqual(settingsKeys({ practice: true, email: 'a@b.test' }), ['rules'], 'the practice rep has no account and no sign out');
  assert.deepEqual(settingsKeys({ manage: true }), ['badge'], 'a manager looking gives a badge');
  assert.deepEqual(settingsKeys({ manage: true, closed: true }), ['badge', 'reopen'], 'and reopens a closed day');
  const page = read('team/index.html'), app = read('team/app.js');
  const col = page.slice(page.indexOf('<div class="col-b">'), page.indexOf('</section>', page.indexOf('<div class="col-b">')));
  assert.ok(col.indexOf('id="work"') > -1 && col.indexOf('id="work"') < col.indexOf('id="badges"'), 'your work comes before the badges');
  assert.ok(col.indexOf('id="settings"') > col.indexOf('id="ledger"'), 'settings stay at the bottom');
  assert.match(app, /sites\.profileButtons\(\)/, 'my active sites is one of the work links');
  for (const lang of ['es', 'en']) assert.ok(DICT[lang]['profile.work']);
  assert.equal(DICT.es['profile.work'], 'tu trabajo');
  assert.equal(DICT.en['profile.work'], 'your work');
});

// K2: the later screens get an illustrated lead, from the app's own art, lit by the rule Semana's results use.
test('each later screen gets its own picture, lit when its state is done; the tables and the card get none', () => {
  assert.deepEqual(leadArt('route', { at: 0, complete: false }), { art: 'meeting', glow: 'meetingGlow', frame: null, lit: false, dim: false });
  assert.equal(leadArt('route', { at: 1 }).art, 'contract');
  assert.equal(leadArt('route', { at: 2 }).art, 'contract');
  for (const at of [3, 4, 5]) assert.equal(leadArt('route', { at }).art, 'summit', `stop ${at + 1}`);
  assert.deepEqual(leadArt('route', { at: 5, complete: true }), { art: 'summit', glow: 'summitGlow', frame: null, lit: true, dim: false });
  assert.equal(leadArt('sites', { count: 1, minutes: 0 }).lit, false);
  assert.equal(leadArt('sites', { count: 1, minutes: 30 }).lit, true, 'a site that recorded this week lights it');
  assert.equal(leadArt('ways', { count: 3, yours: 2 }).lit, false);
  assert.equal(leadArt('ways', { count: 3, yours: 0 }).lit, true, 'nothing on the way waits on the rep');
  assert.deepEqual(leadArt('ways', { count: 0, yours: 0 }), REST, 'an empty list rests');
  assert.deepEqual(leadArt('install', { ready: 2, of: 2 }), { art: 'hand', glow: 'handLit', frame: null, lit: true, dim: false });
  assert.equal(leadArt('install', { ready: 1, of: 2 }).lit, false);
  assert.equal(leadArt('install', { ready: 0, of: 0 }).lit, false);
  assert.equal(leadArt('docs', { count: 3 }), null, 'documents with rows: no lead picture (the ruling of the final round)');
  assert.deepEqual(leadArt('docs', { count: 0 }), REST);
  assert.deepEqual(leadArt('sites', { count: 0 }), REST);
  assert.equal(leadArt('learn', { shown: 2, seen: 2 }), null, 'Aprender with videos: no lead picture');
  assert.deepEqual(leadArt('learn', { shown: 0, seen: 0 }), REST, 'no videos: the rest picture');
  assert.equal(leadArt('book', { owned: 4, overdue: 0, today: 0 }).art, 'followThumb', 'its small file');
  assert.equal(leadArt('book', { owned: 4, overdue: 0, today: 0 }).lit, true, 'nothing due: caught up');
  assert.equal(leadArt('book', { owned: 4, overdue: 1, today: 0 }).lit, false);
  for (const name of ['score', 'biz', 'ladder', 'profile']) assert.equal(leadArt(name, {}), null, name);
  // every picture is a file the app already has
  for (const name of ['route', 'sites', 'ways', 'install', 'docs', 'learn', 'book']) {
    const a = leadArt(name, { at: 0, count: 1, shown: 1 }) || REST;
    assert.ok(ART[a.art], a.art); if (a.glow) assert.ok(ART[a.glow], a.glow);
  }
});

// H1: art never costs a tap.
test('the art takes only the room under the first action: 160, or 120 on a small phone, or nothing', () => {
  const big = { width: 390, height: 844 }, small = { width: 360, height: 740 };
  assert.deepEqual(artFit({ ...big, room: 400 }), { lead: 160, empties: [] });
  assert.deepEqual(artFit({ ...small, room: 400 }), { lead: 120, empties: [] }, 'a small phone shrinks it to 120');
  assert.deepEqual(artFit({ ...big, room: 160 + ART_AIR - 1 }), { lead: 120, empties: [] }, 'not room for 160: 120');
  assert.deepEqual(artFit({ ...big, room: 120 + ART_AIR - 1 }), { lead: 0, empties: [] }, 'not room for 120: left out');
  assert.deepEqual(artFit({ ...big, room: -30 }), { lead: 0, empties: [] }, 'an action already under the fold gets no art above it');
  assert.deepEqual(artFit({ ...big, room: Infinity }), { lead: 160, empties: [] }, 'a screen with no action has room');
  assert.deepEqual(artFit({ ...big, room: 160 + 120 + 3 * ART_AIR, lead: true, above: 2 }), { lead: 160, empties: [120, 0] }, 'empty lists above the first action take what is left, in order');
  assert.deepEqual(artFit({ ...big, room: 120 + ART_AIR, lead: false, above: 1 }), { lead: 0, empties: [120] });
  assert.deepEqual(artFit({ width: 1440, height: 900, room: 500 }), { lead: 160, empties: [] });
});

test('the lead art is the .robj of Semana, built from art.js with lazy images, and fitted on every screen change', () => {
  const page = read('team/index.html'), app = read('team/app.js'), mod = read('team/art-lead.js');
  for (const id of ['rtArt', 'wyArt', 'stArt', 'instArt', 'docArt', 'lrnArt', 'bkArt']) assert.match(page, new RegExp(`<span class="robj k-art lead-art" id="${id}" aria-hidden="true" hidden></span>`), id);
  assert.match(mod, /loading: 'lazy'/); assert.match(mod, /width: /); assert.match(mod, /alt: ''/);
  assert.match(mod, /ART\[/, 'the address comes from art.js');
  assert.match(app, /fitArt\(/);
  assert.match(page, /<link rel="modulepreload" href="art-lead\.js">/);
});

// K3: empty lists say something, and a photo that is loading or failed says so.
test('an empty list rests on rest.webp at 120 px with its one line, and the consent photo shows its state', () => {
  assert.deepEqual(REST, { art: 'restThumb', glow: null, frame: 0, lit: false, dim: false, rest: true });
  assert.ok(ART.restThumb);
  assert.equal(shotState({ consent: false }), 'none');
  assert.equal(shotState({ consent: true }), 'loading');
  assert.equal(shotState({ consent: true, loaded: true }), 'shown');
  assert.equal(shotState({ consent: true, failed: true }), 'failed');
  assert.equal(shotState({ consent: true, loaded: true, failed: true }), 'failed', 'an error after a load is still an error');
  for (const lang of ['es', 'en']) for (const k of ['install.w.photo.failed', 'needs.none']) assert.ok(DICT[lang][k], `${lang}.${k}`);
  assert.equal(DICT.es['install.w.photo.failed'], 'No se pudo cargar la foto. Toca para reintentar.');
  assert.equal(DICT.en['install.w.photo.failed'], 'The photo could not load. Tap to try again.');
  const book = read('team/book.js'), mgr = read('team/manager.js'), sc = read('team/scorecard.js'), inst = read('team/install.js');
  assert.match(book, /restArt\(\)/, 'each empty list of Mis negocios');
  assert.match(mgr, /restArt\(\)/, 'Pendientes with nothing waiting');
  assert.match(sc, /restArt\(\)/, 'a Scorecard cell with nothing in it');
  assert.match(inst, /shotState\(/);
  assert.match(read('team/app.css'), /\.empty-art\{[^}]*height:120px/);
});

// K4: one ground per family of screens, from the zone grounds that exist.
test('the first days, the route and Aprender explain on porcelain; the profile, the sites, Documentos and Mis negocios lead on deep', () => {
  const page = read('team/index.html'), css = read('team/app.css');
  const cls = (id) => (page.match(new RegExp(`<section class="([^"]+)" id="${id}"`)) || [])[1] || '';
  for (const id of ['s-ladder', 's-route', 's-learn']) assert.match(cls(id), /\bz-week\b.*\bground\b/, id);
  for (const id of ['s-profile', 's-sites', 's-ways', 's-docs', 's-book']) assert.match(cls(id), /\bz-team\b.*\bground\b/, id);
  for (const id of ['s-install', 's-worker', 's-biz', 's-team', 's-needs', 's-score', 's-reps']) assert.doesNotMatch(cls(id), /\bz-(week|team)\b/, `${id} keeps its ground`);
  assert.match(css, /\.ground\{/);
  // no new color: every color the grounds' rules name is a token or one of the rgba washes already in use
  const rules = css.split('\n').filter((l) => /\.(z-week|z-team) \.|\.ground/.test(l)).join('\n');
  assert.doesNotMatch(rules, /#[0-9a-f]{3,6}\b/i, 'a ground takes the tokens, never a new hex');
});

// K5: a row that leaves Pendientes goes out, the rows below close up, and the tab's count rolls.
test('the rows that left are the keys drawn before and not after, each with the row it came after', () => {
  assert.deepEqual(goneRows(['a', 'b', 'c'], ['a', 'c']), [{ key: 'b', after: 'a' }]);
  assert.deepEqual(goneRows(['a', 'b', 'c'], ['c']), [{ key: 'a', after: null }, { key: 'b', after: null }], 'the row before it left too: it goes first in its list');
  assert.deepEqual(goneRows(['a'], ['a', 'z']), [], 'a new row is not a leaving one');
  assert.deepEqual(goneRows([], ['a']), []);
  assert.deepEqual(ROW_OUT, { fade: 160, close: 200, x: 12 });
  const mgr = read('team/manager.js'), app = read('team/app.js');
  assert.match(mgr, /goneRows\(/); assert.match(mgr, /'data-key'/);
  assert.match(app, /roll\(/, 'the tab count rolls');
});

// K6: Vendedores shows one action per rep; the others are in a sheet, "Desactivar" last.
test('a rep row keeps "Ver como" and puts the rest in its sheet, nothing lost', async () => {
  const { repActions } = await import('../team/craft-steps.js');
  const rep = { isPlayer: true, admin: false, self: false, active: true, role: 'rep', ladder: true, hourDone: false };
  assert.deepEqual(repActions(rep), { shown: ['viewas'], more: ['hour', 'edit', 'deactivate'] });
  assert.deepEqual(repActions({ ...rep, hourDone: true }).more, ['hour-undo', 'edit', 'deactivate']);
  assert.deepEqual(repActions({ ...rep, ladder: false }).more, ['edit', 'deactivate'], 'no first days: no first hour to mark');
  assert.deepEqual(repActions({ ...rep, active: false }), { shown: ['viewas'], more: ['edit', 'activate'] }, 'an inactive rep is switched back on from the sheet');
  // a manager among the others: no view-as; an admin edits and switches them off, never themselves
  const other = { isPlayer: false, admin: true, self: false, active: true, role: 'manager' };
  assert.deepEqual(repActions(other), { shown: [], more: ['edit', 'deactivate'] });
  assert.deepEqual(repActions({ ...other, self: true }), { shown: [], more: [] }, 'nobody edits or switches off themselves');
  assert.deepEqual(repActions({ ...other, admin: false }), { shown: [], more: [] }, 'a manager does not touch another manager');
  assert.deepEqual(repActions({ ...rep, self: true }), { shown: ['viewas'], more: ['hour', 'edit'] }, 'a rep row is edited by any manager, never switched off by themselves');
  const mgr = read('team/manager.js'), page = read('team/index.html'), css = read('team/app.css');
  assert.match(mgr, /repActions\(/);
  assert.match(page, /<dialog class="sheet" id="moreSheet"/);
  assert.match(css, /\.more-acts \.more-act\{[^}]*min-height:44px/);
  assert.match(css, /\.more-act\.danger\{color:var\(--signal-ink\)/);
  for (const lang of ['es', 'en']) assert.ok(DICT[lang]['reps.more'] && DICT[lang]['reps.more.aria']);
});

// K7: loading is the mark, not a dot.
test('the boot screen draws the top bar\'s M from its own paths, its joints locking in turn, and the loads hold the giant', () => {
  const page = read('team/index.html'), css = read('team/app.css'), svg = read('team/img/mirentor-symbol-dark.svg');
  const boot = page.slice(page.indexOf('id="s-boot"'), page.indexOf('</section>', page.indexOf('id="s-boot"')));
  const line = svg.match(/<polyline points="([^"]+)"/)[1];
  assert.ok(boot.includes(`points="${line}"`), 'the same M');
  for (const m of svg.matchAll(/<circle cx="([\d.]+)" cy="([\d.]+)" r="([\d.]+)"/g)) assert.ok(boot.includes(`cx="${m[1]}" cy="${m[2]}" r="${m[3]}"`), `joint ${m[1]},${m[2]}`);
  assert.doesNotMatch(boot, /bootpulse|<i><\/i>/, 'no pulsing dot');
  assert.match(css, /\.bootm circle\{[^}]*animation:bootlock/);
  assert.match(css, /@keyframes bootlock/);
  assert.match(css, /animation-delay:90ms/); assert.match(css, /animation-delay:360ms/);
  assert.match(css, /\.bootm circle\{animation:none\}/, 'reduced motion: the mark stands still');
  assert.match(css, /#s-team \.giant:empty/, 'the manager\'s load keeps the giant\'s height');
  assert.match(css, /\.ld-giant:empty/, 'and the leader\'s');
});

// K8: the stop's button changes with its stop.
test('on a stop change the button joins the stagger of the stop title and line', () => {
  const app = read('team/app.js');
  assert.match(app, /stagger\(\[\$\('#stopTitle'\), \$\('#stopSub'\), \$\('#nextBtn'\)\]\.filter\(\(n\) => !n\.hidden\), \{ step: 60, y: 8 \}\)/);
});

// K9: one scale for time, corners and type.
test('time has six tokens, and the stylesheet\'s transitions use them', async () => {
  const css = read('team/app.css'), { EASE } = await import('../team/ui.js').catch(() => ({ EASE: null }));
  for (const [k, v] of Object.entries({ press: 140, state: 200, enter: 260, sheet: 320, reveal: 560, track: 620 })) assert.match(css, new RegExp(`--d-${k}:${v}ms`));
  const left = [...css.matchAll(/transition(?:-duration)?:([^;}]*)/g)].map((m) => m[1].replace(/calc\((?:[^()]|\([^()]*\))*\)/g, '')).join(' ').match(/\b\d+ms\b/g) || [];
  // the final round gave three approved moments their own time back: the entrance's name 600 ms, the day's moment's exit
  // 380 ms and the result's light 700 ms (and a new feed line keeps its 420 ms animation)
  assert.deepEqual([...new Set(left)].sort(), ['1200ms', '240ms', '380ms', '600ms', '60ms', '700ms'], 'only the sheet\'s close (its script waits 240 ms), two delays (60 ms, 1.2 s) and the three approved moments keep a number');
  assert.match(css, /\.g-name\{[^}]*clip-path 600ms/); assert.match(css, /clip-path 380ms var\(--ease-out\),visibility 0s linear 380ms/);
  assert.match(css, /\.feed li\.new\{animation:feedin 420ms/); assert.match(css, /\.robj \.base\{[^}]*filter 700ms/);
  void EASE;
  assert.match(read('team/ui.js'), /reveal: 'cubic-bezier\(\.16,1,\.3,1\)', drawer: 'cubic-bezier\(\.32,\.72,0,1\)'/);
});

test('corners come from one scale: 3, 10, 16, 20, a pill and a circle', () => {
  const css = read('team/app.css');
  assert.match(css, /--r-sheet:20px/);
  const values = [...css.matchAll(/border-radius:([^;}]*)/g)].flatMap((m) => m[1].trim().split(/\s+/));
  assert.deepEqual([...new Set(values)].filter((v) => !/^(var\(--r-(hud|input|media|sheet)\)|999px|50%|0)$/.test(v)), []);
});

test('type takes the scale: the half sizes and the off-scale numerals are gone, the label kept where it would wrap', () => {
  const css = read('team/app.css');
  const sizes = [...css.matchAll(/font-size:([0-9.]+)px/g), ...[...css.matchAll(/font:[^;}]*/g)].flatMap((m) => [...m[0].matchAll(/\s([0-9.]+)px(?=\/|\s)/g)])].map((m) => m[1]);
  for (const gone of ['13.5', '14.5', '16.5', '21', '23', '24']) assert.ok(!sizes.includes(gone), `${gone}px is off the scale`);
  assert.deepEqual(sizes.filter((v) => v === '11.5'), ['11.5'], 'only .label keeps 11.5 (at 12 "Semana pasada" wraps on Mis sitios activos)');
  assert.match(css, /\.label\{font:500 11\.5px/);
});

// Final round (N5): the profile's links are built from WORK_ORDER, not in an order of their own.
test('the profile\'s work links come out in WORK_ORDER, whatever order they are handed in', async () => {
  const { inWorkOrder } = await import('../team/craft-steps.js');
  assert.deepEqual(inWorkOrder({ docs: ['D'], sites: [], book: ['B'], learn: ['L'], ladder: ['A'], ways: ['W'] }), ['B', 'A', 'L', 'W', 'D']);
  assert.deepEqual(inWorkOrder({}), []);
  const app = read('team/app.js');
  assert.match(app, /put\(\$\('#work'\), \.\.\.inWorkOrder\(/);
});

// Final round (N5): "Más" is an outlined mini-btn like the other secondary actions, and a failed action in its sheet keeps
// the sheet open and says what failed there.
test('"Más" is outlined, and its sheet stays open with the reason when an action fails', () => {
  const mgr = read('team/manager.js'), page = read('team/index.html');
  assert.match(mgr, /h\('button', \{ class: 'mini-btn', type: 'button', 'data-act': 'more'/);
  assert.doesNotMatch(mgr + read('team/app.css'), /mini-btn quiet|\.mini-btn\.quiet/);
  assert.match(page, /<div class="more-acts" id="moreActs"><\/div>\s*<p class="formerr" id="moreErr" role="alert" hidden><\/p>/);
  const sheet = mgr.slice(mgr.indexOf('function moreSheet('), mgr.indexOf('function practiceGroup('));
  assert.match(sheet, /=== true/, 'the sheet closes only when the action went through');
  assert.doesNotMatch(sheet, /\.then\(\(\) => closeSheet\(dlg\)\)/, 'never on a failure');
  assert.match(mgr, /const act = \(btn, call, okKey, said = null\)/);
});

// Final round (N5): the small things of the look, pinned by their source.
test('the small things: the Guion rows, the porcelain card\'s edge, the word giant at 360, the empty line, the time field, no dead key', () => {
  const docs = read('team/docs.js'), css = read('team/app.css'), book = read('team/book.js');
  const guion = docs.slice(docs.indexOf('function openGuion('), docs.indexOf('openSheet($(\'#guionSheet\'))'));
  assert.match(guion, /class: 'inst-row lrn-row tap doc-row guion-row' \}, h\('span', \{ class: 'lrn-slot' \}, page\(\)\)/, 'the row Documentos uses');
  assert.match(css, /\.z-week \.inst-prep\{[^}]*inset 0 0 0 1px rgba\(27,29,32,\.14\),0 6px 18px rgba\(27,29,32,\.08\)/);
  assert.match(css, /@media \(max-width:379px\)\{\.giant\.word\.long\{font-size:16vw\}\}/);
  assert.match(book, /h\('div', \{ class: 'empty-line' \}, restArt\(\)/);
  assert.match(css, /\.empty-line>\.k-art\.empty-art\[data-px\]\{display:block;flex:none;height:72px/);
  assert.match(css, /\.bz-time\{display:grid;grid-template-columns:minmax\(0,1fr\) max-content/);
  for (const l of ['es', 'en']) assert.equal(DICT[l]['biz.chip'], undefined);
});
