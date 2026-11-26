// "Mis primeros días" and "Aprender" decide a few things on the phone: which step is the next one, whether the ladder
// still has a place on Hoy, what a step's video looks like when it has no address yet, which controls a screen offers
// (none at all through view-as), when opening a video tells the server, and how two zones are picked.
// Those decisions live in team/ladder-steps.js, away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LADDER, VIDEOS, STEP_VIDEO } from '../lib/team/rules.mjs';
import { nextStep, ladderCount, ladderOnHoy, stepVideo, learnRows, ladderControls, postSeen, pickZone, zonesReady, safeUrl, rowZones, whoKey, offeredFor, waitsForVideo, openNow, focusStep, learnShown, earnButton } from '../team/ladder-steps.js';
import { LADDER_DOCS, ladderDocs, guionDocs } from '../team/docs-steps.js';
import { DICT as WORDS } from '../team/i18n.js';

const BY = { video: 'rep', kit: 'rep', whatsapp: 'rep', zones: 'rep', hour: 'manager' };
/** The ten steps as the server sends them, the first `n` done. */
const ladder = (n = 0, videos = VIDEOS) => LADDER.map((step, i) => ({ step, done: i < n, by: BY[step] || 'app', video: STEP_VIDEO[step] || null, hasVideo: !!(STEP_VIDEO[step] && videos[STEP_VIDEO[step]]) }));
const none = () => Object.fromEntries(Object.keys(VIDEOS).map((k) => [k, null]));

test('nextStep(ladder) is the first step not done', () => {
  assert.equal(nextStep(ladder(0)).step, 'video');
  assert.equal(nextStep(ladder(3)).step, 'zones');
  // a step the app ticked out of order does not move the next one past an earlier open step
  const gap = ladder(3); gap[5].done = true;
  assert.equal(nextStep(gap).step, 'zones');
  assert.equal(nextStep(ladder(10)), null);
  assert.equal(nextStep([]), null);
  assert.equal(nextStep(undefined), null);
  assert.deepEqual(ladderCount(gap), { done: 4, of: 10 });
  assert.deepEqual(ladderCount(null), { done: 0, of: 0 });
});

test('a step with a video and no address renders the plain line, not a player', () => {
  const videos = none();
  const talk = ladder(0).find((s) => s.step === 'talk');
  assert.deepEqual(stepVideo(talk, videos), { kind: 'missing', key: 'pitch', url: null });
  // a step with no video has no line at all
  assert.deepEqual(stepVideo(ladder(0).find((s) => s.step === 'kit'), videos), { kind: 'none', key: null, url: null });
  // with an address the step plays it
  const later = { ...videos, pitch: 'https://videos.equipo.test/presentar.mp4' };
  assert.deepEqual(stepVideo(talk, later), { kind: 'play', key: 'pitch', url: 'https://videos.equipo.test/presentar.mp4' });
  // only a web address becomes a link: anything else is treated as no video
  for (const bad of ['javascript:alert(1)', 'data:text/html,hola', '/local/file.mp4', '', 7, 'http//x']) {
    assert.equal(stepVideo(talk, { ...videos, pitch: bad }).kind, 'missing', String(bad));
    assert.equal(safeUrl(bad), null, String(bad));
  }
  // the six rows of Aprender, in the server's order, each with the plain line until it has an address
  const rows = learnRows(videos, ['faq']);
  assert.deepEqual(rows.map((r) => r.key), Object.keys(VIDEOS));
  assert.equal(rows.every((r) => r.kind === 'missing' && r.url === null), true);
  assert.deepEqual(rows.filter((r) => r.seen).map((r) => r.key), ['faq']);
  assert.equal(learnRows(later, []).find((r) => r.key === 'pitch').kind, 'play');
  assert.deepEqual(learnRows(undefined, undefined), []);
});

test('the ladder leaves Hoy when all ten are done', () => {
  assert.equal(ladderOnHoy(ladder(0)), true);
  assert.equal(ladderOnHoy(ladder(9)), true);
  assert.equal(ladderOnHoy(ladder(10)), false);
  // an answer from an older build carries no ladder: nothing to show
  assert.equal(ladderOnHoy(undefined), false);
  assert.equal(ladderOnHoy([]), false);
});

