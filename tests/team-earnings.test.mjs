// What each rep earns: accepted minutes per site and per week, recorded by a manager or an admin; one pay rate per
// accepted hour, set by an admin only; a rep's active sites, with the counts the rep needs to grow them; and what a rep
// sees about a teammate: counts and site names, never a worker. Money is integer cents; no rate means no amount at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { centsFor, rateFor, earnOf } from '../lib/team/pay.mjs';

const API = '/equipo/api';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const THIS_WEEK = '2026-11-16', LAST_WEEK = '2026-11-09';
const IMEI_A = '490154203237518';

/** An admin, a manager, two reps, and an installed site for ana with one worker who records. */
async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto'), mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' });
  const idOf = async (who) => (await s.call('GET', `${API}/me`, undefined, { cookie: who.cookie })).json.viewer.id;
  ana.id = await idOf(ana); beto.id = await idOf(beto);
  const me = async (who) => (await s.call('GET', `${API}/me`, undefined, { cookie: who.cookie })).json;
  const manage = (siteId, body, who = a) => s.call('POST', `${API}/site/${siteId}`, body, { cookie: who.cookie });
  const upload = (id, who) => fetch(`${s.url}${API}/worker/${id}/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: who.cookie }, body: JPG });
  /** A site for `rep`, installed the way the app installs: phones, one worker with consent, phone and clip, closed, confirmed. */
  const installed = async (rep, siteId, name, worker) => {
    await s.call('POST', `${API}/site`, { id: siteId, rep: rep.id, lead: { name } }, { cookie: a.cookie });
    await manage(siteId, { what: 'phones', count: 3 });
    await s.call('POST', `${API}/install/${siteId}/workers`, { id: worker.id, name: worker.name, email: worker.email }, { cookie: rep.cookie });
    await upload(worker.id, rep);
    await s.call('POST', `${API}/worker/${worker.id}/phone`, { imei: worker.imei }, { cookie: rep.cookie });
    await s.call('POST', `${API}/worker/${worker.id}/clip`, {}, { cookie: rep.cookie });
    await s.call('POST', `${API}/install/${siteId}/close`, {}, { cookie: rep.cookie });
    assert.equal((await manage(siteId, { what: 'installed' })).status, 200);
  };
  return { s, a, ana, beto, mgr, me, manage, upload, installed };
}

test('cents for accepted minutes at a rate: exact for hours that are not whole, rounded to the nearest cent', () => {
  assert.equal(centsFor(3666, 100), 6110);   // 61 h 6 min at US$1.00 is US$61.10
  assert.equal(centsFor(61, 250), 254);      // 1 h 1 min at US$2.50 is US$2.5416...: US$2.54
  assert.equal(centsFor(0, 100), 0);
});

test('the rate in force for a week is the newest one that starts on or before it; a practice rep reads the practice rate only', () => {
  const st = emptyState(), ev = (e) => applyEvent(st, { t: '2026-11-16T15:00:00Z', ...e });
  ev({ type: 'rep.created', id: 'r_ana', handle: 'ana', email: 'ana@equipo.test', name: 'Ana Prueba', role: 'rep' });
  ev({ type: 'rep.practice.example', id: 'r_exa', handle: 'ex-a', name: 'Vendedor A', slot: 'A' });
  const ana = st.reps.get('r_ana'), exa = st.reps.get('r_exa');
  assert.equal(rateFor(st, ana, THIS_WEEK), null);
  ev({ type: 'pay.rate', cents: 100, from: LAST_WEEK });
  ev({ type: 'pay.rate', cents: 150, from: THIS_WEEK });
  ev({ type: 'pay.rate', cents: 999, from: '2026-11-18' });   // not a Monday: ignored
  assert.deepEqual([rateFor(st, ana, '2026-11-02'), rateFor(st, ana, LAST_WEEK), rateFor(st, ana, THIS_WEEK), rateFor(st, ana, '2026-11-23')], [null, 100, 150, 150]);
  assert.equal(rateFor(st, exa, THIS_WEEK), null, 'the real rate never pays a practice rep');
  ev({ type: 'practice.pay.rate', cents: 100, from: LAST_WEEK });
  assert.equal(rateFor(st, exa, THIS_WEEK), 100);
  assert.equal(rateFor(st, ana, THIS_WEEK), 150, 'the practice rate never becomes the real rate');
  // earnings: no rate means no amount, null and not zero
  assert.deepEqual(earnOf(st, ana, '2026-11-02'), { week: '2026-11-02', minutes: 0, rate: null, cents: null });
});

test('site hours: only a manager or an admin, a Monday, a later value replaces the earlier, never on a legacy or an unfinished site', async (t) => {
  const { s, a, ana, mgr, me, manage, installed } = await setup(t);
  // opened last week, so last week's minutes are its own (none are taken for a week before a site existed)
  s.time.now -= 7 * 86400000;
  await installed(ana, 's_earn-site-01', 'Taller Uno', { id: 'w_earn-0001', name: 'Persona Uno', email: 'persona1@equipo.test', imei: IMEI_A });
  s.time.now += 7 * 86400000;
  const lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  const before = s.lines().length;
  // a rep (even the site's own) and a leader cannot
  for (const who of [ana, lia]) assert.equal((await manage('s_earn-site-01', { what: 'hours', week: THIS_WEEK, accepted: 600 }, who)).status, 403);
  for (const [week, accepted, code] of [['2026-11-17', 600, 'week'], ['2026-11-23', 600, 'week'], ['nope', 600, 'week'], [THIS_WEEK, -1, 'minutes'], [THIS_WEEK, 2.5, 'minutes'], [THIS_WEEK, 100001, 'minutes']]) {
    const r = await manage('s_earn-site-01', { what: 'hours', week, accepted });
    assert.deepEqual([r.status, r.json.error], [400, code], `${week} ${accepted}`);
  }
  assert.equal(s.lines().length, before, 'nothing appended');
  assert.equal((await manage('s_earn-site-01', { what: 'hours', week: THIS_WEEK, accepted: 600 }, mgr)).status, 200);
  assert.equal((await manage('s_earn-site-01', { what: 'hours', week: THIS_WEEK, accepted: 3666 })).status, 200);
  assert.equal((await manage('s_earn-site-01', { what: 'hours', week: LAST_WEEK, accepted: 120 })).status, 200);
  const ev = s.lines().filter((e) => e.type === 'site.hours');
  assert.deepEqual(ev.map((e) => [e.siteId, e.week, e.accepted]), [['s_earn-site-01', THIS_WEEK, 600], ['s_earn-site-01', THIS_WEEK, 3666], ['s_earn-site-01', LAST_WEEK, 120]]);
  const mine = (await me(ana)).active[0];
  assert.deepEqual([mine.week, mine.last], [3666, 120], 'the later value replaced the earlier');
  // the scorecard hours are a separate thing and stay untouched
  assert.equal(s.lines().some((e) => e.type === 'hours.week'), false);
  // a legacy site, a site not installed yet, a voided one
  await s.call('POST', `${API}/site`, { id: 's_earn-legacy1', rep: ana.id, lead: { name: 'Sitio Viejo' }, legacy: true }, { cookie: a.cookie });
  await manage('s_earn-legacy1', { what: 'installed' });
  assert.deepEqual([(await manage('s_earn-legacy1', { what: 'hours', week: THIS_WEEK, accepted: 60 })).json.error], ['legacy']);
  await s.call('POST', `${API}/site`, { id: 's_earn-fresh01', rep: ana.id, lead: { name: 'Sitio Nuevo' } }, { cookie: a.cookie });
  assert.deepEqual([(await manage('s_earn-fresh01', { what: 'hours', week: THIS_WEEK, accepted: 60 })).json.error], ['not_installed']);
});

test('site hours on a practice site: refused on the manager route; allowed while acting as its practice rep', async (t) => {
  const { s, a, manage } = await setup(t);
  const P = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  const asP = (route) => `${API}/${route}?as=${encodeURIComponent(P)}`;
  await s.call('POST', `${API}/site`, { id: 's_earn-prac-01', rep: P, lead: { name: 'Sitio Demo' } }, { cookie: a.cookie });
  await manage('s_earn-prac-01', { what: 'installed' });
  const refused = await manage('s_earn-prac-01', { what: 'hours', week: THIS_WEEK, accepted: 60 });
  assert.deepEqual([refused.status, refused.json.error], [409, 'practice']);
  // not acting: the practice path does not exist
  const own = await s.call('POST', `${API}/route/hours`, { site: 's_earn-prac-01', week: THIS_WEEK, accepted: 60 }, { cookie: a.cookie });
  assert.deepEqual([own.status, own.json.error], [403, 'practice_only']);
  const ok = await s.call('POST', asP('route/hours'), { site: 's_earn-prac-01', week: THIS_WEEK, accepted: 90 }, { cookie: a.cookie });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.me.active.map((x) => [x.id, x.week]), [['s_earn-prac-01', 90]]);
  assert.equal(s.lines().filter((e) => e.type === 'site.hours').at(-1).by, (await s.call('GET', `${API}/me`, undefined, { cookie: a.cookie })).json.viewer.id);
});

test('earnings: no rate means no amount anywhere; an admin sets the rate; cents are exact; a change applies from its week on', async (t) => {
  const { s, a, ana, beto, mgr, me, manage, installed } = await setup(t);
  // opened last week, so last week's minutes are its own (none are taken for a week before a site existed)
  s.time.now -= 7 * 86400000;
  await installed(ana, 's_earn-site-01', 'Taller Uno', { id: 'w_earn-0001', name: 'Persona Uno', email: 'persona1@equipo.test', imei: IMEI_A });
  s.time.now += 7 * 86400000;
  await manage('s_earn-site-01', { what: 'hours', week: THIS_WEEK, accepted: 3666 });
  await manage('s_earn-site-01', { what: 'hours', week: LAST_WEEK, accepted: 600 });
  const cents = (json) => [...JSON.stringify(json).matchAll(/"cents":([^,}\]]+)/g)].map((m) => m[1]);
  // no rate: every amount is null, in the rep's payload, a teammate's and the leadership view
  const before = await me(ana);
  assert.deepEqual([before.earn.rate, before.earn.week.minutes, before.earn.week.cents, before.earn.last.cents], [null, 3666, null, null]);
  assert.ok(cents(before).length > 0 && cents(before).every((v) => v === 'null'), 'no number where an amount would be');
  assert.ok(cents(await me(beto)).every((v) => v === 'null'));
  const lead = (await s.call('GET', `${API}/lead`, undefined, { cookie: a.cookie })).json;
  assert.ok(cents(lead).length > 0 && cents(lead).every((v) => v === 'null'));
  // only an admin sets it: a manager, a rep and bad values are refused, nothing appended
  const at = s.lines().length;
  assert.deepEqual([(await s.call('POST', `${API}/pay`, { cents: 100 }, { cookie: mgr.cookie })).json.error], ['admin_only']);
  assert.equal((await s.call('POST', `${API}/pay`, { cents: 100 }, { cookie: ana.cookie })).status, 403);
  for (const body of [{ cents: 0 }, { cents: 1.5 }, { cents: '100' }, { cents: 100001 }, { cents: 100, from: '2026-11-17' }]) assert.equal((await s.call('POST', `${API}/pay`, body, { cookie: a.cookie })).status, 400, JSON.stringify(body));
  assert.equal(s.lines().length, at);
  // set from last week: 61 h 6 min at US$1.00 is US$61.10
  const set = await s.call('POST', `${API}/pay`, { cents: 100, from: LAST_WEEK }, { cookie: a.cookie });
  assert.equal(set.status, 200);
  assert.deepEqual(set.json.pay, { cents: 100, from: LAST_WEEK });
  let mine = await me(ana);
  assert.deepEqual([mine.earn.rate, mine.earn.week.cents, mine.earn.last.cents, mine.active[0].cents], [100, 6110, 1000, 6110]);
  // a new rate from this week on changes this week, not last week
  assert.equal((await s.call('POST', `${API}/pay`, { cents: 200 }, { cookie: a.cookie })).status, 200);
  assert.deepEqual(s.lines().filter((e) => e.type === 'pay.rate').map((e) => [e.cents, e.from]), [[100, LAST_WEEK], [200, THIS_WEEK]]);
  mine = await me(ana);
  assert.deepEqual([mine.earn.week.cents, mine.earn.last.cents], [12220, 1000]);
  // a week already shown with a rate keeps it: once a rate was in force, a newer one starts this week, never before
  // (the first rate above could still reach back, since those weeks showed no amount at all)
  const back = await s.call('POST', `${API}/pay`, { cents: 300, from: LAST_WEEK }, { cookie: a.cookie });
  assert.deepEqual([back.status, back.json.error], [409, 'week_shown']);
  assert.equal(s.lines().filter((e) => e.type === 'pay.rate').length, 2, 'nothing written');
  assert.deepEqual([(await me(ana)).earn.last.cents], [1000], 'last week still pays what it showed');
  // the leadership view's rep cards carry the same three figures
  const card = (await s.call('GET', `${API}/lead`, undefined, { cookie: a.cookie })).json.cities.flatMap((c) => c.reps).find((r) => r.id === ana.id);
  assert.deepEqual([card.sites, card.minutes, card.cents], [1, 3666, 12220]);
});

test('my active sites: an installed site with its counts; the rep adds a worker and gives a phone there, the lock holds, another rep and a legacy site are refused', async (t) => {
  const { s, a, ana, beto, me, manage, upload, installed } = await setup(t);
  await installed(ana, 's_earn-site-01', 'Taller Uno', { id: 'w_earn-0001', name: 'Persona Uno', email: 'persona1@equipo.test', imei: IMEI_A });
  // a site still installing is not active
  await s.call('POST', `${API}/site`, { id: 's_earn-fresh01', rep: ana.id, lead: { name: 'Sitio Nuevo' } }, { cookie: a.cookie });
  let mine = (await me(ana)).active;
  assert.deepEqual(mine.map((x) => [x.id, x.name, x.recording, x.phones, x.consents, x.week, x.last, x.cents]), [['s_earn-site-01', 'Taller Uno', 1, 1, 1, 0, 0, null]]);
  // a worker added on the installed site: same route, same lock
  assert.equal((await s.call('POST', `${API}/install/s_earn-site-01/workers`, { id: 'w_earn-0002', name: 'Persona Dos', email: 'persona2@equipo.test' }, { cookie: ana.cookie })).status, 200);
  const locked = await s.call('POST', `${API}/worker/w_earn-0002/phone`, { imei: '356938035643809' }, { cookie: ana.cookie });
  assert.deepEqual([locked.status, locked.json.error], [409, 'consent_first']);
  assert.equal((await upload('w_earn-0002', ana)).status, 200);
  assert.equal((await s.call('POST', `${API}/worker/w_earn-0002/phone`, { imei: '356938035643809' }, { cookie: ana.cookie })).status, 200);
  mine = (await me(ana)).active;
  assert.deepEqual([mine[0].recording, mine[0].phones, mine[0].consents], [2, 2, 2]);
  // a phone returned is a phone off the site, dated
  assert.equal((await s.call('POST', `${API}/worker/w_earn-0002/phone/return`, {}, { cookie: ana.cookie })).status, 200);
  assert.equal((await me(ana)).active[0].phones, 1);
  assert.ok(s.lines().find((e) => e.type === 'worker.phone.returned').t);
  // another rep cannot touch it
  assert.equal((await s.call('POST', `${API}/install/s_earn-site-01/workers`, { id: 'w_earn-0003', name: 'Persona Tres', email: 'persona3@equipo.test' }, { cookie: beto.cookie })).status, 403);
  // a legacy site is not active and takes no worker
  await s.call('POST', `${API}/site`, { id: 's_earn-legacy1', rep: ana.id, lead: { name: 'Sitio Viejo' }, legacy: true }, { cookie: a.cookie });
  await manage('s_earn-legacy1', { what: 'installed' });
  assert.deepEqual((await me(ana)).active.map((x) => x.id), ['s_earn-site-01']);
  assert.equal((await s.call('POST', `${API}/install/s_earn-legacy1/workers`, { id: 'w_earn-0004', name: 'Persona Cuatro', email: 'persona4@equipo.test' }, { cookie: ana.cookie })).status, 409);
});

test('seeing the others: a teammate comes with active sites by name, workers counted, hours and earnings; never a worker\'s name or email', async (t) => {
  const { s, a, ana, beto, me, manage, installed } = await setup(t);
  await installed(beto, 's_earn-beto-01', 'Panadería Dos', { id: 'w_earn-0009', name: 'Trabajadora Secreta', email: 'secreta@equipo.test', imei: IMEI_A });
  await manage('s_earn-beto-01', { what: 'hours', week: THIS_WEEK, accepted: 125 });
  await s.call('POST', `${API}/pay`, { cents: 100 }, { cookie: a.cookie });
  const view = await me(ana);
  const mate = view.crew.find((c) => c.id === beto.id);
  assert.deepEqual(mate, { id: beto.id, sites: [{ name: 'Panadería Dos', workers: 1, minutes: 125 }], minutes: 125, cents: 208 });
  const text = JSON.stringify(view);
  for (const secret of ['Trabajadora Secreta', 'secreta@equipo.test', IMEI_A, 'w_earn-0009']) assert.equal(text.includes(secret), false, secret);
  // ana herself is in the crew with nothing yet
  assert.deepEqual(view.crew.find((c) => c.id === ana.id), { id: ana.id, sites: [], minutes: 0, cents: 0 });
});

test('a voided site still takes the accepted minutes of a week that ended before the void, and they pay; never a later week', async (t) => {
  const s = await start({ clock: Date.parse('2026-11-10T15:00:00Z') }); t.after(() => s.srv.close());   // Tuesday 10 Nov
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const manage = (body) => s.call('POST', `${API}/site/s_void-hours-01`, body, { cookie: a.cookie });
  await s.call('POST', `${API}/site`, { id: 's_void-hours-01', rep: ana.id, lead: { name: 'Hotel Pago' } }, { cookie: a.cookie });
  assert.equal((await manage({ what: 'installed' })).status, 200);
  s.time.now = Date.parse('2026-11-16T15:00:00Z');   // Monday 16 Nov: the rate, from last week
  assert.equal((await s.call('POST', `${API}/pay`, { cents: 500, from: LAST_WEEK }, { cookie: a.cookie })).status, 200);
  s.time.now = Date.parse('2026-11-18T15:00:00Z');   // Wednesday: the site is voided
  assert.equal((await manage({ what: 'void' })).status, 200);
  s.time.now = Date.parse('2026-11-20T15:00:00Z');   // Friday: the buyers' report brings last week's accepted minutes
  const late = await manage({ what: 'hours', week: LAST_WEEK, accepted: 600 });
  assert.equal(late.status, 200, late.text);
  const earn = (await s.call('GET', `${API}/me`, undefined, { cookie: ana.cookie })).json.earn;
  assert.deepEqual([earn.last.minutes, earn.last.cents], [600, 5000]);
  // the week of the void did not end before it: refused, as anything else on a voided site
  const same = await manage({ what: 'hours', week: THIS_WEEK, accepted: 60 });
  assert.deepEqual([same.status, same.json.error], [404, 'site']);
  assert.deepEqual([(await manage({ what: 'phones', count: 2 })).status], [404]);
  assert.equal(s.lines().filter((e) => e.type === 'site.hours').length, 1);
});
