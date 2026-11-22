// The route on the phone: what each stop says, which controls it offers in each mode (a person's own screens, a real rep
// in view-as, the practice rep), which business the Hoy card shows, and what the "open the site" form sends. The
// server computes the route and stays the judge; these only decide what the screen draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopLine, stopControls, routeCard, openSiteBody, routeCount } from '../team/route-steps.js';

const KEYS = ['interested', 'sent', 'signed', 'site', 'phones', 'install'];
/** A route as the server sends it, from its statuses. */
function route(statuses, over = {}) {
  const at = statuses.findIndex((s) => s !== 'done');
  return {
    rep: 'r1', lead: { id: 'APP-1', name: 'Panadería La Espiga' }, practice: false,
    stops: statuses.map((status, i) => ({ key: KEYS[i], status, at: status === 'done' ? '2026-11-20T15:00:00Z' : null, who: status === 'now' ? 'rep' : status === 'wait' ? 'manager' : null, since: status === 'wait' ? '2026-11-20T15:00:00Z' : null })),
    at: at < 0 ? 6 : at, complete: at < 0, contract: null, site: statuses[3] === 'done' ? { id: 's_1', practice: !!over.practice } : null, ...over,
  };
}
const D = 'done', N = 'now', W = 'wait', L = 'later';

test('each stop says what to do, whom it waits on, or when it was done', () => {
  const r = route([D, W, L, L, L, L]);
  assert.deepEqual(stopLine(r, 0), { key: 'route.done.at', at: '2026-11-20T15:00:00Z' });
  assert.deepEqual(stopLine(r, 1), { key: 'route.wait.sent', at: null });
  assert.deepEqual(stopLine(r, 2), { key: 'route.later.signed', at: null });
  assert.deepEqual(stopLine(route([N, L, L, L, L, L]), 0), { key: 'route.now.interested', at: null });
  const passed = route([D, D, D, D, W, L]); passed.stops[0].at = null;
  assert.deepEqual(stopLine(passed, 0), { key: 'route.done.passed', at: null });
});

test('how far a route is: stops done of six', () => {
  assert.deepEqual(routeCount(route([D, D, W, L, L, L])), { done: 2, of: 6 });
  assert.deepEqual(routeCount(route([D, D, D, D, D, D])), { done: 6, of: 6 });
});

test('the controls of the stop to do, on a person\'s own screens', () => {
  assert.equal(stopControls(route([N, L, L, L, L, L]), 0, 'self').log, 'meeting');
  const sent = stopControls(route([D, N, L, L, L, L]), 1, 'self');
  assert.deepEqual([sent.log, sent.docs, sent.practice], ['contract', true, null]);
  assert.equal(stopControls(route([D, W, L, L, L, L]), 1, 'self').docs, true, 'the agreement stays at hand while the sending waits');
  assert.equal(stopControls(route([D, D, W, L, L, L]), 2, 'self').docs, true);
  assert.equal(stopControls(route([D, D, D, N, L, L]), 3, 'self').openSite, true);
  assert.equal(stopControls(route([D, D, D, D, D, N]), 5, 'self').install, 'open');
  assert.equal(stopControls(route([D, D, D, D, D, W]), 5, 'self').install, 'open');
  assert.equal(stopControls(route([D, D, D, D, D, D]), 5, 'self').install, 'view', 'an install confirmed is only looked at');
  // a stop that is not the one to do offers nothing that writes
  const notNow = stopControls(route([D, N, L, L, L, L]), 3, 'self');
  assert.deepEqual([notNow.log, notNow.openSite, notNow.install, notNow.practice], [null, false, null, null]);
});

test('view-as on a real rep: nothing that writes; the install can be looked at', () => {
  for (const [st, i] of [[[N, L, L, L, L, L], 0], [[D, N, L, L, L, L], 1], [[D, D, D, N, L, L], 3], [[D, W, L, L, L, L], 1]]) {
    const c = stopControls(route(st), i, 'view');
    assert.deepEqual([c.log, c.openSite, c.practice], [null, false, null]);
  }
  assert.equal(stopControls(route([D, D, D, D, D, N]), 5, 'view').install, 'view');
});

