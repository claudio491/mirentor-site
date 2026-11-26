// rules.mjs: the season's rules as data, plus the date helpers every derivation uses.
// Numbers come from the design spec (docs/superpowers/specs/2026-11-16-mirentor-sales-team-platform-design.md).
// They are a first proposal: change them here, between seasons, and nowhere else.

export const RULES = {
  season: 's0',
  points: { visit: 3, conversation: 5, followup: 2, message: 1, reply: 3, meetingBooked: 5, meetingHeld: 10, contractSent: 10, contractSigned: 20, siteSigned: 40, siteInstalled: 30, siteFirstHour: 30, dayClosedOnTime: 2 },
  caps: { messagesPerDay: 10 },
  habits: { visits: 1, conversations: 2, followups: 1 },
  goals: { visits: 5, conversations: 10, meetings: 3, contracts: 1 },   // the CRM's Rep Scorecard, for a five-day week
  closeBy: '19:00',
  pendingDays: 14,          // a pending part that nobody confirms in this many days pays nothing
  pendingSignDays: 30,      // the signature part of a contract waits longer
  newRepDays: 14,
  streakSpares: 2,
  teamMeetingsPerRep: 2,
  lateMinutes: 10,          // device time further than this from the server's is flagged
  ownerLapseDays: 30,       // a business whose owner has not contacted it in more than this, with no next step ahead, is free
  nextAheadDays: 365,       // how far ahead a next step may be dated
  nextStepMax: 140,         // how long a next step's words may be
  meetingsAheadDays: 6,      // the manager's "Reuniones de hoy y de la semana": today and this many days after it
  stalledMeetingDays: 2,    // "Trabados": a meeting more than this many days past its date that nobody marked held
  stalledContractDays: 7,   // ...and a contract logged more than this many days ago with no signature
  stalledSnoozeDays: 7,     // "Sigue viva" hides it this long
  missedStep: 'Reagendar la reunión',   // the holder's next step after "No ocurrió" on a meeting
  missedStepContract: 'Retomar el contrato',   // ...and on a contract
  // why a business is lost, in the reps' own words (team/i18n.js, biz.reason.<code>)
  lostReasons: ['no_trust', 'privacy', 'union_hr', 'small_team', 'desk_work', 'no_wifi_lead', 'not_priority', 'went_quiet', 'other'],
  levels: [
    { name: 'aprendizaje', steps: [0, 250, 600] },
    { name: 'oficio', steps: [1000, 1500, 2200] },
    { name: 'maestria', steps: [3000, 4200, 5600] },
    { name: 'mentoria', steps: [7500, 10000, 13000] },
  ],
};

/** What a rep writes as the day's blocker when there is none (accents and case aside): no blocker at all. */
export const NO_BLOCKER = ['', 'ninguno', 'ninguna', 'nada', 'no', 'none', 'n/a'];

/** App channel codes and the CRM's Channel dropdown values. */
export const CHANNELS = { visit: 'In-person visit', call: 'Phone call', whatsapp: 'WhatsApp message', linkedin: 'LinkedIn message', email: 'Email', sms: 'SMS' };

/** What a rep can log. `channels[0]` is the default; `outcome` answers the CRM's Outcome dropdown value. */
export const KINDS = {
  talk: { channels: ['visit'], visit: true, conversation: true, followup: true, outcome: () => 'Visited, spoke with owner' },
  absent: { channels: ['visit'], visit: true, followup: true, outcome: () => 'Visited, owner not there' },
  call: { channels: ['call'], conversation: true, followup: true, outcome: () => 'Call answered' },
  noanswer: { channels: ['call'], outcome: (l) => (l.voicemail ? 'Left voicemail' : 'No answer') },
  message: { channels: ['whatsapp', 'linkedin', 'email', 'sms'], message: true, outcome: (l, ch) => ({ email: 'Email sent', sms: 'Sent SMS' }[ch] || 'Message sent') },
  reply: { channels: ['whatsapp', 'linkedin', 'email', 'sms', 'call'], reply: true, followup: true, outcome: () => 'Replied' },
  // A meeting booked means the rep spoke with whoever decides. In person it is also a visit.
  meeting: { channels: ['visit', 'call', 'whatsapp'], conversation: true, meeting: true, followup: true, visitOn: 'visit', outcome: () => 'Meeting booked' },
  // A contract is a lead stage in the CRM, not an activity row.
  contract: { channels: [], contract: true, outcome: () => null },
  baddata: { channels: ['call', 'email'], outcome: (l, ch) => (ch === 'email' ? 'Bounced' : 'Wrong number') },
};

