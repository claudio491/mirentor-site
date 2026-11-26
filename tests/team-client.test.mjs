// The client has no build step and no framework, so these checks stand in for a compiler:
// every sentence exists in both languages, nothing the browser's policy forbids is in the page, and no markup is built from strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { DICT, makeT, LANGS } from '../team/i18n.js';
import { KINDS, CHANNELS, RULES } from '../lib/team/rules.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
// Every script of the client, read from the folder: a module added later is checked like the others, with no list to keep.
const SCRIPTS = readdirSync(new URL('../team/', import.meta.url)).filter((f) => f.endsWith('.js')).sort().map((f) => `team/${f}`);
const flat = (v) => (Array.isArray(v) ? v.join(' ') : v);
const holes = (v) => [...new Set(flat(v).match(/\{\w+\}/g) || [])].sort();

test('Spanish and English have exactly the same keys, the same blanks and the same plural shape', () => {
  assert.deepEqual(LANGS, ['es', 'en']);
  assert.deepEqual(Object.keys(DICT.es).sort(), Object.keys(DICT.en).sort());
  for (const k of Object.keys(DICT.es)) {
    assert.deepEqual(holes(DICT.es[k]), holes(DICT.en[k]), `blanks differ in ${k}`);
    assert.equal(Array.isArray(DICT.es[k]), Array.isArray(DICT.en[k]), `plural shape differs in ${k}`);
    for (const lang of LANGS) assert.ok(flat(DICT[lang][k]).trim().length > 0, `${lang}.${k} is empty`);
  }
});

test('no em dash anywhere a person reads, and the fixed vocabulary holds', () => {
  for (const lang of LANGS) for (const [k, v] of Object.entries(DICT[lang])) assert.equal(/[—―]| – /.test(flat(v)), false, `${lang}.${k} has a dash`);
  // One word per thing: the score is "puntos / points", the hand's joints are "luces / lights" (they were "marcas / marks").
  for (const lang of LANGS) for (const [k, v] of Object.entries(DICT[lang])) assert.equal(/\bmarcas\b|\b(?:four|possible|of \d+|\{b\}) marks\b/i.test(flat(v)), false, `${lang}.${k} still calls the lights marks`);
  for (const [k, v] of Object.entries(DICT.es)) assert.equal(/\bXP\b|\bpuntaje\b/i.test(flat(v)), false, `es.${k} names the score another way`);
  for (const [k, v] of Object.entries(DICT.en)) assert.equal(/\bXP\b|\bscore points\b/i.test(flat(v)), false, `en.${k} names the score another way`);
  // Who confirms is "líder" in Spanish and "manager" in English, everywhere.
  for (const [k, v] of Object.entries(DICT.es)) assert.equal(/\bmanagers?\b/i.test(flat(v)), false, `es.${k} says manager`);
  for (const [k, v] of Object.entries(DICT.en)) assert.equal(/l[ií]der/i.test(flat(v)), false, `en.${k} says líder`);
  // "Meta" and "goal" name only the weekly goal a rep picks, and the Scorecard's own goal on the leadership view
  // (lead.goal.*, always attributed to the Scorecard, and sc.note, which says the Scorecard counts touches with no goal);
  // the team's number is "objetivo" and "target".
  const outsideGoal = (lang, re) => Object.entries(DICT[lang]).filter(([k, v]) => !/^(goal\.|err\.goal|col\.goal|lead\.goal\.|sc\.note$)/.test(k) && re.test(flat(v).replace(/\{\w+\}/g, ''))).map(([k]) => k);
  assert.deepEqual([outsideGoal('es', /\bmetas?\b/i), outsideGoal('en', /\bgoals?\b/i)], [[], []]);
});

