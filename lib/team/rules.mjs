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
  levels: [
    { name: 'aprendizaje', steps: [0, 250, 600] },
    { name: 'oficio', steps: [1000, 1500, 2200] },
    { name: 'maestria', steps: [3000, 4200, 5600] },
    { name: 'mentoria', steps: [7500, 10000, 13000] },
  ],
};

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
