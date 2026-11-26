// The illustration of the later screens sits beside the headline and costs no row (the coordinator's ruling): on a
// screen whose giant is short it shares the giant's band, bottom-aligned and no taller than it; on a screen whose giant
// is a word it is left out while the screen has rows; it is decided by the screen, never by the language; a strip
// shows its small file; and it arrives once a visit.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { leadArt, REST, BAND, BAND_MIN, BAND_GAP, bandArt, artArrives } from '../team/craft-steps.js';
import { ART } from '../team/art.js';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

test('the screens with a short giant carry their picture in the giant\'s band; the word giants lead with none while they have rows', () => {
  assert.deepEqual(BAND, ['book', 'ways', 'sites', 'route', 'install']);
  assert.equal(leadArt('docs', { count: 3 }), null, 'Documentos with rows: no lead picture');
  assert.equal(leadArt('learn', { shown: 2, seen: 2 }), null, 'Aprender with videos: no lead picture');
  assert.deepEqual(leadArt('docs', { count: 0 }), REST, 'an empty Documentos keeps the rest picture');
  assert.deepEqual(leadArt('learn', { shown: 0 }), REST, 'and an empty Aprender');
});

test('a picture beside the giant is as tall as the band, never taller, and is left out where it has under 96 px', () => {
  assert.equal(BAND_MIN, 96);
  assert.equal(bandArt({ band: 74, room: 280 }), 74, 'room to spare: the band\'s height');
  assert.equal(bandArt({ band: 90, room: 96 }), 0, 'the picture and its air do not fit beside the giant: left out, never squeezed');
  assert.equal(bandArt({ band: 90, room: 90 + BAND_GAP }), 90);
  assert.equal(bandArt({ band: 74, room: 95 }), 0, 'under 96 px beside the giant: left out');
  assert.equal(bandArt({ band: 0, room: 300 }), 0, 'no band, no picture');
  assert.equal(bandArt({ band: 38, room: 300 }), 0, 'a giant as short as "0 min" would get a picture too small to read: left out');
  assert.equal(bandArt({ band: 48, room: 300 }), 48, 'from 48 px the picture shows');
  // the same giant in two languages gives the same answer: the measure is the giant's own, and the numbers are the same
  assert.equal(bandArt({ band: 75, room: 390 - 16 - 248 }), bandArt({ band: 75, room: 390 - 16 - 231 }));
});

test('the strips show one frame from their small file', () => {
  assert.equal(REST.art, 'restThumb');
  assert.equal(leadArt('book', { owned: 2 }).art, 'followThumb');
  for (const k of ['restThumb', 'followThumb']) assert.match(ART[k], /\.thumb\.webp$/);
});

test('the picture arrives the first time its screen opens in a visit, not on every return', () => {
  const seen = new Set();
  assert.equal(artArrives(seen, 's-book'), true);
  assert.equal(artArrives(seen, 's-book'), false, 'back to it: it is simply there');
  assert.equal(artArrives(seen, 's-ways'), true);
  assert.match(read('team/art-lead.js'), /artArrives\(/);
});

test('each short giant shares a band with its picture; the word giants keep theirs out of it', () => {
  const page = read('team/index.html');
  for (const [g, a] of [['bkGiant', 'bkArt'], ['wyGiant', 'wyArt'], ['stGiant', 'stArt'], ['rtGiant', 'rtArt'], ['instGiant', 'instArt']]) {
    assert.match(page, new RegExp(`<div class="k-band"><h1 class="giant[^"]*" id="${g}"></h1><span class="robj k-art lead-art" id="${a}" aria-hidden="true" hidden></span></div>`), g);
  }
  for (const a of ['docArt', 'lrnArt']) assert.doesNotMatch(page, new RegExp(`k-band">[^\\n]*id="${a}"`), a);
  const css = read('team/app.css');
  assert.match(css, /\.k-band\{position:relative/);
  assert.match(css, /\.k-band>\.k-art\{[^}]*position:absolute;[^}]*bottom:0/);
});
