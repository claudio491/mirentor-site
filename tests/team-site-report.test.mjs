// The daily site report: who may send it, what it checks, what it prefills, one per site and day, and the ops lead's export.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, MON_10 } from './team-helper.mjs';
import { REPORT_HEADERS, checkReport, reportRow } from '../lib/team/report.mjs';

const API = '/equipo/api';
const JPG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from('JFIF consent bytes'), Buffer.from([0xff, 0xd9])]);
const IMEIS = ['490154203237518', '356938035643809'];

/** A whole report as the form sends it. */
const full = (over = {}) => ({ people: 2, delivered: 9.5, accepted: 8.25,
  phones: { out: 2, back: 2, broken: 0, working: 2 }, headsets: { out: 2, back: 2, broken: 0, working: 2 },
  batteries: { out: 2, back: 1, broken: 1, working: 1 }, cords: { out: 2, back: 2, broken: 0, working: 2 },
  surge: { working: 1, broken: 0 }, sets: 1, allOk: false, missing: 'Una batería no carga', need: 'Una batería', notes: 'Todo bien', ...over });

/** An admin, two reps, and ana's site installed through the app with two workers holding a phone and one without. */
async function setup(t, { installed = true } = {}) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana'), beto = await s.addRep(a.cookie, 'beto');
  await s.call('POST', `${API}/site`, { id: 's_report-0001', rep: ana.id, lead: { name: 'Taller El Faro' }, city: 'Colón' }, { cookie: a.cookie });
  const siteId = 's_report-0001';
  await s.call('POST', `${API}/site/${siteId}`, { what: 'phones', count: 3 }, { cookie: a.cookie });
  for (const [i, wid] of ['w_report-001', 'w_report-002', 'w_report-003'].entries()) {
    await s.call('POST', `${API}/install/${siteId}/workers`, { id: wid, name: `Persona ${i}`, email: `p${i}@equipo.test`, phone: true }, { cookie: ana.cookie });
    const up = await fetch(`${s.url}${API}/worker/${wid}/consent`, { method: 'PUT', headers: { 'content-type': 'image/jpeg', cookie: ana.cookie }, body: JPG });
    assert.equal(up.status, 200);
    if (i < 2) {
      assert.equal((await s.call('POST', `${API}/worker/${wid}/phone`, { imei: IMEIS[i] }, { cookie: ana.cookie })).status, 200);
      await s.call('POST', `${API}/worker/${wid}/clip`, {}, { cookie: ana.cookie });
    }
  }
  if (installed) {
    assert.equal((await s.call('POST', `${API}/install/${siteId}/close`, {}, { cookie: ana.cookie })).status, 200);
    assert.equal((await s.call('POST', `${API}/site/${siteId}`, { what: 'installed' }, { cookie: a.cookie })).status, 200);
  }
  const send = (body, cookie = ana.cookie, id = siteId) => s.call('POST', `${API}/site/${id}/report`, body, { cookie });
  const read = (cookie = ana.cookie, id = siteId) => s.call('GET', `${API}/site/${id}/report`, undefined, { cookie });
  const sync = (since = '') => s.call('GET', `${API}/sitereports${since ? `?since=${encodeURIComponent(since)}` : ''}`, undefined, { bearer: 'push-token' });
  const reports = () => s.lines().filter((e) => e.type === 'site.report');
  return { s, a, ana, beto, siteId, send, read, sync, reports };
}

test('the header list is the ops lead sheet, 31 columns, byte for byte', () => {
  assert.equal(REPORT_HEADERS.length, 31);
  assert.equal(REPORT_HEADERS[0], 'Timestamp');
  assert.equal(REPORT_HEADERS[8], 'iPhones – handed out today');
  assert.equal(REPORT_HEADERS[25], 'Surge protectors – damaged / not working');
  assert.equal(REPORT_HEADERS[30], 'Anything else we should know about today?');
  assert.equal(REPORT_HEADERS.filter((x) => x.includes('–')).length, 18);
  assert.equal(REPORT_HEADERS.some((x) => x.includes('—')), false);
});

