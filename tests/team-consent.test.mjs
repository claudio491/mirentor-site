import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { saveConsent, readConsent, dropConsent, MAX_CONSENT } from '../lib/team/consent.mjs';

const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('png consent bytes')]);
const dir = () => mkdtempSync(path.join(tmpdir(), 'team-consent-'));
const files = (d) => readdirSync(path.join(d, 'team', 'consents'));

test('a consent is kept under its worker id and read back byte for byte', () => {
  const d = dir();
  const kept = saveConsent(d, 'w_11111111', JPG);
  assert.equal(kept.ext, 'jpg');
  assert.match(kept.v, /^[a-f0-9]{12}$/);
  assert.deepEqual(readConsent(d, 'w_11111111', 'jpg'), JPG);
  assert.equal(readConsent(d, 'w_11111111', 'png'), null);
});

test('a second consent of another kind replaces the first and leaves one file', () => {
  const d = dir();
  saveConsent(d, 'w_11111111', JPG);
  assert.equal(saveConsent(d, 'w_11111111', PNG).ext, 'png');
  assert.deepEqual(files(d), ['w_11111111.png']);
  dropConsent(d, 'w_11111111');
  assert.deepEqual(files(d), []);
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
