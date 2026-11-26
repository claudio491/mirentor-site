// scorecard-steps.js: the Scorecard on the page. Its twenty columns in the CRM sheet's order and in five families, the
// addresses of a week and of a cell's list, what a cell shows and the weeks offered. No page and no imports: scorecard.js
// draws what these decide. The server counts every cell and its list (lib/team/scorecard.mjs).

/** The twenty columns, in the sheet's order. */
export const SC_COLS = ['touches', 'calls', 'visits', 'touched', 'talks', 'replies', 'booked', 'held', 'owned', 'overdue', 'progress', 'out', 'ready',
  'signed', 'installed', 'live', 'consents', 'working', 'owed', 'qualified'];
/** Counted with no goal. */
export const SC_NOGOAL = ['touches', 'calls'];
/** Read "live now": only the current week has them; a past week shows "Sin dato". */
export const SC_NOWONLY = ['owned', 'overdue', 'progress', 'out', 'ready'];
/** The five families the columns are drawn in, with their small labels. */
export const SC_FAMILIES = [
  { key: 'sc.fam.activity', cols: ['touches', 'calls', 'visits', 'touched'] },
  { key: 'sc.fam.talks', cols: ['talks', 'replies', 'booked', 'held'] },
  { key: 'sc.fam.owned', cols: ['owned', 'overdue', 'progress', 'out', 'ready'] },
  { key: 'sc.fam.sites', cols: ['signed', 'installed', 'live', 'consents', 'working', 'owed'] },
  { key: 'sc.fam.qual', cols: ['qualified'] },
];

/** GET scorecard for a week (the server's current week when none is named). */
export const scoreUrl = (week) => (week ? `scorecard?week=${encodeURIComponent(week)}` : 'scorecard');
/** GET the list behind one cell: a rep's id, or 'team'. */
export const cellUrl = (week, rep, col) => `scorecard?week=${encodeURIComponent(week)}&rep=${encodeURIComponent(rep)}&cell=${encodeURIComponent(col)}`;

/** What a cell shows: its number, or "Sin dato" when the sheet has none (a "live now" column of a past week). */
export const cellShown = (v) => (v == null || !Number.isFinite(v) ? { key: 'sc.none' } : { n: v });

/** The weeks of the picker, newest first: the first is "Esta semana", the others "Semana del {date}". */
export const weekChoices = (weeks) => (Array.isArray(weeks) ? weeks : []).map((week, i) => (i === 0 ? { week, key: 'sc.week.this' } : { week, key: 'sc.week.of', date: week }));

/** What a list adds up to: the sum of its `n`. */
export const itemsTotal = (items) => (Array.isArray(items) ? items : []).reduce((s, x) => s + (x && Number.isFinite(x.n) ? x.n : 0), 0);

/** The rows of the table from 1100 px, turned as in the CRM sheet: the twenty numbers go down and the people across.
 *  Each family is a row of its own (its small label), then its numbers, each with the team's cell and each rep's in
 *  the order the server sends them, as cellShown says them. */
export function scoreRows(view) {
  const reps = view && Array.isArray(view.reps) ? view.reps : [], team = (view && view.team) || {};
  return SC_FAMILIES.flatMap((f) => [{ family: f.key },
    ...f.cols.map((col) => ({ col, team: cellShown(team[col]), reps: reps.map((r) => cellShown(r && r.cells ? r.cells[col] : null)) }))]);
}

/** The table's head for each rep, in the server's order: the first name (with the next name's initial when two share
 *  it), the full name and the city. */
export function scoreHeads(reps) {
  const list = Array.isArray(reps) ? reps : [];
  const words = (r) => String((r && r.name) || '').trim().split(/\s+/);
  const firsts = list.map((r) => words(r)[0] || '');
  return list.map((r, i) => {
    const w = words(r), twin = firsts.filter((f) => f === firsts[i]).length > 1 && w[1];
    return { id: r.id, name: r.name, first: twin ? `${w[0]} ${w[1][0]}.` : firsts[i], city: r.city || '' };
  });
}

/** What the Scorecard shows before it has a week to draw: a quiet line while the first answer loads, or the lists'
 *  failed line with its retry. Null once a week is drawn (a later failed read keeps it and only says so). */
export const scoreWait = ({ data, failed }) => (data ? null : failed ? { key: 'bk.failed', retry: 'bk.retry' } : { key: 'sc.loading' });
