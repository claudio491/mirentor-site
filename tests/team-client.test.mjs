// The client has no build step and no framework, so these checks stand in for a compiler:
// every sentence exists in both languages, nothing the browser's policy forbids is in the page, and no markup is built from strings.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { DICT, makeT, LANGS } from '../team/i18n.js';
import { KINDS, CHANNELS, RULES } from '../lib/team/rules.mjs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
const SCRIPTS = ['team/app.js', 'team/install.js', 'team/install-steps.js', 'team/ladder.js', 'team/ladder-steps.js', 'team/docs.js', 'team/docs-steps.js', 'team/route.js', 'team/route-steps.js', 'team/leader.js', 'team/leader-steps.js', 'team/manager-steps.js', 'team/shrink.js', 'team/hand.js', 'team/manager.js', 'team/ui.js', 'team/queue.js', 'team/door.js', 'team/fx.js', 'team/moments.js', 'team/stops.js', 'team/stage.js', 'team/player.js', 'team/art.js', 'team/sites.js', 'team/report.js', 'team/report-steps.js'];
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
  // (lead.goal.*, always attributed to the Scorecard); the team's number is "objetivo" and "target".
  const outsideGoal = (lang, re) => Object.entries(DICT[lang]).filter(([k, v]) => !/^(goal\.|err\.goal|col\.goal|lead\.goal\.)/.test(k) && re.test(flat(v).replace(/\{\w+\}/g, ''))).map(([k]) => k);
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
  // Every refusal the API can answer.
  const api = read('lib/team/api.mjs');
  const errors = new Set([...api.matchAll(/fail\(\d{3}, '([a-z_]+)'/g)].map((m) => m[1]));
  assert.ok(errors.size > 20, 'the API refusals were not found');
  for (const e of errors) need.push(`err.${e}`);
  for (const k of need) for (const lang of LANGS) assert.ok(k in DICT[lang], `${lang} is missing ${k}`);
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