test('the controls of a step: none at all through view-as, and each one only where it can act', () => {
  const on = (c) => Object.keys(c).filter((k) => c[k]).sort();
  const at = (step, done = false) => ({ ...ladder(0).find((s) => s.step === step), done });
  for (const step of LADDER) for (const done of [false, true]) for (const canLog of [false, true]) {
    assert.deepEqual(on(ladderControls({ readOnly: true, step: at(step, done), canLog })), [], `${step} ${done} ${canLog}`);
  }
  for (const step of ['video', 'kit', 'whatsapp']) {
    assert.deepEqual(on(ladderControls({ readOnly: false, step: at(step), canLog: true })), ['tick'], step);
    assert.deepEqual(on(ladderControls({ readOnly: false, step: at(step, true), canLog: true })), [], `${step} done`);
  }
  // the zones can be picked and changed again
  assert.deepEqual(on(ladderControls({ readOnly: false, step: at('zones'), canLog: false })), ['zones']);
  assert.deepEqual(on(ladderControls({ readOnly: false, step: at('zones', true), canLog: false })), ['zones']);
  // the steps the app ticks point at what ticks them, when the person can log (a manager's preview cannot)
  for (const step of ['talk', 'meeting', 'contract']) {
    assert.deepEqual(on(ladderControls({ readOnly: false, step: at(step), canLog: true })), ['log'], step);
    assert.deepEqual(on(ladderControls({ readOnly: false, step: at(step), canLog: false })), [], `${step} preview`);
  }
  assert.deepEqual(on(ladderControls({ readOnly: false, step: at('report'), canLog: true })), ['close']);
  for (const step of ['install', 'hour']) assert.deepEqual(on(ladderControls({ readOnly: false, step: at(step), canLog: true })), [], step);
  assert.deepEqual(on(ladderControls({ readOnly: false, step: null, canLog: true })), []);
});

test('opening a video tells the server once, never through view-as and never for a row with no address', () => {
  const play = { kind: 'play', key: 'pitch', url: 'https://videos.equipo.test/presentar.mp4' };
  assert.equal(postSeen(play, [], false), true);
  assert.equal(postSeen(play, ['pitch'], false), false);
  assert.equal(postSeen(play, [], true), false);
  assert.equal(postSeen({ kind: 'missing', key: 'pitch', url: null }, [], false), false);
});

test('two zones: a tap picks or drops one, a third tap replaces the oldest pick, and only two distinct can be saved', () => {
  let p = [];
  p = pickZone(p, 'Bella Vista'); assert.deepEqual(p, ['Bella Vista']); assert.equal(zonesReady(p), false);
  p = pickZone(p, 'San Francisco'); assert.deepEqual(p, ['Bella Vista', 'San Francisco']); assert.equal(zonesReady(p), true);
  p = pickZone(p, 'Obarrio'); assert.deepEqual(p, ['San Francisco', 'Obarrio']);
  p = pickZone(p, 'Obarrio'); assert.deepEqual(p, ['San Francisco']);
  assert.equal(zonesReady(['Obarrio', 'Obarrio']), false);
  assert.equal(zonesReady(undefined), false);
  // the list given is never changed in place
  const given = ['A']; pickZone(given, 'B'); assert.deepEqual(given, ['A']);
});

test('the zone row shows the zones of the person whose screens these are, never anyone else\'s', () => {
  const zones = ladder(4).find((s) => s.step === 'zones');
  // the viewed rep's own answer carries their own pick: that is what the row shows, whoever is looking
  assert.deepEqual(rowZones(zones, { zones: ['Bella Vista', 'Obarrio'] }), ['Bella Vista', 'Obarrio']);
  // done but nothing in the answer (an older build): no names, the row just says it is done
  assert.equal(rowZones(zones, {}), null);
  assert.equal(rowZones(zones, { zones: [] }), null);
  // not done, or another step: never names
  assert.equal(rowZones({ ...zones, done: false }, { zones: ['A', 'B'] }), null);
  assert.equal(rowZones(ladder(4)[0], { zones: ['A', 'B'] }), null);
});

test('the offered zones are kept only for the identity that fetched them', () => {
  const mgr = whoKey({ me: { me: { id: 'r_mgr' } }, as: null });
  const asRep = whoKey({ me: { me: { id: 'r_ana' } }, as: 'r_ana' });
  const otherLogin = whoKey({ me: { me: { id: 'r_beto' } }, as: null });
  assert.notEqual(mgr, asRep); assert.notEqual(mgr, otherLogin);
  assert.equal(whoKey({ me: null, as: null }), null);
  const cache = { key: mgr, zones: ['Bella Vista', 'Obarrio', 'Calidonia'] };
  assert.deepEqual(offeredFor(cache, mgr), ['Bella Vista', 'Obarrio', 'Calidonia']);
  for (const k of [asRep, otherLogin, null]) assert.equal(offeredFor(cache, k), null, String(k));
  assert.equal(offeredFor(null, mgr), null);
});

