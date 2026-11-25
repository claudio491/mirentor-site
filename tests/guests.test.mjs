import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createSales, checkClaims, guestSet } from '../lib/sales.mjs';
import { teamConfig } from '../lib/team/api.mjs';
import { start } from './team-helper.mjs';

// A guest is one exact address from outside the company domain, named in SALES_GUESTS. The domain itself stays shut.
const CLIENT = 'cid.apps.googleusercontent.com';
const nowS = 1_800_000_000;
const guest = { aud: CLIENT, iss: 'https://accounts.google.com', exp: String(nowS + 600), email_verified: 'true', email: 'Invitada@otra.test', hd: 'otra.test', given_name: 'Ana' };
const opts = (guests = [], allow = []) => ({ clientId: CLIENT, domain: 'mirentor.com', allow: new Set(allow), guests: guestSet(guests.join(',')), nowS });

test('guests: the list is read from one comma-separated value', () => {
  assert.deepEqual([...guestSet(' Invitada@Otra.test , ,no-es-correo,otro@otra.test')], ['invitada@otra.test', 'otro@otra.test']);
  assert.equal(guestSet(undefined).size, 0);
});

test('guests: a named address from another domain gets in, and only that address', () => {
  assert.equal(checkClaims(guest, opts()).why, 'domain', 'nobody is a guest until named');
  assert.deepEqual(checkClaims(guest, opts(['invitada@otra.test'])), { ok: true, email: 'invitada@otra.test', name: 'Ana' });
  assert.equal(checkClaims({ ...guest, email: 'colega@otra.test' }, opts(['invitada@otra.test'])).why, 'domain', 'the rest of that domain stays out');
  assert.equal(checkClaims({ ...guest, email_verified: 'false' }, opts(['invitada@otra.test'])).why, 'unverified');
  assert.equal(checkClaims({ ...guest, aud: 'other' }, opts(['invitada@otra.test'])).why, 'aud');
  // a guest is named one by one already, so the narrower list does not shut them out
  assert.equal(checkClaims(guest, opts(['invitada@otra.test'], ['mario@mirentor.com'])).ok, true);
  // options made before guests existed still work
  assert.equal(checkClaims(guest, { clientId: CLIENT, domain: 'mirentor.com', allow: new Set(), nowS }).why, 'domain');
});

test('guests: the sign-in button only stops narrowing to the company domain when there is a guest', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'sales-g-'));
  writeFileSync(path.join(root, 'index.html'), '<p>hub</p>');
  const page = async (guests) => {
    const sales = createSales({ clientId: CLIENT, secret: 's3cret', root, guests });
    const srv = http.createServer(async (req, res) => { if (!(await sales(req, res, new URL(req.url, 'http://x').pathname))) res.writeHead(404).end(); });
    await new Promise((ok) => srv.listen(0, ok));
    try { return await (await fetch(`http://127.0.0.1:${srv.address().port}/ventas`)).text(); } finally { srv.close(); }
  };
  assert.match(await page(''), /data-hd="mirentor\.com"/);
  assert.doesNotMatch(await page('invitada@otra.test'), /data-hd=/);
});

test('guests: the board takes the list from the same setting', () => {
  assert.deepEqual(teamConfig({ TEAM_ENABLED: '1', SALES_GUESTS: 'Invitada@otra.test' }).guests, ['invitada@otra.test']);
  assert.deepEqual(teamConfig({ TEAM_ENABLED: '1' }).guests, []);
});

test('guests: a named address can be added to the team, another outside address cannot', async (t) => {
  const s = await start({ guests: ['invitada@otra.test'] }); t.after(() => s.srv.close());
  const a = await s.admin();
  const add = (email, over = {}) => s.call('POST', '/equipo/api/reps', { name: 'Persona Invitada', email, role: 'manager', ...over }, { cookie: a.cookie });
  const bad = await add('colega@otra.test');
  assert.deepEqual([bad.status, bad.json.error], [400, 'email_domain']);
  const ok = await add('Invitada@otra.test');
  assert.equal(ok.status, 200);
  const made = s.lines().filter((e) => e.type === 'rep.created').at(-1);
  assert.deepEqual([made.email, made.role, made.handle], ['invitada@otra.test', 'manager', 'invitada']);
  assert.equal((await add('invitada@otra.test', { name: 'Otra Vez' })).json.error, 'email_taken');
});

/** A guest signs in on a portal made with these settings; answers the session cookie. */
async function guestCookie(settings) {
  const root = mkdtempSync(path.join(tmpdir(), 'sales-g3-'));
  writeFileSync(path.join(root, 'index.html'), '<p>hub</p>');
  const sales = createSales({ clientId: CLIENT, secret: 'the-same-secret', root, verify: async () => guest, now: () => nowS * 1000, ...settings });
  const srv = http.createServer(async (req, res) => { if (!(await sales(req, res, new URL(req.url, 'http://x').pathname))) res.writeHead(404).end(); });
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${srv.address().port}`;
  try {
    const login = await fetch(`${base}/ventas/auth`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sales-login': '1' }, body: '{"credential":"x"}' });
    assert.equal(login.status, 200);
    const cookie = (login.headers.get('set-cookie') || '').split(';')[0];
    const me = await fetch(`${base}/ventas/me.json`, { headers: { cookie }, redirect: 'manual' });
    return { cookie, me: [me.status, me.status === 200 ? (await me.json()).email : me.headers.get('location')] };
  } finally { srv.close(); }
}

test('guests: with the narrower list set, a guest who signs in stays in on the next request, as the sign-in said', async () => {
  const { cookie, me } = await guestCookie({ guests: 'invitada@otra.test', allow: 'ejemplo@mirentor.com' });
  assert.deepEqual(me, [200, 'invitada@otra.test'], 'no loop back to the sign-in page');
  const same = createSales({ clientId: CLIENT, secret: 'the-same-secret', root: tmpdir(), guests: 'invitada@otra.test', allow: 'ejemplo@mirentor.com', now: () => nowS * 1000 });
  assert.equal(same.who({ headers: { cookie } }), 'invitada@otra.test');
  // the narrower list still holds for the company's own accounts
  const other = createSales({ clientId: CLIENT, secret: 'the-same-secret', root: tmpdir(), allow: 'ejemplo@mirentor.com', now: () => nowS * 1000 });
  assert.equal(other.who({ headers: { cookie } }), null, 'and an outside address is in only while it is a guest');
});

test('guests: a guest taken off SALES_GUESTS loses the portal and the board on the next request', async () => {
  const { cookie } = await guestCookie({ guests: 'invitada@otra.test' });
  const kept = createSales({ clientId: CLIENT, secret: 'the-same-secret', root: tmpdir(), guests: 'Invitada@otra.test, otro@otra.test', now: () => nowS * 1000 });
  assert.equal(kept.who({ headers: { cookie } }), 'invitada@otra.test');
  const emptied = createSales({ clientId: CLIENT, secret: 'the-same-secret', root: tmpdir(), guests: '', now: () => nowS * 1000 });
  assert.equal(emptied.who({ headers: { cookie } }), null);
  const others = createSales({ clientId: CLIENT, secret: 'the-same-secret', root: tmpdir(), guests: 'otro@otra.test', now: () => nowS * 1000 });
  assert.equal(others.who({ headers: { cookie } }), null);
});
