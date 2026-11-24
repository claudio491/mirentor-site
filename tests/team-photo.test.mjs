import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './team-helper.mjs';
import { openTeamStore } from '../lib/team/store.mjs';
import { mkdirSync, readdirSync, renameSync, rmdirSync } from 'node:fs';
import path from 'node:path';

// Small files that start the way each kind of image starts: that is what the server checks.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF picture bytes'), Buffer.from([0xff, 0xd9])]);
const GIF = Buffer.from('GIF89a picture bytes');
const B = { bearer: 'push-token' };
const photo = (bytes, type) => ({ type, data: bytes.toString('base64') });

test('a photo set with the service token shows on the person, and the file goes only to someone signed in', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const at = `/equipo/api/photo/${m.id}`;
  assert.equal((await s.call('PUT', at, photo(PNG, 'image/png'))).status, 401);
  assert.equal((await s.call('PUT', at, photo(PNG, 'image/png'), { cookie: a.cookie })).status, 401);   // a session is not the token
  const put = await s.call('PUT', at, photo(PNG, 'image/png'), B);
  assert.equal(put.status, 200);
  assert.match(put.json.photo, /^[a-f0-9]{12}$/);

  const me = (await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json;
  assert.equal(me.me.photo, put.json.photo);
  assert.equal(me.table.week.me.photo, put.json.photo);
  const team = (await s.call('GET', '/equipo/api/team', undefined, { cookie: a.cookie })).json;
  assert.equal(team.reps.find((r) => r.id === m.id).photo, put.json.photo);
  assert.equal(team.others[0].photo, null);   // the admin has none

  assert.equal((await fetch(`${s.url}${at}`)).status, 401);
  const seen = await fetch(`${s.url}${at}?v=${put.json.photo}`, { headers: { cookie: m.cookie } });
  assert.deepEqual([seen.status, seen.headers.get('content-type'), seen.headers.get('x-content-type-options')], [200, 'image/png', 'nosniff']);
  assert.match(seen.headers.get('cache-control'), /^private/);
  assert.deepEqual(Buffer.from(await seen.arrayBuffer()), PNG);
});

test('a file that is not the image it says, a kind that is not allowed and a file that is too big are refused', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const at = `/equipo/api/photo/${m.id}`;
  const answers = async (body) => { const r = await s.call('PUT', at, body, B); return [r.status, r.json && r.json.error]; };
  assert.deepEqual(await answers(photo(Buffer.from('not an image at all'), 'image/png')), [400, 'photo']);
  assert.deepEqual(await answers(photo(PNG, 'image/jpeg')), [400, 'photo']);          // the bytes are a PNG
  assert.deepEqual(await answers(photo(GIF, 'image/gif')), [400, 'photo']);
  assert.deepEqual(await answers({ type: 'image/png', data: { toString: 1 } }), [400, 'photo']);
  assert.deepEqual(await answers({ type: 'image/png' }), [400, 'photo']);
  const big = Buffer.concat([PNG, Buffer.alloc(450 * 1024)]);
  assert.equal((await s.call('PUT', at, photo(big, 'image/png'), B)).status, 413);
  assert.deepEqual([(await s.call('PUT', '/equipo/api/photo/r_nobody', photo(PNG, 'image/png'), B)).status], [404]);
  // nothing was kept, and a person without a photo has no file to give
  assert.equal(s.lines().some((e) => e.type === 'rep.photo'), false);
  assert.equal((await fetch(`${s.url}${at}`, { headers: { cookie: m.cookie } })).status, 404);
  assert.deepEqual(s.said, []);
});

test('a photo stays after a restart, a new one replaces it and it can be taken down', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const at = `/equipo/api/photo/${m.id}`;
  const first = (await s.call('PUT', at, photo(PNG, 'image/png'), B)).json.photo;
  const second = (await s.call('PUT', at, photo(JPG, 'image/jpeg'), B)).json.photo;
  assert.notEqual(first, second);
  const seen = await fetch(`${s.url}${at}`, { headers: { cookie: a.cookie } });
  assert.equal(seen.headers.get('content-type'), 'image/jpeg');
  assert.deepEqual(Buffer.from(await seen.arrayBuffer()), JPG);
  assert.deepEqual(openTeamStore(s.dir).state.reps.get(m.id).photo, { v: second, ext: 'jpg' });   // what a restart reads back

  assert.equal((await s.call('DELETE', at, undefined, { cookie: a.cookie })).status, 401);
  assert.equal((await s.call('DELETE', at, undefined, B)).status, 200);
  assert.equal((await s.call('GET', '/equipo/api/me', undefined, { cookie: m.cookie })).json.me.photo, null);
  assert.equal((await fetch(`${s.url}${at}`, { headers: { cookie: m.cookie } })).status, 404);
  assert.equal(openTeamStore(s.dir).state.reps.get(m.id).photo, null);
});

test('a new photo or a removal whose event cannot be written leaves the photo in force as it was', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario');
  const at = `/equipo/api/photo/${m.id}`, photos = () => readdirSync(path.join(s.dir, 'team', 'photos'));
  assert.equal((await s.call('PUT', at, photo(PNG, 'image/png'), B)).status, 200);
  const before = photos();
  const refusing = async (fn) => {
    const file = path.join(s.dir, 'team', 'events.jsonl');
    renameSync(file, `${file}.aside`); mkdirSync(file);
    try { return await fn(); } finally { rmdirSync(file); renameSync(`${file}.aside`, file); }
  };
  assert.equal((await refusing(() => s.call('PUT', at, photo(JPG, 'image/jpeg'), B))).status, 500);
  assert.equal((await refusing(() => s.call('DELETE', at, undefined, B))).status, 500);
  assert.deepEqual(photos(), before);
  const seen = await fetch(`${s.url}${at}`, { headers: { cookie: m.cookie } });
  assert.deepEqual([seen.status, Buffer.from(await seen.arrayBuffer()).equals(PNG)], [200, true]);
  // and when the log takes writes: a new photo leaves one file, a removal none
  assert.equal((await s.call('PUT', at, photo(JPG, 'image/jpeg'), B)).status, 200);
  assert.equal(photos().length, 1);
  assert.equal((await s.call('DELETE', at, undefined, B)).status, 200);
  assert.deepEqual(photos(), []);
});

test('HEAD on a photo answers as GET does, without the bytes, to whoever may GET it', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(); const m = await s.addRep(a.cookie, 'mario'), lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  const at = `${s.url}/equipo/api/photo/${m.id}`;
  assert.equal((await s.call('PUT', `/equipo/api/photo/${m.id}`, photo(PNG, 'image/png'), B)).status, 200);
  for (const cookie of [m.cookie, lia.cookie, a.cookie]) {
    const get = await fetch(at, { headers: { cookie } }), head = await fetch(at, { method: 'HEAD', headers: { cookie } });
    assert.deepEqual([head.status, head.headers.get('content-type'), head.headers.get('cache-control'), head.headers.get('content-length')], [get.status, get.headers.get('content-type'), get.headers.get('cache-control'), String(PNG.length)]);
    assert.equal((await head.arrayBuffer()).byteLength, 0);
    assert.deepEqual(Buffer.from(await get.arrayBuffer()), PNG);
  }
  assert.equal((await fetch(at, { method: 'HEAD' })).status, 401);
  assert.equal((await fetch(`${s.url}/equipo/api/photo/${a.id}`, { method: 'HEAD', headers: { cookie: m.cookie } })).status, 404);   // nobody's photo there
});
