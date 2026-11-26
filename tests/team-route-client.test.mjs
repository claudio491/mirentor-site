// The route on the phone: what each stop says, which controls it offers in each mode (a person's own screens, a real rep
// in view-as, the practice rep), which business the Hoy card shows, and what the "open the site" form sends. The
// server computes the route and stays the judge; these only decide what the screen draws.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { stopLine, stopControls, routeCard, openSiteBody, routeCount, phonesLine, requestBody, advanceLine } from '../team/route-steps.js';
import { makeT } from '../team/i18n.js';

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
  // wave 2: the phones it needs are asked when the site opens, so a body without them is refused (phones_count)
  assert.deepEqual(openSiteBody({ city: ' Panama City ', eligible: '12', coordName: 'Coordinadora', coordPhone: '6000-0000', request: '12' }, 's_x1234567', 'APP-1'),
    { id: 's_x1234567', lead: 'APP-1', city: 'Panama City', eligible: 12, coordinator: { name: 'Coordinadora', phone: '6000-0000' }, request: 12 });
  assert.deepEqual(openSiteBody({ city: '', eligible: '', coordName: '', coordPhone: '', request: '1' }, 's_x1234567', 'APP-1'), { id: 's_x1234567', lead: 'APP-1', request: 1 });
  assert.throws(() => openSiteBody({ eligible: '-3' }, 's_x', 'APP-1'), { code: 'site_eligible' });
  assert.throws(() => openSiteBody({ eligible: '9000' }, 's_x', 'APP-1'), { code: 'site_eligible' });
  assert.throws(() => openSiteBody({ coordName: 'A', coordPhone: '' }, 's_x', 'APP-1'), { code: 'site_coordinator' });
});

test('stop 2 promises the agreement only when a document is hooked to the contract step', () => {
  const N = { status: 'now' }, D = { status: 'done', at: '2026-11-20T15:00:00Z' }, L = { status: 'later' };
  const r = { stops: ['interested', 'sent', 'signed', 'site', 'phones', 'install'].map((key, i) => ({ key, ...[D, N, L, L, L, L][i] })) };
  assert.deepEqual(stopLine(r, 1, { agreement: true }), { key: 'route.now.sent', at: null });
  assert.deepEqual(stopLine(r, 1, { agreement: false }), { key: 'route.now.sent.nodoc', at: null });
  assert.deepEqual(stopLine(r, 1), { key: 'route.now.sent.nodoc', at: null });
  // the other stops say the same either way
  assert.deepEqual(stopLine(r, 0, { agreement: false }), stopLine(r, 0, { agreement: true }));
  const T = makeT('es'), E = makeT('en');
  // track F, F2: what is true and what to do, and the lead already sees it as pending (Pendientes, "Por cargar")
  assert.equal(T('route.now.sent.nodoc'), 'El acuerdo todavía no está en Documentos. Pídeselo a tu líder: ya le aparece como pendiente.');
  assert.equal(E('route.now.sent.nodoc'), 'The agreement is not in Documents yet. Ask your lead for it: it already shows as pending for them.');
});

test('an expired wait says when it expired and offers to log the contract again; the practice control is gone; the Hoy card picks it up', () => {
  const r = route([D, W, L, L, L, L]); r.stops[1].expired = '2026-12-04T15:00:00.000Z';
  assert.deepEqual(stopLine(r, 1), { key: 'route.expired.sent', at: '2026-12-04T15:00:00.000Z' });
  assert.equal(stopControls(r, 1, 'self').log, 'contract');
  assert.equal(stopControls(r, 1, 'view').log, null, 'a manager reading a real rep\'s screens writes nothing');
  const prac = route([D, W, L, L, L, L], { practice: true }); prac.stops[1].expired = '2026-12-04T15:00:00.000Z';
  assert.equal(stopControls(prac, 1, 'practice').practice, null, 'the server refuses a confirmation that expired');
  assert.equal(stopControls(prac, 1, 'practice').log, 'contract');
  const signed = route([D, D, W, L, L, L]); signed.stops[2].expired = '2026-12-30T15:00:00.000Z';
  assert.deepEqual(stopLine(signed, 2), { key: 'route.expired.signed', at: '2026-12-30T15:00:00.000Z' });
  assert.equal(stopControls(signed, 2, 'self').log, 'contract');
  assert.equal(routeCard([route([D, W, L, L, L, L]), r], 'self'), r, 'the rep has something to do there now');
  // every expired line exists in both languages
  for (const lang of ['es', 'en']) for (const k of ['route.expired.sent', 'route.expired.signed', 'route.support.expired', 'route.tag.expired']) assert.notEqual(makeT(lang)(k, { when: 'x', stop: 'y' }), k, `${lang} ${k}`);
});

