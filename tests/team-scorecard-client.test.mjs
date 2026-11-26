// The Scorecard on the page: its columns, the addresses of a week and of a cell, what a cell shows and the weeks offered.
// The server counts every cell and its list (lib/team/scorecard.mjs); these only decide the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SC_COLS, SC_NOGOAL, SC_NOWONLY, SC_FAMILIES, scoreUrl, cellUrl, cellShown, weekChoices, itemsTotal, scoreRows, scoreHeads, scoreWait } from '../team/scorecard-steps.js';
import { SCORECARD_COLS, NOW_ONLY } from '../lib/team/scorecard.mjs';
import { DICT } from '../team/i18n.js';

test('what a Scorecard cell opens and shows, and the weeks it offers', () => {
  assert.equal(cellUrl('2026-11-16', 'r_a b', 'touches'), 'scorecard?week=2026-11-16&rep=r_a%20b&cell=touches');
  assert.equal(scoreUrl('2026-11-16'), 'scorecard?week=2026-11-16'); assert.equal(scoreUrl(), 'scorecard');
  assert.equal(itemsTotal([{ n: 8 }, { n: 2 }]), 10); assert.deepEqual(cellShown(null), { key: 'sc.none' }); assert.deepEqual(cellShown(0), { n: 0 });
  assert.equal(itemsTotal(null), 0);
  assert.deepEqual(weekChoices(['2026-11-16', '2026-11-09']), [{ week: '2026-11-16', key: 'sc.week.this' }, { week: '2026-11-09', key: 'sc.week.of', date: '2026-11-09' }]);
  assert.deepEqual(SC_NOGOAL, ['touches', 'calls']);
});

test('the Scorecard has the server\'s twenty columns, in five families, each with its words', () => {
  assert.deepEqual(SC_COLS, SCORECARD_COLS);
  assert.deepEqual(SC_NOWONLY, NOW_ONLY);
  assert.deepEqual(SC_FAMILIES.flatMap((f) => f.cols), SC_COLS, 'the five families hold every column once, in order');
  assert.deepEqual(SC_FAMILIES.map((f) => f.key), ['sc.fam.activity', 'sc.fam.talks', 'sc.fam.owned', 'sc.fam.sites', 'sc.fam.qual']);
  for (const lang of ['es', 'en']) for (const c of SC_COLS) assert.ok(`sc.col.${c}` in DICT[lang], `${lang} sc.col.${c}`);
  for (const f of SC_FAMILIES) assert.ok(f.key in DICT.es && f.key in DICT.en, f.key);
});

// Fix round C1 (K2): on a wide screen the table is turned, as in the CRM sheet: the twenty numbers go down, the people across.
test('the turned table: the five families in order, each number with the team\'s cell and each rep\'s, in the server\'s order', () => {
  const cells = (n) => Object.fromEntries(SC_COLS.map((c, i) => [c, n + i]));
  const view = { team: cells(100), reps: [{ id: 'r1', name: 'Ana Ruiz', city: 'panama', cells: cells(0) }, { id: 'r2', name: 'Luis Soto', city: 'colon', cells: { ...cells(50), owned: null } }] };
  const rows = scoreRows(view);
  assert.equal(rows.length, 25, 'five family rows and twenty numbers');
  assert.deepEqual(rows.filter((r) => 'family' in r).map((r) => r.family), SC_FAMILIES.map((f) => f.key));
  assert.deepEqual(rows.filter((r) => 'col' in r).map((r) => r.col), SC_COLS);
  assert.deepEqual(rows[0], { family: 'sc.fam.activity' });
  assert.deepEqual(rows[1], { col: 'touches', team: { n: 100 }, reps: [{ n: 0 }, { n: 50 }] });
  const owned = rows.find((r) => r.col === 'owned');
  assert.deepEqual(owned.reps[1], { key: 'sc.none' }, 'a number the sheet has none of reads "Sin dato"');
  // no view yet, or no reps: the rows are still the twenty numbers, with "Sin dato" for the team
  const empty = scoreRows(null);
  assert.equal(empty.length, 25); assert.deepEqual(empty[1], { col: 'touches', team: { key: 'sc.none' }, reps: [] });
});

test('the turned table\'s heads: each rep by first name, with the city under it; two of the same first name add an initial', () => {
  assert.deepEqual(scoreHeads([{ id: 'r1', name: 'Ana Ruiz', city: 'panama' }, { id: 'r2', name: 'Luis  Soto', city: '' }]),
    [{ id: 'r1', name: 'Ana Ruiz', first: 'Ana', city: 'panama' }, { id: 'r2', name: 'Luis  Soto', first: 'Luis', city: '' }]);
  assert.deepEqual(scoreHeads([{ id: 'a', name: 'Ana Ruiz' }, { id: 'b', name: 'Ana Pérez' }, { id: 'c', name: 'Omar' }]).map((x) => x.first), ['Ana R.', 'Ana P.', 'Omar']);
  assert.deepEqual(scoreHeads(null), []);
});

test('the Scorecard never shows a blank: a quiet line while the first answer loads, the lists\' failed line with its retry', () => {
  assert.deepEqual(scoreWait({ data: null, failed: false }), { key: 'sc.loading' });
  assert.deepEqual(scoreWait({ data: null, failed: true }), { key: 'bk.failed', retry: 'bk.retry' });
  assert.equal(scoreWait({ data: { reps: [] }, failed: true }), null, 'a week already drawn stays; a later failure is a toast');
  assert.equal(DICT.es['sc.loading'], 'Cargando los números de la semana…');
  assert.equal(DICT.en['sc.loading'], 'Loading the week\'s numbers…');
  assert.equal(DICT.es['sc.note.nowonly'], 'Sin dato: cinco de estos números solo existen en vivo, sin historial.');
  assert.equal(DICT.en['sc.note.nowonly'], 'No data: five of these numbers only exist live, with no history.');
});