// 25 Nov (REPUX-08): a new rep's first step was "Listo, ya lo hice" on a welcome video that does not exist yet, and the
// next three steps had no button until it was ticked. A step whose video has no address now waits, and never blocks.
test('a step whose video has no address waits, without a button, and blocks nothing', () => {
  const on = (c) => Object.keys(c).filter((k) => c[k]).sort();
  const video = ladder(0).find((s) => s.step === 'video');
  assert.equal(waitsForVideo(video, none()), true);
  assert.deepEqual(on(ladderControls({ readOnly: false, step: video, canLog: true, videos: none() })), []);
  const there = { ...none(), welcome: 'https://videos.equipo.test/bienvenida.mp4' };
  assert.equal(waitsForVideo(video, there), false);
  assert.deepEqual(on(ladderControls({ readOnly: false, step: video, canLog: true, videos: there })), ['tick']);
  // done, or a step with no video of its own: never waiting
  assert.equal(waitsForVideo({ ...video, done: true }, none()), false);
  assert.equal(waitsForVideo(ladder(0).find((s) => s.step === 'kit'), none()), false);
  // a step the app ticks keeps pointing at what ticks it: its missing video is only a missing explanation
  assert.equal(waitsForVideo(ladder(0).find((s) => s.step === 'talk'), none()), false);
});

test('with no welcome video, the kit, the WhatsApp profile and the zones can be done at once, in any order', () => {
  const ctx = { readOnly: false, canLog: true };
  assert.deepEqual(openNow(ladder(0), none(), ctx), ['kit', 'whatsapp', 'zones']);
  const there = { ...none(), welcome: 'https://videos.equipo.test/bienvenida.mp4' };
  assert.deepEqual(openNow(ladder(0), there, ctx), ['video', 'kit', 'whatsapp', 'zones']);
  // the WhatsApp profile done before the kit: the kit and the zones still have their buttons
  const some = ladder(0).map((s) => (s.step === 'whatsapp' ? { ...s, done: true } : s));
  assert.deepEqual(openNow(some, none(), ctx), ['kit', 'zones']);
  // once the rep's own steps are done, the step to do is the first one of the street, as before
  const street = ladder(0).map((s) => (['kit', 'whatsapp', 'zones'].includes(s.step) ? { ...s, done: true } : s));
  assert.deepEqual(openNow(street, none(), ctx), ['talk']);
  // through view-as nothing is open to do
  assert.deepEqual(openNow(ladder(0), there, { readOnly: true, canLog: false }), []);
  // the count stays honest: the waiting video is not done, and the ladder stays on Hoy
  assert.deepEqual(ladderCount(street), { done: 3, of: 10 });
  assert.equal(nextStep(street).step, 'video');
  // the step the screen points at is the first one that can be done
  assert.equal(focusStep(ladder(0), none()).step, 'kit');
  assert.equal(focusStep(ladder(0), there).step, 'video');
  assert.equal(focusStep(street, none()).step, 'talk');
  // only the waiting video left: the screen points at it, saying it waits
  const last = ladder(10).map((s) => (s.step === 'video' ? { ...s, done: false } : s));
  assert.equal(focusStep(last, none()).step, 'video');
  assert.equal(focusStep(ladder(10), none()), null);
});

// Track F, F2: the first days and Aprender point at what exists.
test('every step of the first days with a document step lists the documents hooked to it, in the list order', () => {
  const doc = (id, step, over = {}) => ({ id, title: { es: id, en: '' }, note: { es: '', en: '' }, url: 'https://example.com/x', group: 'vender', lang: 'both', step, order: 0, t: '2026-11-20T12:00:00Z', ...over });
  const docs = [doc('d_kit0000001', 'kit'), doc('d_pitch000001', 'pitch'), doc('d_meet0000001', 'meeting', { url: '', body: { es: 'Texto' } }), doc('d_ctr00000001', 'contract', { group: 'contrato' }),
    doc('d_inst0000001', 'install', { group: 'sitio' }), doc('d_cons0000001', 'consent', { group: 'contrato' }), doc('d_none0000001', null)];
  assert.deepEqual(LADDER_DOCS, { kit: ['kit'], talk: ['pitch'], meeting: ['meeting'], contract: ['contract'], install: ['install', 'consent'] });
  assert.deepEqual(ladderDocs(docs, 'kit').map((d) => d.id), ['d_kit0000001']);
  assert.deepEqual(ladderDocs(docs, 'talk').map((d) => d.id), ['d_pitch000001']);
  assert.deepEqual(ladderDocs(docs, 'meeting').map((d) => d.id), ['d_meet0000001']);
  assert.deepEqual(ladderDocs(docs, 'contract').map((d) => d.id), ['d_ctr00000001']);
  // the install lists the install's and the consent's, in the list order (contracts before the site)
  assert.deepEqual(ladderDocs(docs, 'install').map((d) => d.id), ['d_cons0000001', 'd_inst0000001']);
  for (const step of ['video', 'whatsapp', 'zones', 'report', 'hour']) assert.deepEqual(ladderDocs(docs, step), [], step);
  assert.deepEqual(ladderDocs(undefined, 'kit'), []);
  // every ladder step named is a real step
  for (const step of Object.keys(LADDER_DOCS)) assert.ok(LADDER.includes(step), step);
});

