// The manager's site and hours controls decide a few things before the server answers: what the site form sends, what
// the hours form sends, which controls a site offers, and which roles the person form lists. Those decisions live in
// team/manager-steps.js, away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { meetingRow, stalledLine, extraNeeds, pointsCell, siteBody, hoursBody, siteHoursBody, siteActions, arrivedBody, fixBody, roleOptions, siteReps, siteLeadId, newRepBody, readAgainIn, readNow, freshRead, REFRESH_MS, countryOptions, teamCountries, countryLabel, wayLine, bookCells, overdueLines, toLoad, advanceBody, canAdvance, missedKeys } from '../team/manager-steps.js';
import { DICT } from '../team/i18n.js';

const base = { rep: 'r_1', name: '  Negocio de Prueba ', city: 'Panama City', eligible: '', coordName: '', coordPhone: '', kind: 'normal' };
const refused = (fn) => { try { fn(); } catch (e) { return e.code; } return null; };

test('the site form sends eligible only when it is filled, and never null', () => {
  const body = siteBody(base, 's_1');
  assert.deepEqual(body, { id: 's_1', rep: 'r_1', lead: { name: 'Negocio de Prueba' }, city: 'Panama City' });
  assert.equal('eligible' in body, false);
  assert.equal(siteBody({ ...base, eligible: ' 12 ' }, 's_1').eligible, 12);
  assert.equal(siteBody({ ...base, eligible: '0' }, 's_1').eligible, 0);
  for (const bad of ['-1', '1.5', 'doce', '5001']) assert.equal(refused(() => siteBody({ ...base, eligible: bad }, 's_1')), 'site_eligible', bad);
  // no city typed: the field is left out, the server keeps the site with no city
  assert.equal('city' in siteBody({ ...base, city: ' ' }, 's_1'), false);
});

test('the site form sends a coordinator only with both a name and a phone', () => {
  assert.equal('coordinator' in siteBody(base, 's_1'), false);
  assert.deepEqual(siteBody({ ...base, coordName: ' Coord Uno ', coordPhone: '507 555 0101' }, 's_1').coordinator, { name: 'Coord Uno', phone: '507 555 0101' });
  for (const [n, p] of [['Coord Uno', ''], ['', '5075550101'], ['C', '5075550101'], ['Coord Uno', '555']]) assert.equal(refused(() => siteBody({ ...base, coordName: n, coordPhone: p }, 's_1')), 'site_coordinator', `${n}/${p}`);
});

test('practice and legacy are one choice: a site is one of normal, practice or legacy, never both', () => {
  assert.deepEqual([siteBody({ ...base, kind: 'practice' }, 's_1').practice, siteBody({ ...base, kind: 'practice' }, 's_1').legacy], [true, undefined]);
  assert.deepEqual([siteBody({ ...base, kind: 'legacy' }, 's_1').legacy, siteBody({ ...base, kind: 'legacy' }, 's_1').practice], [true, undefined]);
  const normal = siteBody(base, 's_1');
  assert.equal('practice' in normal || 'legacy' in normal, false);
  assert.equal(refused(() => siteBody({ ...base, kind: 'both' }, 's_1')), 'site_kind');
  assert.equal(refused(() => siteBody({ ...base, name: 'x' }, 's_1')), 'fields');
});

test('the hours form takes hours and minutes and sends minutes, for a Monday, with accepted no more than delivered', () => {
  const v = { week: '2026-11-16', dh: '69', dm: '4', ah: '51', am: '7' };
  assert.deepEqual(hoursBody(v), { weeks: [{ week: '2026-11-16', delivered: 69 * 60 + 4, accepted: 51 * 60 + 7 }] });
  assert.deepEqual(hoursBody({ ...v, dm: '', am: '' }).weeks[0], { week: '2026-11-16', delivered: 69 * 60, accepted: 51 * 60 });
  assert.equal(refused(() => hoursBody({ ...v, week: '2026-11-17' })), 'week');
  assert.equal(refused(() => hoursBody({ ...v, week: '16/11/2026' })), 'week');
  assert.equal(refused(() => hoursBody({ ...v, dm: '60' })), 'hours_minutes');
  assert.equal(refused(() => hoursBody({ ...v, dh: '-1' })), 'hours_minutes');
  // a week with nothing delivered is a real week, typed as 0: the server takes it, and so does the form
  assert.deepEqual(hoursBody({ ...v, dh: '0', dm: '', ah: '0', am: '' }).weeks[0], { week: '2026-11-16', delivered: 0, accepted: 0 });
  assert.equal(refused(() => hoursBody({ ...v, dh: 'x' })), 'hours_minutes');
  assert.equal(refused(() => hoursBody({ ...v, ah: '70' })), 'hours_order');
});

