// The next step on the phone: which step and which day each result proposes, the quick days of the picker, and the
// client's own check of a next step before it is sent. The server stays the judge; this decides what the sheet offers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addWorkdays, defaultNext, quickDays, checkNext, bizFields, contactAsked, LOG_TAGS, LOST_TAGS, LOST_REASONS, holdsIt, proposeNext, footHint, logBody, otherTagLine } from '../team/next-steps.js';
import { DICT } from '../team/i18n.js';

const o = { today: '2026-11-16', workdays: [1, 2, 3, 4, 5] };
const pick = ({ none, waitlist, lost }) => ({ none, waitlist, lost });

test('working days skip the days the rep does not work', () => {
  assert.equal(addWorkdays('2026-11-20', 1), '2026-11-23');               // Friday -> Monday
  assert.equal(addWorkdays('2026-11-20', 1, [1, 2, 3, 4, 5, 6]), '2026-11-21');   // works Saturdays
  assert.equal(addWorkdays('2026-11-21', 1), '2026-11-23');               // from a Saturday
  assert.equal(addWorkdays('2026-12-31', 1), '2027-01-01');
  assert.equal(addWorkdays('2026-11-16', 1, []), '2026-11-17', 'no working days known: calendar days');
});

test('the result proposes the spec\'s next step', () => {
  const at = (kind, tag, today, when) => { const d = defaultNext(kind, tag, { today, workdays: [1, 2, 3, 4, 5], when }); return [d.key, d.day]; };
  assert.deepEqual(at('talk', null, '2026-11-16'), ['nx.step.schedule', '2026-11-18']);
  assert.deepEqual(at('absent', null, '2026-11-20'), ['nx.step.revisit', '2026-11-24']);    // Friday -> Tuesday
  assert.deepEqual(at('call', null, '2026-11-19'), ['nx.step.follow', '2026-11-24']);
  assert.deepEqual(at('noanswer', null, '2026-11-16'), ['nx.step.recall', '2026-11-17']);
  assert.deepEqual(at('message', null, '2026-11-16'), ['nx.step.check', '2026-11-19']);
  assert.deepEqual(at('reply', null, '2026-11-16'), ['nx.step.answer', '2026-11-17']);
  assert.deepEqual(at('meeting', null, '2026-11-16', '2026-11-19'), ['nx.step.meeting', '2026-11-19']);
  assert.deepEqual(at('meeting', null, '2026-11-20'), ['nx.step.meeting', '2026-11-23'], 'a meeting with no date: the next working day');
  assert.deepEqual(at('talk', 'meeting', '2026-11-16', '2026-11-25'), ['nx.step.meeting', '2026-11-25'], 'the meeting tag on a visit');
  assert.deepEqual(at('contract', null, '2026-11-16'), ['nx.step.sign', '2026-11-18']);
  assert.deepEqual(at('call', 'not_now', '2026-11-16'), ['nx.step.retry', '2026-12-16']);
  assert.deepEqual(pick(defaultNext('talk', 'waitlist', o)), { none: true, waitlist: true, lost: false });
  for (const tag of ['not_fit', 'not_interested', 'do_not_call']) assert.deepEqual(pick(defaultNext('call', tag, o)), { none: true, waitlist: false, lost: true });
  for (const d of [defaultNext('talk', 'waitlist', o), defaultNext('call', 'not_fit', o)]) assert.deepEqual([d.key, d.day, d.skip], [null, null, false]);
  assert.equal(defaultNext('baddata', null, o).skip, true);
  assert.deepEqual(pick(defaultNext('talk', null, o)), { none: false, waitlist: false, lost: false });
  for (const k of ['schedule', 'revisit', 'follow', 'recall', 'check', 'answer', 'meeting', 'sign', 'retry']) assert.ok(DICT.es[`nx.step.${k}`]);
});