// Wave 2 (C4): how many phones a site needs, asked when it opens, and how many came, on the route.
test('the route says how many phones were requested and how many came, and the rep can change the request', () => {
  assert.deepEqual(phonesLine({ requested: 30, phones: 10 }), { key: 'route.phones.both', asked: 30, came: 10 });
  assert.deepEqual(phonesLine({ requested: 30, phones: null }), { key: 'route.phones.asked', asked: 30 });
  assert.deepEqual(phonesLine({ requested: null, phones: 6 }), { key: 'route.phones.came', came: 6 }); assert.equal(phonesLine(null), null);
  assert.equal(phonesLine({ requested: null, phones: null }), null);
  assert.deepEqual(openSiteBody({ request: '30' }, 's_x', 'PA-1'), { id: 's_x', lead: 'PA-1', request: 30 });
  for (const bad of ['', '0', '501', '3.5', 'diez']) assert.throws(() => openSiteBody({ request: bad }, 's_x', 'PA-1'), { code: 'phones_count' });
  assert.deepEqual(requestBody({ count: ' 40 ' }), { count: 40 });
  for (const bad of ['', '0', '501', '3.5', 'diez', '-2']) assert.throws(() => requestBody({ count: bad }), { code: 'phones_count' });
  // "Cambiar pedido" on the phones stop: the rep's own screens and the practice rep, never view-as; a site that is
  // installed or from before the app has nothing to request
  const withSite = route([D, D, D, D, W, L], { site: { id: 's_1', practice: false, installed: null, legacy: false } });
  assert.equal(stopControls(withSite, 4, 'self').request, true);
  assert.equal(stopControls(withSite, 4, 'view').request, false);
  assert.equal(stopControls(route([D, D, D, D, W, L], { practice: true, site: { id: 's_1', practice: true } }), 4, 'practice').request, true);
  assert.equal(stopControls(withSite, 3, 'self').request, false, 'only on the phones stop');
  assert.equal(stopControls(route([D, D, D, D, D, W], { site: { id: 's_1', installed: '2026-11-20T15:00:00Z' } }), 4, 'self').request, false);
  assert.equal(stopControls(route([D, D, D, D, W, L], { site: { id: 's_1', legacy: true } }), 4, 'self').request, false);
  assert.equal(stopControls(route([D, D, D, N, L, L]), 4, 'self').request, false, 'no site yet');
  assert.deepEqual(Object.keys(stopControls(route([N, L, L, L, L, L]), 0, 'self')).sort(), ['docs', 'install', 'log', 'openSite', 'practice', 'request']);
  for (const k of ['route.phones.both', 'route.phones.asked', 'route.phones.came', 'route.btn.request', 'err.phones_count', 'site.form.request']) for (const l of ['es', 'en']) assert.ok(makeT(l)(k) !== k, `${l} ${k}`);
});

// Track F, F5: the advance a manager marked, one line on the site stop; nothing with no mark.
test('the site stop says the advance: requested on a day, or paid on a day, and nothing without a mark', () => {
  assert.equal(advanceLine(null), null);
  assert.equal(advanceLine({ advance: null }), null);
  assert.equal(advanceLine({}), null);
  assert.deepEqual(advanceLine({ advance: { asked: '2026-11-12', paid: null } }), { key: 'route.advance.asked', date: '2026-11-12' });
  assert.deepEqual(advanceLine({ advance: { asked: '2026-11-12', paid: '2026-11-14' } }), { key: 'route.advance.paid', date: '2026-11-14' });
  const T = makeT('es'), E = makeT('en');
  assert.equal(T('route.advance.asked', { date: '12 nov' }), 'Adelanto pedido el 12 nov');
  assert.equal(T('route.advance.paid', { date: '14 nov' }), 'Adelanto pagado el 14 nov');
  assert.equal(E('route.advance.asked', { date: 'Nov 12' }), 'Advance requested on Nov 12');
  assert.equal(E('route.advance.paid', { date: 'Nov 14' }), 'Advance paid on Nov 14');
});
