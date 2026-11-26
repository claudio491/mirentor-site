// The business overlay: who holds a business, its next step and its stage, kept as events over the CRM's row. Pure:
// the state is built with applyEvent and the views are read from biz.mjs, with no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, applyEvent } from '../lib/team/state.mjs';
import { RULES } from '../lib/team/rules.mjs';
import { bizIndex, holderOf, bizView, rowOf, logEffect, checkNext, LOST_TAGS, OPEN_STAGES, STAGE_LADDER } from '../lib/team/biz.mjs';

const NOW = '2026-11-16T15:00:00Z';   // Monday 10:00 in Panama
const at = (day) => `${day}T15:00:00Z`;
const REPS = [
  { type: 'rep.created', id: 'r_marta', handle: 'marta', email: 'marta@ejemplo.test', name: 'Marta Pineda', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: at('2026-10-01') },
  { type: 'rep.created', id: 'r_jose', handle: 'jose', email: 'jose@ejemplo.test', name: 'Jose Blanco', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: at('2026-10-01') },
  { type: 'rep.created', id: 'r_boss', handle: 'jefe', email: 'jefe@ejemplo.test', name: 'Jefe Uno', role: 'manager', city: 'Panama City', tz: 'America/Panama', t: at('2026-10-01') },
  { type: 'rep.created', id: 'r_rita', handle: 'rita', email: 'rita@ejemplo.test', name: 'Rita Lopez', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: at('2026-10-01') },
  { type: 'rep.updated', id: 'r_rita', patch: { active: false }, t: at('2026-11-01') },
];
const world = (events = []) => { const s = emptyState(); for (const e of [...REPS, ...events]) applyEvent(s, e); return s; };
const LEAD = { id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New' };
const lead = (over = {}) => ({ ...LEAD, ...over });
const ctxOf = (state, l) => ({ now: NOW, index: bizIndex(state, new Map([[l.id, l]])) });
const held = (over, events = []) => { const s = world(events), l = lead(over); return holderOf(s, l, ctxOf(s, l)); };
const pick = (h) => ({ rep: h.rep, free: h.free, lapsed: h.lapsed });
const viewOf = (state, l) => bizView(state, l, ctxOf(state, l));
let n = 0;
const log = (rep, over = {}) => ({ type: 'log', id: `log-${String((n += 1)).padStart(6, '0')}`, rep, lead: { id: 'PA-0001', name: 'Taller Uno', zone: 'Centro' }, kind: 'talk', t: NOW, ...over });

test('the rules name the lapse, the reasons, how far ahead and how long a step', () => {
  assert.deepEqual([RULES.ownerLapseDays, RULES.nextAheadDays, RULES.nextStepMax], [30, 365, 140]);
  assert.deepEqual(RULES.lostReasons, ['no_trust', 'privacy', 'union_hr', 'small_team', 'desk_work', 'no_wifi_lead', 'not_priority', 'went_quiet', 'other']);
  assert.deepEqual(LOST_TAGS, ['not_fit', 'not_interested', 'do_not_call']);
  assert.deepEqual(OPEN_STAGES, ['New', 'Contacted', 'Intro call booked', 'Intro call done']);
  assert.deepEqual(STAGE_LADDER, ['New', 'Contacted', 'Intro call booked', 'Intro call done', 'Contract sent', 'Contract signed']);
});

test('free: no owner, "Libre (correo automático)", someone not on the team, a manager, a rep who left', () => {
  for (const owner of [undefined, 'Libre (correo automático)', 'Otra Persona', 'Jefe Uno', 'Rita Lopez']) {
    assert.deepEqual(pick(held({ owner, lastContact: '2026-11-10' })), { rep: null, free: true, lapsed: false }, String(owner));
  }
  assert.equal(held({ owner: 'Marta Pineda', lastContact: '2026-11-10' }).rep.id, 'r_marta');
  assert.equal(held({ owner: 'marta pineda', lastContact: '2026-11-10' }).free, false);
  // a name two people on the team answer to is a guess: free
  const twin = { type: 'rep.created', id: 'r_marta2', handle: 'marta2', email: 'marta2@ejemplo.test', name: 'Marta Pineda', role: 'rep', city: 'Panama City', tz: 'America/Panama', t: at('2026-10-02') };
  assert.deepEqual(pick(held({ owner: 'Marta Pineda', lastContact: '2026-11-10' }, [twin])), { rep: null, free: true, lapsed: false });
  // a holder taken off the team holds nothing
  assert.deepEqual(pick(held({ owner: 'Marta Pineda', lastContact: '2026-11-10' }, [{ type: 'rep.updated', id: 'r_marta', patch: { active: false }, t: at('2026-11-12') }])), { rep: null, free: true, lapsed: false });
});

test('ownership lapses after more than 30 days without the owner\'s contact and with no next step ahead', () => {
  assert.equal(held({ owner: 'Marta Pineda', lastContact: '2026-10-17' }).rep.id, 'r_marta');   // 30 days
  assert.deepEqual(pick(held({ owner: 'Marta Pineda', lastContact: '2026-10-16' })), { rep: null, free: true, lapsed: true });   // 31 days
  assert.equal(held({ owner: 'Marta Pineda', lastContact: '2026-10-16', nextDay: '2026-11-16', nextStep: 'Volver' }).rep.id, 'r_marta');
  assert.equal(held({ owner: 'Marta Pineda', lastContact: '2026-10-16', nextDay: '2026-11-13', nextStep: 'Volver' }).free, true);
  // a take in the app is day zero
  const gave = (day) => [{ type: 'biz.owner', lead: 'PA-0001', owner: 'r_marta', by: 'r_boss', t: at(day) }];
  assert.equal(held({}, gave('2026-10-17')).rep.id, 'r_marta');
  assert.equal(held({}, gave('2026-10-16')).lapsed, true);
  // the owner's own log on the business counts; another rep's does not
  assert.equal(held({ owner: 'Marta Pineda', lastContact: '2026-10-01' }, [log('r_marta', { t: at('2026-11-02') })]).rep.id, 'r_marta');
  assert.equal(held({ owner: 'Marta Pineda', lastContact: '2026-10-01' }, [log('r_jose', { t: at('2026-11-02') })]).free, true);
  // an owner in the CRM with no date at all
  assert.deepEqual(pick(held({ owner: 'Marta Pineda' })), { rep: null, free: true, lapsed: true });
});

test('a log that takes a free business makes it the rep\'s, with its next step over the CRM\'s', () => {
  const s = world([log('r_jose', { holds: true, took: true, next: { day: '2026-11-18', step: 'Llamar para agendar la reunión' } })]);
  const v = viewOf(s, lead({ nextDay: '2026-11-20', nextStep: 'Otro paso' }));
  assert.deepEqual([v.holder.id, v.free, v.next, v.stage], ['r_jose', false, { day: '2026-11-18', step: 'Llamar para agendar la reunión' }, 'Contacted']);
  assert.deepEqual(s.biz.get('PA-0001').owner, { rep: 'r_jose', by: 'r_jose', t: NOW });
  assert.equal(s.biz.get('PA-0001').at, NOW);
});

test('logEffect: free takes, the holder moves it, another rep moves nothing, Dato malo takes nothing', () => {
  const s = world(), marta = s.reps.get('r_marta'), jose = s.reps.get('r_jose');
  const freeView = viewOf(s, lead()), martasView = viewOf(s, lead({ owner: 'Marta Pineda', lastContact: '2026-11-10' }));
  assert.deepEqual(logEffect(freeView, jose, 'talk'), { holds: true, took: true, owned: null });
  assert.deepEqual(logEffect(martasView, marta, 'call'), { holds: true, took: false, owned: null });
  assert.deepEqual(logEffect(martasView, jose, 'talk'), { holds: false, took: false, owned: { name: 'Marta' } });
  assert.deepEqual(logEffect(freeView, jose, 'baddata'), { holds: false, took: false, owned: null });
  // a practice rep never takes a real business
  assert.deepEqual(logEffect(freeView, { ...jose, practice: true }, 'talk'), { holds: false, took: false, owned: null });
});

test('a log on another rep\'s business moves nothing on it', () => {
  const s = world([log('r_jose', { next: { day: '2026-11-18', step: 'Mío' }, tag: 'not_interested', lost: 'no_trust', contact: 'Ana Ruiz', phone: '6000-0000' })]);
  assert.equal(s.biz.size, 0);
});

test('Lost with its reason, Waitlist, and a later result opens it again', () => {
  const s = world([log('r_marta', { holds: true, next: { day: '2026-11-18', step: 'Volver' } }), log('r_marta', { holds: true, kind: 'talk', tag: 'not_interested', lost: 'no_trust', next: null })]);
  const crm = lead({ owner: 'Marta Pineda', lastContact: '2026-11-10' });
  let v = viewOf(s, crm);
  assert.deepEqual([v.stage, v.lost, v.next, v.waitlist], ['Lost', { reason: 'no_trust' }, null, false]);
  applyEvent(s, log('r_marta', { holds: true, kind: 'call', channel: 'call' }));
  v = viewOf(s, crm);
  assert.deepEqual([v.stage, v.lost], ['Contacted', null]);
  applyEvent(s, log('r_marta', { holds: true, kind: 'talk', tag: 'waitlist', next: null }));
  v = viewOf(s, crm);
  assert.deepEqual([v.stage, v.waitlist, v.lost, v.next], ['Waitlist', true, null, null]);
  // a lost tag forces the next step away, even if the line carried one
  const t = world([log('r_marta', { holds: true, tag: 'not_fit', lost: 'small_team', next: { day: '2026-11-18', step: 'x' } })]);
  assert.deepEqual([viewOf(t, crm).stage, viewOf(t, crm).next], ['Lost', null]);
  // the CRM at Lost: a reopen (lost: null) brings it back to Contacted; a meeting raises it to Intro call booked
  const u = world([log('r_marta', { holds: true, lost: null })]);
  assert.equal(viewOf(u, lead({ owner: 'Marta Pineda', lastContact: '2026-11-10', stage: 'Lost' })).stage, 'Contacted');
  assert.equal(viewOf(world([log('r_marta', { kind: 'meeting' })]), crm).stage, 'Intro call booked');
  assert.equal(viewOf(world([log('r_marta', { kind: 'meeting' })]), lead({ stage: 'Contract sent' })).stage, 'Contract sent');
});

test('No llamar from any rep marks the business; voiding that log takes the mark back', () => {
  const dnc = log('r_jose', { tag: 'do_not_call' });
  const s = world([dnc]);
  const crm = lead({ owner: 'Marta Pineda', lastContact: '2026-11-10' });
  assert.deepEqual([viewOf(s, crm).dnc, viewOf(s, crm).holder.id], [true, 'r_marta']);
  applyEvent(s, { type: 'log.void', logId: dnc.id, by: 'r_boss', reason: 'otro negocio', t: NOW });
  assert.equal(viewOf(s, crm).dnc, false);
  assert.equal(viewOf(world(), lead({ doNotCall: true })).dnc, true);   // the CRM's own flag
});

test('replay checks each new event again: a bad next, an unknown reason or a foreign field changes nothing', () => {
  const s = world([log('r_marta', { holds: true, took: true, next: { day: '2026-11-18', step: 'Volver' } })]);
  const before = structuredClone(s.biz.get('PA-0001'));
  for (const e of [
    log('r_marta', { holds: true, next: { day: '2026-02-30', step: 'x' } }),
    log('r_marta', { holds: true, next: { day: '2026-11-17', step: 'x'.repeat(141) } }),
    log('r_marta', { holds: true, next: 'mañana' }),
    log('r_marta', { holds: true, tag: 'not_interested', lost: 'bored' }),
    log('r_marta', { holds: true, contact: { a: 1 }, phone: 6000 }),
    log('r_marta', { holds: true, owner: 'r_jose', synced: ['next'] }),
    { type: 'biz.owner', lead: 'PA-0001', owner: 'r_nobody', by: 'r_boss', t: NOW },
    { type: 'biz.owner', lead: 'PA-0001', owner: 'r_boss', by: 'r_boss', t: NOW },
    { type: 'biz.next', lead: 'PA-0001', rep: 'r_marta', next: { day: '2026-11-01', step: 'x' }, t: NOW },
    { type: 'biz.synced', lead: 'PA-0001', fields: ['bogus'], t: NOW },
  ]) applyEvent(s, e);
  assert.deepEqual(s.biz.get('PA-0001'), before);
  assert.equal(world([log('r_marta')]).biz.size, 0, 'a log without the new fields leaves state.biz empty');
});

test('a manager releases or gives a business, a reopen opens it, and a synced field goes back to the CRM\'s cell', () => {
  const s = world([log('r_marta', { holds: true, took: true, next: { day: '2026-11-18', step: 'Volver' } })]);
  const crm = lead({ nextDay: '2026-11-25', nextStep: 'Del CRM' });
  applyEvent(s, { type: 'biz.synced', lead: 'PA-0001', fields: ['next'], t: at('2026-11-17') });
  assert.equal(s.biz.get('PA-0001').at, NOW, 'synced does not change at');
  assert.deepEqual(viewOf(s, crm).next, { day: '2026-11-25', step: 'Del CRM' });
  applyEvent(s, { type: 'biz.next', lead: 'PA-0001', rep: 'r_marta', next: { day: '2026-11-19', step: 'Llamar' }, t: at('2026-11-16') });
  assert.deepEqual([viewOf(s, crm).next, s.biz.get('PA-0001').synced.has('next')], [{ day: '2026-11-19', step: 'Llamar' }, false]);
  applyEvent(s, { type: 'biz.owner', lead: 'PA-0001', owner: 'r_jose', by: 'r_boss', t: NOW });
  assert.equal(viewOf(s, crm).holder.id, 'r_jose');
  applyEvent(s, { type: 'biz.owner', lead: 'PA-0001', owner: null, by: 'r_boss', t: NOW });
  assert.deepEqual([viewOf(s, crm).holder, viewOf(s, crm).free, viewOf(s, crm).lapsed], [null, true, false]);
  applyEvent(s, { type: 'biz.reopen', lead: 'PA-0001', by: 'r_boss', t: NOW });
  assert.equal(viewOf(s, lead({ stage: 'Waitlist' })).stage, 'Contacted');
});

test('checkNext', () => {
  assert.deepEqual(checkNext(undefined, '2026-11-16'), {});
  assert.deepEqual(checkNext(null, '2026-11-16'), { next: null });
  assert.deepEqual(checkNext({ day: '2026-11-16', step: '  Volver a visitar ' }, '2026-11-16'), { next: { day: '2026-11-16', step: 'Volver a visitar' } });
  assert.deepEqual(checkNext({ day: '2027-11-16', step: 'x' }, '2026-11-16').next.day, '2027-11-16');   // 365 days
  for (const bad of [{ day: '2026-11-15', step: 'x' }, { day: '2027-11-17', step: 'x' }, { day: '2026-11-17', step: '' }, { day: '2026-11-17', step: 'x'.repeat(141) }, { day: '17/11/2026', step: 'x' }, 'mañana', 7]) assert.deepEqual(checkNext(bad, '2026-11-16'), { error: 'next' });
});

test('a row says what the spec lists and nothing more', () => {
  const s = world([log('r_marta', { holds: true, took: true, next: { day: '2026-11-18', step: 'Volver' } })]), marta = s.reps.get('r_marta');
  const first = (r) => r.name.split(' ')[0];
  const row = rowOf(viewOf(s, lead({ walkin: 8, workers: 12, contact: 'Ana Ruiz' })), marta, first);
  assert.deepEqual(Object.keys(row).sort(), ['free', 'id', 'known', 'lastDay', 'lastKind', 'lost', 'name', 'next', 'owner', 'stage', 'walkin', 'workers', 'zone']);
  assert.deepEqual([row.owner, row.lastDay, row.lastKind, row.walkin, row.workers, row.known], [{ name: 'Marta', mine: true }, '2026-11-16', 'talk', 8, 12, true]);
  assert.deepEqual(rowOf(viewOf(s, lead()), s.reps.get('r_jose'), first).owner, { name: 'Marta', mine: false });
  const none = rowOf(viewOf(world(), lead({ lastContact: '2026-11-02' })), marta, first);
  assert.deepEqual([none.owner, none.lastDay, none.lastKind, none.walkin, none.workers, none.next], [null, '2026-11-02', null, null, null, null]);
});

test('lead.map carries the overlay to the CRM id', () => {
  const s = world([{ type: 'lead.added', lead: { id: 'APP-1234ABCD', company: 'Bar Nuevo', zone: 'Centro', city: 'Panama City', by: 'r_marta' }, t: NOW },
    log('r_marta', { lead: { id: 'APP-1234ABCD', name: 'Bar Nuevo' }, holds: true, took: true, next: { day: '2026-11-18', step: 'Volver' } }),
    { type: 'lead.map', temp: 'APP-1234ABCD', real: 'PA-0009', t: NOW }]);
  assert.deepEqual([s.biz.has('APP-1234ABCD'), s.biz.get('PA-0009').owner.rep, s.biz.get('PA-0009').next.day], [false, 'r_marta', '2026-11-18']);
});

test('a value set again after it synced wins again over the CRM\'s cell: next, a gift, a release, a take, a reopen', () => {
  const synced = (fields, t = NOW) => ({ type: 'biz.synced', lead: 'PA-0001', fields, t });
  // next: set X, synced, the CRM edits it to Y, the holder sets X again
  const s = world([{ type: 'biz.owner', lead: 'PA-0001', owner: 'r_marta', by: 'r_boss', t: NOW }, { type: 'biz.next', lead: 'PA-0001', rep: 'r_marta', next: { day: '2026-11-18', step: 'Volver' }, t: NOW }, synced(['next'])]);
  const crm = lead({ nextDay: '2026-11-25', nextStep: 'Del CRM' });
  assert.deepEqual(viewOf(s, crm).next, { day: '2026-11-25', step: 'Del CRM' });
  applyEvent(s, { type: 'biz.next', lead: 'PA-0001', rep: 'r_marta', next: { day: '2026-11-18', step: 'Volver' }, t: at('2026-11-16') });
  assert.deepEqual([viewOf(s, crm).next, s.biz.get('PA-0001').synced.has('next')], [{ day: '2026-11-18', step: 'Volver' }, false]);
  // a gift: given to jose, synced, the CRM puts Marta back, the manager gives it to jose again
  const g = world([{ type: 'biz.owner', lead: 'PA-0001', owner: 'r_jose', by: 'r_boss', t: NOW }, synced(['owner'])]);
  const back = lead({ owner: 'Marta Pineda', lastContact: '2026-11-10' });
  assert.equal(viewOf(g, back).holder.id, 'r_marta');
  applyEvent(g, { type: 'biz.owner', lead: 'PA-0001', owner: 'r_jose', by: 'r_boss', t: NOW });
  assert.equal(viewOf(g, back).holder.id, 'r_jose');
  // a release: released, synced, the CRM names Marta again, released again
  const r = world([{ type: 'biz.owner', lead: 'PA-0001', owner: null, by: 'r_boss', t: NOW }, synced(['owner'])]);
  assert.equal(viewOf(r, back).holder.id, 'r_marta');
  applyEvent(r, { type: 'biz.owner', lead: 'PA-0001', owner: null, by: 'r_boss', t: NOW });
  assert.deepEqual([viewOf(r, back).holder, viewOf(r, back).free], [null, true]);
  // a take by log: taken, synced, the CRM writes Libre over it, the same rep logs and takes it again
  const k = world([log('r_marta', { holds: true, took: true, t: at('2026-11-02') }), synced(['owner'])]);
  const libre = lead({ owner: 'Libre (correo automático)' });
  assert.equal(viewOf(k, libre).free, true);
  applyEvent(k, log('r_marta', { holds: true, took: true }));
  assert.deepEqual([viewOf(k, libre).holder?.id, viewOf(k, libre).free], ['r_marta', false]);
  // a reopen: reopened, synced, the CRM marks it Lost again, the holder reopens it again
  const o = world([{ type: 'biz.reopen', lead: 'PA-0001', rep: 'r_marta', by: 'r_marta', t: NOW }, synced(['stage'])]);
  const lostAgain = lead({ owner: 'Marta Pineda', lastContact: '2026-11-10', stage: 'Lost' });
  assert.equal(viewOf(o, lostAgain).stage, 'Lost');
  applyEvent(o, log('r_marta', { holds: true, kind: 'call', lost: null }));
  assert.equal(viewOf(o, lostAgain).stage, 'Contacted');
});

test('a gift is day zero after it syncs too, and lapses 31 days later with no contact and no next step', () => {
  const s = world([{ type: 'biz.owner', lead: 'PA-0001', owner: 'r_marta', by: 'r_boss', t: NOW }, { type: 'biz.synced', lead: 'PA-0001', fields: ['owner'], t: NOW }]);
  const crm = lead({ owner: 'Marta Pineda' }), index = bizIndex(s, new Map([[crm.id, crm]]));
  assert.equal(holderOf(s, crm, { now: NOW, index }).rep.id, 'r_marta');
  assert.equal(holderOf(s, crm, { now: '2026-12-16T15:00:00Z', index }).rep.id, 'r_marta');   // 30 days
  assert.deepEqual(pick(holderOf(s, crm, { now: '2026-12-17T15:00:00Z', index })), { rep: null, free: true, lapsed: true });   // 31 days
});

test('a reopen is judged in its world: one by a rep of the other world changes nothing', () => {
  const s = world([{ type: 'practice.lead.added', lead: { id: 'APP-PRAC0001', company: 'Práctica', zone: 'Centro', city: '', by: 'r_x', practice: true }, t: NOW },
    { type: 'biz.reopen', lead: 'APP-PRAC0001', rep: 'r_marta', by: 'r_marta', t: NOW }, { type: 'biz.reopen', lead: 'PA-0001', by: 'r_nobody', t: NOW }]);
  assert.equal(s.biz.size, 0);
});

test('from Contract sent on, a business keeps its holder however long ago the last contact was', () => {
  const old = { owner: 'Marta Pineda', lastContact: '2026-09-17' };   // 60 days, no next step
  for (const stage of ['Contract sent', 'Contract signed', 'Setup day set', 'Live']) {
    assert.deepEqual([held({ ...old, stage }).rep?.id, held({ ...old, stage }).free], ['r_marta', false], stage);
  }
  assert.deepEqual(pick(held({ ...old, stage: 'Intro call done' })), { rep: null, free: true, lapsed: true });
  // another rep's visit takes nothing and says whose it is
  const s = world(), sent = viewOf(s, lead({ ...old, stage: 'Contract sent' }));
  assert.deepEqual(logEffect(sent, s.reps.get('r_jose'), 'talk'), { holds: false, took: false, owned: { name: 'Marta' } });
  // the stage can come from the app: a contract logged 60 days ago whose sending a manager confirmed, the CRM still at Contacted
  const contract = log('r_marta', { kind: 'contract', t: at('2026-09-17') });
  const crm = lead({ ...old, stage: 'Contacted' });
  assert.equal(viewOf(world([contract]), crm).free, true, 'not confirmed: it lapses');
  const confirmed = world([contract, { type: 'confirm', logId: contract.id, what: 'contract_sent', by: 'r_boss', t: at('2026-09-18') }]);
  assert.deepEqual([viewOf(confirmed, crm).stage, viewOf(confirmed, crm).holder?.id], ['Contract sent', 'r_marta']);
  // a manager can still let it go
  applyEvent(confirmed, { type: 'biz.owner', lead: 'PA-0001', owner: null, by: 'r_boss', t: NOW });
  assert.equal(viewOf(confirmed, crm).free, true);
});

test('logEffect names the holder as the rows do: an example rep by their letter', () => {
  const holder = { id: 'r_ejemplo-a', name: 'Vendedor A', example: 'A', practice: true, role: 'rep', active: true };
  const view = { lead: { id: 'EX', practice: true }, holder };
  assert.deepEqual(logEffect(view, { id: 'r_ejemplo-b', practice: true }, 'talk'), { holds: false, took: false, owned: { name: 'Vendedor A' } });
  assert.deepEqual(logEffect(view, { id: 'r_ejemplo-b', practice: true }, 'talk', 'en').owned, { name: 'Rep A' });
  assert.deepEqual(logEffect({ lead: LEAD, holder: { id: 'r_x', name: '  Ana María Paz ' } }, { id: 'r_y' }, 'talk').owned, { name: 'Ana' });
});
