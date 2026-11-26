// A business on the phone: whose it is, its stage, when its next step is due, its last contact, the links that call,
// write or map it, the Para hoy card and the card's controls in each mode. The server computes the rows and the card
// and stays the judge; these only decide the words and what the screen offers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STAGE_CODE, ownerLine, stageLine, dueLine, lastLine, telHref, waHref, mapsHref, readPath, todoCard, followStop, cardModel, heldAsk, stopPreset, sectionOf, BOOK_LISTS, hoyLine, ownerWords, stillHere, assignList, donePreset, listsAfter, dueText, modeOf, readOnlyOf } from '../team/biz-steps.js';
import { DICT } from '../team/i18n.js';

/** A row as GET leads sends it. */
const row = (id, over = {}) => ({ id, name: `Taller ${id}`, zone: 'Centro', known: true, stage: 'Contacted', free: false, owner: { name: 'Mateo', mine: true }, next: { day: '2026-11-16', step: 'Volver a visitar' }, lost: null, lastDay: '2026-11-13', lastKind: 'talk', workers: 12, walkin: 8, ...over });
/** A card as GET biz/<id> sends it. */
const card = (over = {}) => ({
  ...row('PA-0001'), city: 'Panama City', type: 'Workshop', industry: 'Auto repair', category: '', address: 'Calle 50', maps: '', website: 'https://taller.example',
  contact: 'Ana Ruiz', title: 'Dueña', phone: '+507 6000-0000', email: 'ana@taller.example', rating: 4.6, reviews: null, notes: '   ', q: null,
  history: [{ day: '2026-11-13', who: 'Mateo', mine: true, kind: 'talk', channel: 'visit', tag: null, note: '', crm: false }],
  route: null, can: { next: true, release: true, assign: false }, ...over,
});
const keysIn = (v, out = []) => {
  if (Array.isArray(v)) v.forEach((x) => keysIn(x, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) { if (k === 'key' && typeof x === 'string') out.push(x); else keysIn(x, out); }
  return out;
};

test('each CRM stage has its code and its words', () => {
  assert.deepEqual(STAGE_CODE, { New: 'new', Contacted: 'contacted', 'Intro call booked': 'booked', 'Intro call done': 'done', 'Contract sent': 'sent', 'Contract signed': 'signed', 'Setup day set': 'setup', Live: 'live', Lost: 'lost', Waitlist: 'waitlist' });
  for (const code of Object.values(STAGE_CODE)) assert.ok(DICT.es[`biz.stage.${code}`], code);
  assert.deepEqual(stageLine('Intro call booked'), { key: 'biz.stage.booked' });
  assert.deepEqual(stageLine('  Something the CRM added '), { text: 'Something the CRM added' }, 'a stage the app does not know shows as the CRM wrote it');
  for (const s of [null, undefined, '', '  ']) assert.equal(stageLine(s), null);
});

test('whose it is, and when its next step is due', () => {
  assert.deepEqual(ownerLine({ owner: { name: 'Mateo', mine: false } }), { key: 'biz.own.other', name: 'Mateo' });
  assert.deepEqual(ownerLine({ owner: { name: 'Mateo', mine: true } }), { key: 'biz.own.mine' });
  assert.deepEqual(ownerLine({ owner: null, free: true }), { key: 'biz.own.free' });
  assert.deepEqual(ownerLine({ owner: { name: 'Mateo', mine: false }, free: true }), { key: 'biz.own.free' }, 'a lapsed owner is free');
  assert.deepEqual(dueLine({ day: '2026-11-13', step: 'x' }, '2026-11-16'), { key: 'biz.due.late', n: 3 });
  assert.deepEqual(dueLine({ day: '2026-11-16', step: 'x' }, '2026-11-16'), { key: 'biz.due.today' });
  assert.deepEqual(dueLine({ day: '2026-11-20', step: 'x' }, '2026-11-16'), { key: 'biz.due.on', day: '2026-11-20' });
  assert.deepEqual(dueLine({ day: '2026-10-31', step: 'x' }, '2026-11-02'), { key: 'biz.due.late', n: 2 }, 'across a month');
  for (const n of [null, undefined, {}, { day: 'tomorrow' }]) assert.equal(dueLine(n, '2026-11-16'), null);
});

test('the last contact: the newest of the history, else what the row knows', () => {
  assert.deepEqual(lastLine(card()), { who: 'Mateo', mine: true, kind: 'talk', day: '2026-11-13', crm: false, step: 'Volver a visitar' });
  assert.deepEqual(lastLine(card({ history: [], lastDay: '2026-10-02', lastKind: null, next: null })), { who: null, mine: false, kind: null, day: '2026-10-02', crm: true, step: null });
  assert.deepEqual(lastLine(row('PA-1', { lastDay: '2026-11-10', lastKind: 'call' })), { who: null, mine: false, kind: 'call', day: '2026-11-10', crm: false, step: 'Volver a visitar' });
  assert.equal(lastLine(card({ history: [], lastDay: null, lastKind: null })), null);
  assert.equal(lastLine(null), null);
});

test('the links: a phone number calls or writes, an address maps, and nothing unsafe gets through', () => {
  assert.equal(telHref('+507 6000-0000'), 'tel:+50760000000');
  assert.equal(telHref('6000-0000'), 'tel:60000000');
  assert.equal(telHref('123'), null);
  assert.equal(telHref(''), null); assert.equal(telHref(null), null); assert.equal(telHref(60000000), null);
  assert.equal(waHref('6000-0000'), 'https://wa.me/50760000000');
  assert.equal(waHref('+507 6000-0000'), 'https://wa.me/50760000000');
  assert.equal(waHref('+57 300 123 4567'), 'https://wa.me/573001234567');
  assert.equal(waHref('223-4567'), null, 'seven digits is a landline: no WhatsApp');
  assert.equal(waHref(null), null);
  assert.equal(mapsHref({ maps: 'javascript:x', address: 'Calle 50', city: 'Panama City' }), 'https://www.google.com/maps/search/?api=1&query=Calle%2050%2C%20Panama%20City');
  assert.equal(mapsHref({ maps: 'https://maps.google.com/?cid=1', address: 'Calle 50' }), 'https://maps.google.com/?cid=1');
  assert.equal(mapsHref({ maps: '', address: 'Calle 50', city: '' }), 'https://www.google.com/maps/search/?api=1&query=Calle%2050');
  assert.equal(mapsHref({ maps: '', address: '', city: 'Panama City' }), null);
  assert.equal(mapsHref(null), null);
});

test('a read made through view-as names whose screens it reads; the other modes send the path as it is', () => {
  assert.equal(readPath('biz/PA-0001', 'view', 'r_mateo'), 'biz/PA-0001?as=r_mateo');
  assert.equal(readPath('leads?list=due&offset=30', 'view', 'r 1'), 'leads?list=due&offset=30&as=r%201');
  assert.equal(readPath('leads?list=due&as=r_mateo', 'view', 'r_mateo'), 'leads?list=due&as=r_mateo');
  assert.equal(readPath('biz/PA-0001', 'self', null), 'biz/PA-0001');
  assert.equal(readPath('biz/PA-0001', 'practice', 'r_prac'), 'biz/PA-0001', 'practice is left to api()');
});

test('Para hoy: three due rows first, else free businesses, else nothing; the follow-up stop names the oldest', () => {
  const due = ['A', 'B', 'C', 'D', 'E'].map((id) => row(id));
  const c = todoCard({ due, soon: [], counts: { overdue: 4, today: 1, soon: 0, nonext: 0, owned: 9 } }, []);
  assert.deepEqual([c.mode, c.rows.map((r) => r.id), c.more, c.late, c.today], ['due', ['A', 'B', 'C'], 2, 4, 1]);
  const f = todoCard({ due: [], soon: [], counts: { overdue: 0, today: 0, soon: 0, nonext: 0, owned: 0 } }, [row('F1', { free: true, owner: null }), row('F2', { free: true, owner: null })]);
  assert.deepEqual([f.mode, f.rows.map((r) => r.id), f.more], ['free', ['F1', 'F2'], 0]);
  assert.equal(todoCard({ due: [], counts: {} }, []).mode, 'empty');
  assert.equal(todoCard(null, null).mode, 'empty');
  assert.deepEqual(followStop({ due: [{ name: 'Taller Uno', next: { step: 'Volver a visitar' } }] }), { name: 'Taller Uno', step: 'Volver a visitar' });
  assert.equal(followStop({ due: [] }), null);
  assert.equal(followStop(null), null);
  assert.equal(followStop({ due: [{ name: 'Taller Uno', next: null }] }), null);
});

test('the card offers what the mode allows, and lists only the facts the CRM has', () => {
  const self = cardModel(card(), 'self');
  assert.deepEqual(self.acts, { call: 'tel:+50760000000', wa: 'https://wa.me/50760000000', map: 'https://www.google.com/maps/search/?api=1&query=Calle%2050%2C%20Panama%20City', log: true });
  assert.deepEqual([self.next, self.release, self.reopen, self.assign], [{ has: true, done: true, move: true }, true, false, false]);
  const view = cardModel(card({ can: { next: true, release: true, assign: true }, stage: 'Lost' }), 'view');
  assert.deepEqual([view.acts.log, view.next, view.release, view.reopen, view.assign], [false, { has: true, done: false, move: false }, false, false, false]);
  assert.equal(view.acts.call, 'tel:+50760000000', 'reading still calls');
  const other = cardModel(card({ owner: { name: 'Jose', mine: false }, can: { next: false, release: false, assign: false } }), 'self');
  assert.deepEqual([other.next, other.release, other.acts.log], [{ has: true, done: false, move: false }, false, true]);
  const lost = cardModel(card({ stage: 'Lost', next: null }), 'practice');
  assert.deepEqual([lost.next, lost.reopen], [{ has: false, done: false, move: true }, true]);
  assert.equal(cardModel(card({ stage: 'Waitlist', can: { next: false, release: true, assign: true } }), 'self').reopen, true, 'a manager reopens');
  assert.equal(cardModel(card({ can: { next: false, release: true, assign: true } }), 'self').assign, true);
  // Facts: the CRM's, in a fixed order, the empty ones left out, a link only where it is safe.
  assert.deepEqual(self.facts.map((f) => f.key), ['biz.f.contact', 'biz.f.title', 'biz.f.phone', 'biz.f.email', 'biz.f.address', 'biz.f.industry', 'biz.f.website', 'biz.f.type', 'biz.f.workers', 'biz.f.walkin', 'biz.f.rating']);
  const fact = (k) => self.facts.find((f) => f.key === `biz.f.${k}`);
  assert.deepEqual(fact('phone'), { key: 'biz.f.phone', value: '+507 6000-0000', href: 'tel:+50760000000' });
  assert.deepEqual(fact('email'), { key: 'biz.f.email', value: 'ana@taller.example', href: 'mailto:ana@taller.example' });
  assert.deepEqual(fact('website'), { key: 'biz.f.website', value: 'https://taller.example', href: 'https://taller.example/' });
  assert.deepEqual(fact('workers'), { key: 'biz.f.workers', value: 12 });
  assert.equal(cardModel(card({ website: 'javascript:alert(1)' }), 'self').facts.find((f) => f.key === 'biz.f.website').href, undefined);
  assert.deepEqual(cardModel(card({ workers: 0 }), 'self').facts.find((f) => f.key === 'biz.f.workers'), { key: 'biz.f.workers', value: 0 }, 'zero is a value the CRM has');
  // Every key a model returns exists.
  const models = [self, view, lost, ownerLine({ owner: null }), ownerLine({ owner: { name: 'M', mine: true } }), ownerLine({ owner: { name: 'M', mine: false } }),
    dueLine({ day: '2026-11-13' }, '2026-11-16'), dueLine({ day: '2026-11-16' }, '2026-11-16'), dueLine({ day: '2026-11-20' }, '2026-11-16'), ...Object.keys(STAGE_CODE).map(stageLine)];
  for (const k of keysIn(models)) assert.ok(k in DICT.es, k);
});

test('a meeting that should have happened asks about itself, oldest first, with its time', () => {
  const pending = [
    { logId: 'a', code: 'meeting_held', held: false, when: '2026-11-25', lead: { id: 'EJ-1', name: 'Uno' } },
    { logId: 'b', code: 'meeting_held', held: false, when: '2026-11-26', lead: { id: 'EJ-2', name: 'Dos' } },
    { logId: 'c', code: 'meeting_held', held: false, when: '2026-11-27', lead: { id: 'EJ-3', name: 'Tres' } },   // not yet
    { logId: 'd', code: 'meeting_held', held: true, when: '2026-11-24', lead: { id: 'EJ-4', name: 'Cuatro' } },   // already said
    { logId: 'e', code: 'contract_sent', held: false, when: '2026-11-20', lead: { id: 'EJ-5', name: 'Cinco' } },
    { logId: 'f', code: 'meeting_held', held: false, when: null, lead: { id: 'EJ-6', name: 'Seis' } },
  ];
  const meetings = [{ logId: 'b', lead: { id: 'EJ-2', name: 'Dos' }, when: '2026-11-26', time: '10:30', contact: null }];
  assert.deepEqual(heldAsk(pending, meetings, '2026-11-26').map((m) => [m.logId, m.name, m.when, m.time]), [['a', 'Uno', '2026-11-25', null], ['b', 'Dos', '2026-11-26', '10:30']]);
  assert.deepEqual(heldAsk(null, null, '2026-11-26'), []);
});

test("the stop's button opens the sheet with that stop's results first and marked", () => {
  assert.deepEqual(stopPreset(0), { first: ['talk', 'absent'] });
  assert.deepEqual(stopPreset(1), { first: ['talk', 'call'] });
  assert.equal(stopPreset(2), null);
  assert.equal(stopPreset(3), null);
});

test('Mis negocios: each list says what it holds, whether there is more, and what it says when empty', () => {
  const rows30 = Array.from({ length: 30 }, (_, i) => row(`EJ-${i}`));
  const due = sectionOf('due', { leads: rows30, total: 41 }, 30);
  assert.deepEqual([due.key, due.rows.length, due.more, due.empty], ['bk.sec.due', 30, true, 'bk.empty.due']);
  assert.equal(sectionOf('due', { leads: rows30, total: 41 }, 41).more, false);
  const none = sectionOf('free', { leads: [], total: 0 }, 0);
  assert.deepEqual([none.rows, none.more, none.empty], [[], false, 'bk.empty.free']);
  assert.deepEqual(sectionOf('soon', null, 0).rows, []);
  assert.deepEqual(BOOK_LISTS, ['due', 'soon', 'nonext', 'free']);
  for (const l of BOOK_LISTS) assert.ok(DICT.es[`bk.sec.${l}`] && DICT.es[`bk.empty.${l}`]);
});

// Fix round 1 (A1): Hoy says who to see before the illustration, in one line, when something is due.
test('the line of Para hoy above the stage: the first business due and how late, and how many more', () => {
  const T = '2026-11-26';
  const late = row('A', { name: 'Taller Uno', next: { day: '2026-11-24', step: 'Volver a llamar' } });
  const today = row('B', { name: 'Taller Dos', next: { day: T, step: 'Volver a visitar' } });
  const agenda = (due, counts = {}, meetings = []) => ({ due, soon: [], meetings, counts: { overdue: 0, today: 0, ...counts } });
  assert.deepEqual(hoyLine(agenda([late, today, row('C'), row('D')], { overdue: 3, today: 1 }), [], T), { key: 'bk.line.late', name: 'Taller Uno', n: 2, more: 3 });
  assert.deepEqual(hoyLine(agenda([today], { today: 1 }), [], T), { key: 'bk.line.today', name: 'Taller Dos', n: null, more: 0 }, 'one alone has no "y N más"');
  assert.deepEqual(hoyLine(agenda([late], { overdue: 9 }), [], T).more, 8, 'the counts know more than the rows sent');
  assert.equal(hoyLine(agenda([]), [], T), null, 'nothing due: no line');
  assert.equal(hoyLine(null, null, T), null);
  // a meeting that should have happened counts as due; when it is the oldest thing the line asks about it
  const held = (logId, when, id, name) => ({ logId, code: 'meeting_held', held: false, when, lead: { id, name } });
  const asked = hoyLine(agenda([late, today], { overdue: 1, today: 1 }), [held('m1', '2026-11-23', 'M', 'Carpintería Sol')], T);
  assert.deepEqual(asked, { key: 'bk.held.ask', name: 'Carpintería Sol', n: null, more: 2 });
  assert.deepEqual(hoyLine(agenda([late]), [held('m1', '2026-11-25', 'M', 'Carpintería Sol')], T), { key: 'bk.line.late', name: 'Taller Uno', n: 2, more: 1 }, 'an older due business leads');
  assert.deepEqual(hoyLine(agenda([]), [held('m1', T, 'M', 'Carpintería Sol')], T), { key: 'bk.held.ask', name: 'Carpintería Sol', n: null, more: 0 }, 'the question alone');
  // the meeting asked about is counted once, not again as its due row
  const meetingRow = row('M', { name: 'Carpintería Sol', next: { day: '2026-11-23', step: 'Reunión con quien decide' } });
  assert.deepEqual(hoyLine(agenda([meetingRow, late], { overdue: 2 }), [held('m1', '2026-11-23', 'M', 'Carpintería Sol')], T), { key: 'bk.held.ask', name: 'Carpintería Sol', n: null, more: 1 });
  for (const k of ['bk.line.late', 'bk.line.today', 'bk.line.more', 'bk.held.ask']) assert.ok(k in DICT.es && k in DICT.en, k);
});

// Fix round 1 (A4): a meeting asked as "¿Se hizo la reunión con X?" shows once on Para hoy.
test('Para hoy leaves out of its due rows the business whose meeting it asks about', () => {
  const asked = [{ logId: 'm1', id: 'M', name: 'Carpintería Sol', when: '2026-11-25', time: null }];
  const due = [row('M'), row('A'), row('B'), row('C'), row('D')];
  const c = todoCard({ due, counts: { overdue: 5, today: 0 } }, [], asked);
  assert.deepEqual([c.mode, c.rows.map((r) => r.id), c.more], ['due', ['A', 'B', 'C'], 1]);
  const only = todoCard({ due: [row('M')], counts: { overdue: 1, today: 0 } }, [row('F', { free: true, owner: null })], asked);
  assert.deepEqual([only.mode, only.rows], ['due', []], 'only the meeting is due: no free list under the question, no row');
  assert.deepEqual(todoCard({ due, counts: { overdue: 5 } }, []).rows.map((r) => r.id), ['M', 'A', 'B'], 'nothing asked: as before');
});

// Fix round 1 (A5): the question says the meeting's hour for a past meeting too.
test('a past meeting asks about itself with its own hour, when the pending item carries it', () => {
  const pending = [{ logId: 'a', code: 'meeting_held', held: false, when: '2026-11-24', time: '09:15', lead: { id: 'EJ-1', name: 'Uno' } },
    { logId: 'b', code: 'meeting_held', held: false, when: '2026-11-25', lead: { id: 'EJ-2', name: 'Dos' } },
    { logId: 'c', code: 'meeting_held', held: false, when: '2026-11-25', time: 'late', lead: { id: 'EJ-3', name: 'Tres' } }];
  const meetings = [{ logId: 'b', when: '2026-11-25', time: '10:30' }, { logId: 'c', when: '2026-11-25', time: '11:00' }];
  assert.deepEqual(heldAsk(pending, meetings, '2026-11-25').map((m) => [m.logId, m.time]), [['a', '09:15'], ['b', '10:30'], ['c', '11:00']]);
  // the shape GET me sends now: every pending item carries time (HH:MM or null), the agenda only today's and later
  const real = [{ logId: 'p', code: 'meeting_held', held: false, when: '2026-11-20', time: '16:45', lead: { id: 'EJ-9', name: 'Nueve' } },
    { logId: 'q', code: 'meeting_held', held: false, when: '2026-11-21', time: null, lead: { id: 'EJ-8', name: 'Ocho' } }];
  assert.deepEqual(heldAsk(real, [], '2026-11-25').map((m) => [m.logId, m.time]), [['p', '16:45'], ['q', null]], "a past meeting's hour shows in the question");
});

// Fix round 1 (B5): a free business says, before saving, that logging it makes it the rep's.
test('the strip says a free business will be the rep\'s, except for bad data', () => {
  const free = { owner: null, free: true };
  assert.deepEqual(ownerWords(free, 'talk'), { key: 'biz.own.free.take' });
  assert.deepEqual(ownerWords(free, null), { key: 'biz.own.free.take' }, 'any result but bad data takes it');
  assert.deepEqual(ownerWords(free, 'baddata'), { key: 'biz.own.free' }, '"Dato malo" takes nothing');
  assert.deepEqual(ownerWords({ owner: { name: 'Omar', mine: false }, free: true }, 'call'), { key: 'biz.own.free.take' }, 'lapsed is free');
  assert.deepEqual(ownerWords({ owner: { name: 'Omar', mine: false } }, 'call'), { key: 'biz.own.other', name: 'Omar' });
  assert.deepEqual(ownerWords({ owner: { name: 'Andrea', mine: true } }, 'call'), { key: 'biz.own.mine' });
  assert.equal(DICT.es['biz.own.free.take'], 'Libre · si lo registras, lo llevas tú');
  assert.equal(DICT.en['biz.own.free.take'], 'Free · log it and it is yours');
});

// Fix round 1 (C3): a late answer never moves the rep: a card opens only on the screen it was tapped from, and only for
// the last tap.
test('a card opens only when the rep is still where they tapped', () => {
  assert.equal(stillHere({ n: 3, tab: 'book' }, { n: 3, tab: 'book' }), true);
  assert.equal(stillHere({ n: 3, tab: 'book' }, { n: 3, tab: 'today' }), false, 'Back or another tab meanwhile');
  assert.equal(stillHere({ n: 3, tab: 'book' }, { n: 4, tab: 'book' }), false, 'a newer tap');
  assert.equal(stillHere(null, { n: 1, tab: 'book' }), false);
});

// Fix round 1 (C4): "Dárselo a otro vendedor" leaves the holder out by id when the card carries it.
test('the reps a business can be given to leave its holder out, by id when the card has it', () => {
  const reps = [{ id: 'r1', name: 'Omar Díaz', city: 'Panamá' }, { id: 'r2', name: 'Omar Ruiz', city: 'Panamá' }, { id: 'r3', name: 'Luis Paz', city: 'Panamá' }, { id: 'r4', name: 'Ana Sol', city: 'Colón' }];
  const biz = (owner, over = {}) => ({ city: 'Panamá', free: false, owner, ...over });
  assert.deepEqual(assignList(reps, biz({ id: 'r1', name: 'Omar' })).map((r) => r.id), ['r2', 'r3'], 'two reps called Omar: only the holder leaves');
  assert.deepEqual(assignList(reps, biz({ name: 'Omar' })).map((r) => r.id), ['r3'], 'no id: by first name, as before');
  assert.deepEqual(assignList(reps, biz(null)).map((r) => r.id), ['r1', 'r2', 'r3']);
  assert.deepEqual(assignList(reps, biz({ id: 'r1', name: 'Omar' }, { free: true })).map((r) => r.id), ['r1', 'r2', 'r3'], 'free: anyone of the city');
  assert.deepEqual(assignList(reps, biz(null, { city: '' })).map((r) => r.id), ['r1', 'r2', 'r3', 'r4']);
  assert.deepEqual(assignList(null, biz(null)), []);
  // the card as GET biz/<id> sends it to a manager: owner { id, name } with name as a first name
  const card = { id: 'EJ-1', city: 'Panamá', free: false, owner: { id: 'r2', name: 'Omar', mine: false } };
  assert.deepEqual(assignList(reps, card).map((r) => r.id), ['r1', 'r3'], 'the holder is left out by id');
});

// Fix round 1 (C5): "Hecho" opens the log sheet ready for that step.
test('"Hecho" puts first the results that do the step, for the table\'s own sentences in either language', () => {
  for (const lang of ['es', 'en']) {
    const d = DICT[lang];
    // every result's default step but "Visité, no estaba" is done by calling: talk, call, noanswer, message, reply, contract
    for (const k of ['schedule', 'follow', 'recall', 'check', 'answer', 'sign']) assert.deepEqual(donePreset(d[`nx.step.${k}`]), { first: ['call', 'noanswer'] }, `${lang} ${k}`);
    assert.deepEqual(donePreset(d['nx.step.revisit']), { first: ['talk', 'absent'] }, lang);
    for (const k of ['meeting', 'retry']) assert.equal(donePreset(d[`nx.step.${k}`]), null, `${lang} ${k}`);
  }
  assert.deepEqual(donePreset('  Volver a llamar '), { first: ['call', 'noanswer'] }, 'as the CRM may space it');
  assert.equal(donePreset('Llevar el contrato a la dueña'), null, 'a step the rep wrote');
  assert.equal(donePreset(null), null);
});

// Fix round 1 (C2): a list that could not be read says so; it never looks empty.
test('Mis negocios after a read: what failed is marked, a list read before for the same person is kept', () => {
  const ok = (n) => ({ status: 'fulfilled', value: { leads: Array.from({ length: n }, (_, i) => ({ id: `x${i}` })), total: n } });
  const no = { status: 'rejected', reason: { code: 'offline' } };
  const a = listsAfter([ok(2), no, ok(0), no], null);
  assert.deepEqual([a.lists.due.total, a.lists.nonext.total, [...a.failed].sort(), a.none], [2, 0, ['free', 'soon'], false]);
  assert.equal(a.lists.soon, null);
  const kept = listsAfter([no, no, no, no], { due: { leads: [], total: 0 }, soon: { leads: [], total: 3 }, nonext: null, free: null });
  assert.deepEqual([kept.lists.soon.total, [...kept.failed].sort(), kept.none], [3, ['due', 'free', 'nonext', 'soon'], false], 'kept, but still marked: the screen offers to read again');
  assert.equal(listsAfter([no, no, no, no], null).none, true, 'nothing read and nothing kept: one line for the screen');
  for (const k of ['bk.failed', 'bk.retry', 'bk.offline']) assert.ok(DICT.es[k] && DICT.en[k], k);
});

// Fix round 1 (C6): when a next step is due is worded once, for the card and the lists.
test('dueText and the mode helpers live once', () => {
  const t = (k, v) => `${k}|${v.n ?? ''}|${v.date ?? ''}`, dm = (d) => `dm(${d})`;
  assert.equal(dueText({ day: '2026-11-23' }, '2026-11-25', t, dm), 'biz.due.late|2|');
  assert.equal(dueText({ day: '2026-11-27' }, '2026-11-25', t, dm), 'biz.due.on||dm(2026-11-27)');
  assert.equal(dueText(null, '2026-11-25', t, dm), '');
  assert.equal(modeOf({ as: null, me: { viewer: { role: 'rep' }, me: { id: 'r1' } } }), 'self');
  assert.equal(readOnlyOf({ as: null, me: { viewer: { role: 'rep' }, me: { id: 'r1' } } }), false);
});
