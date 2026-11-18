import { test } from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import * as pageCrypto from '../tools/demo/node-crypto.js';
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

const { createHash, randomBytes, timingSafeEqual } = pageCrypto;

test('the stand-ins for Node hash and encode exactly as Node does', () => {
  const long = 'registro '.repeat(40), bytes = Buffer.from([0, 1, 2, 250, 251, 255]);
  for (const input of ['', 'abc', long, bytes]) {
    for (const enc of ['hex', 'base64url']) assert.equal(createHash('sha256').update(input).digest(enc), nodeCrypto.createHash('sha256').update(input).digest(enc));
  }
  // the copy keeps no secret and signs nothing: what is left of the stand-in is what the board's code asks for
  assert.deepEqual(Object.keys(pageCrypto).sort(), ['createHash', 'randomBytes', 'timingSafeEqual']);
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
  assert.equal(/(src|href)="(?!#|data:)/.test(made.fragment), false);   // nothing in the page points at a file or an address
  assert.equal(/url\((?!data:)/.test(made.fragment.slice(0, made.fragment.indexOf('</style>'))), false);
  assert.equal(made.fragment.match(/<\/script>/g).length, 1);
  assert.equal(made.fragment.includes('Persona Uno') && made.fragment.includes('data:image/jpeg;base64,'), true);
  // The illustrations travel inside too: each one is in the script as itself, and no address of one is left.
  assert.equal(/["'`]art\/[a-z0-9.-]+\.webp/.test(made.script), false, 'an illustration is still read from a server');
  assert.equal((made.script.match(/data:image\/webp;base64,/g) || []).length, 13);
});

test('inside the page, the team\'s own server code lets the viewer be anyone on the team, scores a log and keeps the log it is given', async () => {
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

  // the leader adds someone by their work email: the viewer can be that person at once
  assert.equal((await s.signIn('guia')).status, 200);
  assert.equal((await json('GET', 'team'))[1].reps.length, 2);
  assert.equal((await json('POST', 'reps', { email: 'tres@mirentor.com', name: 'Persona Tres', country: 'PA', city: 'Panama City', workdays: [1, 2, 3, 4, 5] }))[0], 200);
  assert.deepEqual(s.people().map((p) => p.handle).sort(), ['dos', 'guia', 'tres', 'uno']);
  assert.equal((await s.signIn('tres')).status, 200);

  // the log that was handed out is enough to come back to the same state
  const again = startServer({ people: [], saved: kept });
  assert.equal((await again.signIn('uno')).status, 200);
  assert.equal(JSON.parse((await again.call('GET', 'me')).body).week.points, 8);
  assert.equal((await again.signIn('tres')).status, 200);
});

test('a copy opened before keeps what was logged in it, and takes what the team list has gained since', async () => {
  const req = await load(build().script);
  const { startServer } = req('tools/demo/server.js');
  const before = req('tools/demo/demo-data.js').PEOPLE;   // as an earlier build carried them: no addresses
  let kept = '';
  const first = startServer({ people: before, onSave: (text) => { kept = text; } });
  await first.signIn('uno');
  await first.call('POST', 'log', { id: 'demo-log-00000002', lead: { name: 'Ferretería de prueba', zone: 'Centro' }, kind: 'talk', clientAt: new Date().toISOString() });

  // the next build knows everyone's address, one photo more, and a new teammate
  const now = [...before.map((p) => ({ ...p, email: `${p.handle}@mirentor.com` })), { id: 'r_cuatro', handle: 'cuatro', name: 'Persona Cuatro', role: 'rep', city: 'Panama City', country: 'PA', email: 'cuatro@mirentor.com', photo: null }];
  let again = '';
  const s = startServer({ people: now, saved: kept, onSave: (text) => { again = text; } });
  assert.deepEqual(s.people().map((p) => p.handle).sort(), ['cuatro', 'dos', 'guia', 'uno']);
  await s.signIn('uno');
  assert.equal(JSON.parse((await s.call('GET', 'me')).body).week.points, 8);   // what was logged is still there
  await s.signIn('guia');
  const team = JSON.parse((await s.call('GET', 'team')).body);
  assert.deepEqual([...team.reps, ...team.others].map((r) => [r.handle, r.email]).sort(), [['cuatro', 'cuatro@mirentor.com'], ['dos', 'dos@mirentor.com'], ['guia', 'guia@mirentor.com'], ['uno', 'uno@mirentor.com']]);
  assert.equal(again.length > kept.length, true);   // the catching up is kept, so it happens once

  // opened a third time, nothing more is added
  const third = startServer({ people: now, saved: again, onSave: (text) => { again = text; } });
  const size = again.length;
  await third.signIn('guia');
  assert.equal(again.length, size);
  // an address someone else took inside the copy is left alone
  const clash = startServer({ people: [...now, { id: 'r_cinco', handle: 'cinco', name: 'Persona Cinco', role: 'rep', email: 'uno@mirentor.com' }], saved: again, onSave: () => {} });
  await clash.signIn('guia');
  const five = [...JSON.parse((await clash.call('GET', 'team')).body).reps].find((r) => r.handle === 'cinco');
  assert.deepEqual([five.name, five.email], ['Persona Cinco', '']);
});
