import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash, createHmac, randomBytes, timingSafeEqual } from '../tools/demo/node-crypto.js';
import { Buffer as PageBuffer } from '../tools/demo/buffer.js';
import { buildDemo } from '../tools/team-demo.mjs';

// Placeholder people: a roster with real names never lives in the repository.
const PEOPLE = [
  { handle: 'uno', name: 'Persona Uno', role: 'rep', city: 'Panama City', startDate: '2026-10-01', photo: 'uno.jpg' },
  { handle: 'dos', name: 'Persona Dos', role: 'rep', city: 'Panama City', startDate: '2026-10-01' },
  { handle: 'guia', name: 'Persona Guía', role: 'admin', city: 'Panama City', startDate: '2026-10-01' },
];
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF picture bytes'), Buffer.from([0xff, 0xd9])]);
const build = () => { const photos = mkdtempSync(path.join(tmpdir(), 'team-demo-photos-')); writeFileSync(path.join(photos, 'uno.jpg'), JPG); return buildDemo({ people: PEOPLE, photosDir: photos }); };
/** Load the page's own script in Node and hand back its module loader. Only the server side is used: no screen here. */
async function load(script) {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'team-demo-')), 'bundle.mjs');
  writeFileSync(file, `${script}\nexport const req = __req;\n`);
  return (await import(pathToFileURL(file).href)).req;
}

test('the stand-ins for Node hash and encode exactly as Node does', () => {
  const long = 'registro '.repeat(40), bytes = Buffer.from([0, 1, 2, 250, 251, 255]);
  for (const input of ['', 'abc', long, bytes]) {
    for (const enc of ['hex', 'base64url']) assert.equal(createHash('sha256').update(input).digest(enc), nodeCrypto.createHash('sha256').update(input).digest(enc));
    assert.equal(createHmac('sha256', 'la clave').update(input).digest('base64url'), nodeCrypto.createHmac('sha256', 'la clave').update(input).digest('base64url'));
  }
  assert.equal(createHmac('sha256', long).update('x').digest('hex'), nodeCrypto.createHmac('sha256', long).update('x').digest('hex'));   // a key longer than a block
  assert.deepEqual([...createHash('sha256').update('abc').digest()], [...nodeCrypto.createHash('sha256').update('abc').digest()]);
  assert.equal(timingSafeEqual(PageBuffer.from('igual'), PageBuffer.from('igual')), true);
  assert.equal(timingSafeEqual(PageBuffer.from('igual'), PageBuffer.from('otro!')), false);
  assert.equal(randomBytes(16).toString('hex').length, 32);

  const text = 'José dejó 3 contactos · ñ';
  for (const enc of ['hex', 'base64', 'base64url']) {
    assert.equal(PageBuffer.from(text).toString(enc), Buffer.from(text).toString(enc));
    assert.equal(PageBuffer.from(Buffer.from(text).toString(enc), enc).toString(), text);
  }
  assert.equal(PageBuffer.concat([PageBuffer.from('RIFF'), PageBuffer.from([0, 0, 0, 0]), PageBuffer.from('WEBP')]).toString('latin1', 8, 12), 'WEBP');
  assert.equal(PageBuffer.from([1, 2, 3]).subarray(0, 2).equals(PageBuffer.from([1, 2])), true);
  assert.equal(PageBuffer.isBuffer(PageBuffer.alloc(0)), true);
});

test('the copy is one page that loads nothing: no module left to fetch, no path back to a server', () => {
  const made = build();
  assert.deepEqual([made.people, made.photos], [['uno (rep)', 'dos (rep)', 'guia (admin)'], 1]);
  assert.equal(/<!doctype|<html[\s>]|<head[\s>]|<body[\s>]/i.test(made.fragment), false);   // an artifact brings its own shell
  assert.match(made.whole, /^<!doctype html>/);
  assert.equal(/^(import|export)\s/m.test(made.script), false);
  assert.equal(/from\s+'node:/.test(made.script), false);
  assert.equal(/(src|href)="\/equipo/.test(made.fragment), false);
  assert.equal(/url\((?!data:)/.test(made.fragment.slice(0, made.fragment.indexOf('</style>'))), false);
  assert.equal(made.fragment.match(/<\/script>/g).length, 1);
  assert.equal(made.fragment.includes('Persona Uno') && made.fragment.includes('data:image/jpeg;base64,'), true);
});

test('inside the page, the team\'s own server code signs people in, scores a log and keeps the log it is given', async () => {
  const req = await load(build().script);
  const { startServer } = req('tools/demo/server.js');
  let kept = '';
  const s = startServer({ people: req('tools/demo/demo-data.js').PEOPLE, onSave: (text) => { kept = text; } });
  const json = async (method, route, body) => { const a = await s.call(method, route, body); return [a.status, a.body ? JSON.parse(a.body) : null]; };

  assert.equal((await s.call('GET', 'me')).status, 401);
  assert.equal((await s.signIn('uno')).status, 200);
  const [, me] = await json('GET', 'me');
  assert.deepEqual([me.me.name, me.week.points, typeof me.me.photo], ['Persona Uno', 0, 'string']);
  const [status, logged] = await json('POST', 'log', { id: 'demo-log-00000001', lead: { name: 'Ferretería de prueba', zone: 'Centro' }, kind: 'talk', clientAt: new Date().toISOString() });
  assert.deepEqual([status, logged.gained], [200, 8]);

  // the leader creates someone: with no address to open a link at, the new person can sign in at once
  assert.equal((await s.signIn('guia')).status, 200);
  assert.equal((await json('GET', 'team'))[1].reps.length, 2);
  assert.equal((await json('POST', 'reps', { handle: 'tres', name: 'Persona Tres', country: 'PA', city: 'Panama City', workdays: [1, 2, 3, 4, 5] }))[0], 200);
  assert.deepEqual(s.people().map((p) => p.handle).sort(), ['dos', 'guia', 'tres', 'uno']);
  assert.equal((await s.signIn('tres')).status, 200);

  // the log that was handed out is enough to come back to the same state
  const again = startServer({ people: [], saved: kept });
  assert.equal((await again.signIn('uno')).status, 200);
  assert.equal(JSON.parse((await again.call('GET', 'me')).body).week.points, 8);
  assert.equal((await again.signIn('tres')).status, 200);
});