test('the quick days and the client\'s check agree with the server\'s on the same inputs', async (t) => {
  assert.deepEqual(quickDays('2026-11-16'), [
    { key: 'nx.q.tomorrow', day: '2026-11-17' }, { key: 'nx.q.3d', day: '2026-11-19' }, { key: 'nx.q.1w', day: '2026-11-23' }, { key: 'nx.q.1m', day: '2026-12-16' }]);
  for (const q of quickDays('2026-11-16')) assert.ok(DICT.es[q.key], q.key);
  // The client's own answers, with its error codes.
  assert.deepEqual(checkNext(undefined, '2026-11-16'), {});
  assert.deepEqual(checkNext(null, '2026-11-16'), { next: null });
  assert.deepEqual(checkNext({ day: '2026-11-16', step: '  Volver a visitar ' }, '2026-11-16'), { next: { day: '2026-11-16', step: 'Volver a visitar' } });
  assert.deepEqual(checkNext({ day: '2027-11-16', step: 'x' }, '2026-11-16'), { next: { day: '2027-11-16', step: 'x' } });   // 365 days
  for (const day of ['2026-11-15', '2027-11-17', '17/11/2026', '2026-02-30', '', 20261117]) assert.deepEqual(checkNext({ day, step: 'x' }, '2026-11-16'), { error: 'next_day' }, String(day));
  for (const step of ['', '   ', 'y'.repeat(141), 7, null]) assert.deepEqual(checkNext({ day: '2026-11-17', step }, '2026-11-16'), { error: 'next_step' }, String(step));
  assert.deepEqual(checkNext('2026-11-17', '2026-11-16'), { error: 'next_day' });
  assert.deepEqual(checkNext({ day: '2026-11-17', step: 'y'.repeat(140) }, '2026-11-16').next.step.length, 140);
  // The server's checkNext lives in lib/team/biz.mjs, built on another branch. Until that branch is merged, this part waits.
  let serverCheckNext;
  try { ({ checkNext: serverCheckNext } = await import('../lib/team/biz.mjs')); } catch { /* not merged yet */ }
  if (typeof serverCheckNext !== 'function') { t.skip('lib/team/biz.mjs has no checkNext yet: the comparison with the server runs once the server branch is merged'); return; }
  const cases = [undefined, null, { day: '2026-11-16', step: ' x ' }, { day: '2026-11-15', step: 'x' }, { day: '2027-11-16', step: 'x' }, { day: '2027-11-17', step: 'x' }, { day: '2026-11-17', step: '' }, { day: '2026-11-17', step: 'y'.repeat(141) }, { day: '17/11/2026', step: 'x' }, { day: '2026-02-30', step: 'x' }];
  for (const v of cases) {
    const mine = checkNext(v, '2026-11-16'), theirs = serverCheckNext(v, '2026-11-16');
    assert.equal(!!mine.error, !!theirs.error, JSON.stringify(v));
    if (!mine.error) assert.deepEqual(mine, theirs, JSON.stringify(v));
  }
});

test('what the log sends about the business', () => {
  assert.deepEqual(bizFields({ kind: 'talk', tag: null, next: { day: '2026-11-18', step: 'Llamar' }, holds: true }), { next: { day: '2026-11-18', step: 'Llamar' } });
  assert.deepEqual(bizFields({ kind: 'call', tag: 'not_fit', next: null, reason: null, holds: true }), { error: 'reason' });
  assert.deepEqual(bizFields({ kind: 'call', tag: 'not_fit', next: null, reason: 'no_trust', holds: true }), { next: null, lost: 'no_trust' });
  assert.deepEqual(bizFields({ kind: 'talk', tag: 'waitlist', next: null, holds: true }), { next: null });
  assert.deepEqual(bizFields({ kind: 'baddata', tag: null, next: undefined, holds: true }), {});
  assert.deepEqual(bizFields({ kind: 'talk', tag: null, next: { day: '2026-11-18', step: 'x' }, holds: false }), {});
  assert.deepEqual(bizFields({ kind: 'call', tag: 'do_not_call', next: null, reason: 'other', holds: false }), {}, 'another rep\'s "no llamar" sends no reason: it moves nothing but the lists');
});

test('whose the business is decides what the sheet sends, and its proposal follows the result until the rep changes it', () => {
  assert.equal(holdsIt(null), true, 'offline or a new business: the server judges');
  assert.equal(holdsIt({ free: true, owner: { name: 'Omar', mine: false } }), true, 'lapsed: free again');
  assert.equal(holdsIt({ free: false, owner: { name: 'Andrea', mine: true } }), true);
  assert.equal(holdsIt({ free: false, owner: { name: 'Omar', mine: false } }), false);
  const say = (k) => DICT.es[k];
  assert.deepEqual(proposeNext('talk', null, o, say), { day: '2026-11-18', step: DICT.es['nx.step.schedule'] });
  assert.equal(proposeNext('call', 'not_interested', o, say), null);
  assert.equal(proposeNext('talk', 'waitlist', o, say), null);
  assert.equal(proposeNext('baddata', null, o, say), undefined);
  assert.deepEqual(proposeNext('meeting', null, { ...o, when: '2026-11-20' }, say), { day: '2026-11-20', step: DICT.es['nx.step.meeting'] });
});