test('the practice controls appear only for the practice rep, on the stop that waits on a manager', () => {
  const p = (st) => route(st, { practice: true });
  assert.equal(stopControls(p([D, W, L, L, L, L]), 1, 'practice').practice, 'contract_sent');
  assert.equal(stopControls(p([D, D, W, L, L, L]), 2, 'practice').practice, 'contract_signed');
  assert.equal(stopControls(p([D, D, D, D, W, L]), 4, 'practice').practice, 'phones');
  assert.equal(stopControls(p([D, D, D, D, D, W]), 5, 'practice').practice, 'installed');
  // never for a real rep's route, whatever the mode, and never on a stop that is not waiting
  for (const mode of ['self', 'view']) assert.equal(stopControls(route([D, W, L, L, L, L]), 1, mode).practice, null);
  assert.equal(stopControls(route([D, W, L, L, L, L]), 1, 'practice').practice, null, 'a route that is not practice');
  assert.equal(stopControls(p([D, W, L, L, L, L]), 1, 'view').practice, null);
  assert.equal(stopControls(p([D, D, D, N, L, L]), 3, 'practice').practice, null);
  // the practice rep still does its own part
  assert.equal(stopControls(p([D, D, D, N, L, L]), 3, 'practice').openSite, true);
});

test('the Hoy card: the business furthest along with something to do now; the install stop keeps its own card', () => {
  const a = route([D, N, L, L, L, L], { lead: { id: 'A', name: 'A' } });
  const b = route([D, D, D, N, L, L], { lead: { id: 'B', name: 'B' } });
  const c = route([D, D, W, L, L, L], { lead: { id: 'C', name: 'C' } });
  const d = route([D, D, D, D, D, N], { lead: { id: 'D', name: 'D' } });
  assert.equal(routeCard([d, c, b, a], 'self').lead.id, 'B');
  assert.equal(routeCard([d, c, a], 'self').lead.id, 'A');
  assert.equal(routeCard([d, c], 'self'), null);
  assert.equal(routeCard([], 'self'), null);
  assert.equal(routeCard(null, 'self'), null);
  // in view-as the card still shows the rep's next move, to read
  assert.equal(routeCard([b, a], 'view').lead.id, 'B');
  // acting as the practice rep, a stop that waits on a manager is something to do now too
  const pc = route([D, D, W, L, L, L], { practice: true, lead: { id: 'PC', name: 'PC' } });
  const pi = route([D, D, D, D, D, W], { practice: true, lead: { id: 'PI', name: 'PI' } });
  assert.equal(routeCard([pi, pc, a], 'practice').lead.id, 'PI');
  assert.equal(routeCard([pc, a], 'self').lead.id, 'A');
});

test('the "open the site" form sends the business id and only the facts that were typed', () => {
  assert.deepEqual(openSiteBody({ city: ' Panama City ', eligible: '12', coordName: 'Coordinadora', coordPhone: '6000-0000' }, 's_x1234567', 'APP-1'),
    { id: 's_x1234567', lead: 'APP-1', city: 'Panama City', eligible: 12, coordinator: { name: 'Coordinadora', phone: '6000-0000' } });
  assert.deepEqual(openSiteBody({ city: '', eligible: '', coordName: '', coordPhone: '' }, 's_x1234567', 'APP-1'), { id: 's_x1234567', lead: 'APP-1' });
  assert.throws(() => openSiteBody({ eligible: '-3' }, 's_x', 'APP-1'), { code: 'site_eligible' });
  assert.throws(() => openSiteBody({ eligible: '9000' }, 's_x', 'APP-1'), { code: 'site_eligible' });
  assert.throws(() => openSiteBody({ coordName: 'A', coordPhone: '' }, 's_x', 'APP-1'), { code: 'site_coordinator' });
});