const kindOf = (kind) => {
  const k = Object.hasOwn(KINDS, kind) ? KINDS[kind] : null;
  if (!k) throw new Error(`unknown kind: ${kind}`);
  return k;
};

export function channelOf(kind, channel) {
  const k = kindOf(kind);
  return k.channels.includes(channel) ? channel : k.channels[0] ?? null;
}

export function crmRow(log) {
  const k = kindOf(log.kind);
  const ch = channelOf(log.kind, log.channel);
  const outcome = k.outcome(log, ch);
  return outcome ? { channel: CHANNELS[ch], outcome } : null;
}

export function flagsOf(log) {
  const k = kindOf(log.kind);
  const ch = channelOf(log.kind, log.channel);
  return {
    visit: !!k.visit || (!!k.visitOn && ch === k.visitOn),
    conversation: !!k.conversation, followup: !!k.followup, message: !!k.message, reply: !!k.reply, meeting: !!k.meeting, contract: !!k.contract,
  };
}

// ---- dates: a "day" is a local calendar day 'YYYY-MM-DD' in the rep's time zone ----

const dayFmt = new Map();
const fmtFor = (tz) => {
  if (!dayFmt.has(tz)) dayFmt.set(tz, new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }));
  return dayFmt.get(tz);
};
const parts = (iso, tz) => Object.fromEntries(fmtFor(tz).formatToParts(new Date(iso)).map((p) => [p.type, p.value]));

export function localDay(iso, tz) { const p = parts(iso, tz); return `${p.year}-${p.month}-${p.day}`; }
export function localMinutes(iso, tz) { const p = parts(iso, tz); return Number(p.hour) * 60 + Number(p.minute); }

const utc = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
const fromUtc = (ms) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (day, n) => fromUtc(utc(day) + n * 86400000);
/** A real calendar day written YYYY-MM-DD: 2026-11-31 is not one. */
export const isCalendarDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(utc(v)) && fromUtc(utc(v)) === v;
/** The last minute of a local day (23:59 there), as an instant. A row that carries only its day (one from the CRM) is
 *  filed at this minute so it sorts after everything done that day; the minute is never shown, only the day. */
export function dayEndIso(day, tz) {
  const want = utc(day) + 86400000 - 60000;
  let ms = want;
  for (let i = 0; i < 3; i += 1) {
    const p = parts(new Date(ms).toISOString(), tz);
    const wall = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
    if (wall === want) break;
    ms += want - wall;
  }
  return new Date(ms).toISOString();
}
export const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
/** 1 = Monday ... 7 = Sunday. */
/** Hours are whole minutes, 0 to 100000. */
export const validMinutes = (n) => Number.isInteger(n) && n >= 0 && n <= 100000;
export const isoWeekday = (day) => new Date(utc(day)).getUTCDay() || 7;
export const weekStart = (day) => addDays(day, 1 - isoWeekday(day));
export const monthStart = (day) => `${day.slice(0, 8)}01`;

/** A smaller team shows a smaller podium, so the last places are never spelled out. */
/** A time zone this runtime knows. Any other name would throw on every date a rep's numbers need. */
export function validTz(tz) {
  if (typeof tz !== 'string' || !tz) return false;
  try { new Intl.DateTimeFormat('en-CA', { timeZone: tz }); return true; } catch { return false; }
}

/** When a rep may pick the weekly goal: on Monday for the week that just started, from Friday to Sunday for the next one. */
export function goalWindow(today) {
  const wd = isoWeekday(today), ws = weekStart(today);
  return wd === 1 ? { which: 'this', week: ws } : wd >= 5 ? { which: 'next', week: addDays(ws, 7) } : null;
}

export const podiumSize = (n) => (n >= 7 ? 3 : n >= 4 ? 2 : n >= 1 ? 1 : 0);

