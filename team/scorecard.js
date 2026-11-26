// scorecard.js: the CRM's Rep Scorecard, read from the app. A manager's tab and a block of the leadership page: one row
// per rep and one for the team, twenty numbers in the sheet's order and its five families, and every number opening the
// list it counts. From 1100 px it is a table turned as the CRM sheet is: the twenty numbers go down and the people across,
// the head and the numbers' names staying while the rest scrolls; under that, one card for the team and one per rep,
// each number with its full name beside it. Before the first answer it says it is loading; a failed read says so, with
// its retry.
// The server counts every cell and its list (lib/team/scorecard.mjs); scorecard-steps.js decides the page. Nothing here
// writes: a leader and view-as read it as a manager does.
import { $, h, put, t, num, dayMonth, cityName, openSheet, closeSheet, toast, toastErr, quiet } from './ui.js';
import { restArt } from './art-lead.js';
import { SC_NOWONLY, SC_FAMILIES, scoreUrl, cellUrl, cellShown, weekChoices, itemsTotal, scoreRows, scoreHeads, scoreWait } from './scorecard-steps.js';

const WIDE = matchMedia('(min-width:1100px)');

export function createScorecard({ api, S, errText, openBiz = () => {} }) {
  let data = null, week = null, ticket = 0, cellTicket = 0, failed = false;
  let back = null;   // the list a business's card was opened from: Back reopens it (R4)
  const drawn = new Map();   // node -> how it is drawn again, when the week changes or the screen crosses 1100 px

  /** GET scorecard for a week (the server's current one when none is named). A read that a newer one replaced is dropped. */
  async function load(w = week) {
    const mine = ++ticket;
    let res;
    try { res = await api('GET', scoreUrl(w)); }
    catch (e) { if (mine === ticket) failed = true; throw e; }
    if (mine !== ticket) return false;
    data = res; week = res.week; failed = false;
    return true;
  }
  const team = () => ({ id: 'team', name: t('sc.team'), city: '', cells: (data && data.team) || {} });
  const colName = (c) => t(`sc.col.${c}`);
  const isThis = () => !!data && Array.isArray(data.weeks) && data.week === data.weeks[0];

  /** One number: a button that opens its list, or "Sin dato" (disabled) when the sheet has no number for it. */
  function cell(row, c, withName = false) {
    const shown = cellShown(row.cells[c]);
    return cellButton(row, c, shown, withName);
  }
  function cellButton(row, c, shown, withName = false) {
    const none = 'key' in shown;
    const label = t('sc.open.aria', { col: colName(c), name: row.name });
    const value = h('span', { class: none ? 'sc-v sc-null' : 'sc-v num', text: none ? t(shown.key) : num(shown.n) });
    return h('button', { class: `sc-cell${withName ? ' sc-item' : ''}`, type: 'button', disabled: none, 'aria-label': none ? `${colName(c)}, ${row.name}: ${t(shown.key)} · ${t('sc.nowonly')}` : label,
      title: none && !withName ? t('sc.nowonly') : null, onclick: none ? null : () => open(row.id, c, row.name) },
    value, withName ? h('span', { class: 'sc-n', text: colName(c) }) : null);
  }

  /** The table, from 1100 px, turned as the CRM sheet is (scorecard-steps scoreRows): the numbers' full names down the
   *  first column, then the team's column, then one per rep (first name, city under it). Each family is a row with its
   *  small label. The head and the first column stay while the rest scrolls; the people scroll sideways only when they
   *  do not fit, under a fade on the right edge. */
  function table() {
    const reps = (data && data.reps) || [], heads = scoreHeads(reps), all = [team(), ...reps], span = all.length + 1;
    const head = h('thead', {}, h('tr', {}, h('td', { class: 'sc-corner' }),
      h('th', { scope: 'col', class: 'sc-who sc-tot' }, h('b', { text: t('sc.team') })),
      heads.map((x) => h('th', { scope: 'col', class: 'sc-who', title: x.name }, h('b', { text: x.first }), x.city ? h('small', { text: cityName(x.city) }) : null))));
    const body = h('tbody', {}, scoreRows(data).map((r) => {
      if ('family' in r) return h('tr', { class: 'sc-famrow' }, h('th', { colspan: String(span) }, h('span', { class: 'label', text: t(r.family) })));
      return h('tr', {}, h('th', { scope: 'row', class: 'sc-col' }, colName(r.col)),
        h('td', { class: 'sc-tot' }, cellButton(all[0], r.col, r.team)),
        r.reps.map((shown, i) => h('td', {}, cellButton(all[i + 1], r.col, shown))));
    }));
    const wrap = h('div', { class: 'sc-wrap' }, h('table', { class: 'sc-tbl' }, h('caption', { class: 'vh', text: t('sc.title') }), head, body));
    wrap.addEventListener('scroll', () => edge(wrap), { passive: true });
    return wrap;
  }
  /** Whether the people overflow sideways (then the table scrolls inside its own frame, its head and first column
   *  staying), and whether the right edge still hides some of them (the fade). */
  function fit(wrap) {
    if (!wrap || !wrap.isConnected) return;
    wrap.classList.remove('sc-many');
    const tbl = wrap.firstElementChild;
    wrap.classList.toggle('sc-many', !!tbl && tbl.scrollWidth > wrap.clientWidth + 1);
    // on the manager's tab the frame is as tall as the screen leaves under the top bar once the page is scrolled to its
    // end, so its head never slides under the bar: what follows it on the page is measured. On the leadership page the
    // frame is as tall as the screen allows and the page scrolls past it (app.css .ld-score .sc-wrap.sc-many).
    if (wrap.classList.contains('sc-many') && !wrap.closest('.ld-score')) {
      const below = document.documentElement.scrollHeight - (wrap.getBoundingClientRect().bottom + scrollY);
      wrap.style.setProperty('--sc-below', `${Math.max(0, Math.round(below))}px`);
    }
    edge(wrap);
  }
  const edge = (wrap) => wrap.classList.toggle('sc-more', wrap.classList.contains('sc-many') && wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 2);

  /** The cards, under 1100 px: the team first, then each rep; five small labels, two numbers a row. */
  function cards() {
    const rows = [team(), ...((data && data.reps) || [])];
    return h('div', { class: 'sc-cards' }, rows.map((r, i) => h('section', { class: `inst-zone ${i === 0 ? 'inst-prep' : 'inst-crew'} sc-card`, 'aria-label': r.name },
      h('div', { class: 'inst-zh' }, h('b', { class: 'inst-k', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }), h('h2', { text: r.name }), r.city ? h('span', { class: 'label', text: cityName(r.city) }) : null),
      SC_FAMILIES.map((f) => h('div', { class: 'sc-family' }, h('p', { class: 'label', text: t(f.key) }), h('div', { class: 'sc-pairs' }, f.cols.map((c) => cell(r, c, true))))))));
  }

  /** The week picker: this week and the three before. A change reads that week and draws it again. */
  function weekSeg() {
    const choices = weekChoices(data ? data.weeks : []);
    return h('div', { class: 'seg scroll sc-weeks', role: 'group', 'aria-label': t('sc.week.aria') }, choices.map((c) => h('button', { type: 'button', 'aria-pressed': String(c.week === week),
      text: t(c.key, { date: c.date ? dayMonth(c.date) : '' }), onclick: () => pick(c.week) })));
  }
  async function pick(w) {
    if (w === week) return;
    try { if (await load(w)) redraw(); } catch (e) { toastErr(errText(e)); }
  }

  /** The team's qualified businesses for the week: the number the company is asked for. A week with nothing reads 0. */
  const headline = () => {
    const n = data && data.team && Number.isFinite(data.team.qualified) ? data.team.qualified : 0;
    return { n, line: isThis() ? t('sc.giant.this') : t('sc.giant.past', { date: data ? dayMonth(data.week) : '' }) };
  };
  /** The quiet lines under the numbers; a past week adds why five of them read "Sin dato". */
  const notes = () => [h('p', { class: 'note', text: t('sc.note') }), h('p', { class: 'note', text: t('sc.note.sheet') }),
    data && !isThis() ? h('p', { class: 'note', text: t('sc.note.nowonly') }) : null].filter(Boolean);

  /** Before a week is drawn: the loading line, or the lists' failed line with its retry (scorecard-steps scoreWait). */
  function waiting() {
    const w = scoreWait({ data, failed });
    if (!w.retry) return h('p', { class: 'note sc-wait', role: 'status', text: t(w.key) });
    return h('button', { class: 'bz-more bk-retry sc-wait', type: 'button', onclick: again }, h('span', { text: t(w.key) }), h('b', { text: t(w.retry) }));
  }
  /** The retry: the line says it is loading again, then the week or the failed line. */
  async function again() {
    failed = false; redraw();
    try { await load(); } catch { /* the failed line says it */ }
    redraw();
  }
  /** The table fits itself whenever its room changes: the wrap or its parent changes size (the people's column widths
   *  settle, the page's layout moves), and once the fonts are ready. The watcher goes when the table is drawn again or
   *  the screen leaves (the wrap is no longer drawn). */
  const watching = new Map();   // node -> its table's ResizeObserver
  function unwatch(node) { const ro = watching.get(node); if (ro) ro.disconnect(); watching.delete(node); }
  function watch(node, wrap) {
    unwatch(node);
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(() => {
        if (!wrap.isConnected || !wrap.getClientRects().length) { unwatch(node); return; }
        fit(wrap);
      });
      ro.observe(wrap);
      if (wrap.parentElement) ro.observe(wrap.parentElement);
      watching.set(node, ro);
    }
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => fit(wrap), () => {});
  }
  const numbers = (node) => {
    unwatch(node);
    if (!data) { put(node, waiting()); return; }
    if (!WIDE.matches) { put(node, cards()); return; }
    const wrap = table();
    put(node, wrap);
    fit(wrap);
    watch(node, wrap);
  };
  /** The numbers alone (table or cards) into a node. */
  function draw(node) {
    if (!node) return;
    drawn.set(node, () => numbers(node));
    numbers(node);
  }
  /** The leadership page's block: its title, the headline in one line, the weeks, the numbers and the two notes. */
  function block(node) {
    if (!node) return;
    drawn.set(node, () => block(node));
    node.hidden = false;
    if (!data) { put(node, h('h2', { class: 'ld-h', text: t('sc.title') }), waiting()); return; }
    const hl = headline(), box = h('div', { class: 'sc-body' });
    put(node, h('h2', { class: 'ld-h', text: t('sc.title') }), h('p', { class: 'support sc-line' }, h('b', { class: 'num', text: num(hl.n) }), ` ${hl.line}`), weekSeg(), box, ...notes());
    numbers(box);
  }
  /** The tab. */
  function paint() {
    $('#scLead').textContent = t('sc.title');
    if (!data) {   // never a blank tab: the loading line, or the failed one with its retry, where the table goes
      for (const sel of ['#scGiant', '#scWeek', '#scNote']) $(sel).replaceChildren();
      $('#scSupport').textContent = '';
      numbers($('#scTable'));
      return;
    }
    const hl = headline();
    put($('#scGiant'), h('span', { class: 'num', text: num(hl.n) }), h('em', { text: '.' }));
    $('#scSupport').textContent = hl.line;
    put($('#scWeek'), weekSeg());
    put($('#scNote'), ...notes());
    numbers($('#scTable'));
  }
  function redraw() {
    quiet(() => {
      if (!$('#s-score').hidden) paint();
      for (const again of drawn.values()) again();
    });
  }
  WIDE.addEventListener('change', () => { if (data) redraw(); });
  let fitAsk = 0;
  addEventListener('resize', () => { cancelAnimationFrame(fitAsk); fitAsk = requestAnimationFrame(() => { for (const w of document.querySelectorAll('.sc-wrap')) fit(w); }); });

  // ---- the list behind a cell ----
  const shownName = (rep, name) => (rep === 'team' ? t('sc.team') : name);
  /** One item of a list, by what the list holds: a log (day, business, result), a business (its name, opening its
   *  card), a site (its name and its number), a worker (name and site). A leader reads them and opens nothing. */
  function itemNode(kind, x, from, team) {
    const who = team && x.rep ? ` · ${x.rep}` : '';   // whose it is, on the team's lists only
    const opens = !S.lead && kind !== 'sites' && kind !== 'workers';
    const leadId = kind === 'logs' ? x.lead && x.lead.id : kind === 'biz' ? x.id : null;
    let name, sub;
    if (kind === 'logs') { name = x.lead ? x.lead.name : ''; sub = `${dayMonth(x.day)} · ${t(`kind.${x.kind}`)}${who}`; }
    else if (kind === 'biz') { name = x.name; sub = `${x.next && x.next.step ? x.next.step : ''}${who}`.replace(/^ · /, ''); }
    else if (kind === 'sites') { name = x.name; sub = `${x.city ? cityName(x.city) : ''}${who}`.replace(/^ · /, ''); }
    else { name = x.name; sub = `${x.site ? x.site.name : ''}${who}`.replace(/^ · /, ''); }
    const count = kind === 'sites' || (Number.isFinite(x.n) && x.n !== 1) ? h('span', { class: 'label num', text: num(x.n) }) : null;
    return h('li', { class: opens && leadId ? 'inst-row two tap' : 'inst-row two' }, h('span', { class: 'inst-n' }, h('b', { text: name }), sub ? h('small', { text: sub }) : null), count,
      opens && leadId ? h('button', { class: 'inst-hit', type: 'button', 'aria-label': t('bk.row.aria', { name }), onclick: (e) => { const hit = e.currentTarget; toCard = shownList; closeSheet($('#scSheet')); openBiz(leadId, from, hit); } }) : null);
  }
  /** Open the list behind a cell in the sheet: its title is "column: name", its rows add up to the number. */
  let shownList = null;   // the list open in the sheet: { rep, col, name }
  // The list closes: it is remembered for Back only when a business's card was opened from it (toCard); closed any
  // other way, it is forgotten.
  let toCard = null;
  const sheet = $('#scSheet');
  if (sheet) sheet.addEventListener('close', () => { back = toCard; toCard = null; });
  async function open(rep, col, name = '') {
    if (!data) return;
    const mine = ++cellTicket, from = S.tab;
    shownList = { rep, col, name };
    let res;
    try { res = await api('GET', cellUrl(data.week, rep, col)); } catch (e) { toastErr(errText(e)); return; }
    if (mine !== cellTicket) return;
    const items = Array.isArray(res.items) ? res.items : [];
    $('#scSheetH').textContent = t('sc.list.title', { col: colName(col), name: shownName(rep, name) });
    put($('#scList'), items.map((x) => itemNode(res.kind, x, from, rep === 'team')));
    $('#scList').hidden = !items.length;
    $('#scEmpty').hidden = items.length > 0;
    // a cell with nothing in it rests, with its one line
    const empty = $('#scEmpty');
    if (!(empty.previousElementSibling && empty.previousElementSibling.classList.contains('empty-art'))) empty.before(restArt());
    empty.previousElementSibling.hidden = items.length > 0;
    $('#scSheetN').textContent = items.length ? num(itemsTotal(items)) : '';   // what the list adds up to: the number tapped
    $('#scSheetN').hidden = !items.length;
    openSheet($('#scSheet'));
  }

  /** The tab is opened: read the week shown (or this one) and draw it. Before the first answer the tab says it is
   *  loading; a failed first read shows the failed line with its retry, a later one keeps the week drawn and says so.
   *  `fromCard`: the tab is reached back from a business's card opened from a cell's list, which opens again. */
  async function show({ fromCard = false } = {}) {
    const reopen = fromCard ? back : null;
    back = null;
    if (!data) { failed = false; quiet(paint); }   // reopened after a failed first read: the loading line, not the old failed one
    try { await load(); } catch (e) { if (data) toastErr(errText(e)); quiet(paint); return; }
    paint();
    if (reopen && S.tab === 'score') open(reopen.rep, reopen.col, reopen.name);
  }
  const render = () => { if (data && S.tab === 'score') quiet(paint); };
  const nowOnly = (c) => SC_NOWONLY.includes(c);

  /** The manager leaves for a screen other than a business's card: the list a card was opened from is forgotten. */
  const leave = () => { back = null; toCard = null; };

  return { load, draw, block, open, show, render, paint, nowOnly, leave, loaded: () => !!data };
}
