// The manager's site and hours controls decide a few things before the server answers: what the site form sends, what
// the hours form sends, which controls a site offers, and which roles the person form lists. Those decisions live in
// team/manager-steps.js, away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { siteBody, hoursBody, siteHoursBody, siteActions, roleOptions, siteReps, siteLeadId, newRepBody, readAgainIn, readNow, freshRead, REFRESH_MS } from '../team/manager-steps.js';
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
  assert.deepEqual(siteActions(site({})), ['install', 'phones', 'installed', 'void']);   // nobody on it yet: no record to download
  assert.deepEqual(siteActions(site({ state: 'installing', phones: 3, workers: 2 })), ['install', 'phones', 'record', 'void']);
  assert.deepEqual(siteActions(site({ state: 'closed', phones: 3, workers: 2, closed: 't' })), ['install', 'confirm', 'record', 'void']);
  assert.deepEqual(siteActions(site({ state: 'installed', workers: 2, steps: { installed: 't' } })), ['install', 'first_hour', 'hours', 'record', 'void']);   // hours once it is live (Task 15)
  // a legacy site is not installed here: no phones; its screens load past consents, and it keeps the old way of being marked
  assert.deepEqual(siteActions(site({ state: 'legacy', legacy: true })), ['install', 'installed', 'void']);
  assert.deepEqual(siteActions(site({ state: 'legacy', legacy: true, workers: 3 })), ['install', 'installed', 'record', 'void']);
  // a practice site opens like a real one and is removed, never voided; it has no record and counts in no total
  assert.deepEqual(siteActions(site({ state: 'practice', practice: true, workers: 2, closed: 't' })), ['install', 'confirm', 'remove']);
  assert.deepEqual(siteActions(site({ state: 'practice', practice: true })), ['install', 'phones', 'remove']);
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
