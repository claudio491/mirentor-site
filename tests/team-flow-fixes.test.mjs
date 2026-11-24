// What the end-to-end flow audit found the API still let through (24 Nov): a meeting said to have happened twice
// (two events); a void with no reason; the same day off marked twice; a person with no working day, saved as
// Monday to Friday without a word; and an emptied name answered "saved" while nothing changed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';

const API = '/equipo/api';

// A meeting dated later may still be said to have happened (it can move earlier): the manager's confirmation is what pays,
// as tests/team-review.test.mjs pins. What must not happen is a second event for the same thing said twice.
test('a meeting is said to have happened once: said again, the same answer and no second event', async (t) => {
  const s = await start(); t.after(() => s.srv.close());   // Monday 16 Nov 2026
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  const log = (id, when) => s.call('POST', `${API}/log`, logBody(id, { kind: 'meeting', channel: 'call', when, lead: { name: `Negocio ${id}`, zone: 'Centro' } }), { cookie: m.cookie });
  assert.equal((await log('meet-today-0001', '2026-11-16')).status, 200);
  assert.equal((await s.call('POST', `${API}/held`, { logId: 'meet-today-0001' }, { cookie: m.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/held`, { logId: 'meet-today-0001' }, { cookie: m.cookie })).status, 200, 'said twice: the same answer');
  assert.equal(s.lines().filter((e) => e.type === 'log.held').length, 1, 'and one event');
});

test('a void needs its reason', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  assert.equal((await s.call('POST', `${API}/log`, logBody('void-me-000001'), { cookie: m.cookie })).status, 200);
  for (const reason of ['', '   ', undefined]) {
    const r = await s.call('POST', `${API}/void`, { logId: 'void-me-000001', reason }, { cookie: a.cookie });
    assert.deepEqual([r.status, r.json.error], [400, 'reason'], JSON.stringify(reason));
  }
  assert.equal(s.lines().some((e) => e.type === 'log.void'), false);
  assert.equal((await s.call('POST', `${API}/void`, { logId: 'void-me-000001', reason: 'registrado dos veces' }, { cookie: a.cookie })).status, 200);
});

test('the same day off marked twice is one event, and taking it back works once', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const off = (undo) => s.call('POST', `${API}/dayoff`, { scope: 'all', date: '2026-11-20', ...(undo ? { undo: true } : {}) }, { cookie: a.cookie });
  assert.equal((await off()).status, 200); assert.equal((await off()).status, 200);
  assert.equal(s.lines().filter((e) => e.type === 'dayoff').length, 1);
  assert.equal((await off(true)).status, 200); assert.equal((await off(true)).status, 200);
  assert.equal(s.lines().filter((e) => e.type === 'dayoff.undo').length, 1);
});

test('a person needs at least one working day, and an emptied name is refused, not answered as saved', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin();
  const none = await s.call('POST', `${API}/reps`, { email: 'sin.dias@equipo.test', name: 'Sin Dias', country: 'PA', city: 'Panama City', workdays: [], startDate: '2026-11-16' }, { cookie: a.cookie });
  assert.deepEqual([none.status, none.json.error], [400, 'workdays']);
  const m = await s.addRep(a.cookie, 'mario');
  const patch = (p) => s.call('POST', `${API}/reps/${m.id}`, { patch: p }, { cookie: a.cookie });
  const days = await patch({ workdays: [] });
  assert.deepEqual([days.status, days.json.error], [400, 'workdays']);
  const name = await patch({ name: '  ' });
  assert.deepEqual([name.status, name.json.error], [400, 'name']);
  assert.equal((await patch({ name: 'Mario Nuevo' })).status, 200);
});
