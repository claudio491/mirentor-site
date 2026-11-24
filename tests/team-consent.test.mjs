import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveConsent, readConsent, dropConsent, keepOnlyConsent, discardConsent, MAX_CONSENT } from '../lib/team/consent.mjs';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png consent bytes')]);
const dir = () => mkdtempSync(path.join(tmpdir(), 'team-consent-'));
const files = (d) => readdirSync(path.join(d, 'team', 'consents'));

test('a consent is kept under its worker id and version and read back byte for byte', () => {
  const d = dir();
  const kept = saveConsent(d, 'w_11111111', JPG);
  assert.deepEqual([kept.ext, kept.fresh], ['jpg', true]);
  assert.match(kept.v, /^[a-f0-9]{12}$/);
  assert.deepEqual(files(d), [`w_11111111.${kept.v}.jpg`]);
  assert.deepEqual(readConsent(d, 'w_11111111', 'jpg', kept.v), JPG);
  assert.equal(readConsent(d, 'w_11111111', 'png', kept.v), null);
});

test('a new version is written beside the one in force; once its event is written the old one goes, and dropping leaves nothing', () => {
  const d = dir();
  const first = saveConsent(d, 'w_11111111', JPG), second = saveConsent(d, 'w_11111111', PNG);
  assert.equal(second.ext, 'png');
  assert.equal(files(d).length, 2, 'nothing in force is touched by the save');
  assert.deepEqual(readConsent(d, 'w_11111111', 'jpg', first.v), JPG);
  keepOnlyConsent(d, 'w_11111111', second, first);
  assert.deepEqual(files(d), [`w_11111111.${second.v}.png`]);
  dropConsent(d, 'w_11111111', second);
  assert.deepEqual(files(d), []);
});

test('a new version whose event could not be written is taken back; the same bytes sent again are never taken back', () => {
  const d = dir();
  const first = saveConsent(d, 'w_11111111', JPG), second = saveConsent(d, 'w_11111111', PNG);
  discardConsent(d, 'w_11111111', second);
  assert.deepEqual(files(d), [`w_11111111.${first.v}.jpg`]);
  const again = saveConsent(d, 'w_11111111', JPG);
  assert.deepEqual([again.v, again.fresh], [first.v, false]);
  discardConsent(d, 'w_11111111', again);
  assert.deepEqual(readConsent(d, 'w_11111111', 'jpg', first.v), JPG);
});

test('a consent an older build filed under the single name is still read, and goes once a newer version is in force', () => {
  const d = dir();
  saveConsent(d, 'w_00000000', JPG);   // makes the folder
  writeFileSync(path.join(d, 'team', 'consents', 'w_11111111.jpg'), JPG);
  assert.deepEqual(readConsent(d, 'w_11111111', 'jpg', 'a1b2c3d4e5f6'), JPG);
  const next = saveConsent(d, 'w_11111111', PNG);
  keepOnlyConsent(d, 'w_11111111', next, { v: 'a1b2c3d4e5f6', ext: 'jpg' });
  assert.deepEqual(files(d).filter((f) => f.startsWith('w_11111111')), [`w_11111111.${next.v}.png`]);
});

test('what is not an image, is too big or carries an unsafe id is refused and nothing is written', () => {
  const d = dir();
  assert.equal(saveConsent(d, 'w_11111111', Buffer.from('hello')), null);
  assert.equal(saveConsent(d, 'w_11111111', Buffer.concat([JPG, Buffer.alloc(MAX_CONSENT)])), null);
  assert.equal(saveConsent(d, '../escape', JPG), null);
  assert.equal(readConsent(d, '../escape', 'jpg'), null);
  assert.equal(readConsent(d, 'w_11111111', 'gif'), null);
  assert.throws(() => files(d), /ENOENT/);
});