test('hours are whole numbers in two fields: "51,5" or anything unreadable is refused in the form, and nothing typed is never a zero', () => {
  const v = { week: '2026-11-16', dh: '69', dm: '4', ah: '51', am: '7' };
  // "51,5" read as 515 hours, or as nothing and then 0: the form says why instead of sending a number
  for (const bad of ['51,5', '51.5', '5 1', '½', '1e3', '-0', '+5', 'cincuenta', '５１']) {
    assert.equal(refused(() => hoursBody({ ...v, dh: bad })), 'hours_minutes', `delivered ${bad}`);
    assert.equal(refused(() => hoursBody({ ...v, am: bad })), 'hours_minutes', `accepted minutes ${bad}`);
    assert.equal(refused(() => siteHoursBody({ week: '2026-11-16', h: bad, m: '' })), 'hours_minutes', `site hours ${bad}`);
  }
  // both fields left empty is no number at all: refused, never sent as zero
  assert.equal(refused(() => hoursBody({ ...v, dh: '', dm: '' })), 'hours_minutes');
  assert.equal(refused(() => hoursBody({ ...v, ah: ' ', am: '' })), 'hours_minutes');
  assert.equal(refused(() => siteHoursBody({ week: '2026-11-16', h: '', m: '' })), 'hours_minutes');
  // one of the two may stay empty: 51 h, or 45 min
  assert.deepEqual(hoursBody({ ...v, dh: '', dm: '45', ah: '', am: '30' }).weeks[0], { week: '2026-11-16', delivered: 45, accepted: 30 });
  assert.deepEqual(siteHoursBody({ week: '2026-11-16', h: ' 51 ', m: '' }), { what: 'hours', week: '2026-11-16', accepted: 51 * 60 });
  assert.deepEqual(siteHoursBody({ week: '2026-11-16', h: '0', m: '' }), { what: 'hours', week: '2026-11-16', accepted: 0 });   // a real zero, typed
  assert.equal(refused(() => siteHoursBody({ week: '2026-11-16', h: '1', m: '60' })), 'hours_minutes');
  assert.equal(refused(() => siteHoursBody({ week: '2026-11-16', h: '1667', m: '' })), 'hours_minutes');   // over what the server takes (100,000 minutes)
});

test('each site offers the controls its state allows', () => {
  const site = (over) => ({ state: 'waiting_phones', legacy: false, practice: false, workers: 0, steps: {}, ...over });
  // wave 2: a shipment adds ("Llegaron teléfonos"), the total is corrected only once there is one, and the request can change until installed
  assert.deepEqual(siteActions(site({})), ['install', 'request', 'arrived', 'installed', 'void']);   // nobody on it yet: no record to download
  assert.deepEqual(siteActions(site({ state: 'installing', phones: 3, workers: 2 })), ['install', 'request', 'arrived', 'phones', 'record', 'void']);
  assert.deepEqual(siteActions(site({ state: 'closed', phones: 3, workers: 2, closed: 't' })), ['install', 'request', 'confirm', 'record', 'void']);
  assert.deepEqual(siteActions(site({ state: 'installed', workers: 2, steps: { installed: 't' } })), ['install', 'first_hour', 'hours', 'record', 'void']);   // hours once it is live (Task 15)
  // a legacy site is not installed here: no phones; its screens load past consents, and it keeps the old way of being marked
  assert.deepEqual(siteActions(site({ state: 'legacy', legacy: true })), ['install', 'installed', 'void']);
  assert.deepEqual(siteActions(site({ state: 'legacy', legacy: true, workers: 3 })), ['install', 'installed', 'record', 'void']);
  // a practice site opens like a real one and is removed, never voided; it has no record and counts in no total
  assert.deepEqual(siteActions(site({ state: 'practice', practice: true, workers: 2, closed: 't' })), ['install', 'request', 'confirm', 'remove']);
  assert.deepEqual(siteActions(site({ state: 'practice', practice: true })), ['install', 'request', 'arrived', 'remove']);
});