/** A new rep's first days, in order. The app ticks most of them from what the rep does; the rest are ticked by hand. */
export const LADDER = ['video', 'kit', 'whatsapp', 'zones', 'talk', 'report', 'meeting', 'contract', 'install', 'hour'];
/** The three steps the rep ticks. `hour` is a manager's; the others the app reads from the log. */
export const SELF_STEPS = ['video', 'kit', 'whatsapp'];
/** Training videos by key. A URL when the video exists, null until then. */
export const VIDEOS = { welcome: null, pitch: null, hours: null, logging: null, install: null, faq: null };
/** The video that explains each step. */
export const STEP_VIDEO = { video: 'welcome', talk: 'pitch', report: 'logging', install: 'install', hour: 'hours' };
/** The Scorecard's goal for its Accepted Hours row; the Scorecard does not state the period there. It is the
 *  Scorecard's number, not one this app sets: the leadership view shows it as a reference, attributed to the Scorecard.
 *  Change it here when the Scorecard changes. */
export const SCORECARD_ACCEPTED_GOAL_HOURS = 3750;

// ---- a business's next step and how it is closed (biz.mjs reads and re-exports these) ----

/** The tags that close a business: stage Lost, with a reason. "No llamar" also takes it off every list. */
export const LOST_TAGS = ['not_fit', 'not_interested', 'do_not_call'];

/** A next step as a log or a card sends it, judged against `today` (the writer's day): `{}` when none was sent, `{ next:
 *  null }` to clear it, `{ next: { day, step } }`, or `{ error: 'next' }`. The day runs from today to a year ahead, the
 *  step from 1 to 140 characters. The reducer judges each event again with this, against the event's own day. */
export function checkNext(v, today) {
  if (v === undefined) return {};
  if (v === null) return { next: null };
  if (!v || typeof v !== 'object' || Array.isArray(v)) return { error: 'next' };
  const words = typeof v.step === 'string' ? v.step.replace(/\s+/g, ' ').trim() : '';
  if (!isCalendarDay(v.day) || v.day < today || v.day > addDays(today, RULES.nextAheadDays) || !words || words.length > RULES.nextStepMax) return { error: 'next' };
  return { next: { day: v.day, step: words } };
}

// ---- a business's qualification: how many work with their hands, Wi-Fi, and who coordinates (biz.mjs re-exports) ----

/** The three rows and the answers each takes. None is required: a log may send any of them. */
export const QUAL = { workers: ['lt10', '10_29', '30_49', '50plus'], wifi: ['yes', 'no', 'unknown'], lead: ['yes', 'no', 'unknown'] };
/** The results that are a conversation with the business: the only logs that carry a qualification. */
export const QUAL_KINDS = ['talk', 'call', 'meeting', 'contract'];
/** The lower bound of each workers' range: the number the CRM's Hands-on workers cell gets when it is empty. */
export const WORKERS_FLOOR = { lt10: 1, '10_29': 10, '30_49': 30, '50plus': 50 };

/** A qualification as a log or the reducer reads it: only the listed rows with a listed answer; null when none is left. */
export function checkQ(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
  const out = {};
  for (const k of Object.keys(QUAL)) if (QUAL[k].includes(v[k])) out[k] = v[k];
  return Object.keys(out).length ? out : null;
}
/** The answers a business keeps: per row, the latest wins, except that "unknown" never replaces a yes or a no. */
export function mergeQ(had, got) {
  const out = { ...(had || {}) };
  for (const [k, v] of Object.entries(got || {})) {
    if (v === 'unknown' && (out[k] === 'yes' || out[k] === 'no')) continue;
    out[k] = v;
  }
  return out;
}
/** Whether a business qualifies: Wi-Fi and someone who coordinates, both yes. A no on either does not; otherwise it is
 *  missing the rows that are not yes. */
export function qualOf(q) {
  const wifi = q?.wifi, lead = q?.lead;
  if (wifi === 'yes' && lead === 'yes') return { state: 'yes', missing: [] };
  if (wifi === 'no' || lead === 'no') return { state: 'no', missing: [] };
  return { state: 'missing', missing: [['wifi', wifi], ['lead', lead]].filter(([, v]) => v !== 'yes').map(([k]) => k) };
}