test('the first days\' script step lists the Guion when nobody hooked a document to it, and nothing when there is none', () => {
  const doc = (id, step, over = {}) => ({ id, title: { es: id, en: '' }, note: { es: '', en: '' }, url: '', body: { es: 'Di: hola.' }, group: 'vender', lang: 'both', step, order: 0, t: '2026-11-20T12:00:00Z', ...over });
  // the real script pasted as cards ("Pegar varias tarjetas": no step), a pitch, and a contract elsewhere
  const pasted = [doc('d_card0000001', null, { order: 0 }), doc('d_card0000002', null, { order: 1 }), doc('d_pitch000001', 'pitch', { order: 2 }), doc('d_ctr00000001', 'contract', { group: 'contrato' })];
  assert.deepEqual(ladderDocs(pasted, 'kit').map((d) => d.id), ['d_card0000001', 'd_card0000002', 'd_pitch000001']);
  assert.deepEqual(ladderDocs(pasted, 'kit'), guionDocs(pasted));   // as the Guion sheet lists it
  // a document hooked to the kit is still all the step lists
  assert.deepEqual(ladderDocs([...pasted, doc('d_kit0000001', 'kit', { group: 'contrato' })], 'kit').map((d) => d.id), ['d_kit0000001']);
  // no script at all: the step lists nothing, as today (the manager's "Por cargar" says the script is missing)
  assert.deepEqual(ladderDocs([doc('d_ctr00000001', 'contract', { group: 'contrato' })], 'kit'), []);
  // the other steps keep only what is hooked to them
  assert.deepEqual(ladderDocs(pasted, 'meeting'), []);
});

test('Aprender draws only the videos that exist; with none it says so once', () => {
  const none = Object.fromEntries(Object.keys(VIDEOS).map((k) => [k, '']));
  assert.deepEqual(learnShown(none, []), { rows: [], empty: true });
  const one = { ...none, pitch: 'https://example.com/v.mp4' };
  const got = learnShown(one, ['pitch']);
  assert.deepEqual(got.rows.map((r) => [r.key, r.kind, r.seen]), [['pitch', 'play', true]]);
  assert.equal(got.empty, false);
  // a slot whose address does not hold is left out too
  assert.deepEqual(learnShown({ ...none, faq: 'http://example.com/v.mp4' }, []).rows, []);
  assert.ok('learn.empty' in WORDS.es && 'learn.empty' in WORDS.en);
  assert.equal(WORDS.es['learn.empty'], 'Todavía no hay videos. Lo que hay para leer está en Documentos.');
  assert.equal(WORDS.en['learn.empty'], 'No videos yet. What there is to read is in Documents.');
});

test('the welcome step with no video offers how you earn; with its video, or done, it does not', () => {
  const none = Object.fromEntries(Object.keys(VIDEOS).map((k) => [k, '']));
  const steps = ladder(0, none), video = steps.find((s) => s.step === 'video');
  assert.equal(earnButton(video, none), true);
  assert.equal(earnButton({ ...video, done: true }, none), false);
  assert.equal(earnButton(video, { ...none, [video.video]: 'https://example.com/w.mp4' }), false);
  assert.equal(earnButton(steps.find((s) => s.step === 'kit'), none), false);
  assert.equal(WORDS.es['ladder.earn'], 'Ver cómo se gana');
  assert.equal(WORDS.en['ladder.earn'], 'See how you earn');
});

test('the zones say what is true: their businesses come first when you search and in My businesses', () => {
  assert.equal(WORDS.es['ladder.s.zones'], 'Los negocios de tus zonas salen primero cuando buscas y en Mis negocios.');
  assert.equal(WORDS.en['ladder.s.zones'], 'Businesses in your zones come first when you search and in My businesses.');
  assert.equal(WORDS.es['zones.support'], 'Elige dos zonas de tu ciudad. Sus negocios salen primero cuando buscas y en Mis negocios.');
  assert.equal(WORDS.en['zones.support'], 'Pick two zones in your city. Their businesses come first when you search and in My businesses.');
});