test('only an admin is offered the roles, Liderazgo among them, with its own label', () => {
  assert.deepEqual(roleOptions('admin'), ['rep', 'manager', 'admin', 'leader']);
  assert.deepEqual(roleOptions('manager'), []);
  assert.deepEqual([DICT.es['role.leader'], DICT.en['role.leader']], ['Liderazgo', 'Leadership']);
  for (const code of ['site_eligible', 'site_coordinator', 'site_kind', 'hours_order', 'hours_minutes']) for (const l of ['es', 'en']) assert.ok(DICT[l][`err.${code}`], `${l} err.${code}`);
});

test('a team with no reps still offers someone for a site: the active managers and admins, the viewer first', () => {
  const lone = { reps: [], others: [{ id: 'r_jefe', name: 'Jefe Uno', role: 'admin', active: true }] };
  const got = siteReps(lone, 'r_jefe');
  assert.deepEqual(got, { options: [{ value: 'r_jefe', label: 'Jefe Uno' }], value: 'r_jefe' });
  // a leader cannot install, and someone switched off is not offered
  const mixed = { reps: [{ id: 'r_ana', name: 'Ana Rep', role: 'rep', active: true }],
    others: [{ id: 'r_mara', name: 'Mara Manager', role: 'manager', active: true }, { id: 'r_lia', name: 'Lia Lider', role: 'leader', active: true },
      { id: 'r_old', name: 'Rep Viejo', role: 'rep', active: false }, { id: 'r_ex', name: 'Ex Admin', role: 'admin', active: false }, { id: 'r_jefe', name: 'Jefe Uno', role: 'admin', active: true }] };
  const m = siteReps(mixed, 'r_jefe');
  assert.deepEqual(m.options.map((o) => o.value), ['r_ana', 'r_jefe', 'r_mara']);
  assert.equal(m.value, 'r_ana', 'with reps on the team, a rep is the default');
  // nobody at all: nothing to offer, the button stays off
  assert.deepEqual(siteReps({ reps: [], others: [] }, 'r_x'), { options: [], value: '' });
});

test('the site form sends the business id when the name is one of that rep\'s businesses on the way', () => {
  const team = { routes: [{ rep: 'r_ana', lead: { id: 'APP-0001', name: 'Panadería La Espiga' } }, { rep: 'r_beto', lead: { id: 'APP-0002', name: 'Taller Dos' } }] };
  assert.equal(siteLeadId(team, 'r_ana', ' panaderia la ESPIGA '), 'APP-0001');
  assert.equal(siteLeadId(team, 'r_ana', 'Taller Dos'), null);   // another rep's business
  assert.equal(siteLeadId(team, 'r_ana', 'Otro Negocio'), null);
  assert.equal(siteLeadId({}, 'r_ana', 'Panadería La Espiga'), null);
  const v = { rep: 'r_ana', name: 'Panadería La Espiga' };
  assert.deepEqual(siteBody(v, 's_1', 'APP-0001').lead, { id: 'APP-0001', name: 'Panadería La Espiga' });
  assert.deepEqual(siteBody(v, 's_1').lead, { name: 'Panadería La Espiga' });
});

