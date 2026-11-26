// next-steps.js: the next step a result proposes, the quick days of the picker, and the client's check of a next step.
// No page and no imports: the log sheet and the business card draw what these decide. The server checks again and stays the judge.

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_STEP = 140, MAX_AHEAD = 365;

/** A calendar day as a UTC date, or null when it is not a real day. */
function toDate(day) {
  if (typeof day !== 'string' || !DAY.test(day)) return null;
  const d = new Date(`${day}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== day ? null : d;
}
const fromDate = (d) => d.toISOString().slice(0, 10);

/** The day n calendar days after `day`. */
export function addDays(day, n) {
  const d = toDate(day);
  if (!d) return null;
  d.setUTCDate(d.getUTCDate() + n);
  return fromDate(d);
}

/** The day n working days after `day`, counting only the rep's working days (1 is Monday, 7 or 0 is Sunday).
 *  A day off is not known to the client. With no working day given, the days are calendar days. */
export function addWorkdays(day, n, workdays = [1, 2, 3, 4, 5]) {
  const set = new Set((Array.isArray(workdays) ? workdays : []).map((w) => (w === 7 ? 0 : w)));
  if (!set.size) return addDays(day, n);
  const d = toDate(day);
  if (!d) return null;
  for (let left = n; left > 0;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (set.has(d.getUTCDay())) left -= 1;
  }
  return fromDate(d);
}

// The spec's table: each kind of contact proposes one step, so many working days ahead.
const BY_KIND = {
  talk: ['schedule', 2], absent: ['revisit', 2], call: ['follow', 3], noanswer: ['recall', 1],
  message: ['check', 3], reply: ['answer', 1], meeting: ['meeting', 1], contract: ['sign', 2],
};
const LOST = new Set(['not_fit', 'not_interested', 'do_not_call']);
/** The tags that close a business as Lost, and why it was lost (the server's RULES.lostReasons, in the reps' words). */
export const LOST_TAGS = [...LOST];
export const LOST_REASONS = ['no_trust', 'privacy', 'union_hr', 'small_team', 'desk_work', 'no_wifi_lead', 'not_priority', 'went_quiet', 'other'];

/** What a result proposes as its next step. `key` is the words of the step (nx.step.*) and `day` its day.
 *  `none`: the result closes the business or parks it, so it has no next step (`lost` or `waitlist` says why).
 *  `skip`: the log sends nothing about the next step (bad data). */
export function defaultNext(kind, tag, { today, workdays, when } = {}) {
  const out = (key, day, over = {}) => ({ key, day, none: false, lost: false, waitlist: false, skip: false, ...over });
  if (kind === 'baddata') return out(null, null, { skip: true });
  if (LOST.has(tag)) return out(null, null, { none: true, lost: true });
  if (tag === 'waitlist') return out(null, null, { none: true, waitlist: true });
  if (tag === 'not_now') return out('nx.step.retry', addDays(today, 30));
  if (kind === 'meeting' || tag === 'meeting') return out('nx.step.meeting', toDate(when) ? when : addWorkdays(today, 1, workdays));
  const row = BY_KIND[kind];
  if (!row) return out(null, null, { skip: true });
  return out(`nx.step.${row[0]}`, addWorkdays(today, row[1], workdays));
}

/** The picker's quick days: calendar days from today. */
export const quickDays = (today) => [
  { key: 'nx.q.tomorrow', day: addDays(today, 1) }, { key: 'nx.q.3d', day: addDays(today, 3) },
  { key: 'nx.q.1w', day: addDays(today, 7) }, { key: 'nx.q.1m', day: addDays(today, 30) },
];

/** The server's rules for a next step, with the client's error codes: nothing sent is {}, none is { next: null },
 *  otherwise a real day from today to a year ahead and a step of 1 to 140 characters, trimmed. */
export function checkNext(v, today) {
  if (v === undefined) return {};
  if (v === null) return { next: null };
  if (typeof v !== 'object' || Array.isArray(v)) return { error: 'next_day' };
  const d = toDate(v.day);
  if (!d || v.day < today || v.day > addDays(today, MAX_AHEAD)) return { error: 'next_day' };
  const step = typeof v.step === 'string' ? v.step.trim() : '';
  if (!step || step.length > MAX_STEP) return { error: 'next_step' };
  return { next: { day: v.day, step } };
}

/** "Cómo quedó" in the log sheet. Booking a meeting is the result "Reunión de 20 min agendada", the one that asks for
 *  its date, so the tag "meeting" is not offered (the server still takes it from an older phone). */
export const LOG_TAGS = ['waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call'];

/** Whether the rep's log moves the business: it is theirs, or free (a lapsed holder counts as free). Not known
 *  (offline, or a business added now) is left to the server, which drops what a log on another rep's business carries. */
export function holdsIt(row) {
  if (!row) return true;
  return !row.owner || !!row.free || !!row.owner.mine;
}

/** The next step a result proposes, in words: `{ day, step }`, `null` for none (Lost, Waitlist), or `undefined` when
 *  the log sends nothing about it (bad data). `say(key)` gives the words of a step. */
export function proposeNext(kind, tag, opts, say) {
  const d = defaultNext(kind, tag, opts);
  if (d.skip) return undefined;
  if (d.none) return null;
  return { day: d.day, step: say(d.key) };
}

/** What a log sends about its business: the next step, and Lost with its reason. Only the holder's log (or one that
 *  takes a free business) says anything; a lost tag needs its reason before the log can be saved. */
export function bizFields({ kind, tag, next, reason, holds }) {
  if (!holds || kind === 'baddata') return {};
  if (LOST.has(tag)) return reason ? { next: null, lost: reason } : { error: 'reason' };
  if (tag === 'waitlist') return { next: null };
  return next === undefined ? {} : { next };
}

/** On another rep's business, what a closing tag does there, said under the tags before saving: it stays in that
 *  business's history and closes nothing ('nx.other.tag'), except "No llamar", which takes it off everyone's lists
 *  ('nx.other.dnc'). Null on the rep's own or a free business, for any other tag, and when whose it is is not known. */
export function otherTagLine(row, tag) {
  if (!row || holdsIt(row) || !LOST.has(tag)) return null;
  return { key: tag === 'do_not_call' ? 'nx.other.dnc' : 'nx.other.tag', name: row.owner.name };
}

/** The one line at the foot of the log sheet. Why Guardar waits comes first: no business or result, a lost tag with
 *  no reason (`problem` 'reason'), a next step with no valid day or words ('next_day', 'next_step'); only then what the
 *  log is worth (already logged today, a follow-up or not, a first contact). `follows`: the result can count as a
 *  follow-up; `points`: what a follow-up pays; `closing`: "Cerrar como No califica" is armed, so saving closes the
 *  business, which is said before what the log is worth; `checking`: a new business's near twins are being looked
 *  for, and Guardar waits for the answer. */
export function footHint({ kind, lead, today, problem = null, follows = false, points = 0, closing = false, checking = false }) {
  if (!kind || !lead) return { key: 'log.hint.pick' };
  if (problem === 'reason') return { key: 'nx.lost' };
  if (problem === 'next_day' || problem === 'next_step') return { key: `err.${problem}` };
  if (checking) return { key: 'log.dup.wait' };
  if (closing) return { key: 'qf.notfit.foot' };
  if (!lead.isNew && lead.lastDay === today) return { key: 'log.hint.today' };
  if (!lead.isNew && lead.known && (!lead.lastDay || lead.lastDay < today)) return follows ? { key: 'log.hint.follow', n: points } : { key: 'log.hint.nofollow' };
  return { key: lead.isNew || !lead.known ? 'log.hint.first' : 'log.hint.pick' };
}

/** The contact and the phone: a meeting and a contract always ask; a conversation asks only when the CRM has no
 *  contact for the business yet. Without the card (no signal) nothing extra is asked. */
export function contactAsked(kind, card) {
  if (kind === 'meeting' || kind === 'contract') return true;
  if (kind !== 'talk' && kind !== 'call') return false;
  return !!card && !(typeof card.contact === 'string' && card.contact.trim());
}

/** The body of POST log from what the sheet holds, sending only what is on screen when it is saved: the contact and
 *  the phone when the sheet asks for them (contactAsked, against the card `card`), the date for a meeting or a
 *  contract, the time for a meeting, and what the log says about the business (`about`, from bizFields). Text is
 *  trimmed and an empty field is left out. `lead` is the business picked ({ id }) or a new one ({ isNew }, named by
 *  `newLead`). */
export function logBody({ id, kind, clientAt, lead, newLead = null, channel, voicemail, tag, contact, phone, when, time, note, about = {}, card = null }) {
  const body = { id, kind, clientAt, lead: lead && lead.isNew ? { name: newLead.name, zone: newLead.zone } : { id: lead.id } };
  if (channel) body.channel = channel;
  if (voicemail) body.voicemail = true;
  if (tag) body.tag = tag;
  const typed = { contact, phone, when, note };
  const keys = [...(contactAsked(kind, card) ? ['contact', 'phone'] : []), ...(kind === 'meeting' || kind === 'contract' ? ['when'] : []), 'note'];
  for (const k of keys) { const v = typeof typed[k] === 'string' ? typed[k].trim() : ''; if (v) body[k] = v; }
  if (kind === 'meeting' && typeof time === 'string' && /^\d{2}:\d{2}$/.test(time)) body.time = time;
  if ('next' in about) body.next = about.next;
  if (about.lost) body.lost = about.lost;
  return body;
}