test('the sheet asks for a contact and a phone only where it helps, and booking a meeting is a result, not a tag', () => {
  assert.equal(contactAsked('meeting', { contact: 'Sra. Ruiz' }), true);
  assert.equal(contactAsked('contract', null), true);
  assert.equal(contactAsked('talk', { contact: 'Sra. Ruiz' }), false);
  assert.equal(contactAsked('talk', { contact: null }), true);
  assert.equal(contactAsked('call', { contact: '' }), true);
  assert.equal(contactAsked('call', null), false, 'offline: the card is not known, nothing extra is asked');
  assert.equal(contactAsked('absent', { contact: null }), false);
  assert.deepEqual(LOG_TAGS, ['waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call']);
})

test('the lost tags and reasons on the phone are the server\'s', async () => {
  const { RULES, LOST_TAGS: SERVER_TAGS } = await import('../lib/team/rules.mjs');
  assert.deepEqual(LOST_REASONS, RULES.lostReasons);
  assert.deepEqual([...LOST_TAGS].sort(), [...SERVER_TAGS].sort());
});

// Fix round 1 (B2): Guardar never waits in silence. The foot's line says why it waits, before anything else.
test('the foot of the log sheet says why Guardar waits, and a contact note never covers a reason', () => {
  const T = '2026-11-25';
  const known = { id: 'P1', known: true, lastDay: '2026-11-20' };
  assert.deepEqual(footHint({ kind: null, lead: known, today: T }), { key: 'log.hint.pick' });
  assert.deepEqual(footHint({ kind: 'talk', lead: null, today: T }), { key: 'log.hint.pick' });
  assert.deepEqual(footHint({ kind: 'talk', lead: known, today: T, problem: 'next_day', follows: true, points: 2 }), { key: 'err.next_day' });
  assert.deepEqual(footHint({ kind: 'talk', lead: known, today: T, problem: 'next_step', follows: true, points: 2 }), { key: 'err.next_step' });
  assert.deepEqual(footHint({ kind: 'call', lead: known, today: T, problem: 'reason', follows: true, points: 2 }), { key: 'nx.lost' }, 'a lost tag with no reason asks for it');
  assert.deepEqual(footHint({ kind: 'talk', lead: known, today: T, follows: true, points: 2 }), { key: 'log.hint.follow', n: 2 });
  assert.deepEqual(footHint({ kind: 'message', lead: known, today: T, follows: false }), { key: 'log.hint.nofollow' });
  assert.deepEqual(footHint({ kind: 'talk', lead: { ...known, lastDay: T }, today: T, follows: true }), { key: 'log.hint.today' });
  assert.deepEqual(footHint({ kind: 'talk', lead: { isNew: true }, today: T }), { key: 'log.hint.first' });
  assert.deepEqual(footHint({ kind: 'talk', lead: { id: 'P9', known: false }, today: T }), { key: 'log.hint.first' });
  assert.ok(DICT.es['nx.lost'].includes('Elige el motivo'));
});

// Fix round C1 (K1): while "Cerrar como No califica" is armed, the foot says the business closes, before any follow-up hint.
test('the foot says the business closes as not a fit while that close is armed', () => {
  const T = '2026-11-25', known = { id: 'P1', known: true, lastDay: '2026-11-20' };
  assert.deepEqual(footHint({ kind: 'talk', lead: known, today: T, follows: true, points: 2, closing: true }), { key: 'qf.notfit.foot' });
  assert.deepEqual(footHint({ kind: 'talk', lead: { ...known, lastDay: T }, today: T, closing: true }), { key: 'qf.notfit.foot' });
  assert.deepEqual(footHint({ kind: 'call', lead: { isNew: true }, today: T, closing: true }), { key: 'qf.notfit.foot' });
  // with nothing picked it still asks for the pick
  assert.deepEqual(footHint({ kind: null, lead: known, today: T, closing: true }), { key: 'log.hint.pick' });
  assert.equal(DICT.es['qf.notfit.foot'], 'Al guardar, este negocio se cierra como No califica: sin wifi o sin quien coordine.');
  assert.equal(DICT.en['qf.notfit.foot'], 'On save, this business closes as not a fit: no Wi-Fi or nobody to coordinate.');
});