test('the person form sends a rep with no access as access none, with no email and no role', () => {
  const v = { name: ' Rosa Sin Correo ', email: 'rosa@equipo.test', city: 'Panama City', country: 'PA', startDate: '2026-10-01', workdays: [1, 2, 3], role: 'manager' };
  assert.deepEqual(newRepBody({ ...v, access: 'none' }), { access: 'none', name: ' Rosa Sin Correo ', city: 'Panama City', country: 'PA', startDate: '2026-10-01', workdays: [1, 2, 3] });
  assert.deepEqual(newRepBody({ ...v, access: 'mail' }), { email: 'rosa@equipo.test', name: ' Rosa Sin Correo ', city: 'Panama City', country: 'PA', startDate: '2026-10-01', workdays: [1, 2, 3], role: 'manager' });
  // no choice in the form (an older page): the email path, as before
  assert.equal(newRepBody(v).email, 'rosa@equipo.test');
  for (const k of ['reps.form.access', 'reps.form.access.mail', 'reps.form.access.none', 'reps.form.access.hint', 'reps.noaccess', 'reps.form.email.give', 'reps.added.noaccess']) for (const l of ['es', 'en']) assert.ok(DICT[l][k], `${l} ${k}`);
  assert.deepEqual([DICT.es['reps.form.access.none'], DICT.en['reps.form.access.none'], DICT.es['reps.noaccess'], DICT.en['reps.noaccess']], ['Sin acceso por ahora', 'No access for now', 'Sin acceso', 'No access']);
});

test('a team view that did not load is read again by itself, sooner first, then less often', () => {
  // one failed GET team left the manager's screens blank until the five-minute redraw
  assert.deepEqual([1, 2, 3, 4, 5, 6, 20].map((failures) => readAgainIn({ hasTeam: false, failures })), [2000, 4000, 8000, 16000, 30000, 30000, 30000]);
  // nothing failed and nothing on screen yet (the first read is still on its way): soon
  assert.equal(readAgainIn({ hasTeam: false, failures: 0 }), 2000);
});

test('a team view on screen is read again every minute, only while a manager screen is in front and nothing is written', () => {
  // held meetings, phones, closed installs, site reports and workers add no feed line: they waited for the five-minute redraw
  assert.ok(REFRESH_MS >= 30000 && REFRESH_MS <= 90000, `refresh ${REFRESH_MS}`);
  assert.equal(readAgainIn({ hasTeam: true, failures: 0 }), REFRESH_MS);
  assert.equal(readAgainIn({ hasTeam: true, failures: 3 }), REFRESH_MS);   // a view stays on screen: no hurry
  const base = { hidden: false, writing: false, sheet: false, hasTeam: true, tab: 'needs' };
  for (const tab of ['team', 'needs', 'reps']) assert.equal(readNow({ ...base, tab }), true, tab);
  for (const tab of ['lead', 'install', 'docs', 'today', null]) assert.equal(readNow({ ...base, tab }), false, String(tab));
  assert.equal(readNow({ ...base, hidden: true }), false, 'paused while the page is hidden');
  assert.equal(readNow({ ...base, writing: true }), false, 'a write on its way answers with the view itself');
  assert.equal(readNow({ ...base, sheet: true }), false, 'a form open over the screen');
  // nothing on screen yet: it tries whatever is open, except while the page is hidden
  assert.equal(readNow({ ...base, hasTeam: false, tab: 'docs', sheet: true }), true);
  assert.equal(readNow({ ...base, hasTeam: false, hidden: true }), false);
});

test('a read answer never undoes a write: one that went out before the last write the screen adopted is dropped', () => {
  // reads and writes take numbers from one counter, in the order they happen
  assert.equal(freshRead({ start: 5, shown: 4 }), true);
  assert.equal(freshRead({ start: 4, shown: 5 }), false, 'a write was adopted after this read went out');
  assert.equal(freshRead({ start: 4, shown: 6 }), false, 'a newer read is already on screen');
  assert.equal(freshRead({ start: 7, shown: 6, writing: true }), false, 'a write on its way will answer with a newer view');
});

