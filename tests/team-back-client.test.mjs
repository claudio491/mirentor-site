// Track F, F3: the phone's Back closes what is open and stays in the app, and a log left half done is still there.
// The decisions live in team/back-steps.js, away from the page, so they can be tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { backStep, tabMove, momentClose, restartAway, reloadSkip, keepDraft, takeDraft, DRAFT_MS, DRAFT_KEY } from '../team/back-steps.js';
import { DICT } from '../team/i18n.js';

test('Back: a traversal the app made itself is skipped; a sheet open closes first; then a deep screen; then back home', () => {
  assert.equal(backStep({ skip: 1, sheets: 2, deep: true, away: true }), 'skip');
  // a sheet open: Back closes it and stays where the rep was
  assert.equal(backStep({ sheets: 1 }), 'sheet');
  // two sheets (a card over the Guion list): the first Back closes the top one, the second the other
  assert.equal(backStep({ sheets: 2, deep: true }), 'sheet');
  // a deep screen keeps the trail it had
  assert.equal(backStep({ sheets: 0, deep: true, away: true }), 'deep');
  // a tab other than home: Back returns home
  assert.equal(backStep({ sheets: 0, deep: false, away: true }), 'home');
  // home, nothing open: the address changed (view-as), the screens start again from it
  assert.equal(backStep({}), 'restart');
});

test('Back twice from a deep screen over Semana ends on Semana, then home', () => {
  // the order of the entries the app pushes: Semana (away), then the profile (deep); a sheet on top
  let s = { skip: 0, sheets: 1, deep: true, away: true };
  const seen = [];
  for (let i = 0; i < 3; i += 1) {
    const step = backStep(s);
    seen.push(step);
    if (step === 'sheet') s = { ...s, sheets: s.sheets - 1 };
    else if (step === 'deep') s = { ...s, deep: false };
    else if (step === 'home') s = { ...s, away: false };
  }
  assert.deepEqual(seen, ['sheet', 'deep', 'home']);
  assert.equal(backStep(s), 'restart');
});

test('tabs: leaving home adds one entry, moving between other tabs replaces it, going home gives it back', () => {
  assert.deepEqual(tabMove({ to: 'week', home: 'today', away: false }), { push: true, back: false, away: true });
  assert.deepEqual(tabMove({ to: 'table', home: 'today', away: true }), { push: false, back: false, away: true });
  assert.deepEqual(tabMove({ to: 'today', home: 'today', away: true }), { push: false, back: true, away: false });
  assert.deepEqual(tabMove({ to: 'today', home: 'today', away: false }), { push: false, back: false, away: false });
  // a manager's home is Equipo
  assert.deepEqual(tabMove({ to: 'needs', home: 'team', away: false }), { push: true, back: false, away: true });
});

test('the day\'s moment closed toward the week keeps exactly one entry above home; closed in place it gives its entry back', () => {
  // held: the entries under the moment's own, above home (a tab's, a deep screen's)
  const above = (held, m) => held + 1 - m.pop;
  // "Ver mi semana" from Hoy: no traversal, the moment's entry becomes the week's
  const fromHoy = momentClose({ go: true, held: 0 });
  assert.deepEqual(fromHoy, { pop: 0, away: true });
  assert.equal(above(0, fromHoy), 1);
  // from a tab already away (or a deep screen over one): what is under the moment goes, one entry stays
  for (const held of [1, 2]) { const m = momentClose({ go: true, held }); assert.equal(m.away, true); assert.equal(above(held, m), 1); }
  // a tap outside, Escape or "Listo.": the moment's own entry goes, the rest stays as it was
  assert.deepEqual(momentClose({ go: false, held: 0 }), { pop: 1, away: null });
  assert.deepEqual(momentClose({ go: false, held: 1 }), { pop: 1, away: null });
  // and then Back from the week returns home, and once more leaves as from Hoy
  assert.equal(backStep({ away: true }), 'home');
  assert.equal(backStep({ away: false }), 'restart');
});

const T0 = Date.parse('2026-11-25T15:00:00Z');
const fields = { lead: { id: 'APP-1', name: 'Taller Ejemplo', zone: 'Centro', known: true }, kind: 'talk', note: 'Volver el jueves', qual: { wifi: 'yes' }, qOpen: ['wifi'] };