// Fix round 1 (B3): only what is on screen is sent.
test('the log body sends the contact and the phone only when the sheet asks for them', () => {
  const base = { id: 'l1', clientAt: '2026-11-25T15:00:00.000Z', lead: { id: 'P1' }, channel: null, voicemail: false, tag: null, contact: ' Ana Ruiz ', phone: '6000-0000', when: '2026-11-27', time: '10:30', note: ' ojo ', about: {} };
  // typed for a meeting, then the result changed to a visit on a business whose card has a contact: not sent
  assert.deepEqual(logBody({ ...base, kind: 'talk', card: { contact: 'Sra. Ruiz' } }), { id: 'l1', kind: 'talk', clientAt: base.clientAt, lead: { id: 'P1' }, note: 'ojo' });
  assert.deepEqual(logBody({ ...base, kind: 'talk', card: { contact: '' } }), { id: 'l1', kind: 'talk', clientAt: base.clientAt, lead: { id: 'P1' }, contact: 'Ana Ruiz', phone: '6000-0000', note: 'ojo' });
  assert.deepEqual(logBody({ ...base, kind: 'call', card: null }).contact, undefined, 'offline the fields are not asked, so not sent');
  assert.deepEqual(logBody({ ...base, kind: 'meeting', channel: 'visit', card: null, about: { next: { day: '2026-11-27', step: 'Reunión' } } }),
    { id: 'l1', kind: 'meeting', clientAt: base.clientAt, lead: { id: 'P1' }, channel: 'visit', contact: 'Ana Ruiz', phone: '6000-0000', when: '2026-11-27', note: 'ojo', time: '10:30', next: { day: '2026-11-27', step: 'Reunión' } });
  assert.equal(logBody({ ...base, kind: 'contract', card: null }).time, undefined, 'a time is a meeting\'s');
  assert.equal(logBody({ ...base, kind: 'absent', card: { contact: '' } }).when, undefined);
  assert.deepEqual(logBody({ ...base, kind: 'call', tag: 'not_fit', card: { contact: 'x' }, about: { next: null, lost: 'no_trust' } }),
    { id: 'l1', kind: 'call', clientAt: base.clientAt, lead: { id: 'P1' }, tag: 'not_fit', note: 'ojo', next: null, lost: 'no_trust' });
  assert.deepEqual(logBody({ ...base, kind: 'noanswer', voicemail: true, lead: { isNew: true }, newLead: { name: 'Taller Nuevo', zone: 'Centro' }, card: null, note: '' }),
    { id: 'l1', kind: 'noanswer', clientAt: base.clientAt, lead: { name: 'Taller Nuevo', zone: 'Centro' }, voicemail: true });
});

// Fix round 1 (B5): on another rep's business a closing tag says it does not close it.
test('a closing tag on another rep\'s business says what it does there', () => {
  const omar = { owner: { name: 'Omar', mine: false }, free: false };
  assert.deepEqual(otherTagLine(omar, 'not_fit'), { key: 'nx.other.tag', name: 'Omar' });
  assert.deepEqual(otherTagLine(omar, 'not_interested'), { key: 'nx.other.tag', name: 'Omar' });
  assert.deepEqual(otherTagLine(omar, 'do_not_call'), { key: 'nx.other.dnc', name: 'Omar' }, '"No llamar" does take it off every list');
  assert.equal(otherTagLine(omar, 'waitlist'), null);
  assert.equal(otherTagLine(omar, null), null);
  assert.equal(otherTagLine({ owner: { name: 'Andrea', mine: true } }, 'not_fit'), null, 'the rep\'s own');
  assert.equal(otherTagLine({ owner: { name: 'Omar', mine: false }, free: true }, 'not_fit'), null, 'free');
  assert.equal(otherTagLine(null, 'not_fit'), null, 'not known: the server judges');
  for (const k of ['nx.other.tag', 'nx.other.dnc']) assert.ok(DICT.es[k] && DICT.en[k], k);
  assert.equal(DICT.es['nx.other.dnc'].replace('{name}', 'Omar'), 'Lo lleva Omar. "No llamar" lo saca de las listas de todos.');
});

// Fix round C1 (K5): while the twins of a new business are looked for, the foot says so instead of dimming in silence.
test('the foot says it is checking whether the business already exists', () => {
  const T = '2026-11-25';
  assert.deepEqual(footHint({ kind: 'talk', lead: { isNew: true }, today: T, checking: true }), { key: 'log.dup.wait' });
  assert.deepEqual(footHint({ kind: null, lead: { isNew: true }, today: T, checking: true }), { key: 'log.hint.pick' });
  assert.equal(DICT.es['log.dup.wait'], 'Buscando si ya existe…');
  assert.equal(DICT.en['log.dup.wait'], 'Checking whether it already exists…');
});