test('a country other than Panamá or Colombia is named, kept in the person form, and offered for a day off', () => {
  // "Día libre" threw on a rep from MX (no words for country.MX), and the person form silently set them back to PA
  assert.deepEqual(countryOptions('PA'), ['PA', 'CO']);
  assert.deepEqual(countryOptions('MX'), ['PA', 'CO', 'MX'], 'their own country stays a choice, so saving keeps it');
  assert.deepEqual(countryOptions('cr'), ['PA', 'CO', 'CR']);
  for (const odd of ['', null, undefined, 'Panama', '1']) assert.deepEqual(countryOptions(odd), ['PA', 'CO'], String(odd));
  // the day off offers each country the team has once, and nothing for a person with none
  assert.deepEqual(teamCountries([{ country: 'PA' }, { country: 'MX' }, { country: 'PA' }, { country: '' }, {}, { country: 'co' }]), ['CO', 'MX', 'PA']);
  // the app's own words first, then the browser's name for the code, then the code itself; never a missing key
  const own = (c) => ({ PA: 'Panamá', CO: 'Colombia' })[c] || null;
  const region = (c) => (c === 'MX' ? 'México' : null);
  assert.deepEqual(['PA', 'MX', 'ZZ'].map((c) => countryLabel(c, { own, region })), ['Panamá', 'México', 'ZZ']);
  assert.equal(countryLabel('MX', { own }), 'MX');
  const es = new Intl.DisplayNames(['es-PA'], { type: 'region' });
  assert.equal(countryLabel('MX', { own, region: (c) => es.of(c) }), 'México');
});

test('a stop on its way to a site names who moves next, and an expired contract wait is the rep\'s to log again', () => {
  const route = (stop, extra = {}) => ({ complete: false, at: 1, stops: [{ key: 'interested', status: 'done' }, { key: 'sent', ...stop }], ...extra });
  assert.deepEqual(wayLine({ complete: true, at: 6, stops: [] }, { repFirst: 'Ana' }), { key: 'needs.ways.done', params: {} });
  assert.deepEqual(wayLine(route({ status: 'wait', expired: null }), { repFirst: 'Ana' }), { key: 'needs.ways.you', params: { stop: 'sent' } });
  assert.deepEqual(wayLine(route({ status: 'todo' }), { repFirst: 'Ana' }), { key: 'needs.ways.rep', params: { name: 'Ana', stop: 'sent' } });
  // the server refuses to confirm an expired wait (409 expired): it no longer waits on the manager
  const expired = wayLine(route({ status: 'wait', expired: '2026-11-20T12:00:00.000Z' }), { repFirst: 'Ana' });
  assert.notEqual(expired.key, 'needs.ways.you');
  assert.deepEqual(expired, { key: 'needs.ways.expired', params: { name: 'Ana' } });
  for (const lang of Object.keys(DICT)) assert.ok(DICT[lang]['needs.ways.expired'], lang);
});

test("each rep's businesses: owned and overdue, with the line under each only when it counts something", () => {
  assert.deepEqual(bookCells({ owned: 7, overdue: 3, today: 1, nonext: 0 }), { owned: { n: 7, sub: null }, overdue: { n: 3, sub: { key: 'mgr.book.today', n: 1 } } });
  assert.deepEqual(bookCells({ owned: 4, overdue: 0, today: 0, nonext: 2 }), { owned: { n: 4, sub: { key: 'mgr.book.nonext', n: 2 } }, overdue: { n: 0, sub: null } });
  assert.deepEqual(bookCells(undefined), { owned: { n: 0, sub: null }, overdue: { n: 0, sub: null } });
});

test("who has overdue follow-ups, in the server's order (oldest first)", () => {
  const needs = { overdue: [{ rep: 'r_b', name: 'Bea Ruiz', overdue: 1, oldest: '2026-11-10' }, { rep: 'r_a', name: 'Ana Gil', overdue: 4, oldest: '2026-11-12' }] };
  assert.deepEqual(overdueLines(needs), [
    { rep: 'r_b', name: 'Bea Ruiz', key: 'needs.overdue.item', n: 1, date: '2026-11-10' },
    { rep: 'r_a', name: 'Ana Gil', key: 'needs.overdue.item', n: 4, date: '2026-11-12' }]);
  assert.deepEqual(overdueLines({}), []);
  for (const k of ['mgr.book.today', 'mgr.book.nonext', 'needs.overdue.item', 'needs.overdue.title', 'needs.overdue.empty', 'col.owned', 'col.overdue', 'mgr.flag.overdue']) assert.ok(DICT.es[k], k);
});

