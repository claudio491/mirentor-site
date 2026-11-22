// example.mjs: the example team, made from one fixed recipe so a manager can show the team's life before real reps have
// any. Four practice reps ("Vendedor A" to "Vendedor D"), two weeks of activity relative to today (last week and this
// one up to now), sites named "Sitio de ejemplo 1" and on, workers "Trabajador 1" and on, IMEI-shaped example texts, the
// example consent placeholder, accepted minutes per site for both weeks and the example rate of US$1.00 per accepted
// hour, which pays practice only. The same clock gives the same events. Everything is written as ordinary events for
// practice reps and practice sites, so every screen shows it through the code real data uses; nothing here is a name,
// a business or a person that exists.
import { deflateSync } from 'node:zlib';
import { localDay, weekStart, addDays, isoWeekday, channelOf } from './rules.mjs';

/** Who the four are: how long they have been on the team, how they work, and the sites they have. One clearly ahead
 *  (A), one new (D). */
const TEAM = [
  { slot: 'A', since: 70, plan: 'ahead', sites: [{ workers: 4, last: 3666, now: 1830 }, { workers: 3, last: 2410, now: 1205 }], contract: 2 },
  { slot: 'B', since: 50, plan: 'steady', sites: [{ workers: 3, last: 1500, now: 640 }], contract: 3 },
  { slot: 'C', since: 35, plan: 'light', sites: [{ workers: 2, last: 700, now: 380 }], contract: null },
  { slot: 'D', since: 3, plan: 'new', sites: [], contract: null },
];
/** A day's logs per way of working, as [kind, local time]. `odd` is for every other day. */
const PLANS = {
  ahead: { even: [['talk', '08:40'], ['talk', '09:30'], ['absent', '10:15'], ['call', '11:00'], ['talk', '14:00'], ['meeting', '15:20']],
    odd: [['talk', '08:30'], ['call', '09:10'], ['talk', '10:40'], ['message', '12:00'], ['talk', '15:00'], ['meeting', '16:10']] },
  steady: { even: [['talk', '09:00'], ['absent', '10:00'], ['call', '11:30'], ['meeting', '15:00']], odd: [['talk', '08:50'], ['call', '11:00'], ['talk', '15:30']] },
  light: { even: [['talk', '08:50'], ['call', '15:30']], odd: [['absent', '09:20']] },
  new: { even: [['talk', '09:40'], ['absent', '11:00']], odd: [['talk', '09:40'], ['absent', '11:00']] },
};
const LEADS = 12;   // businesses per rep: a day visits different ones, and a later day comes back to them (a follow-up)
/** The example rate: US$1.00 per accepted hour, in cents. */
export const EXAMPLE_RATE_CENTS = 100;

