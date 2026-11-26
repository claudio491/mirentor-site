// manager.js: what a manager sees. Every rep in one view, the things that wait for a decision, and the people who have access.
// The headline of the team view is a live number (days closed today), and the rows that need attention are framed.
import { $, $$, h, put, t, lang, reduce, EASE, num, openSheet, closeSheet, ord, wdShort, dayMonth, upper, isoWeek, addDays, dayOf, clock, stamp, ago, cityName, countTo, flipList, toast, toastErr, src, once, copyText, formSheet, quiet, newId, sameText, face, putFace, giant } from './ui.js';
import { miniHand, lens, setLens, portrait, setPortrait } from './hand.js';
import { STOPS } from './stops.js';
import { shortNames } from './moments.js';
import { toLoad, advanceBody, canAdvance, meetingRow, stalledLine, extraNeeds, pointsCell, siteBody, arrivedBody, fixBody, siteActions, roleOptions, recordUrl, siteReps, siteLeadId, siteHoursBody, recentMondays, payWeeks, payBody, newRepBody, readAgainIn, readNow, freshRead, REFRESH_MS, countryOptions, teamCountries, countryLabel, wayLine, bookCells, overdueLines, missedKeys } from './manager-steps.js';
import { DICT, LOCALE } from './i18n.js';
import { usd } from './sites-steps.js';
import { siteStateKey } from './leader-steps.js';
import { phonesLine, phoneCount, advanceLine } from './route-steps.js';
import { practiceActions, exampleActions } from './practice-steps.js';
import { askTwice, guardList } from './taps.js';
import { restArt, fitArt } from './art-lead.js';
import { goneRows, ROW_OUT, repActions, countRolls } from './craft-steps.js';
import { roll } from './fx.js';

const MONDAY = '2026-11-16';   // any Monday: only used to name the days of the week
const dayName = (n) => wdShort(addDays(MONDAY, n - 1));
/** A country in the reader's words: the app's own for the ones it names (Panamá, Colombia), the browser's for any other
 *  code, the code itself when even that is missing (manager-steps.js countryLabel). */
const countryText = (code) => countryLabel(code, {
  own: (c) => (`country.${c}` in DICT.es ? t(`country.${c}`) : null),
  region: (c) => { try { return new Intl.DisplayNames([LOCALE[lang()]], { type: 'region' }).of(c) || null; } catch { return null; } } });