// Wave 2 (C4): a shipment adds to what arrived; a request is optional when a manager opens a site.
test('a shipment that arrived is a count from 1 to 500, and the site form may say how many phones it needs', () => {
  assert.deepEqual(arrivedBody({ count: '6' }), { what: 'arrived', count: 6 });
  for (const bad of ['', '0', '501', '3.5', 'seis']) assert.equal(refused(() => arrivedBody({ count: bad })), 'phones_count', bad);
  const base = { rep: 'r_1', name: 'Taller Uno', kind: 'normal' };
  assert.equal('request' in siteBody(base, 's_1'), false, 'optional for a manager');
  assert.equal(siteBody({ ...base, request: ' 30 ' }, 's_1').request, 30);
  assert.equal(refused(() => siteBody({ ...base, request: '501' }, 's_1')), 'phones_count');
  for (const k of ['site.act.arrived', 'site.act.fix', 'site.act.request', 'site.arrived.title', 'site.arrived.intro', 'site.arrived.count', 'site.arrived.done', 'site.request.done']) for (const l of ['es', 'en']) assert.ok(DICT[l][k], `${l} ${k}`);
});

// Wave 2 (C6): the week's meetings, what is stuck and the day's blockers come first in Pendientes; the table shows the
// points it ranks by.
test('Pendientes: a meeting row, a stuck line, what the new groups add to the count, and the points the table ranks by', () => {
  assert.deepEqual(stalledLine({ kind: 'meeting', days: 3, lead: { name: 'Taller Uno' } }), { key: 'needs.stall.meeting', n: 3, lead: 'Taller Uno' });
  assert.deepEqual(stalledLine({ kind: 'contract', days: 9, lead: { name: 'Taller Dos' } }), { key: 'needs.stall.contract', n: 9, lead: 'Taller Dos' });
  assert.equal(extraNeeds({ stalled: [{}, {}], blockers: [{ seen: false }, { seen: true }] }), 3);
  assert.equal(extraNeeds({}), 0, 'an older server sends neither');
  assert.deepEqual(pointsCell({ points: 24, scaledPoints: 40 }), { n: 40, raw: 24 }); assert.deepEqual(pointsCell({ points: 30, scaledPoints: 30 }), { n: 30, raw: null });
  assert.deepEqual(pointsCell({ points: 12 }), { n: 12, raw: null }, 'no scaled number: the points as they are');
  const m = { when: '2026-11-18', time: '09:30', lead: { id: 'EJ-1', name: 'Taller Uno' }, name: 'Mario Paz', contact: 'Sra. Ruiz', demo: true, held: false };
  assert.deepEqual(meetingRow(m).who, { key: 'needs.meet.with', name: 'Mario Paz', contact: 'Sra. Ruiz' });
  assert.deepEqual(meetingRow(m), { day: '2026-11-18', time: '09:30', lead: { id: 'EJ-1', name: 'Taller Uno' }, who: { key: 'needs.meet.with', name: 'Mario Paz', contact: 'Sra. Ruiz' }, demo: true, held: false });
  assert.deepEqual(meetingRow({ ...m, contact: null, time: null, demo: false }).who, { text: 'Mario Paz' });
  assert.equal(meetingRow({ ...m, contact: null, time: null }).time, null);
  for (const k of ['needs.meet.title', 'needs.meet.empty', 'needs.meet.with', 'needs.meet.demo', 'needs.meet.held', 'needs.stall.title', 'needs.stall.empty', 'needs.stall.missed', 'needs.stall.alive',
    'needs.stall.missed.done', 'needs.stall.alive.done', 'needs.block.title', 'needs.block.empty', 'needs.block.yesterday', 'needs.block.seen', 'needs.block.mark', 'col.points.raw']) for (const l of ['es', 'en']) assert.ok(DICT[l][k], `${l} ${k}`);
});

