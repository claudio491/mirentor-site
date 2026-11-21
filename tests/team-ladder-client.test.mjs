// "Mis primeros días" and "Aprender" decide a few things on the phone: which step is the next one, whether the ladder
// still has a place on Hoy, what a step's video looks like when it has no address yet, which controls a screen offers
// (none at all through view-as), when opening a video tells the server, and how two zones are picked.
// Those decisions live in team/ladder-steps.js, away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LADDER, VIDEOS, STEP_VIDEO } from '../lib/team/rules.mjs';
import { nextStep, ladderCount, ladderOnHoy, stepVideo, learnRows, ladderControls, postSeen, pickZone, zonesReady, safeUrl, rowZones, whoKey, offeredFor } from '../team/ladder-steps.js';

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