test('checks: people required, counts whole and not negative, hours from 0 to 24 per person, accepted within delivered, an answer', () => {
  assert.ok(checkReport(full()).report);
  assert.equal(checkReport(full({ people: undefined })).error, 'report_people');
  assert.equal(checkReport(full({ people: -1 })).error, 'report_people');
  assert.equal(checkReport(full({ people: 1.5 })).error, 'report_people');
  assert.equal(checkReport(full({ phones: { out: -1 } })).error, 'report_counts');
  assert.equal(checkReport(full({ sets: 2.5 })).error, 'report_counts');
  assert.equal(checkReport(full({ surge: { working: '3' } })).error, 'report_counts');
  assert.equal(checkReport(full({ delivered: 48.01, accepted: null })).error, 'report_hours');   // 2 people: 48 h at most
  assert.ok(checkReport(full({ delivered: 48, accepted: 48 })).report);
  assert.equal(checkReport(full({ delivered: -1 })).error, 'report_hours');
  assert.equal(checkReport(full({ delivered: '7' })).error, 'report_hours');
  assert.equal(checkReport(full({ delivered: 5, accepted: 6 })).error, 'report_hours');
  assert.equal(checkReport(full({ people: 0, delivered: 1 })).error, 'report_hours');
  assert.equal(checkReport(full({ allOk: undefined })).error, 'report_answer');
  assert.equal(checkReport(full({ allOk: 'yes' })).error, 'report_answer');
  // hours left empty stay unknown, never 0; decimals are kept to two places
  const r = checkReport(full({ delivered: '', accepted: undefined })).report;
  assert.deepEqual([r.delivered, r.accepted], [null, null]);
  assert.equal(checkReport(full({ delivered: 7.333, accepted: null })).report.delivered, 7.33);
  // an unknown count is empty in the row, not 0
  const row = reportRow({ lead: { name: 'X' }, city: '' }, { t: 't', day: '2026-11-16', leadName: 'L', report: checkReport(full({ sets: null, delivered: null })).report });
  assert.equal(row.length, 31);
  assert.deepEqual([row[6], row[26]], ['', '']);
});

test('the form opens prefilled: people and phones from the phones on site, the site and the person filling it in', async (t) => {
  const { read } = await setup(t);
  const r = await read();
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.prefill, { people: 2, phones: 2, name: 'Taller El Faro', city: 'Colón', lead: 'ana Rep' });
  assert.equal(r.json.day, '2026-11-16');
  assert.equal(r.json.report, null);
});

test('one report per site and local day: a second one the same day replaces the first, both stay in the log', async (t) => {
  const { s, send, read, sync, reports } = await setup(t);
  const one = await send(full());
  assert.equal(one.status, 200);
  assert.equal(one.json.report.report.people, 2);
  assert.ok(one.json.me.active.find((x) => x.id === 's_report-0001').report, 'Mis sitios activos says today is sent');
  s.time.now = MON_10 + 3600000;
  const two = await send(full({ people: 3, notes: 'Corrección' }));
  assert.equal(two.status, 200);
  assert.equal(reports().length, 2);
  assert.equal((await read()).json.report.report.notes, 'Corrección');
  const out = await sync();
  assert.equal(out.json.rows.length, 1);
  assert.equal(out.json.rows[0][5], 3);
  assert.equal(out.json.ids[0], `s_report-0001|2026-11-16|${reports()[1].id}`);
  // the next day is a new row
  s.time.now = MON_10 + 86400000;
  assert.equal((await read()).json.report, null);
  await send(full());
  assert.equal((await sync()).json.rows.length, 2);
});

test('who may send it: the site rep and a manager; another rep, a leader and a site not yet live are refused', async (t) => {
  const { s, a, beto, send, read } = await setup(t);
  assert.deepEqual([(await send(full(), beto.cookie)).status, (await read(beto.cookie)).status], [403, 403]);
  assert.equal((await send(full(), beto.cookie, 's_missing-0001')).json.error, 'not_yours');   // a rep cannot probe ids
  assert.equal((await send(full(), a.cookie, 's_missing-0001')).status, 404);
  assert.equal((await send(full(), a.cookie)).status, 200);
  const lead = await s.call('POST', `${API}/reps`, { email: 'lia@equipo.test', name: 'Lia Liderazgo', role: 'leader' }, { cookie: a.cookie });
  assert.equal(lead.status, 200);
  const leaderCookie = s.as('lia@equipo.test');
  const w = await send(full(), leaderCookie), r = await read(leaderCookie);
  assert.deepEqual([w.status, w.json.error, r.status], [403, 'read_only', 403]);
  // the token route is the token's only
  assert.equal((await s.call('GET', `${API}/sitereports`, undefined, { cookie: leaderCookie })).status, 401);
  assert.equal((await s.call('GET', `${API}/sitereports`, undefined, { cookie: a.cookie })).status, 401);
});

test('a site that is not installed takes no report', async (t) => {
  const { send, reports } = await setup(t, { installed: false });
  const r = await send(full());
  assert.deepEqual([r.status, r.json.error], [409, 'not_live']);
  assert.equal(reports().length, 0);
});

test('a refused report appends nothing', async (t) => {
  const { send, reports } = await setup(t);
  const r = await send(full({ delivered: 100 }));
  assert.deepEqual([r.status, r.json.error], [400, 'report_hours']);
  assert.equal(reports().length, 0);
});