/** The UTC instant of a local wall time in a time zone. */
function atLocal(day, hhmm, tz) {
  const [y, m, d] = day.split('-').map(Number), [hh, mm] = hhmm.split(':').map(Number), want = Date.UTC(y, m - 1, d, hh, mm);
  const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  let t = want;
  for (let i = 0; i < 2; i += 1) {
    const p = Object.fromEntries(fmt.formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    t += want - Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  }
  return new Date(t).toISOString();
}

/** The events of the example team, in time order, none after `now`, and the bytes of the consent placeholder. The
 *  consent events carry no version: the caller files the placeholder and writes the version it gets.
 *  What the team did does not depend on the hour of the press: today's moves are all there whether the button is pressed
 *  at 00:30 or at 10:00 (today's report is never in, the day is not over). When the clock has not reached their usual
 *  times yet, today's moves keep their order and are spread between midnight and now, so nothing is ever dated after
 *  now. `recipeDay` on each rep says which day the recipe was made for, so a team from an earlier day can be updated. */
export function exampleTeam({ now, tz = 'America/Panama', country = 'PA', city = '' }) {
  const today = localDay(now, tz), ws = weekStart(today), last = addDays(ws, -7);
  const at = (day, hhmm) => atLocal(day, hhmm, tz);
  const days = [...[0, 1, 2, 3, 4].map((n) => addDays(last, n)), ...[0, 1, 2, 3, 4].map((n) => addDays(ws, n))].filter((d) => d <= today && isoWeekday(d) <= 5);
  const born = at(addDays(last, -1), '08:00');
  const out = [{ type: 'practice.pay.rate', cents: EXAMPLE_RATE_CENTS, from: last, t: born }];
  let siteNo = 0, workerNo = 0;
  for (const who of TEAM) {
    const id = `r_ejemplo-${who.slot.toLowerCase()}`, start = addDays(today, -who.since);
    out.push({ type: 'rep.practice.example', id, slot: who.slot, handle: `ejemplo-${who.slot.toLowerCase()}`, name: `Vendedor ${who.slot}`, country, city, tz, workdays: [1, 2, 3, 4, 5], startDate: start, lang: 'es', recipeDay: today, t: born });
    const lead = (n) => ({ id: `EX-${who.slot}-${String(n + 1).padStart(2, '0')}`, name: `Negocio de ejemplo ${who.slot}${n + 1}`, zone: '' });
    days.forEach((day, i) => {
      if (day < start) return;
      const plan = PLANS[who.plan][i % 2 ? 'odd' : 'even'];
      plan.forEach(([kind, hhmm], j) => {
        const logId = `ex-${who.slot.toLowerCase()}-${day}-${j}`, t = at(day, hhmm), ch = channelOf(kind);
        out.push({ type: 'log', id: logId, rep: id, lead: lead((i * 3 + j) % LEADS), kind, ...(ch ? { channel: ch } : {}), clientAt: null, t });
        // a meeting is held the next day, and a manager confirms it then
        if (kind === 'meeting') out.push({ type: 'confirm', logId, what: 'meeting_held', t: at(addDays(day, 1), '09:00') });
      });
      // the contract of the week: sent the same day, signed two days later
      if (who.contract === i) {
        const logId = `ex-${who.slot.toLowerCase()}-${day}-contract`;
        out.push({ type: 'log', id: logId, rep: id, lead: lead(LEADS - 1), kind: 'contract', clientAt: null, t: at(day, '16:30') },
          { type: 'confirm', logId, what: 'contract_sent', t: at(day, '17:00') }, { type: 'confirm', logId, what: 'contract_signed', t: at(addDays(day, 2), '10:00') });
      }
      // most days end with the report; the light worker forgets one now and then
      if (day < today && !(who.plan === 'light' && i % 3 === 1)) out.push({ type: 'day.close', rep: id, day, tomorrow: 'Seguir con las visitas de la zona', blocker: '', t: at(day, '18:30') });
    });
    // the sites, opened and installed last week: phones, workers with the consent, a phone and a clip, closed, confirmed
    who.sites.forEach((plan, k) => {
      siteNo += 1;
      const siteId = `s_ejemplo-${siteNo}`, day = addDays(last, k), t0 = (hhmm) => at(day, hhmm);
      out.push({ type: 'site', id: siteId, rep: id, lead: { id: `EX-SITE-${siteNo}`, name: `Sitio de ejemplo ${siteNo}` }, city, eligible: plan.workers + 4, practice: true, t: t0('11:00') },
        { type: 'site.phones', siteId, count: plan.workers + 1, t: t0('11:30') }, { type: 'site.prep', siteId, what: 'signs', t: t0('11:40') }, { type: 'site.prep', siteId, what: 'zones', t: t0('11:45') });
      for (let w = 0; w < plan.workers; w += 1) {
        workerNo += 1;
        const wid = `w_ejemplo-${siteNo}-${w + 1}`, mm = String(10 + w * 4).padStart(2, '0');
        out.push({ type: 'worker.added', siteId, id: wid, name: `Trabajador ${workerNo}`, email: `trabajador${workerNo}@ejemplo.test`, phone: true, t: t0(`12:${mm}`) },
          { type: 'worker.consent', workerId: wid, form: 'v1', t: t0(`12:${String(11 + w * 4).padStart(2, '0')}`) },
          { type: 'worker.phone', workerId: wid, imei: `EJEMPLO-${String(workerNo).padStart(4, '0')}`, t: t0(`12:${String(12 + w * 4).padStart(2, '0')}`) },
          { type: 'worker.clip', workerId: wid, t: t0(`12:${String(13 + w * 4).padStart(2, '0')}`) });
      }
      out.push({ type: 'install.close', siteId, t: t0('13:30') }, { type: 'site.step', siteId, what: 'installed', t: at(addDays(day, 1), '08:30') });
      // the accepted minutes of both weeks, as a manager would record them from the buyers' report
      out.push({ type: 'site.hours', siteId, week: last, accepted: plan.last, t: now });
      if (plan.now) out.push({ type: 'site.hours', siteId, week: ws, accepted: plan.now, t: now });
    });
  }
  // today's moves, in their planned order: kept at their usual times once the clock passed them all, otherwise spread
  // between midnight and now; anything planned after today is left out
  const dayStart = at(today, '00:00'), tomorrow = at(addDays(today, 1), '00:00');
  const todays = out.map((e, i) => [e, i]).filter(([e]) => e.type !== 'site.hours' && e.t >= dayStart && e.t < tomorrow).sort(([a, i], [b, j]) => (a.t < b.t ? -1 : a.t > b.t ? 1 : i - j)).map(([e]) => e);
  if (todays.length && todays.at(-1).t > now) {
    const from = Date.parse(dayStart), span = Math.max(0, Date.parse(now) - from);
    todays.forEach((e, k) => { e.t = new Date(from + Math.floor((span * (k + 1)) / (todays.length + 1))).toISOString(); });
  }
  const events = out.filter((e) => e.t <= now).map((e, i) => [e, i]).sort(([a, i], [b, j]) => (a.t < b.t ? -1 : a.t > b.t ? 1 : i - j)).map(([e]) => e);
  return { events, consent: placeholder() };
}

// ---- the example consent placeholder: a drawn page with lines and a signature mark, as a PNG made here ----
const CRC = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc32 = (buf) => { let c = 0xffffffff; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4), crc = Buffer.alloc(4), body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  len.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};
/** A 240 x 320 grey page: a border, ten written lines, a signature stroke near the foot. The same bytes every time. */
export function placeholder() {
  const W = 240, H = 320, rows = [];
  for (let y = 0; y < H; y += 1) {
    const row = Buffer.alloc(1 + W);   // filter byte 0, then one grey byte per pixel
    for (let x = 0; x < W; x += 1) {
      let v = 244;
      if (x < 6 || x >= W - 6 || y < 6 || y >= H - 6) v = 200;
      else if (y >= 40 && y < 240 && (y - 40) % 20 < 3 && x >= 24 && x < W - 24 - ((y / 20) % 3) * 30) v = 168;
      else if (y >= 262 && y < 296 && Math.abs(y - (279 + Math.round(10 * Math.sin(x / 9)))) < 2 && x >= 40 && x < 180) v = 70;
      row[1 + x] = v;
    }
    rows.push(row);
  }
  const head = Buffer.alloc(13);
  head.writeUInt32BE(W, 0); head.writeUInt32BE(H, 4); head[8] = 8; head[9] = 0; head[10] = 0; head[11] = 0; head[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', head), chunk('IDAT', deflateSync(Buffer.concat(rows))), chunk('IEND', Buffer.alloc(0))]);
}