test('a draft is kept for the same rep, the same day and 30 minutes; view-as and a leader keep none; nothing typed keeps nothing', () => {
  assert.equal(DRAFT_MS, 30 * 60000);
  assert.equal(DRAFT_KEY, 'cancha.logDraft.v1');
  const d = keepDraft({ rep: 'r_ana', day: '2026-11-25', now: T0, own: true, fields });
  assert.deepEqual(d, { rep: 'r_ana', day: '2026-11-25', at: T0, fields });
  assert.equal(keepDraft({ rep: 'r_ana', day: '2026-11-25', now: T0, own: false, fields }), null);   // view-as, a leader
  assert.equal(keepDraft({ rep: 'r_ana', day: '2026-11-25', now: T0, own: true, fields: { lead: null, kind: null, note: '', qual: {} } }), null);
  assert.equal(keepDraft({ rep: null, day: '2026-11-25', now: T0, own: true, fields }), null);
  // taken back by the same rep, the same day, within 30 minutes
  assert.deepEqual(takeDraft(d, { rep: 'r_ana', day: '2026-11-25', now: T0 + 29 * 60000 }), fields);
  assert.equal(takeDraft(d, { rep: 'r_ana', day: '2026-11-25', now: T0 + 31 * 60000 }), null);
  assert.equal(takeDraft(d, { rep: 'r_omar', day: '2026-11-25', now: T0 }), null);
  assert.equal(takeDraft(d, { rep: 'r_ana', day: '2026-11-26', now: T0 }), null);
  assert.equal(takeDraft(null, { rep: 'r_ana', day: '2026-11-25', now: T0 }), null);
  assert.equal(takeDraft({ rep: 'r_ana', day: '2026-11-25', at: 'x', fields }, { rep: 'r_ana', day: '2026-11-25', now: T0 }), null);
});

test('opening for a named business starts clean unless the draft is that same business', () => {
  const d = keepDraft({ rep: 'r_ana', day: '2026-11-25', now: T0, own: true, fields });
  const at = { rep: 'r_ana', day: '2026-11-25', now: T0 + 60000 };
  assert.deepEqual(takeDraft(d, { ...at, lead: 'APP-1' }), fields);
  assert.equal(takeDraft(d, { ...at, lead: 'APP-2' }), null);
  // a draft with no business picked is not taken for a named one
  const none = keepDraft({ rep: 'r_ana', day: '2026-11-25', now: T0, own: true, fields: { ...fields, lead: null } });
  assert.equal(takeDraft(none, { ...at, lead: 'APP-1' }), null);
  assert.deepEqual(takeDraft(none, at), { ...fields, lead: null });
  for (const k of ['log.draft', 'log.draft.clear']) assert.ok(k in DICT.es && k in DICT.en, k);
  assert.equal(DICT.es['log.draft'], 'Seguiste donde quedaste.');
  assert.equal(DICT.es['log.draft.clear'], 'Empezar de cero');
});

test('a draft never brings back where an earlier sheet was opened from, and a saved log leaves no draft', () => {
  // opened from a business's route, then left: a plain "+ Registrar" lands where a plain one lands after saving
  const d = keepDraft({ rep: 'r_ana', day: '2026-11-25', now: T0, own: true, fields: { ...fields, from: 'route' } });
  const back = takeDraft(d, { rep: 'r_ana', day: '2026-11-25', now: T0 + 60000 });
  assert.equal('from' in back, false);
  assert.equal(back.note, 'Volver el jueves');
  // a log saved keeps nothing, whatever the sheet held
  assert.equal(keepDraft({ rep: 'r_ana', day: '2026-11-25', now: T0, own: true, saved: true, fields }), null);
});

test('Back that starts the screens again lands away from home only on a tab\'s entry; a reload on a sheet\'s or the moment\'s entry steps off it', () => {
  // view-as started from Pendientes: Back from the rep's screens lands on the Pendientes entry, which is a tab's
  assert.equal(restartAway({ cancha: 'tab' }), true);
  // the team's own first entry, or one the address put there
  for (const st of [null, undefined, {}, { cancha: 'step' }, 'x']) assert.equal(restartAway(st), false, String(st));
  // a reload with a sheet's or the moment's entry on top: that entry is stepped off at once
  assert.equal(reloadSkip({ cancha: 'sheet' }), true);
  assert.equal(reloadSkip({ cancha: 'moment' }), true);
  for (const st of [null, { cancha: 'tab' }, { cancha: 'step' }]) assert.equal(reloadSkip(st), false);
});