test('a practice site takes reports for a demo and never reaches the export', async (t) => {
  const { s, a, sync } = await setup(t);
  const made = await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie });
  const prac = made.json.id;
  await s.call('POST', `${API}/site`, { id: 's_practice-0001', rep: prac, lead: { name: 'Sitio de práctica' } }, { cookie: a.cookie });
  assert.equal((await s.call('POST', `${API}/site/s_practice-0001`, { what: 'installed' }, { cookie: a.cookie })).status, 200);
  // a manager acting as the practice rep, and the manager on their own screens
  assert.equal((await s.call('POST', `${API}/site/s_practice-0001/report?as=${prac}`, full(), { cookie: a.cookie })).status, 200);
  assert.equal((await s.call('POST', `${API}/site/s_practice-0001/report`, full(), { cookie: a.cookie })).status, 200);
  // while acting, a real site is not the practice rep's to report
  assert.equal((await s.call('POST', `${API}/site/s_report-0001/report?as=${prac}`, full(), { cookie: a.cookie })).status, 403);
  assert.equal(s.lines().filter((e) => e.type === 'site.report').length, 2);
  assert.equal((await sync()).json.rows.length, 0);
});

test('the export: 31 values in the sheet order, the headers with it, Yes or No, empty for unknown, and since filtering', async (t) => {
  const { s, send, sync, reports } = await setup(t);
  await send(full({ accepted: null, sets: null, allOk: true }));
  const out = await sync();
  assert.equal(out.status, 200);
  assert.deepEqual(out.json.headers, [...REPORT_HEADERS]);
  assert.deepEqual(Object.keys(out.json).sort(), ['headers', 'ids', 'ok', 'rows', 'since', 'until']);
  const row = out.json.rows[0];
  assert.equal(row.length, 31);
  assert.deepEqual(row.slice(0, 8), [reports()[0].t, 'Taller El Faro 2026-11-16', '2026-11-16', 'Taller El Faro, Colón', 'ana Rep', 2, 9.5, '']);
  assert.deepEqual(row.slice(8, 12), [2, 2, 0, 2]);
  assert.deepEqual(row.slice(24, 31), [1, 0, '', 'Yes', 'Una batería no carga', 'Una batería', 'Todo bien']);
  // since: a sync after the report sees nothing new; a change after it comes back with a new event id
  const mark = new Date(MON_10 + 60000).toISOString();
  assert.equal((await sync(mark)).json.rows.length, 0);
  s.time.now = MON_10 + 120000;
  await send(full({ allOk: false }));
  const again = await sync(mark);
  assert.equal(again.json.rows.length, 1);
  assert.equal(again.json.rows[0][27], 'No');
  assert.equal(again.json.since, mark);
  assert.equal(again.json.ids[0].split('|').slice(0, 2).join('|'), out.json.ids[0].split('|').slice(0, 2).join('|'));
  assert.notEqual(again.json.ids[0], out.json.ids[0]);
  assert.equal((await s.call('GET', `${API}/sitereports`)).status, 401);
});

test('a report survives a restart: the log replays it', async (t) => {
  const { s, send } = await setup(t);
  await send(full());
  s.srv.close();
  const again = await start({ dir: s.dir, clock: MON_10 }); t.after(() => again.srv.close());
  const out = await again.call('GET', `${API}/sitereports`, undefined, { bearer: 'push-token' });
  assert.equal(out.json.rows.length, 1);
});

test('after midnight the report can still be for yesterday, until noon; it never takes the next day\'s place', async (t) => {
  const { s, send, read, sync } = await setup(t);
  // Monday 16 Nov 10:00 Panama is the helper's clock; move to Tuesday 00:30 Panama (05:30 UTC)
  s.time.now = Date.parse('2026-11-17T05:30:00Z');
  const open = await read();
  assert.deepEqual(open.json.days, ['2026-11-17', '2026-11-16']);
  assert.equal(open.json.day, '2026-11-17');
  const late = await send({ ...full(), day: '2026-11-16' });
  assert.equal(late.status, 200, late.text);
  assert.equal(late.json.day, '2026-11-16');
  // the real Tuesday report that evening is its own row
  s.time.now = Date.parse('2026-11-17T23:00:00Z');
  assert.deepEqual((await read()).json.days, ['2026-11-17']);
  assert.equal((await send({ ...full({ people: 1, phones: { out: 1, back: 1, broken: 0, working: 1 } }) })).status, 200);
  const rows = (await sync()).json.rows;
  assert.deepEqual(rows.map((r) => r[2]).sort(), ['2026-11-16', '2026-11-17']);
  // after noon, yesterday is closed; a day that is neither is refused, never stored
  assert.equal((await send({ ...full(), day: '2026-11-16' })).json.error, 'day');
  assert.equal((await send({ ...full(), day: '2026-11-20' })).json.error, 'day');
});
