// What the board does with a request body: it is read only for someone allowed to send one (the service token, or a
// session), and one that is too large is answered 413 in a way the phone can read, never with a cut connection (the
// app takes a network error for "no signal" and would keep the request waiting forever).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { start, logBody } from './team-helper.mjs';

const API = '/equipo/api';

test('a body is read only after the token or the session is checked', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const send = (method, p, body, headers = {}) => fetch(`${s.url}${API}/${p}`, { method, headers: { 'content-type': 'application/json', ...headers }, body });
  const answer = async (r) => [r.status, (await r.json()).error];
  // a body that is not JSON: without the token or a session that is all the answer says, before the body is looked at
  assert.deepEqual(await answer(await send('PUT', 'leads', '{not json')), [401, 'token']);
  assert.deepEqual(await answer(await send('POST', 'leadmap', '{not json')), [401, 'token']);
  assert.deepEqual(await answer(await send('PUT', `photo/${a.id}`, '{not json')), [401, 'token']);
  assert.deepEqual(await answer(await send('POST', 'log', '{not json')), [401, 'session']);
  assert.deepEqual(await answer(await send('POST', 'reps', '{not json')), [401, 'session']);
  // a large one too: an unauthenticated 4 MB lead list is refused without being read or parsed
  const big = JSON.stringify(Array.from({ length: 30000 }, (_, i) => ({ id: `X${i}`, company: 'y'.repeat(100) })));
  assert.ok(big.length > 3.5 * 1024 * 1024);
  assert.deepEqual(await answer(await send('PUT', 'leads', big)), [401, 'token']);
  assert.deepEqual(await answer(await send('PUT', 'leads', `${big}x`.repeat(2))), [401, 'token']);
  // with the token, or with a session, the body is read as before
  assert.deepEqual(await answer(await send('PUT', 'leads', '{not json', { authorization: 'Bearer push-token' })), [400, 'body']);
  assert.deepEqual(await answer(await send('POST', 'log', '{not json', { cookie: a.cookie })), [400, 'body']);
  assert.deepEqual(s.said, []);
});

test('a body over the limit is answered 413, and the phone reads it: never a cut connection', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  for (const kb of [20, 200, 2000, 9000]) {
    const r = await fetch(`${s.url}${API}/log`, { method: 'POST', headers: { 'content-type': 'application/json', cookie: m.cookie }, body: JSON.stringify(logBody('big-log-0001', { note: 'x'.repeat(kb * 1024) })) });
    assert.deepEqual([kb, r.status, (await r.json()).error], [kb, 413, 'too_large']);
  }
  // the same connection goes on working, and the log was never written
  const ok = await s.call('POST', `${API}/log`, logBody('small-log-001'), { cookie: m.cookie });
  assert.equal(ok.status, 200);
  assert.equal(s.lines().some((e) => e.id === 'big-log-0001'), false);
  // the service token's lead list (4 MB) and a consent photo (1 MB) have their own limits, answered the same way
  const leads = await fetch(`${s.url}${API}/leads`, { method: 'PUT', headers: { 'content-type': 'application/json', authorization: 'Bearer push-token' }, body: JSON.stringify([{ id: 'X', company: 'y'.repeat(5 * 1024 * 1024) }]) });
  assert.deepEqual([leads.status, (await leads.json()).error], [413, 'too_large']);
  await s.call('POST', `${API}/site`, { id: 's_body-site-001', rep: m.id, lead: { name: 'Taller Uno' } }, { cookie: a.cookie });
  await s.call('POST', `${API}/install/s_body-site-001/workers`, { id: 'w_body-wk-0001', name: 'Persona Uno', email: 'p1@equipo.test' }, { cookie: m.cookie });
  const photo = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3 * 1024 * 1024, 7)]);
  const consent = await fetch(`${s.url}${API}/worker/w_body-wk-0001/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: m.cookie }, body: photo });
  assert.deepEqual([consent.status, (await consent.json()).error], [413, 'too_big']);
  assert.deepEqual(s.said, []);
});

/** Writes a request that says its body is huge (or gives no length) and keeps sending, as fast as the socket takes it,
 *  until the server closes the connection, 100 MB went in, or 10 s passed. What came back, and how much went in. */
async function flood(port, path, { chunked = false } = {}) {
  const sock = net.connect(port, '127.0.0.1');
  await new Promise((r) => sock.once('connect', r));
  let answer = '', closed = false, sent = 0;
  sock.on('data', (d) => { answer += d.toString(); });
  sock.on('close', () => { closed = true; });
  sock.on('error', () => { closed = true; });
  const size = chunked ? 'transfer-encoding: chunked' : `content-length: ${200 * 1024 * 1024}`;
  sock.write(`POST ${path} HTTP/1.1\r\nhost: 127.0.0.1:${port}\r\ncontent-type: application/json\r\n${size}\r\nconnection: keep-alive\r\n\r\n`);
  const mb = Buffer.alloc(1024 * 1024, 0x20), piece = chunked ? Buffer.concat([Buffer.from('100000\r\n'), mb, Buffer.from('\r\n')]) : mb;
  const t0 = Date.now();
  while (!closed && sent < 100 * 1024 * 1024 && Date.now() - t0 < 10000) {
    const ok = sock.write(piece); sent += mb.length;
    if (!ok) await new Promise((r) => { const tm = setTimeout(r, 1000); sock.once('drain', () => { clearTimeout(tm); r(); }); });
  }
  await new Promise((r) => setTimeout(r, 300));
  sock.destroy();
  return { status: answer.split('\r\n')[0], closed, mb: Math.round(sent / 1048576) };
}

// The answer goes out first, but a client still pushing its body when the connection closes may lose it: no client of
// the board sends a body like this, and the rule is the one past DRAIN_MAX for a 413. What is pinned is that the server
// stops reading, and that whatever answer arrives is the right one.
test('a refused body that says it is huge, or gives no length, is not read: the connection closes after the answer', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const port = Number(new URL(s.url).port);
  for (const [path, chunked, status] of [[`${API}/log`, false, 401], [`${API}/log`, true, 401], [`${API}/leads`, false, 401], [`${API}/nada`, false, 404], ['/equipo/app.js', false, 405]]) {
    const r = await flood(port, path, { chunked });
    assert.ok(r.status === '' || r.status.startsWith(`HTTP/1.1 ${status}`), `${path} ${chunked ? 'chunked' : ''}: ${r.status}`);
    assert.equal(r.closed, true, `${path}: the server closed it`);
    assert.ok(r.mb < 60, `${path}: ${r.mb} MB went in before it closed`);
  }
});