export function createManager({ api, S, errText, refresh, renderAll, renderFeed, signOut, viewAs, openInstall, openReport, openBiz = () => {}, docForm = () => {} }) {
  let team = null, city = 'all';
  const tzOf = (rep) => (rep && rep.tz) || S.me.me.tz;
  const repById = (id) => team.reps.find((r) => r.id === id) || team.others.find((r) => r.id === id) || (team.practice && team.practice.id === id ? { ...team.practice, name: t('reps.practice.name') } : null) || (team.example || []).find((r) => r.id === id) || null;
  const isAdmin = () => S.me.viewer.role === 'admin';
  /** A link to a rep's screens opens them in place. With a modifier key it stays a plain link, for a new tab. */
  const openAs = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); viewAs(e.currentTarget.dataset.as); };

  // ---- reading the team view ----
  // The screens read the team by themselves (manager-steps.js says when): every minute while one of them is in front,
  // since much of what a manager acts on adds no line to the feed; and, when a read failed with nothing on screen, soon
  // and then less often, with the screens saying what happened and a button that tries again at once.
  // Reads and writes take numbers from one counter, so an answer that went out before a write the screen adopted is
  // dropped instead of undoing it.
  let failures = 0, failed = null, again = 0, seq = 0, shown = 0, writing = 0, readAt = 0;
  async function load() {
    const start = ++seq;
    try {
      const res = await api('GET', 'team');
      failures = 0; failed = null; readAt = Date.now();
      if (freshRead({ start, shown, writing: writing > 0 })) { shown = start; team = res; }
    } catch (e) { failures += 1; failed = e; if (!team) renderAll(false); throw e; } finally { plan(); }
  }
  /** A write: its answer is the new team view, adopted at once, and a read that went out before it is stale from now on. */
  async function wrote(call) {
    writing += 1;
    try { const res = await call(); if (res && res.reps) { team = res; shown = ++seq; } return res; } finally { writing -= 1; }
  }
  /** Schedule the next read by itself, while a manager is on these screens. */
  function plan() {
    clearTimeout(again); again = 0;
    if (S.mgr && S.me) again = setTimeout(tick, readAgainIn({ hasTeam: !!team, failures }));
  }
  const sig = (v) => JSON.stringify({ ...v, serverTime: null });
  /** The read by itself. A view that came back the same is not drawn again, so nothing moves under a finger for nothing. */
  async function tick() {
    clearTimeout(again); again = 0;
    if (!S.mgr || !S.me) return;
    if (!readNow({ hidden: document.hidden, writing: writing > 0, sheet: !!$('dialog[open]'), hasTeam: !!team, tab: S.tab })) { plan(); return; }
    const before = team && sig(team);
    try { await load(); } catch { return; }   // nothing on screen: load drew why; with a view, the next minute tries again
    if (S.mgr && team && sig(team) !== before) renderAll(false);
  }
  /** "Volver a intentar": read now, whatever is open. The answer, or the reason it failed, is drawn at once. */
  async function retry() {
    try { await load(); } catch { return; }
    if (S.mgr) renderAll(false);
  }
  // Back on the page after a while (or with nothing on screen): read now instead of waiting for the next minute.
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.mgr && S.me && (!team || Date.now() - readAt >= REFRESH_MS)) tick(); });
  /** Nothing to show yet. While the first read is on its way the screens stay as they are; once it failed, each one says
   *  so in the words of the app's own error screen, with the reason and a way to try again now. */
  function renderMissing() {
    for (const id of ['#dayoffBtn', '#addRepBtn']) $(id).disabled = true;   // both need the team: who, which cities, which day
    // the chips row is the person's own (the day, a sample): drawn at once, so it holds its place while the team is read
    const day = dayOf(S.me.serverTime, S.me.me.tz);
    $('#teamDateChip').textContent = `${upper(wdShort(day))} ${upper(dayMonth(day))} · ${upper(t('time.week', { n: isoWeek(day) }))}`;
    $('#teamSampleChip').hidden = !S.me.sample;
    if (!failed) return;
    const why = errText(failed);
    const tryNow = () => h('p', { class: 'gate-acts' }, h('button', { class: 'btn primary wide', type: 'button', 'data-act': 'retry', text: t('gate.retry'),
      onclick: (e) => once(e.currentTarget, async () => { await retry(); if (!team) toastErr(errText(failed)); }) }));
    for (const id of ['#teamGiant', '#needsGiant', '#repsGiant']) { giant($(id), t('gate.error.title')); $(id).classList.remove('word'); }
    $('#teamSupport').textContent = why;
    let box = $('#teamRetry');
    if (!box) { box = h('div', { id: 'teamRetry' }); $('#teamSupport').after(box); }
    put(box, tryNow()); box.hidden = false;
    put($('#needsBody'), h('div', {}, h('p', { class: 'support', text: why }), tryNow()));
    put($('#repsBody'), h('p', { class: 'support', text: why }), tryNow());
  }
  const needsCount = () => (team ? team.needs.confirm.length + team.needs.silent.length + team.needs.late.length + team.needs.pace.length + (team.needs.overdue || []).length + extraNeeds(team.needs) : 0);
  /** Run a manager action: the answer is the new team view. The feed and the tables follow from a fresh read. */
  /** It answers true once the action went through. `said`: where a failure is said (a sheet's own line); else a toast. */
  const act = (btn, call, okKey, said = null) => once(btn, async () => {
    try { await wrote(call); renderAll(false); if (okKey) toast(t(okKey)); refresh(false); return true; }
    catch (e) { if (said) said(errText(e)); else toastErr(errText(e)); if (e && (e.status === 409 || e.status === 404)) retry(); return false; }   // out of date (expired, gone): read the team again
  });

  /** A step that is hard to take back asks twice (taps.js): the first tap arms the button and says what will happen (a
   *  key's words, or `warn()` itself); the second runs it only after a pause, so one double tap never does both. */
  function twice(e, warn, run) {
    const step = askTwice(e.currentTarget, e);
    if (step === 'arm') { if (typeof warn === 'function') warn(); else toast(t(warn)); } else if (step === 'run') run();
  }
  // Every list a manager acts on is redrawn by the answer of an action, and the next row then lies under the finger:
  // the second click of a double click never acts there, and no tap does while a list settles (taps.js). A rep's
  // history counts too: through view-as a manager undoes and voids from it.
  guardList($('#needsBody')); guardList($('#repsBody')); guardList($('#ledger'));
  /** Take back a confirmation made by mistake: that part goes back to waiting. */
  const undoConfirm = (btn, logId, what) => act(btn, () => api('POST', 'confirm', { logId, what, undo: true }), 'needs.undone');
  /** Open a day that a rep closed too early, so they can log again. */
  const reopenDay = (btn, repId, day) => act(btn, () => api('POST', 'reopen', { rep: repId, day }), 'reps.reopen.done');

  // ---- the team ----
  function flagsOf(rep) {
    const out = [], n = team.needs, c = n.confirm.filter((x) => x.rep === rep.id).length;
    if (n.silent.some((x) => x.rep === rep.id)) out.push(t('mgr.flag.silent'));
    if (n.pace.some((x) => x.rep === rep.id)) out.push(t('mgr.flag.pace'));
    if (c) out.push(t('mgr.flag.confirm', { n: c }));
    if (n.late.some((x) => x.rep === rep.id)) out.push(t('mgr.flag.late'));
    if (rep.book && rep.book.overdue) out.push(t('mgr.flag.overdue', { n: rep.book.overdue }));
    return out;
  }
  const COLS = ['visits', 'convs', 'meetings', 'contracts', 'owned', 'overdue', 'points', 'streak', 'report', 'last'];
  function newRow() {
    return h('li', { class: 'brow' }, h('span', { class: 'pos num' }),
      h('span', { class: 'who' }, h('span', { class: 'fc' }), h('span', { class: 'wt' }, h('b'), h('small'), h('span', { class: 'flags' }))), h('span', { class: 'h' }),
      h('span', { class: 'cells' }, COLS.map((c) => h('span', { class: `m r c-${c}` }, h('span', { class: 'cell-l' }), h('span', { class: 'cv num' })))),
      h('span', { class: 'act' }, h('a', { class: 'mini-btn', onclick: openAs })), h('i', { class: 'vf', 'aria-hidden': 'true' }));
  }
  function paintRow(row, r) {
    const zone = tzOf(r), g = team.goals, flags = flagsOf(r), w = r.week.counts;
    row.classList.toggle('p1', r.place === 1); row.classList.toggle('flagged', flags.length > 0);
    row.classList.toggle('blank', !r.week.points && !r.week.marks && !r.today.logs);   // nothing this week: the cells would be ten zeros
    const pos = $('.pos', row); pos.textContent = r.place ? ord(r.place) : t('mgr.noplace'); pos.classList.toggle('none', !r.place);
    $('.who b', row).textContent = r.name;
    putFace($('.fc', row), r);
    $('.who small', row).replaceChildren(cityName(r.city));
    // "new" is a fact about the rep, not something to attend to: it is a plain tag before the flags.
    $('.flags', row).replaceChildren(...(r.isNew ? [h('span', { class: 'tag', text: t('table.new') })] : []), ...flags.map((f) => h('span', { class: 'chip', text: f })));
    $('.h', row).replaceChildren(miniHand(r.week.days, r.week.marks > r.week.days.reduce((a, d) => a + d.marks, 0)));
    const set = (col, label, nodes) => { const cell = $(`.c-${col}`, row); $('.cell-l', cell).textContent = label; $('.cv', cell).replaceChildren(...[nodes].flat()); };
    const frac = (a, b) => [num(a), h('small', { text: `/${num(b)}` })];
    set('visits', t('col.visits'), frac(w.visits, g.visits));
    set('convs', t('col.convs'), frac(w.conversations, g.conversations));
    set('meetings', t('col.meetings'), frac(w.meetings, g.meetings));
    set('contracts', t('col.contracts'), frac(w.contracts, g.contracts));
    // the businesses each rep holds, and how many are overdue, with what is under each number when it counts
    const bk = bookCells(r.book), withSub = (cell) => [num(cell.n), cell.sub ? h('small', { class: 'bk-sub', text: t(cell.sub.key, { n: cell.sub.n }) }) : null].filter(Boolean);
    set('owned', t('col.owned'), withSub(bk.owned));
    set('overdue', t('col.overdue'), withSub(bk.overdue)); $('.c-overdue .cv', row).classList.toggle('late', bk.overdue.n > 0);
    // the points it ranks by (scaled to five working days), and the points before scaling under them when they differ
    const pcell = $('.c-points', row), pts = pointsCell(r.week); $('.cell-l', pcell).textContent = t('col.points'); $('.cv', pcell).classList.add('pts'); countTo($('.cv', pcell), pts.n);
    let rawNode = $('small.bk-sub', pcell);
    if (pts.raw != null) { if (!rawNode) { rawNode = h('small', { class: 'bk-sub' }); pcell.append(rawNode); } rawNode.textContent = t('col.points.raw', { n: num(pts.raw) }); } else if (rawNode) rawNode.remove();
    set('streak', t('col.streak'), t('u.days', { n: r.streak.current }));
    const rep = r.today.isWork ? (r.today.closed ? t('mgr.report.closed', { time: clock(r.today.closedAt, zone) }) : t('mgr.report.open')) : t('mgr.report.rest');
    set('report', t('col.report'), rep); $('.c-report .cv', row).classList.toggle('ok', !!r.today.closed);
    set('last', t('col.last'), r.today.lastLogAt ? ago(r.today.lastLogAt, team.serverTime, zone) : t('mgr.last.none'));
    const link = $('.act a', row); link.href = `?as=${encodeURIComponent(r.id)}`; link.dataset.as = r.id; link.textContent = t('mgr.viewas.row'); link.setAttribute('aria-label', t('mgr.viewas.row.aria', { name: r.name }));
  }
  function renderTeam(animate) {
    const tn = team.team, day = dayOf(team.serverTime, S.me.me.tz);
    $('#teamDateChip').textContent = `${upper(wdShort(day))} ${upper(dayMonth(day))} · ${upper(t('time.week', { n: isoWeek(day) }))}`;
    $('#teamSampleChip').hidden = !S.me.sample;
    $('#teamGiant').replaceChildren(src(h('button', { class: 'src', type: 'button', text: t('mgr.of', { a: tn.closedToday, b: tn.working }) }), () => t('c.source'), () => t('src.mgr.closed')), h('em', { text: '.' }));
    $('#teamSupport').textContent = t('mgr.support', { w: tn.working, p: tn.players, m: tn.meetings, t: tn.target });
    const box = $('#teamLenses');
    if (!box.childElementCount) box.append(src(lens('meetings', ''), () => t('c.source'), () => t('src.team', { target: team.team.target, per: Math.round(team.team.target / Math.max(1, team.team.players)) })), lens('contracts', ''), src(lens('closed', ''), () => t('c.source'), () => t('src.mgr.closed')));
    const contracts = team.reps.reduce((a, r) => a + r.week.counts.contracts, 0);
    $('[data-lens="meetings"] .l', box).textContent = t('col.meetings'); $('[data-lens="contracts"] .l', box).textContent = t('col.contracts'); $('[data-lens="closed"] .l', box).textContent = t('col.report');
    setLens($('[data-lens="meetings"]', box), tn.meetings, tn.target);
    setLens($('[data-lens="contracts"]', box), contracts, team.goals.contracts * tn.players);
    setLens($('[data-lens="closed"]', box), tn.closedToday, tn.working);

    const cities = [...new Set(team.reps.map((r) => r.city).filter(Boolean))].sort();
    if (city !== 'all' && !cities.includes(city)) city = 'all';
    // The wall: every rep's day as the scene it stands on (the stop that is next, the close once the day is done,
    // the hammock on a day off), with their face and the arc of today's four habits. A tap opens their screens.
    const shown = team.reps.filter((r) => city === 'all' || r.city === city), names = shortNames(shown);
    const drawWall = () => flipList($('#wall'), shown, (r) => r.id,
      () => h('a', { class: 'wl', onclick: openAs }, h('span', { class: 'ws', 'aria-hidden': 'true' }, h('i')), h('span', { class: 'pt' }), h('b'), h('span', { class: 'st' })),
      (node, r) => {
        const done = r.today.habits.filter(Boolean).length, flagged = flagsOf(r).length > 0;
        const state = !r.today.isWork ? t('mgr.report.rest') : r.today.closed ? t('mgr.report.closed', { time: clock(r.today.closedAt, tzOf(r)) }) : r.today.logs ? t('wall.today', { a: done }) : t('mgr.last.none');
        node.href = `?as=${encodeURIComponent(r.id)}`; node.dataset.as = r.id; node.classList.toggle('flag', flagged);
        node.setAttribute('aria-label', t('wall.open.aria', { name: r.name, state }));
        const over = r.today.closed || done === 4, at = r.today.habits.slice(0, 3).findIndex((x) => !x);
        $('.ws', node).dataset.art = !r.today.isWork ? 'rest' : over ? 'close' : STOPS[at >= 0 ? at : 3];
        $('.ws i', node).dataset.f = r.today.isWork && over ? '3' : '0';
        node.classList.toggle('wait', r.today.isWork && !over);
        putFace($('.pt', node), r, (person) => portrait(person, { share: 0 }));
        setPortrait($('.pt .portrait', node), r.today.isWork ? done / 4 : 0);
        $('b', node).textContent = names.get(r.id); $('.st', node).textContent = state;
      });
    if (animate) drawWall(); else quiet(drawWall);
    const seg = $('#citySeg'); seg.parentElement.hidden = cities.length < 2;
    seg.replaceChildren(...[['all', t('mgr.filter.all')], ...cities.map((c) => [c, cityName(c)])].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(city === id), text: label, onclick: () => { city = id; quiet(() => renderTeam(false)); } })));

    const table = $('#teamTable');
    if (!table.childElementCount) table.append(h('div', { class: 'bt-h', 'aria-hidden': 'true' }), h('ol', { class: 'tower', id: 'teamRows' }));
    $('.bt-h', table).replaceChildren(h('span', { text: t('col.place') }), h('span', { text: t('col.rep') }), h('span', { text: t('col.hand') }), ...COLS.map((c) => h('span', { class: 'r', text: t(`col.${c}`) })), h('span'));
    $('#teamRows').setAttribute('aria-label', t('mgr.table.aria'));
    const rows = team.reps.filter((r) => city === 'all' || r.city === city).sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9));
    const draw = () => flipList($('#teamRows'), rows, (r) => r.id, newRow, paintRow);
    if (animate) draw(); else quiet(draw);
    $('#teamEmpty').hidden = team.reps.length > 0; table.hidden = !team.reps.length;
    renderFeed($('#teamFeed'), $('#teamFeedEmpty'), animate);
  }

  // ---- needs me ----
  /** A date typed in a date field, as a person reads it: jue 19 nov. Anything else is shown as typed. */
  const niceDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${wdShort(v)} ${dayMonth(v)}` : v);
  const group = (titleKey, items, emptyKey, extra = null, counted = true) => h('section', { class: 'group', 'data-group': titleKey },
    h('h2', {}, t(titleKey), counted && items.length ? [' ', h('span', { class: 'count num', text: String(items.length) })] : null),
    items.length ? h('ul', { class: 'items' }, items) : h('p', { class: 'note', text: t(emptyKey) }), extra);
  const copyBtn = (text) => h('button', { class: 'mini-btn', type: 'button', text: t('needs.msg.copy'), onclick: async () => toast(t((await copyText(text)) ? 'c.copied' : 'close.copy.fail')) });
  function voidLog(logId) {
    formSheet({ title: t('needs.void.title'), intro: t('needs.void.p'), submit: t('needs.void.submit'),
      fields: [{ name: 'reason', label: t('needs.void.reason'), placeholder: t('needs.void.reason.ph'), max: 200 }],
      onSubmit: async (v) => { await wrote(() => api('POST', 'void', { logId, reason: v.reason })); toast(t('needs.voided')); await refresh(false); } });
  }
  function giveBadge(rep) {
    formSheet({ title: t('reps.badge.title'), intro: t('reps.badge.p'), submit: t('reps.badge.submit'),
      fields: [{ name: 'text', type: 'textarea', label: t('reps.badge.text'), placeholder: t('reps.badge.ph'), max: 140 }],
      onSubmit: async (v) => { await wrote(() => api('POST', 'badge', { rep: rep.id, text: v.text })); toast(t('reps.badge.done')); await refresh(false); } });
  }
  /** A rep's overdue businesses, read on the manager's own account (as= names whose), each one opening its card on the
   *  manager's account, where it can be released or given (view-as writes nothing). */
  async function overdueSheet(x) {
    let res;
    try { res = await api('GET', `leads?list=due&as=${encodeURIComponent(x.rep)}`); } catch (e) { toastErr(errText(e)); return; }
    const today = dayOf(team.serverTime, tzOf(repById(x.rep)));
    const rows = (res.leads || []).filter((r) => r.next && r.next.day < today);
    const body = h('ul', { class: 'inst-rows bk-sheet' }, rows.map((r) => h('li', { class: 'inst-row two tap' },
      h('span', { class: 'inst-n' }, h('b', { text: r.name }), h('small', { text: `${niceDay(r.next.day)} · ${r.next.step}` })),
      h('button', { class: 'inst-hit', type: 'button', 'aria-label': t('bk.row.aria', { name: r.name }), onclick: (e) => { const hit = e.currentTarget; closeSheet($('#formSheet')); openBiz(r.id, 'needs', hit); } }))));
    formSheet({ title: x.name, intro: t(x.key, { n: x.n, date: niceDay(x.date) }), body, submit: t('c.close'), onSubmit: async () => false });
  }
  function renderNeeds() {
    const n = team.needs, total = needsCount(), head = $('#needsGiant');
    if (total) head.replaceChildren(num(total), h('em', { text: '.' })); else head.replaceChildren(t('needs.zero').slice(0, -1), h('em', { text: '.' }));
    head.classList.toggle('word', !total);
    // nothing waits: the rest picture and one line, above the groups that each say they are empty
    put($('#needsNone'), total ? null : [restArt(), h('p', { class: 'note', text: t('needs.none') })]);
    $('#needsNone').hidden = !!total;
    const confirm = n.confirm.map((x) => h('li', { 'data-key': `c:${x.logId}:${x.what}` },
      h('span', {}, h('b', { text: t(`needs.what.${x.what}`, { lead: x.lead.name }) }), h('small', { text: `${x.name} · ${stamp(x.at, tzOf(repById(x.rep)))}` }),
        x.held ? h('small', { text: t('needs.held') }) : null, x.when ? h('small', { text: t('needs.when', { when: niceDay(x.when) }) }) : null, x.contact ? h('small', { text: t('needs.contact', { contact: x.contact }) }) : null),
      h('span', { class: 'acts' },
        h('button', { class: 'mini-btn primary', type: 'button', text: t(`needs.btn.${x.what}`), onclick: (e) => act(e.currentTarget, () => api('POST', 'confirm', { logId: x.logId, what: x.what }), 'needs.confirmed') }),
        h('button', { class: 'mini-btn', type: 'button', text: t('needs.btn.void'), onclick: () => voidLog(x.logId) }))));
    const silent = n.silent.map((x) => { const msg = t('needs.msg.silent', { name: x.name.split(' ')[0] }); return h('li', { 'data-key': `s:${x.rep}` },
      h('span', {}, h('b', { text: x.name }), h('small', { text: x.lastLogAt ? t('needs.silent.last', { when: ago(x.lastLogAt, team.serverTime, tzOf(repById(x.rep))) }) : t('needs.silent.never') })),
      h('span', { class: 'acts' }, copyBtn(msg)), h('p', { class: 'msg', lang: 'es', text: msg })); });
    const late = n.late.map((x) => { const zone = tzOf(repById(x.rep)); return h('li', { 'data-key': `l:${x.logId}` },
      h('span', {}, h('b', { text: `${x.name} · ${t(`kind.${x.kind}`)}` }), h('small', { text: x.lead.name }), h('small', { text: t('needs.late.meta', { server: stamp(x.at, zone), client: x.clientAt ? stamp(x.clientAt, zone) : '?' }) })),
      h('span', { class: 'acts' }, h('button', { class: 'mini-btn', type: 'button', text: t('needs.btn.void'), onclick: () => voidLog(x.logId) }))); });
    const pace = n.pace.map((x) => { const msg = t('needs.msg.pace', { name: x.name.split(' ')[0], a: x.marks, b: x.possible }); return h('li', { 'data-key': `p:${x.rep}` },
      h('span', {}, h('b', { text: x.name }), h('small', { text: t('needs.pace.item', { a: x.marks, b: x.possible }) })),
      h('span', { class: 'acts' }, copyBtn(msg)), h('p', { class: 'msg', lang: 'es', text: msg })); });
    const overdue = overdueLines(n).map((x) => h('li', { 'data-key': `o:${x.rep}` },
      h('span', {}, h('b', { text: x.name }), h('small', { text: t(x.key, { n: x.n, date: niceDay(x.date) }) })),
      h('span', { class: 'acts' },
        h('button', { class: 'mini-btn primary', type: 'button', text: t('col.overdue'), onclick: () => overdueSheet(x) }),
        h('a', { class: 'mini-btn', href: `?as=${encodeURIComponent(x.rep)}`, 'data-as': x.rep, text: t('mgr.viewas.row'), 'aria-label': t('mgr.viewas.row.aria', { name: x.name }), onclick: openAs }))));
    const sites = team.sites.map(siteItem);
    // the advances requested and not paid, oldest first, with the days waiting; "Adelanto" opens the form to mark it paid
    const advances = (n.advances || []).map((x) => { const rep = repById(x.rep), site = team.sites.find((y) => y.id === x.siteId); return h('li', { 'data-key': `a:${x.siteId}` },
      h('span', {}, h('b', { text: x.name }), h('small', { text: t('needs.adv.days', { date: dayMonth(x.asked), n: x.days }) }), rep ? h('small', { text: rep.name }) : null),
      h('span', { class: 'acts' }, site ? h('button', { class: 'mini-btn primary', type: 'button', text: t('site.advance'), onclick: () => advanceForm(site) }) : null)); });
    // wave 2, first: the meetings of today and the coming six days, what is stuck, and the day's blockers
    const dayWords = (d) => (d === dayOf(team.serverTime, S.me.me.tz) ? t('nav.today') : niceDay(d));
    const meetings = (n.meetings || []).map((x) => { const m = meetingRow(x); return h('li', {},
      h('span', {}, h('b', { text: m.lead ? m.lead.name : '' }), h('small', { text: [dayWords(m.day), m.time].filter(Boolean).join(' · ') }),
        h('small', { text: m.who.key ? t(m.who.key, m.who) : m.who.text }), m.held ? h('small', { text: t('needs.meet.held') }) : null),
      h('span', { class: 'acts' }, m.demo ? h('span', { class: 'chip', text: t('needs.meet.demo') }) : null)); });
    const stalled = (n.stalled || []).map((x) => { const l = stalledLine(x); return h('li', { 'data-key': `st:${x.logId}` },
      h('span', {}, h('b', { text: t(l.key, l) }), h('small', { text: x.name })),
      h('span', { class: 'acts' },
        h('button', { class: 'mini-btn primary', type: 'button', text: t('needs.stall.missed'), onclick: (e) => { const b = e.currentTarget; const k = missedKeys(x.kind); twice(e, k.sure, () => act(b, () => api('POST', 'stalled', { logId: x.logId, what: 'missed' }), k.done)); } }),
        h('button', { class: 'mini-btn', type: 'button', text: t('needs.stall.alive'), onclick: (e) => act(e.currentTarget, () => api('POST', 'stalled', { logId: x.logId, what: 'alive' }), 'needs.stall.alive.done') }))); });
    const blockers = (n.blockers || []).map((x) => { const old = x.day < dayOf(team.serverTime, tzOf(repById(x.rep))); return h('li', { 'data-key': `b:${x.rep}:${x.day}` },
      h('span', {}, h('b', { text: x.text }), h('small', { text: [x.name, old ? t('needs.block.yesterday') : null, x.seen ? t('needs.block.seen') : null].filter(Boolean).join(' · ') })),
      h('span', { class: 'acts' }, x.seen ? null : h('button', { class: 'mini-btn', type: 'button', text: t('needs.block.mark'), onclick: (e) => act(e.currentTarget, () => api('POST', 'blocker', { rep: x.rep, day: x.day }), null) }))); });
    // every business of every rep on its way to a site, what waits on a manager first (the server orders it)
    const ways = (team.routes || []).map((r) => {
      const rep = repById(r.rep), st = r.complete ? null : r.stops[r.at], stop = st ? t(`route.stop.${st.key}`) : '';
      const way = wayLine(r, { repFirst: rep ? rep.first : '' }), line = t(way.key, { ...way.params, stop });
      return h('li', { 'data-key': `w:${r.lead.id}` }, h('span', {}, h('b', { text: r.lead.name }), h('small', { text: st ? `${rep ? rep.name : ''} · ${t('ways.stop', { n: r.at + 1, b: r.stops.length, stop })}` : (rep ? rep.name : '') }), h('small', { text: line })));
    });
    const was = listKeys();   // what each list showed, so a row that left can go out where it was
    const addSite = h('button', { class: 'btn', type: 'button', id: 'addSiteBtn', text: t('needs.sites.add'), disabled: !siteReps(team, S.me.viewer.id).options.length, onclick: siteForm });
    $('#needsBody').replaceChildren(
      h('div', {}, group('needs.meet.title', meetings, 'needs.meet.empty'), group('needs.stall.title', stalled, 'needs.stall.empty'), group('needs.block.title', blockers, 'needs.block.empty'),
        group('needs.overdue.title', overdue, 'needs.overdue.empty'), group('needs.adv.title', advances, 'needs.adv.empty'), group('needs.confirm.title', confirm, 'needs.confirm.empty'), group('needs.late.title', late, 'needs.late.empty'), group('needs.sites.title', sites, 'needs.sites.empty', h('p', { class: 'note' }, addSite), false), group('needs.ways.title', ways, 'needs.ways.empty')),
      h('div', {}, group('needs.silent.title', silent, 'needs.silent.empty'), group('needs.pace.title', pace, 'needs.pace.empty'), (silent.length || pace.length) ? h('p', { class: 'note', text: t('needs.msg.note') }) : null,
        loadGroup()));
    leaveRows(was);
    fitArt($('#s-needs'));   // its rest picture takes only the room the first action leaves
  }
  /** Each list of Pendientes by its group, with its rows (their keys and the rows themselves), as drawn now. */
  const listKeys = () => new Map($$('#needsBody [data-group]').map((g) => [g.dataset.group, $$('li[data-key]', g).map((li) => ({ key: li.dataset.key, li }))]));
  /** A row that left a list (confirmed, voided, settled, paid) goes out where it was: it fades and slides right, then its
   *  height closes and the rows below move up into its place (craft-steps.js ROW_OUT). With reduced motion it is simply
   *  gone. The list itself was already drawn again: the row is put back only for as long as it leaves. */
  function leaveRows(was) {
    if (reduce) return;
    // a group's own count rolls with its row: it keeps the old number while the row fades, then rolls as the height closes
    const now = new Map($$('#needsBody [data-group]').map((g) => [g.dataset.group, $$('li[data-key]', g).length]));
    for (const { group: key, from, to } of countRolls(new Map([...was].map(([k, rows]) => [k, rows.length])), now)) {
      const head = $$('#needsBody [data-group]').map((g) => $('h2', g)).find((x) => x && x.parentElement.dataset.group === key);
      if (!head) continue;
      let count = $('.count', head);
      if (!count) { count = h('span', { class: 'count num' }); head.append(' ', count); }   // emptied: the old number stays until the row has gone
      count.textContent = String(from); count.dataset.roll = String(from);
      setTimeout(() => { if (!count.isConnected) return; if (to) roll(count, String(to)); else { count.previousSibling?.remove(); count.remove(); } }, ROW_OUT.fade);
    }
    for (const [groupKey, rows] of was) {
      const group = $$('#needsBody [data-group]').find((g) => g.dataset.group === groupKey);
      if (!group) continue;
      const now = $$('li[data-key]', group).map((li) => li.dataset.key);
      for (const { key, after } of goneRows(rows.map((r) => r.key), now)) {
        const row = rows.find((r) => r.key === key).li, prev = after ? $$('li[data-key]', group).find((li) => li.dataset.key === after) : null;
        let list = $('ul.items', group);
        if (!list) { list = h('ul', { class: 'items' }); $('h2', group).after(list); }   // the list emptied: its line waits under the leaving row
        if (prev) prev.after(row); else list.prepend(row);
        row.inert = true;
        const out = row.animate([{ opacity: 1, transform: 'none' }, { opacity: 0, transform: `translateX(${ROW_OUT.x}px)` }], { duration: ROW_OUT.fade, easing: EASE.out, fill: 'forwards' });
        out.onfinish = () => {
          const cs = getComputedStyle(row), from = { height: `${row.getBoundingClientRect().height}px`, paddingTop: cs.paddingTop, paddingBottom: cs.paddingBottom, opacity: 0 };
          const shut = row.animate([from, { height: '0px', paddingTop: '0px', paddingBottom: '0px', opacity: 0 }], { duration: ROW_OUT.close, easing: EASE.out, fill: 'forwards' });
          shut.onfinish = () => { row.replaceWith(); if (list.isConnected && !list.children.length) list.replaceWith(); };
        };
      }
    }
  }
  /** "Por cargar": the quiet end of Pendientes, only when something a rep's screens point at is missing in Documents.
   *  "Cargar" opens the document form with its group and step chosen. It never counts in the tab's number. */
  function loadGroup() {
    const items = toLoad(S.docs);
    if (!items.length) return null;
    return group('needs.load.title', items.map((x) => h('li', {}, h('span', {}, h('b', { text: t(x.key) })),
      h('span', { class: 'acts' }, h('button', { class: 'mini-btn', type: 'button', text: t('needs.load.btn'), onclick: () => docForm({ group: x.group, step: x.step }) })))), null, null, false);
  }

  // ---- sites: each one with the controls its state allows (manager-steps.js decides which) ----
  const siteCall = (id, body) => api('POST', `site/${encodeURIComponent(id)}`, body);
  /** "Llegaron teléfonos": a shipment, added to what already came. */
  function shipment(s) {
    formSheet({ title: t('site.arrived.title'), intro: t('site.arrived.intro', { name: s.lead.name }), submit: t('site.phones.submit'),
      fields: [{ name: 'count', type: 'number', label: t('site.arrived.count') }],
      onSubmit: async (v) => {
        const body = arrivedBody(v), res = await wrote(() => siteCall(s.id, body));
        const now = res && res.sites ? res.sites.find((x) => x.id === s.id) : null;
        toast(t('site.arrived.done', { n: now && now.phones != null ? now.phones : (s.phones || 0) + body.count })); await refresh(false);
      } });
  }
  /** "Cambiar pedido": how many phones the site needs. */
  function phonesRequest(s) {
    formSheet({ title: t('site.act.request'), intro: s.lead.name, submit: t('site.phones.submit'),
      fields: [{ name: 'count', type: 'number', label: t('site.form.request'), hint: t('site.form.request.hint'), value: s.requested ? String(s.requested) : '' }],
      onSubmit: async (v) => { const count = phoneCount(v.count); await wrote(() => siteCall(s.id, { what: 'request', count })); toast(t('site.request.done')); await refresh(false); } });
  }
  /** "Corregir el total": the correction that replaces how many phones came (a shipment, "Llegaron teléfonos", adds). */
  function phonesArrived(s) {
    formSheet({ title: t('site.act.fix'), intro: t('site.fix.intro', { name: s.lead.name }), submit: t('site.phones.submit'),
      fields: [{ name: 'count', type: 'number', label: t('site.fix.count'), value: s.phones ? String(s.phones) : '' }],
      onSubmit: async (v) => {
        const body = fixBody(v);
        await wrote(() => siteCall(s.id, body)); toast(t('site.fix.done', { n: body.count })); await refresh(false);
      } });
  }
  /** A live site's accepted hours for one week, as the buyers' report gives them. A later value replaces the earlier. */
  function siteHours(s) {
    const today = dayOf(team.serverTime, S.me.me.tz), weeks = recentMondays(today, 6);
    formSheet({ title: t('sites.hours.title'), intro: t('sites.hours.p', { name: s.lead.name }), submit: t('site.phones.submit'),
      fields: [{ name: 'week', type: 'select', label: t('site.hours.week'), value: weeks[0], options: weeks.map((w) => ({ value: w, label: t('week.of', { date: dayMonth(w) }) })) },
        { name: 'h', type: 'number', label: t('site.hours.h') }, { name: 'm', type: 'number', label: t('site.hours.m') }],
      onSubmit: async (v) => { const body = siteHoursBody(v); await wrote(() => siteCall(s.id, body)); toast(t('site.hours.done')); await refresh(false); } });
  }
  function siteButton(kind, s) {
    const btn = (key, cls, run) => h('button', { class: cls ? `mini-btn ${cls}` : 'mini-btn', type: 'button', 'data-act': kind, text: t(key), onclick: run });
    if (kind === 'install') return btn(s.legacy ? 'site.act.consents' : 'site.act.install', '', () => openInstall(s.id));   // a legacy site loads its past consents there
    if (kind === 'arrived') return btn('site.act.arrived', '', () => shipment(s));
    if (kind === 'request') return btn('site.act.request', '', () => phonesRequest(s));
    if (kind === 'phones') return btn('site.act.fix', '', () => phonesArrived(s));
    if (kind === 'confirm') return btn('site.act.confirm', 'primary', (e) => act(e.currentTarget, () => siteCall(s.id, { what: 'installed' }), s.practice ? 'route.prac.saved' : 'site.confirmed'));   // a practice site counts in no total
    if (kind === 'installed' || kind === 'first_hour') return btn(`needs.sites.mark.${kind}`, '', (e) => act(e.currentTarget, () => siteCall(s.id, { what: kind }), 'needs.sites.done'));
    if (kind === 'hours') return btn('site.act.hours', '', () => siteHours(s));
    if (kind === 'record') return h('a', { class: 'mini-btn', 'data-act': kind, href: recordUrl(s.id), download: `record-${s.id}.csv`, text: t('site.act.record') });
    if (kind === 'remove') return btn('site.act.remove', '', (e) => { const b = e.currentTarget; twice(e, 'site.act.remove.confirm', () => act(b, () => siteCall(s.id, { what: 'remove' }), 'site.removed')); });
    return btn('needs.sites.void', '', (e) => { const b = e.currentTarget; twice(e, 'needs.sites.void.confirm', () => act(b, () => siteCall(s.id, { what: 'void' }), 'needs.sites.voided')); });
  }
  /** "Adelanto": when the business's advance was requested and when it was paid, or the mark taken off. The rep sees
   *  it on the route's site stop. No amount, no name, no bank detail is asked. */
  function advanceForm(s) {
    const a = s.advance || {};
    const clear = h('button', { class: 'mini-btn', type: 'button', text: t('site.advance.clear'), hidden: !a.asked, onclick: (e) => once(e.currentTarget, async () => {
      try { await wrote(() => siteCall(s.id, { what: 'advance', asked: null, paid: null })); closeSheet($('#formSheet')); toast(t('site.advance.cleared')); await refresh(false); } catch (err) { toastErr(errText(err)); }
    }) });
    formSheet({ title: t('site.advance.title'), intro: t('site.advance.p', { name: s.lead.name }), submit: t('docs.form.submit'), body: h('div', { class: 'bz-acts' }, clear),
      fields: [{ name: 'asked', type: 'date', label: t('site.advance.asked'), value: a.asked || '' }, { name: 'paid', type: 'date', label: t('site.advance.paid'), value: a.paid || '' }],
      onSubmit: async (v) => { const body = advanceBody(v); await wrote(() => siteCall(s.id, body)); toast(t(body.asked ? 'site.advance.done' : 'site.advance.cleared')); await refresh(false); } });
  }
  /** The advance's line on a site: paid on a day, else requested on a day. */
  const advanceText = (s) => { const l = advanceLine(s); return l ? t(l.key, { date: dayMonth(l.date) }) : null; };
  /** A live site's daily report: open it, or once sent today, when, opening it to read or edit. */
  function reportButton(s, zone) {
    return h('button', { class: `mini-btn rpt-act${s.report ? ' sent' : ''}`, type: 'button', 'data-act': 'report', text: s.report ? t('report.sent', { time: clock(s.report, zone) }) : t('report.open'), onclick: () => openReport(s.id, zone) });
  }
  const phonesText = (s) => { const l = phonesLine(s); return l ? t(l.key, l) : null; };
  function siteItem(s) {
    const rep = repById(s.rep), zone = tzOf(rep), key = s.practice ? null : siteStateKey(s);
    // a legacy site counts the consents loaded against the workers it has: "3 de 40 consentimientos"
    const facts = (s.legacy ? [key ? t(`lead.state.${key}`) : null, s.city ? cityName(s.city) : null, s.eligible != null ? t('site.meta.consents', { a: s.consents || 0, b: s.eligible }) : t('site.meta.consents.n', { n: s.consents || 0 })]
      : [key ? t(`lead.state.${key}`) : null, s.city ? cityName(s.city) : null, s.eligible != null ? t('site.meta.eligible', { n: s.eligible }) : null,
        s.workers ? t('site.meta.workers', { n: s.workers }) : null, phonesText(s)]).filter(Boolean).join(' · ');
    return h('li', { class: 'site-li', 'data-site': s.id, 'data-key': `site:${s.id}` },
      h('span', {}, h('b', {}, s.lead.name, s.practice ? [' ', h('span', { class: 'chip inst-prac', text: t('install.practice') })] : null), h('small', { text: `${rep ? rep.name : ''} · ${stamp(s.at, zone)}` }),
        facts ? h('small', { text: facts }) : null,
        ['installed', 'first_hour'].filter((k) => s.steps[k]).map((k) => h('small', { text: `${t(`needs.sites.${k}`)}: ${stamp(s.steps[k], zone)}` })),
        advanceText(s) ? h('small', { text: advanceText(s) }) : null),
      h('span', { class: 'acts' }, s.reportable ? reportButton(s, zone) : null, siteActions(s).filter((k) => k !== 'void').map((k) => siteButton(k, s)),
        canAdvance(s) ? h('button', { class: 'mini-btn', type: 'button', 'data-act': 'advance', text: t('site.advance'), onclick: () => advanceForm(s) }) : null,
        siteActions(s).includes('void') ? siteButton('void', s) : null));
  }
  /** A new site. The id is made when the form opens: sending the form twice records one site. */
  function siteForm() {
    const siteId = `s_${newId()}`, known = team.cities || [], who = siteReps(team, S.me.viewer.id), first = repById(who.value);
    const city = (first && (known.find((k) => sameText(k, first.city)) || first.city)) || known[0] || '';
    formSheet({ title: t('needs.sites.title'), submit: t('needs.sites.submit'),
      fields: [{ name: 'rep', type: 'select', label: t('needs.sites.rep'), value: who.value, options: who.options.map((o) => (o.practice ? { value: o.value, label: `${t('reps.practice.name')} · ${t('install.practice')}` } : o)) }, { name: 'name', label: t('needs.sites.name') },
        known.length ? { name: 'city', type: 'pick', label: t('site.form.city'), value: city, max: 60, other: t('reps.form.city.other'), otherLabel: t('reps.form.city.other.label'),
          options: [...known, ...(city && !known.includes(city) ? [city] : [])].map((c) => ({ value: c, label: cityName(c) })) } : { name: 'city', label: t('site.form.city'), value: city, max: 60 },
        { name: 'eligible', type: 'number', label: t('site.form.eligible'), hint: t('site.form.eligible.hint') },
        { name: 'request', type: 'number', label: t('site.form.request'), hint: t('site.form.request.hint') },
        { name: 'coordName', label: t('site.form.coord.name'), max: 80 }, { name: 'coordPhone', type: 'tel', label: t('site.form.coord.phone'), max: 30 },
        { name: 'kind', type: 'select', label: t('site.form.kind'), value: 'normal', options: ['normal', 'practice', 'legacy'].map((k) => ({ value: k, label: t(`site.kind.${k}`) })) }],
      onSubmit: async (v) => { const body = siteBody(v, siteId, siteLeadId(team, v.rep, v.name)); await wrote(() => api('POST', 'site', body)); toast(t('needs.sites.added')); await refresh(false); } });
  }

  // ---- reps ----
  function repForm(rep = null) {
    const today = dayOf(team.serverTime, S.me.me.tz);
    const fields = [{ name: 'name', label: t('reps.form.name'), value: rep ? rep.name : '', max: 80 }];
    // The address is the person's way in. Nobody edits their own: a slip would lock them out.
    const own = !!rep && rep.id === S.me.viewer.id;
    // A new person may come in with no access for now: on the team and counted, with nobody signing in as them.
    if (!rep) fields.push({ name: 'access', type: 'select', label: t('reps.form.access'), hint: t('reps.form.access.hint'), value: 'mail', options: ['mail', 'none'].map((k) => ({ value: k, label: t(`reps.form.access.${k}`) })) });
    // A person with no address yet is given one here, under the same rules: from then on that account opens the board.
    if (!own) fields.push({ name: 'email', type: 'email', label: t(rep && !rep.email ? 'reps.form.email.give' : 'reps.form.email'), hint: t('reps.form.email.hint'), value: rep ? rep.email : '', lower: true, max: 120 });
    // The city decides which businesses a rep can pick, so it comes from the business list. Another one can still be written.
    const known = team.cities || [], listed = (c) => known.find((k) => sameText(k, c));
    const city = rep ? (listed(rep.city) || rep.city) : (listed('Panama City') || known[0] || 'Panama City');
    fields.push(known.length
      ? { name: 'city', type: 'pick', label: t('reps.form.city'), hint: t('reps.form.city.pick'), value: city, max: 60, other: t('reps.form.city.other'), otherLabel: t('reps.form.city.other.label'), otherHint: t('reps.form.city.hint'),
        options: [...known, ...(city && !listed(city) ? [city] : [])].map((c) => ({ value: c, label: cityName(c) })) }
      : { name: 'city', label: t('reps.form.city'), hint: t('reps.form.city.hint'), value: city, max: 60 },
      { name: 'country', type: 'select', label: t('reps.form.country'), value: rep ? rep.country : 'PA', options: countryOptions(rep ? rep.country : 'PA').map((c) => ({ value: c, label: countryText(c) })) },
      { name: 'startDate', type: 'date', label: t('reps.form.start'), value: rep ? rep.startDate : today },
      { name: 'workdays', type: 'days', label: t('reps.form.workdays'), value: rep ? rep.workdays : [1, 2, 3, 4, 5], options: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: dayName(n) })) });
    const roles = rep ? [] : roleOptions(S.me.viewer.role);   // only an admin picks a role, Liderazgo among them
    if (roles.length) fields.push({ name: 'role', type: 'select', label: t('reps.form.role'), value: 'rep', options: roles.map((r) => ({ value: r, label: t(`role.${r}`) })) });
    const dlg = formSheet({ title: t(rep ? 'reps.edit.title' : 'reps.add.title'), submit: t(rep ? 'reps.form.save' : 'reps.form.submit'), fields,
      onSubmit: async (v) => {
        if (!v.city) throw { code: 'fields' };
        v.city = listed(v.city) || v.city;   // the list's own spelling when it is the same city
        if (rep) { await wrote(() => api('POST', `reps/${encodeURIComponent(rep.id)}`, { patch: { name: v.name, city: v.city, country: v.country, startDate: v.startDate, workdays: v.workdays, ...(own || v.email.toLowerCase() === (rep.email || '') ? {} : { email: v.email }) } })); toast(t('reps.saved')); renderAll(false); return false; }
        // Nothing to hand over: from now on that Google account opens the board.
        await wrote(() => api('POST', 'reps', newRepBody(v)));
        toast(t(v.access === 'none' ? 'reps.added.noaccess' : 'reps.added', { name: v.name.trim().split(/\s+/)[0] })); renderAll(false);
        return false;
      } });
    // "No access for now" hides the email and the role: the server skips both on that path.
    const access = dlg.querySelector('#fs-access');
    if (access) {
      const sync = () => { for (const n of ['email', 'role']) { const f = dlg.querySelector(`[data-name="${n}"]`); if (f) f.hidden = access.value === 'none'; } };
      access.onchange = sync; sync();
    }
  }
  function dayOff() {
    const today = dayOf(team.serverTime, S.me.me.tz), countries = teamCountries(team.reps);
    formSheet({ title: t('reps.dayoff.title'), intro: t('reps.dayoff.p'), submit: t('reps.dayoff.submit'),
      fields: [{ name: 'what', type: 'select', label: t('reps.dayoff.what'), value: 'mark', options: [{ value: 'mark', label: t('reps.dayoff.mark') }, { value: 'undo', label: t('reps.dayoff.unmark') }] },
        { name: 'date', type: 'date', label: t('reps.dayoff.date'), value: today },
        { name: 'scope', type: 'select', label: t('reps.dayoff.scope'), value: 'all', options: [{ value: 'all', label: t('reps.dayoff.all') }, ...countries.map((c) => ({ value: c, label: t('reps.dayoff.country', { country: countryText(c) }) })), ...team.reps.map((r) => ({ value: r.id, label: r.name }))] }],
      onSubmit: async (v) => { const undo = v.what === 'undo'; await wrote(() => api('POST', 'dayoff', { scope: v.scope, date: v.date, ...(undo ? { undo: true } : {}) })); toast(t(undo ? 'reps.dayoff.undone' : 'reps.dayoff.done')); await refresh(false); } });
  }
  function repItem(r, isPlayer) {
    // Without an address nobody can come in as this person: the list says so until a manager adds it.
    const status = !r.active ? h('small', { text: t('reps.inactive') }) : null;
    const days = r.workdays.map(dayName).join(' ');
    const self = r.id === S.me.viewer.id;
    // How many businesses of the list this rep can pick. None means the city is written another way than in the list.
    const leads = !isPlayer || !team.leadCount || !r.active ? null : r.leadsInCity ? h('small', { text: t('reps.leads', { n: r.leadsInCity }) }) : h('small', { class: 'warn', text: t('reps.leads.none') });
    // the first days, and the one step a manager ticks (in the sheet): the first approved hour, with its undo
    const ladder = isPlayer && r.ladderDone != null ? h('small', { class: 'rep-lad', text: t('reps.ladder', { n: r.ladderDone }) }) : null;
    const can = repActions({ isPlayer, admin: isAdmin(), self, active: r.active, role: r.role, ladder: isPlayer && r.ladderDone != null, hourDone: !!r.hourDone });
    return h('li', { 'data-rep': r.id },
      h('span', { class: 'pers' }, face(r), h('span', { class: 'pt' }, h('b', { text: r.name }), r.email ? h('small', { class: 'mail', text: r.email }) : h('span', { class: 'chip ghost noacc', text: t('reps.noaccess') }), h('small', { text: `${isPlayer ? '' : `${t(`role.${r.role}`)} · `}${cityName(r.city)} · ${t('reps.start', { date: dayMonth(r.startDate) })} · ${days}` }), status, leads, ladder)),
      // one action on the row; the others in a sheet, opened by "Más", outlined like every secondary action (craft-steps.js repActions)
      h('span', { class: 'acts' },
        can.shown.includes('viewas') ? h('a', { class: 'mini-btn', href: `?as=${encodeURIComponent(r.id)}`, 'data-as': r.id, onclick: openAs, text: t('mgr.viewas', { name: r.first }) }) : null,
        can.more.length ? h('button', { class: 'mini-btn', type: 'button', 'data-act': 'more', text: t('reps.more'), 'aria-label': t('reps.more.aria', { name: r.name }), 'aria-haspopup': 'dialog', onclick: () => moreSheet(r, can.more) }) : null));
  }
  /** "Más": a rep's other actions, one full-width row each, switching them off last and in signal ink. A step that is
   *  hard to take back asks twice there as it did on the row; the sheet closes once an action is done, and stays open with
   *  the reason on its own line when one fails. */
  function moreSheet(r, keys) {
    const dlg = $('#moreSheet');
    const err = $('#moreErr'), said = (text) => { err.textContent = text; err.hidden = false; };
    err.hidden = true;
    const done = (run) => async (e) => { const b = e.currentTarget; err.hidden = true; if ((await run(b)) === true && dlg.open) closeSheet(dlg); };
    const row = (key, text, run, cls = '', aria = null) => h('button', { class: `more-act${cls ? ` ${cls}` : ''}`, type: 'button', 'data-act': key, text, 'aria-label': aria, onclick: run });
    const hit = {
      hour: () => row('hour', t('reps.ladder.hour'), done((b) => act(b, () => api('POST', 'ladder', { step: 'hour', rep: r.id }), 'reps.ladder.hour.done', said)), '', t('reps.ladder.hour.aria', { name: r.name })),
      'hour-undo': () => row('hour-undo', t('reps.ladder.hour.undo'), done((b) => act(b, () => api('POST', 'ladder', { step: 'hour', rep: r.id, undo: true }), 'reps.ladder.hour.undone', said)), '', t('reps.ladder.hour.undo.aria', { name: r.name })),
      edit: () => row('edit', t('reps.edit'), () => { closeSheet(dlg); repForm(r); }),
      deactivate: () => row('deactivate', t('reps.deactivate'), (e) => { const b = e.currentTarget; twice(e, () => toast(r.name, t('reps.deactivate')), () => act(b, () => api('POST', `reps/${encodeURIComponent(r.id)}`, { patch: { active: false } }), 'reps.saved', said).then((ok) => { if (ok === true && dlg.open) closeSheet(dlg); })); }, 'danger'),
      activate: () => row('activate', t('reps.activate'), done((b) => act(b, () => api('POST', `reps/${encodeURIComponent(r.id)}`, { patch: { active: true } }), 'reps.saved', said))),
    };
    $('#moreH').textContent = r.name;
    $('#moreP').textContent = `${cityName(r.city)} · ${t('reps.start', { date: dayMonth(r.startDate) })}`;
    put($('#moreActs'), keys.map((k) => hit[k]()));
    openSheet(dlg);
  }
  /** The practice rep: one control to create it, then a way into its screens (writes allowed) and a remove in two taps. */
  function practiceGroup() {
    const acts = practiceActions(team, S.me.viewer.role);
    if (!acts.length) return null;
    const p = team.practice;
    const btn = (key, cls, run) => h('button', { class: cls ? `mini-btn ${cls}` : 'mini-btn', type: 'button', 'data-act': `practice-${key}`, text: t(`reps.practice.${key}`), onclick: run });
    const controls = acts.map((k) => (k === 'create' ? btn('create', 'primary', (e) => act(e.currentTarget, () => api('POST', 'practice', {}), 'reps.practice.created'))
      : k === 'view' ? h('a', { class: 'mini-btn primary', 'data-act': 'practice-view', href: `?as=${encodeURIComponent(p.id)}`, 'data-as': p.id, onclick: openAs, text: t('reps.practice.view') })
        : btn('remove', '', (e) => { const b = e.currentTarget; twice(e, 'reps.practice.remove.confirm', () => act(b, () => api('POST', 'practice/remove', {}), 'reps.practice.removed')); })));
    const who = p ? h('span', { class: 'pers' }, face({ ...p, name: t('reps.practice.name') }), h('span', { class: 'pt' }, h('b', {}, t('reps.practice.name'), ' ', h('span', { class: 'chip inst-prac', text: t('install.practice') })), h('small', { text: t('reps.practice.p') })))
      : h('span', { class: 'pers' }, h('span', { class: 'pt' }, h('small', { text: t('reps.practice.p') })));
    return h('section', { class: 'group', id: 'practiceGroup' }, h('h2', { text: t('reps.practice.h') }), h('ul', { class: 'items' }, h('li', {}, who, h('span', { class: 'acts' }, controls)), exampleGroup()));
  }
  /** The example team: one control to load it; then a way into each one's screens (writes allowed, practice only) and
   *  one remove, in two taps, for all four. */
  function exampleGroup() {
    const acts = exampleActions(team, S.me.viewer.role);
    if (!acts.length) return null;
    if (acts[0] === 'load') {
      return h('li', { 'data-example': 'none' }, h('span', { class: 'pers' }, h('span', { class: 'pt' }, h('b', { text: t('reps.example.load') }), h('small', { text: t('reps.example.p') }))),
        h('span', { class: 'acts' }, h('button', { class: 'mini-btn primary', type: 'button', 'data-act': 'example-load', text: t('reps.example.load'), onclick: (e) => act(e.currentTarget, () => api('POST', 'practice/example', {}), 'reps.example.loaded') })));
    }
    const rows = team.example.map((r) => h('li', { 'data-example': r.example },
      h('span', { class: 'pers' }, face(r), h('span', { class: 'pt' }, h('b', {}, r.name, ' ', h('span', { class: 'chip inst-prac', text: t('install.practice') })), h('small', { text: r.isNew ? t('table.new') : cityName(r.city) || t('install.practice') }))),
      h('span', { class: 'acts' }, h('a', { class: 'mini-btn primary', 'data-act': 'example-view', href: `?as=${encodeURIComponent(r.id)}`, 'data-as': r.id, onclick: openAs, text: t('reps.example.view', { name: r.name }) }))));
    // a team made for an earlier day: one press brings it to today's week (the old one goes whole, today's comes in)
    const refresh = acts.includes('refresh') ? h('li', { 'data-example': 'stale' }, h('span', { class: 'pers' }, h('span', { class: 'pt' }, h('b', { text: t('reps.example.stale') }), h('small', { text: t('reps.example.stale.p') }))),
      h('span', { class: 'acts' }, h('button', { class: 'mini-btn primary', type: 'button', 'data-act': 'example-refresh', text: t('reps.example.refresh'), onclick: (e) => act(e.currentTarget, () => api('POST', 'practice/example', {}), 'reps.example.refreshed') }))) : null;
    const remove = h('li', {}, h('span', { class: 'pers' }, h('span', { class: 'pt' }, h('small', { text: t('reps.example.p') }))),
      h('span', { class: 'acts' }, h('button', { class: 'mini-btn', type: 'button', 'data-act': 'example-remove', text: t('reps.example.remove'), onclick: (e) => { const b = e.currentTarget; twice(e, 'reps.example.remove.confirm', () => act(b, () => api('POST', 'practice/example/remove', {}), 'reps.example.removed')); } })));
    return [refresh, ...rows, remove].filter(Boolean);
  }
  /** What a rep earns per accepted hour. Everyone sees it; only an admin sets it. */
  function payLine() {
    const p = team.pay;
    const text = p ? t('pay.now', { r: usd(p.cents), date: dayMonth(p.from) }) : t('pay.none');
    return h('div', { class: 'line', id: 'payLine' }, h('span', {}, h('b', { text: t('pay.h') }), ' ', text),
      isAdmin() ? h('button', { class: 'mini-btn', type: 'button', 'data-act': 'pay', text: t(p ? 'c.change' : 'pay.set'), onclick: payForm }) : null);
  }
  function payForm() {
    const today = dayOf(team.serverTime, S.me.me.tz), weeks = payWeeks(today, team.pay, 6);
    formSheet({ title: t('pay.form.title'), intro: t('pay.form.p'), submit: t('site.phones.submit'),
      fields: [{ name: 'usd', label: t('pay.form.usd'), hint: t('pay.form.usd.hint'), value: team.pay ? (team.pay.cents / 100).toFixed(2) : '', max: 8 },
        { name: 'from', type: 'select', label: t('pay.form.from'), value: weeks[0], options: weeks.map((w) => ({ value: w, label: t('week.of', { date: dayMonth(w) }) })) }],
      onSubmit: async (v) => { const body = payBody(v); await wrote(() => api('POST', 'pay', body)); renderAll(false); toast(t('pay.saved')); refresh(false); } });
  }
  function renderReps() {
    $('#repsGiant').replaceChildren(num(team.reps.length), h('em', { text: '.' }));
    put($('#repsBody'),
      team.reps.length ? h('ul', { class: 'items' }, team.reps.map((r) => repItem(r, true))) : h('p', { class: 'note', text: t('mgr.none') }),
      practiceGroup(),
      team.others.length ? h('section', { class: 'group' }, h('h2', { text: t('reps.others') }), h('ul', { class: 'items' }, team.others.map((r) => repItem(r, false)))) : null,
      h('section', { class: 'group' }, h('h2', { text: t('profile.settings') }), h('div', { class: 'settings' }, payLine(),
        h('div', { class: 'line' }, h('span', { text: S.me.viewer.email ? t('profile.account', { email: S.me.viewer.email }) : '' }), h('button', { class: 'mini-btn signout', type: 'button', text: t('profile.signout'), onclick: signOut })))));
  }

  function render(animate = false) {
    if (!team) { renderMissing(); return; }
    const box = $('#teamRetry');
    if (box) box.hidden = true;
    renderTeam(animate); renderNeeds(); renderReps();
    $('#dayoffBtn').onclick = dayOff; $('#addRepBtn').onclick = () => repForm();
    for (const id of ['#dayoffBtn', '#addRepBtn']) $(id).disabled = false;
  }
  /** The active reps, for a business's card: who a manager can give a business to. */
  const reps = () => (team ? team.reps.map((r) => ({ id: r.id, name: r.name, city: r.city })) : []);
  return { load, render, needsCount, voidLog, giveBadge, undoConfirm, reopenDay, reps };
}
