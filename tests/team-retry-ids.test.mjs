// A person and a badge can carry the id the form made (as a site, a log or a document does), so a retry after a lost
// answer adds nobody and nothing: the same id again answers as the first time. Without an id, as before.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, mail } from './team-helper.mjs';

const API = '/equipo/api';

test('a person added with the form\'s id is added once: a retry answers the same, with an address (not email_taken) or without one', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const add = (body) => s.call('POST', `${API}/reps`, body, { cookie: a.cookie });
  const made = () => s.lines().filter((e) => e.type === 'rep.created').length;
  const before = made();
  const none = { id: 'r_retry-nomail-01', name: 'Sin Acceso', access: 'none', city: 'Panama City' };
  const first = await add(none), again = await add(none);
  assert.deepEqual([first.status, first.json.id, again.status, again.json.id], [200, 'r_retry-nomail-01', 200, 'r_retry-nomail-01']);
  const withMail = { id: 'r_retry-mail-0001', email: mail('nuevo'), name: 'Nuevo Rep', city: 'Panama City' };
  const one = await add(withMail), two = await add(withMail);
  assert.deepEqual([one.status, one.json.id, two.status, two.json.id, two.json.error], [200, 'r_retry-mail-0001', 200, 'r_retry-mail-0001', undefined]);
  assert.equal(made(), before + 2, 'two people, not four');
  assert.deepEqual(s.lines().filter((e) => e.type === 'rep.created').slice(-2).map((e) => e.id), ['r_retry-nomail-01', 'r_retry-mail-0001']);
  // the address is still taken for anyone else
  assert.deepEqual([(await add({ id: 'r_retry-mail-0002', email: mail('nuevo'), name: 'Otro' })).json.error], ['email_taken']);
  // without an id, or with one of another shape, as before: each press is a new person
  for (const body of [{ name: 'Sin Id', access: 'none' }, { name: 'Sin Id', access: 'none' }, { id: 'nope', name: 'Id Raro', access: 'none' }]) {
    const r = await add(body);
    assert.equal(r.status, 200);
    assert.match(r.json.id, /^r_[0-9a-f]{10}$/);
  }
  assert.equal(made(), before + 5);
  // an id that belongs to the practice world is not a person this form made
  const prac = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.id;
  assert.deepEqual([(await add({ id: prac, name: 'Choque', access: 'none' })).json.error], ['id_taken']);
});

test('a badge given with the form\'s id is given once: a retry answers the same', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario'), j = await s.addRep(a.cookie, 'jose');
  const give = (body) => s.call('POST', `${API}/badge`, body, { cookie: a.cookie });
  const badge = { id: 'b_retry-badge-01', rep: m.id, text: 'Mejor jugada de la semana' };
  assert.deepEqual([(await give(badge)).status, (await give(badge)).status], [200, 200]);
  assert.deepEqual(s.lines().filter((e) => e.type === 'badge.give').map((e) => [e.id, e.rep]), [['b_retry-badge-01', m.id]]);
  assert.equal((await s.call('GET', `${API}/me`, undefined, { cookie: m.cookie })).json.feed.filter((f) => f.code === 'badge').length, 1);
  // the same id for someone else is not a retry
  assert.deepEqual([(await give({ ...badge, rep: j.id })).json.error], ['id_taken']);
  // without an id, as before: each press is a badge
  await give({ rep: m.id, text: 'Otra' }); await give({ rep: m.id, text: 'Otra' });
  assert.equal(s.lines().filter((e) => e.type === 'badge.give').length, 3);
});