// Fix round C1 (K3): "No ocurrió" rewrites the holder's next step for good, so it asks twice; "Sigue viva" stays one tap.
test('"No ocurrió" asks twice, and Pendientes says the three new groups it holds', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../team/manager.js', import.meta.url), 'utf8');
  const missed = src.slice(src.indexOf("text: t('needs.stall.missed')"), src.indexOf("text: t('needs.stall.alive')"));
  assert.match(missed, /const k = missedKeys\(x\.kind\); twice\(e, k\.sure/, 'the missed button arms first, in the words of a meeting or a contract');
  const alive = src.slice(src.indexOf("text: t('needs.stall.alive')"), src.indexOf("text: t('needs.stall.alive')") + 220);
  assert.doesNotMatch(alive, /twice\(/, '"Sigue viva" is one tap');
  assert.equal(DICT.es['needs.stall.missed.sure'], 'Toca otra vez para confirmar: su próximo paso pasa a ser reagendar.');
  assert.equal(DICT.en['needs.stall.missed.sure'], 'Tap again to confirm: its next step becomes rebooking.');
  assert.equal(DICT.es['needs.support'], 'Reuniones de la semana, lo trabado, los bloqueos, lo que espera tu confirmación, vendedores sin registros y registros con la hora cambiada.');
  assert.equal(DICT.en['needs.support'], "The week's meetings, what is stuck, blockers, what waits for your confirmation, reps with no logs and logs with a changed time.");
});

// Fix round C1 (K4): "Corregir el total" sets the total, checked as every phone count is, and says so in its own words.
test('correcting the phones\' total checks its number with phoneCount and reads as a correction', () => {
  const refusedFix = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
  assert.deepEqual(fixBody({ count: ' 12 ' }), { what: 'phones', count: 12 });
  for (const bad of ['', '0', '501', '3.5', 'diez']) assert.equal(refusedFix(() => fixBody({ count: bad })), 'phones_count', bad);
  assert.equal(DICT.es['err.phones_count'], 'Escribe un número de 1 a 500.');
  const words = { 'site.act.fix': ['Corregir el total', 'Correct the total'],
    'site.fix.intro': ['{name}: el número que escribas reemplaza el total de teléfonos que llegaron.', '{name}: the number you enter replaces the total of phones that arrived.'],
    'site.fix.count': ['Total que llegó', 'Total that arrived'], 'site.fix.done': ['Total corregido: {n}.', 'Total corrected: {n}.'] };
  for (const [k, [es, en]] of Object.entries(words)) { assert.equal(DICT.es[k], es, k); assert.equal(DICT.en[k], en, k); }
  // "Llegaron teléfonos" keeps its words, and the key nothing reads is gone
  assert.deepEqual([DICT.es['site.act.arrived'], DICT.en['site.act.arrived']], ['Llegaron teléfonos', 'Phones arrived']);
  assert.equal(DICT.es['site.arrived.intro'], '{name}: lo que anotes se suma a lo que ya llegó.');
  assert.equal('site.act.phones' in DICT.es || 'site.act.phones' in DICT.en, false);
});

// Track F, F2: what is missing in Documents is the manager's to load, at the end of Pendientes, not counted.
test('"Por cargar" holds the agreement when no document is hooked to the contract, and the script when "Para vender" is empty', () => {
  const doc = (over) => ({ id: `d_x${Math.random().toString(36).slice(2, 12)}`, title: { es: 'Ejemplo', en: '' }, note: { es: '', en: '' }, url: 'https://example.com/x', group: 'vender', lang: 'both', step: null, order: 0, t: '2026-11-20T12:00:00Z', ...over });
  assert.deepEqual(toLoad([]), [{ key: 'needs.load.contract', group: 'contrato', step: 'contract' }, { key: 'needs.load.guion', group: 'vender', step: null }]);
  assert.deepEqual(toLoad(undefined).map((x) => x.key), ['needs.load.contract', 'needs.load.guion']);
  assert.deepEqual(toLoad([doc({ group: 'contrato', step: 'contract' })]).map((x) => x.key), ['needs.load.guion']);
  assert.deepEqual(toLoad([doc({})]).map((x) => x.key), ['needs.load.contract']);
  assert.deepEqual(toLoad([doc({}), doc({ group: 'contrato', step: 'contract', url: '', body: { es: 'Texto' } })]), []);
  // a document in "Contratos" with no step does not count as the agreement
  assert.deepEqual(toLoad([doc({}), doc({ group: 'contrato' })]).map((x) => x.key), ['needs.load.contract']);
  // a document whose address does not hold and has no text is not there
  assert.deepEqual(toLoad([doc({ url: 'javascript:x' })]).map((x) => x.key), ['needs.load.contract', 'needs.load.guion']);
  // it never counts in the tab's number
  assert.equal(extraNeeds({ stalled: [], blockers: [], toLoad: toLoad([]) }), 0);
  for (const k of ['needs.load.title', 'needs.load.contract', 'needs.load.guion', 'needs.load.btn']) assert.ok(k in DICT.es && k in DICT.en, k);
  assert.equal(DICT.es['needs.load.contract'], 'El acuerdo no está en Documentos.');
  assert.equal(DICT.es['needs.load.guion'], 'No hay guion en Documentos.');
});

// Track F, F5: the manager's "Adelanto" form and the advances in Pendientes.
test('the advance form sends the whole mark; clearing sends both null; only a real site offers it', () => {
  assert.deepEqual(advanceBody({ asked: '2026-11-12', paid: '' }), { what: 'advance', asked: '2026-11-12', paid: null });
  assert.deepEqual(advanceBody({ asked: '2026-11-12', paid: '2026-11-14' }), { what: 'advance', asked: '2026-11-12', paid: '2026-11-14' });
  assert.deepEqual(advanceBody({ asked: ' ', paid: '' }), { what: 'advance', asked: null, paid: null });
  assert.equal(refused(() => advanceBody({ asked: '', paid: '2026-11-14' })), 'fields');
  assert.equal(refused(() => advanceBody({ asked: '2026-11-14', paid: '2026-11-12' })), 'fields');
  assert.equal(canAdvance({ practice: false }), true);
  assert.equal(canAdvance({ practice: true }), false);
  // the advances waiting count in the tab's number
  assert.equal(extraNeeds({ stalled: [], blockers: [], advances: [{ siteId: 's1' }, { siteId: 's2' }] }), 2);
  for (const k of ['site.advance', 'site.advance.title', 'site.advance.asked', 'site.advance.paid', 'site.advance.clear', 'site.advance.done', 'site.advance.cleared', 'needs.adv.title', 'needs.adv.empty', 'needs.adv.days']) assert.ok(k in DICT.es && k in DICT.en, k);
  assert.equal(DICT.es['site.advance'], 'Adelanto'); assert.equal(DICT.en['site.advance'], 'Advance');
  assert.equal(DICT.es['site.advance.clear'], 'Quitar la marca');
  assert.equal(DICT.es['needs.adv.title'].toLowerCase(), 'adelantos pedidos sin pagar');
  assert.equal(DICT.en['needs.adv.title'].toLowerCase(), 'advances requested, not paid');
});

// Final round (N8): "No ocurrió" on a contract asks the holder to pick the contract back up, and the manager is told so.
test('after No ocurrió, a meeting is rebooked and a contract is picked back up, in both languages', async () => {
  const { DICT } = await import('../team/i18n.js');
  assert.deepEqual(missedKeys('meeting'), { sure: 'needs.stall.missed.sure', done: 'needs.stall.missed.done' });
  assert.deepEqual(missedKeys('contract'), { sure: 'needs.stall.missed.sure.contract', done: 'needs.stall.missed.done.contract' });
  assert.equal(DICT.es['needs.stall.missed.done.contract'], 'Anotado. Su próximo paso es retomar el contrato, hoy.');
  assert.equal(DICT.en['needs.stall.missed.done.contract'], 'Noted. Its next step is to pick the contract back up, today.');
  for (const l of ['es', 'en']) assert.ok(DICT[l]['needs.stall.missed.sure.contract']);
});