test('every key the scripts ask for exists', () => {
  const es = DICT.es;
  for (const file of SCRIPTS) {
    const src = read(file);
    for (const m of src.matchAll(/\bt\(\s*'([^']+)'/g)) assert.ok(m[1] in es, `${file} uses a missing key: ${m[1]}`);
    // Families built from a code: t(`feed.${code}`) needs at least one key with that prefix.
    for (const m of src.matchAll(/\bt\(\s*`([a-zA-Z.]+)\$\{/g)) assert.ok(Object.keys(es).some((k) => k.startsWith(m[1])), `${file} uses a missing family: ${m[1]}`);
  }
  const page = read('team/index.html');
  for (const m of page.matchAll(/data-t(?:-aria|-ph)?="([^"]+)"/g)) assert.ok(m[1] in es, `index.html uses a missing key: ${m[1]}`);
});

test('every code the server can send has its words', () => {
  const need = [];
  for (const k of Object.keys(KINDS)) need.push(`kind.${k}`);
  for (const c of Object.keys(CHANNELS)) need.push(`ch.${c}`);
  for (const l of RULES.levels) need.push(`level.${l.name}`);
  const codes = ['visit', 'conversation', 'followup', 'message', 'reply', 'meeting_booked', 'meeting_held', 'contract_sent', 'contract_signed', 'site_signed', 'site_installed', 'site_first_hour', 'day_closed'];
  for (const c of codes) need.push(`led.${c}`, `ledsrc.${c}`);
  for (const c of ['talk', 'absent', 'call', 'reply', 'meeting', 'contract', 'meeting_held', 'contract_sent', 'contract_signed', 'site_signed', 'site_installed', 'site_first_hour', 'day_closed', 'badge']) need.push(`feed.${c}`);
  for (const c of ['first_log', 'first_meeting', 'streak', 'full_hand', 'visits', 'first_site_live']) need.push(`badge.${c}`, `badge.info.${c}`);
  for (const c of ['meeting', 'waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call']) need.push(`tag.${c}`);
  for (let i = 0; i < 4; i += 1) need.push(`habit.${i}`, `habit.${i}.s`, `habitname.${i}`);
  // The business: why it was lost, its stage in the CRM and the next step each result proposes.
  // The literal list stands in until the server's RULES.lostReasons is merged; then both are checked.
  const lostReasons = ['no_trust', 'privacy', 'union_hr', 'small_team', 'desk_work', 'no_wifi_lead', 'not_priority', 'went_quiet', 'other'];
  for (const r of new Set([...lostReasons, ...(RULES.lostReasons || [])])) need.push(`biz.reason.${r}`);
  for (const s of ['new', 'contacted', 'booked', 'done', 'sent', 'signed', 'setup', 'live', 'lost', 'waitlist']) need.push(`biz.stage.${s}`);
  for (const s of ['schedule', 'revisit', 'follow', 'recall', 'check', 'answer', 'meeting', 'sign', 'retry']) need.push(`nx.step.${s}`);
  // Every refusal the API can answer.
  const api = read('lib/team/api.mjs');
  const errors = new Set([...api.matchAll(/fail\(\d{3}, '([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(errors.size > 20, 'the API refusals were not found');
  for (const e of errors) need.push(`err.${e}`);
  for (const k of need) for (const lang of LANGS) assert.ok(k in DICT[lang], `${lang} is missing ${k}`);
});

test('the business words: no "lead" or "prospecto" on screen, and the four fixed words are used', () => {
  for (const [k, v] of Object.entries(DICT.es)) if (/^(biz|bk|nx)\./.test(k)) assert.equal(/\blead\b|prospect/i.test(flat(v)), false, k);
  assert.deepEqual([DICT.es['biz.own.mine'], DICT.es['biz.own.free'], DICT.es['nx.title']], ['Tuyo', 'Libre', 'Próximo paso']);
  // The words the screens of the business ask for outside the biz., bk. and nx. families.
  for (const k of ['log.took', 'log.owned', 'log.time', 'err.next', 'err.next_day', 'err.next_step', 'err.free', 'err.open', 'err.list', 'col.owned', 'col.overdue', 'mgr.book.today', 'mgr.book.nonext', 'mgr.flag.overdue', 'needs.overdue.title', 'needs.overdue.empty', 'needs.overdue.item']) {
    for (const lang of LANGS) assert.ok(k in DICT[lang], `${lang} is missing ${k}`);
  }
  // The styles of the business, under their own comment, with the three prefixes only.
  const css = read('team/app.css'), at = css.indexOf('/* the business: strip, next step, card, book */');
  assert.ok(at > 0, 'the block of the business is in the stylesheet');
  for (const c of ['bk-card', 'bk-sub', 'bz-strip', 'bz-acts', 'bz-facts', 'bz-reason', 'nxs-say']) assert.match(css.slice(at), new RegExp(`\\.${c}\\b`), c);
});

test('the dictionary source has no duplicate key in either language', () => {
  // A parsed object cannot show a duplicate: the later one silently wins. So the source text is read, one language block at a time.
  const src = read('team/i18n.js');
  const blocks = { es: src.slice(src.indexOf('const es = {'), src.indexOf('const en = {')), en: src.slice(src.indexOf('const en = {'), src.indexOf('export const DICT')) };
  for (const lang of LANGS) {
    const seen = new Map();
    for (const m of blocks[lang].matchAll(/^\s*'([^']+)':/gm)) seen.set(m[1], (seen.get(m[1]) || 0) + 1);
    const dup = [...seen].filter(([, n]) => n > 1).map(([k]) => k);
    assert.deepEqual(dup, [], `${lang} repeats keys: ${dup.join(', ')}`);
  }
});

test('no two role labels are the same within a language', () => {
  for (const lang of LANGS) {
    const labels = Object.entries(DICT[lang]).filter(([k]) => /^role\.[a-z]+$/.test(k)).map(([, v]) => v);
    assert.ok(labels.length >= 4);
    assert.equal(new Set(labels).size, labels.length, `${lang} repeats a role label: ${labels.join(', ')}`);
  }
});

test('t fills the blanks, picks the plural and never returns a bare key', () => {
  const es = makeT('es'), en = makeT('en');
  assert.equal(es('today.of', { a: 1, b: 4 }), '1 de 4');
  assert.equal(en('today.of', { a: 1, b: 4 }), '1 of 4');
  assert.equal(es('u.points', { n: 1 }), '1 punto');
  assert.equal(es('u.points', { n: 12 }), '12 puntos');
  assert.equal(en('u.points', { n: 1 }), '1 point');
  assert.equal(es('u.points', { n: 1240 }), '1,240 puntos');
  assert.deepEqual([es('pts.plus', { n: 1 }), es('pts.plus', { n: 8 }), en('pts.plus', { n: 1 })], ['+1 pt', '+8 pts', '+1 pt']);
  assert.throws(() => es('no.such.key'), /no\.such\.key/);
});

test('a sheet opens with the focus on its title, so the title is what a screen reader says first', () => {
  // Left alone the browser hands the focus to the first control inside, the close button: a screen reader then opens
  // every sheet with "Cerrar, botón", and a sheet opened from the keyboard rings its close button. (Chrome ignores
  // autofocus on the dialog itself.) The title can take the focus, and opening a sheet gives it the focus.
  const page = read('team/index.html');
  const sheets = [...page.matchAll(/<dialog\b[^>]*class="sheet"[^>]*aria-labelledby="([^"]+)"[^>]*>/g)];
  assert.ok(sheets.length >= 5, 'the sheets are in the page');
  for (const [, title] of sheets) assert.match(page, new RegExp(`<h2 id="${title}"[^>]*\\stabindex="-1"`), `the title #${title} must take the focus`);
  const body = (read('team/ui.js').match(/export function openSheet\(dlg\) \{[\s\S]*?\n\}/) || [''])[0];
  assert.match(body, /\$\('h2', dlg\)[\s\S]*\.focus\(\{ preventScroll: true \}\)/, 'openSheet gives the title the focus');
});

test('the page obeys its own policy: no inline script, no inline style, no handler attributes', () => {
  const page = read('team/index.html');
  assert.equal(/<script(?![^>]*\ssrc=)[^>]*>/i.test(page), false, 'inline script');
  assert.equal(/\sstyle\s*=/i.test(page), false, 'style attribute');
  assert.equal(/<style[\s>]/i.test(page), false, 'style element');
  assert.equal(/\son[a-z]+\s*=/i.test(page), false, 'handler attribute');
  assert.match(page, /<script type="module" src="app\.js"><\/script>/);
  assert.match(page, /<meta name="robots" content="noindex, ?nofollow">/);
  for (const m of page.matchAll(/(?:src|href)="([^"#?:]+\.[a-z0-9]+)"/g)) assert.ok(existsSync(new URL(`../team/${m[1]}`, import.meta.url)), `missing file ${m[1]}`);
});

test('every address in the client is relative, so the app works wherever it is mounted', () => {
  for (const file of [...SCRIPTS, 'team/index.html', 'team/app.css', 'team/manifest.webmanifest']) {
    assert.equal(/(["'`]|url\()\/(?!\/)[a-z]/i.test(read(file)), false, `${file} has an address that starts at the root of the site`);
  }
});

test('the scripts never build markup from strings', () => {
  for (const file of SCRIPTS) {
    const src = read(file);
    assert.equal(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|\beval\(|new Function/.test(src), false, `${file} builds markup or code from a string`);
    assert.equal(/\.style\.cssText|setAttribute\('style'/.test(src), false, `${file} writes a style attribute`);
  }
});

test('the stylesheet keeps the motion rules', () => {
  const css = read('team/app.css');
  assert.equal(/transition:\s*all\b/.test(css), false, 'transition: all');
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/);
  assert.equal(/scale\(0\)/.test(css), false, 'scale(0)');
  for (const m of css.matchAll(/url\(([^)]+)\)/g)) { const f = m[1].replace(/["']/g, ''); if (!f.startsWith('data:')) assert.ok(existsSync(new URL(`../team/${f}`, import.meta.url)), `missing ${f}`); }
  // Nothing is set under 11 px. Sizes from 11 to 12.9 px are for the short mono labels only (chips, column heads, axis labels):
  // every rule that uses one must say so by using the mono family or being one of the label classes.
  for (const m of css.matchAll(/font(?:-size)?:[^;}]*?(\d+(?:\.\d+)?)px/g)) assert.ok(Number(m[1]) >= 11, `a ${m[1]}px font`);
  for (const m of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const size = /font(?:-size)?:[^;]*?(\d+(?:\.\d+)?)px/.exec(m[2]);
    if (size && Number(size[1]) < 13) assert.ok(/var\(--mono\)/.test(m[2]) || /\.(tab|flabel|slabel|count|tag|cell-l|chip)\b/.test(m[1]), `text under 13 px outside a label: ${m[1].trim()}`);
  }
});

// 25 Nov (craft review, change 1): a deep screen that started its arrival on a timer after setTab showed whole in the
// wipe, went blank and built itself again. Its arrival runs inside the change instead (setTab's onArrive).
test('a deep screen arrives inside the change, never on a timer after it', () => {
  for (const f of ['team/ladder.js', 'team/route.js', 'team/install.js', 'team/sites.js', 'team/docs.js', 'team/leader.js']) {
    for (const m of read(f).matchAll(/setTimeout\([^;]*?, (?:reduce \? 0 : )?90\)/g)) assert.fail(`${f} arrives on a timer after setTab: ${m[0].slice(0, 60)}`);
  }
  assert.match(read('team/app.js'), /function setTab\(name, \{[^}]*onArrive[^}]*\} = \{\}\)/);
});

// 24 Nov: on a slow signal the modules were found one level at a time (app.js asks for ui.js, which asks for i18n.js...),
// each level a round trip: the flow audit measured the first screen at 30 s on slow 3G. The page names every module the
// app loads, so the browser asks for all of them at once. This keeps that list exactly the app's module graph.
test('the page preloads every module the app imports, and nothing else', () => {
  const graph = new Set(), walk = (file) => {
    if (graph.has(file)) return; graph.add(file);
    for (const m of read(`team/${file}`).matchAll(/^import\s+(?:[^;]*?\s+from\s+)?'\.\/([\w-]+\.js)';?/gm)) walk(m[1]);
  };
  walk('app.js');
  const page = read('team/index.html');
  const preloaded = new Set([...page.matchAll(/<link rel="modulepreload" href="([\w-]+\.js)">/g)].map((m) => m[1]));
  assert.deepEqual([...preloaded].sort(), [...graph].sort());
});

// The wiring of the read order and the door lives in app.js, which needs a page to run: pinned here by its source.
test('the quiet check asks again after the documents, a new start drops what is still out, and an ended session reloads marked for the door', () => {
  const app = read('team/app.js');
  const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
  const poll = between('async function poll()', 'async function refresh(');
  assert.match(poll, /await docs\.load\(\)[^\n]*\n\s*if \(!reads\.fresh\(read\)\) return;/, 'a log answered while the documents were read is not undone');
  assert.match(poll, /adopt\(me, read\)/);
  const start = between('async function start(', 'async function viewAs(');
  assert.match(start, /reads\.adopted\(\)/, 'nothing read for the screens being left is adopted');
  assert.match(start, /if \(ticket === starts\) enter\(me\)/, 'the answer of a start that a newer one replaced is dropped');
  assert.match(start, /if \(ticket !== starts\) return;/);
  const shut = between('function shutOut(', 'function signOut(');
  assert.match(shut, /const to = toDoor\(location\.href\)/, 'the reload goes to the door, which the worker sends to the network');
  assert.match(shut, /location\.replace\(to\)/);
  const gate = between('function showGate(', 'const DOOR');
  assert.match(gate, /kind === 'session' \? toDoor\(/);
});

test('the business card is a screen of the app, reached from a row and left by its back button', () => {
  const app = read('team/app.js'), page = read('team/index.html');
  assert.match(app, /SCREENS = \[[^\]]*'biz'/); assert.match(page, /id="s-biz"/);
  for (const id of ['bzBack', 'bzActs', 'bzNext', 'bzFacts', 'bzHistory', 'bzEnd']) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(app, /DEEP = new Set\(\[[^\]]*'biz'/, 'the phone\'s Back comes back from a card inside the app');
});

test('Hoy says who to see today: the Para hoy card, and the follow-up stop names the business', () => {
  const app = read('team/app.js'), page = read('team/index.html');
  assert.match(page, /id="bookCard"/);
  assert.ok(page.indexOf('id="bookCard"') < page.indexOf('id="installCard"'), 'Para hoy comes before the install card');
  assert.match(app, /book\.card\(/); assert.match(app, /followStop\(/);
  assert.match(app, /openLog\(stopPreset\(/, 'the stop\'s button opens the sheet with that stop\'s results first');
  // fix round 1 (A1, A3): one line of Para hoy between the headline and the stage opens Mis negocios, and so does the
  // follow-up stop's button when the agenda has rows
  assert.ok(page.indexOf('id="hoyLine"') > page.indexOf('id="todayGiant"') && page.indexOf('id="hoyLine"') < page.indexOf('id="stopStage"'));
  assert.match(app, /\$\('#hoyLine'\)\.addEventListener\('click', \(e\) => book\.open\('today', e\.currentTarget\)\)/);
  assert.match(app, /sel === 2 && S\.me\.agenda && S\.me\.agenda\.due\.length\) book\.open\('today', \$\('#nextBtn'\)\)/);
});

test('Mis negocios is a screen of the app, reached from Para hoy and the profile', () => {
  const app = read('team/app.js'), page = read('team/index.html'), book = read('team/book.js');
  assert.match(app, /SCREENS = \[[^\]]*'book'/); assert.match(app, /DEEP = new Set\(\[[^\]]*'book'/);
  assert.match(page, /id="s-book"/);
  for (const id of ['bkBack', 'bkCount', 'bkGiant', 'bkSupport', 'bkRO', 'bkList']) assert.match(page, new RegExp(`id="${id}"`));
  assert.match(book, /bk\.card\.all/); assert.match(app, /book\.profileButtons\(\)/);
});

// 25 Nov, the craft review (changes 2 and 3): the points counted before the dot that carries them landed, a toast
// jumped from the top to the bottom while the sheet closed, and "Guardando…" was a toast of its own.
test('the reward lands in order: the points count when the dot lands, and a toast keeps its edge', () => {
  const app = read('team/app.js'), ui = read('team/ui.js'), css = read('team/app.css');
  const between = (src, a, b) => src.slice(src.indexOf(a), src.indexOf(b, src.indexOf(a)));
  const logged = between(app, 'function logged(', '// ---- the moments');
  assert.ok(logged.indexOf('S.ptsHeld') >= 0 && logged.indexOf('S.ptsHeld') < logged.indexOf('renderAll(true)'), 'the chip keeps its old number before the screens are drawn');
  assert.match(logged, /flyDot\([\s\S]*?, tag, \(\) => \{\s*S\.ptsHeld = null; countTo\(\$\('#ptsN'\)/, 'it counts when the dot lands');
  assert.match(between(app, 'function renderTop(', 'function renderNav('), /S\.ptsHeld/);
  const save = between(app, 'function saveLog(', 'function logged(');
  assert.equal(/toast\(`\$\{t\('c\.saving'\)\}/.test(save), false, 'no "Guardando…" toast');
  assert.match(save, /t\('c\.saving'\)/, 'the save button says it');
  assert.match(between(ui, 'export function toast(', 'export function holdToast('), /dataset\.edge/);
  assert.equal(/:has\(dialog\.sheet\[open\]\) \.toast/.test(css), false, 'the toast\'s place is decided when it shows, not while it is on screen');
  assert.match(css, /\.toast\[data-edge=bottom\]/);
});

// 25 Nov (REPUX-17): a tie read "A 0 puntos de Omar." The table's gap line says the tie instead.
test('a tie on the table reads "Empatas con {name}.", never a gap of 0 points', () => {
  const es = makeT('es'), en = makeT('en');
  assert.equal(es('table.sup.tie', { name: 'Omar' }), 'Empatas con Omar.');
  assert.equal(en('table.sup.tie', { name: 'Omar' }), 'You are tied with Omar.');
  assert.equal(es('table.sup.tie.next'), 'Empatas con el siguiente lugar.');
  // the words are decided once, in moments.js gapLine (tests/team-moments.test.mjs), for the table and the entrance
  const line = read('team/app.js').split('\n').find((l) => l.includes("T.gap.aheadOnPodium"));
  assert.match(line, /gapLine\(\{ pts: T\.gap\.pts, name: T\.gap\.aheadOnPodium \? T\.gap\.aheadName : null \}\)/);
});

// 25 Nov (REPUX-15): tapping "1 por enviar" did nothing a rep could see. It tries again and, while the log still waits, says so.
test('the waiting chip says what waits when tapped, in both languages and both counts', () => {
  for (const [lang, one, two] of [['es', '1 registro espera señal. Se envía solo cuando vuelva.', '2 registros esperan señal. Se envían solos cuando vuelva.'],
    ['en', '1 log is waiting for signal. It sends itself when the signal is back.', '2 logs are waiting for signal. They send themselves when the signal is back.']]) {
    assert.equal(makeT(lang)('top.queue.wait', { n: 1 }), one);
    assert.equal(makeT(lang)('top.queue.wait', { n: 2 }), two);
  }
  assert.match(read('team/app.js'), /\$\('#queueChip'\)\.addEventListener\('click', [^\n]*'top\.queue\.wait'/);
});

// Fix round 1 (D4): tapping the waiting chip while the logs are being sent says nothing: they are on their way.
test('the waiting chip stays quiet while a flush already runs', () => {
  assert.match(read('team/app.js'), /\$\('#queueChip'\)\.addEventListener\('click', async \(\) => \{ if \(flushing\) return;/);
});

// Fix round 1 (D7): the leadership ring shows accepted of delivered hours this week; its name says so, never "of goal".
test('the leadership ring is named for what it shows', () => {
  const es = makeT('es'), en = makeT('en');
  assert.equal(es('lead.pct.aria', { pct: '79,3 %' }), 'Esta semana se aceptó el 79,3 % de las horas entregadas');
  assert.equal(en('lead.pct.aria', { pct: '79.3%' }), 'This week 79.3% of the delivered hours were accepted');
  for (const lang of ['es', 'en']) assert.equal(/meta|goal/i.test(makeT(lang)('lead.pct.aria', { pct: 'x' })), false, lang);
});

// Wave 2: the words and styles of qualification, phones, the Scorecard, the manager's new lists and a worker with no email.
test('wave 2 words and styles: every family in both languages, the fixed words used', () => {
  const keys = [
    'qf.workers', 'qf.workers.lt10', 'qf.workers.10_29', 'qf.workers.30_49', 'qf.workers.50plus', 'qf.wifi',
    'qf.lead', 'qf.yes', 'qf.no', 'qf.unknown', 'qf.change', 'qf.state.yes',
    'qf.state.no', 'qf.state.missing', 'qf.miss.wifi', 'qf.miss.lead', 'qf.contract', 'qf.notfit',
    'log.demo', 'log.dup.title', 'log.dup.new', 'log.dup.dnc', 'log.zone.other', 'log.zone.other.ph',
    'site.form.request', 'site.form.request.hint', 'site.act.arrived', 'site.act.fix', 'site.act.request', 'site.arrived.title',
    'site.arrived.intro', 'site.arrived.count', 'site.arrived.done', 'site.request.done', 'route.phones.both', 'route.phones.asked',
    'route.phones.came', 'route.btn.request', 'err.phones_count', 'nav.score', 'sc.title', 'sc.week.this',
    'sc.week.of', 'sc.week.aria', 'sc.team', 'sc.none', 'sc.nowonly', 'sc.note',
    'sc.note.sheet', 'sc.giant.this', 'sc.giant.past', 'sc.list.title', 'sc.list.empty', 'sc.open.aria',
    'sc.fam.activity', 'sc.fam.talks', 'sc.fam.owned', 'sc.fam.sites', 'sc.fam.qual', 'sc.col.touches',
    'sc.col.calls', 'sc.col.visits', 'sc.col.touched', 'sc.col.talks', 'sc.col.replies', 'sc.col.booked',
    'sc.col.held', 'sc.col.owned', 'sc.col.overdue', 'sc.col.progress', 'sc.col.out', 'sc.col.ready',
    'sc.col.signed', 'sc.col.installed', 'sc.col.live', 'sc.col.consents', 'sc.col.working', 'sc.col.owed',
    'sc.col.qualified', 'needs.meet.title', 'needs.meet.empty', 'needs.meet.with', 'needs.meet.demo', 'needs.meet.held',
    'needs.stall.title', 'needs.stall.empty', 'needs.stall.meeting', 'needs.stall.contract', 'needs.stall.missed', 'needs.stall.alive',
    'needs.stall.missed.done', 'needs.stall.alive.done', 'needs.block.title', 'needs.block.empty', 'needs.block.yesterday', 'needs.block.seen',
    'needs.block.mark', 'col.points.raw', 'install.add.hasemail', 'install.add.hasemail.yes', 'install.add.hasemail.no', 'install.noemail',
  ];
  for (const k of keys) for (const lang of LANGS) assert.ok(k in DICT[lang], `${lang} is missing ${k}`);
  assert.equal(DICT.es['qf.state.yes'], 'Califica');
  assert.equal(DICT.es['log.demo'], 'Pedir demo: tu líder coordina quién va');
  assert.equal(DICT.es['needs.stall.missed'], 'No ocurrió');
  assert.equal(DICT.es['site.form.request'], 'Teléfonos que necesita');
  // the Scorecard speaks the CRM sheet's language in English (addendum R8): twenty columns, each with its row's name
  const cols = ['touches', 'calls', 'visits', 'touched', 'talks', 'replies', 'booked', 'held', 'owned', 'overdue', 'progress', 'out', 'ready', 'signed', 'installed', 'live', 'consents', 'working', 'owed', 'qualified'];
  for (const c of cols) for (const lang of LANGS) assert.ok(`sc.col.${c}` in DICT[lang], `${lang} is missing sc.col.${c}`);
  assert.equal(DICT.en['sc.col.touched'], 'Unique leads touched');
  assert.equal(DICT.en['sc.col.working'], 'Camera rigs working (live sites)');
  assert.equal(DICT.es['sc.col.ready'], 'Sitios listos para activar');
  // the plural lines take {n}
  for (const k of ['needs.stall.meeting', 'needs.stall.contract']) for (const lang of LANGS) assert.ok(Array.isArray(DICT[lang][k]) && DICT[lang][k].every((v) => v.includes('{n}')), `${lang}.${k}`);
  // Spanish says "negocio", never "lead", in every new family
  for (const k of keys) assert.equal(/\blead\b/i.test(flat(DICT.es[k]).replace(/\{lead\}/g, '')), false, `es.${k} says lead`);
  // the styles, after their own comment
  const css = read('team/app.css'), at = css.indexOf('/* wave 2: qualification, scorecard, duplicates */');
  assert.ok(at > 0, 'the wave 2 block is in the stylesheet');
  for (const c of ['qf-row', 'qf-folded', 'qf-state', 'qf-warn', 'sc-wrap', 'sc-tbl', 'sc-cell', 'sc-tot', 'sc-null', 'dup-list']) assert.match(css.slice(at), new RegExp(`\\.${c}\\b`), c);
});

// Wave 2 (C3): qualification in three taps on the four results, "Pedir demo" on a meeting, and the business says if it qualifies.
test('the log sheet asks qualification on the four results and sends only what was tapped', () => {
  const app = read('team/app.js'), biz = read('team/biz.js'), page = read('team/index.html');
  const between = (a, b) => app.slice(app.indexOf(a), app.indexOf(b, app.indexOf(a)));
  const imp = app.match(/^import \{([^}]*)\} from '\.\/qual-steps\.js';$/m);
  assert.ok(imp, 'app.js imports from ./qual-steps.js');
  for (const name of ['QUAL_KINDS', 'qualRows', 'qualBody', 'contractWarn']) assert.match(imp[1], new RegExp(`\\b${name}\\b`), name);
  assert.match(between('function saveLog()', 'function logInert('), /qualBody\(/, 'saveLog sends only what was tapped');
  assert.match(between('function renderLog()', 'function keepFields('), /id: 'lDemo'/, '#lDemo is built in renderLog');
  assert.match(biz, /qualLine\(/, 'the card and the strip say if it qualifies');
  assert.match(page, /<link rel="modulepreload" href="qual-steps\.js">/);
});

// Wave 2 (C5): the Scorecard, a manager's tab and a block of the leadership page.
test('the Scorecard is a manager tab and a block of the leadership page, and its cells open their lists', async () => {
  const { shellFor } = await import('../team/leader-steps.js');
  assert.ok(shellFor('manager').tabs.includes('score'));
  assert.ok(shellFor('admin').tabs.includes('score'));
  assert.equal(shellFor('leader').tabs.length, 0, 'a leader still reads one page');
  const app = read('team/app.js'), page = read('team/index.html'), sc = read('team/scorecard.js'), leader = read('team/leader.js');
  for (const id of ['s-score', 'scLead', 'scGiant', 'scWeek', 'scNote', 'scTable', 'ldScore', 'scSheet', 'scSheetH', 'scList', 'scEmpty']) assert.match(page, new RegExp(`id="${id}"`), id);
  assert.match(page, /<symbol id="i-score"/);
  assert.match(page, /<dialog class="sheet" id="scSheet"/);
  assert.match(app, /SCREENS = \[[^\]]*'score'/);
  assert.match(sc, /\bh\(/, 'built node by node');
  assert.match(sc, /cellUrl\(/, 'a cell opens its own list');
  assert.match(sc, /export function createScorecard\(/);
  assert.match(leader, /#ldScore/, 'the leadership page draws the same table');
  for (const f of ['scorecard.js', 'scorecard-steps.js']) assert.match(page, new RegExp(`<link rel="modulepreload" href="${f.replace('.', '\\.')}">`), f);
});
