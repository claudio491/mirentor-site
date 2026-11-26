// book.js: the businesses a rep holds, as Hoy and "Mis negocios" show them. "Para hoy" on Hoy: a meeting that should
// have happened asks about itself first, then what is overdue and due today, oldest first, three rows; with nothing
// due, the free businesses of the rep's two zones. The server builds the agenda and the lists (lib/team/biz.mjs);
// biz-steps.js decides the words. Through view-as nothing that writes shows.
import { $, $$, h, put, t, num, dayMonth, toast, toastErr, once, countTo, reduce, quiet, icon } from './ui.js';
import { reveal, stagger } from './fx.js';
import { paintArt, restArt } from './art-lead.js';
import { leadArt } from './craft-steps.js';
import { todoCard, dueText as dueWords, heldAsk, hoyLine, readPath, sectionOf, BOOK_LISTS, modeOf, readOnlyOf, stillHere, listsAfter } from './biz-steps.js';

export function createBook({ api, S, errText, adopt, renderAll, setTab, openBiz, openLog, today }) {
  let free = null, freeFor = null, freeAsked = false, freeFailed = false, freeTicket = 0;
  const mode = () => modeOf(S);
  const readOnly = () => readOnlyOf(S);
  const dueText = (next) => dueWords(next, today(), t, dayMonth);

  /** A row of a business: its name, when its next step is due and the step; the whole row opens its card. */
  const row = (r, from, sub) => h('li', { class: 'inst-row two tap' }, h('span', { class: 'inst-n' }, h('b', { text: r.name }), h('small', { text: sub })),
    h('button', { class: 'inst-hit', type: 'button', 'aria-label': t('bk.row.aria', { name: r.name }), onclick: (e) => openBiz(r.id, from, e.currentTarget) }));
  const dueRow = (r, from) => row(r, from, [dueText(r.next), r.next && r.next.step].filter(Boolean).join(' · '));
  const freeRow = (r, from) => row(r, from, r.zone || t('log.nozone'));

  /** The free businesses of the rep's zones, for the card with nothing due: kept for whom they were read and the day
   *  (freeFor), read again for anyone else or another day, and forgotten after anything that can take a business.
   *  Each read carries a ticket: an older read that lands after a newer one is dropped. A read that fails is marked
   *  (freeFailed), so the card says it could not read the list instead of saying there is nothing. */
  const freeKey = () => `${S.me.me.id}|${today()}`;
  function readFree() {
    const key = freeKey();
    if (freeFor !== key) { free = null; freeFor = key; freeAsked = false; freeFailed = false; }
    if (freeAsked) return;
    freeAsked = true;
    const mine = ++freeTicket;
    api('GET', readPath('leads?list=free', mode(), S.as))
      .then((res) => { if (mine !== freeTicket || freeFor !== key) return; free = res.leads; freeFailed = false; renderAll(false); })
      .catch(() => { if (mine !== freeTicket || freeFor !== key) return; freeFailed = true; renderAll(false); });
  }
  /** A log, a write on a card or a change of person can take a business: the free list is read again. */
  function forget() { free = null; freeFor = null; freeAsked = false; freeFailed = false; freeTicket += 1; }
  /** The free list's retry on the card. */
  function freeAgain() { freeAsked = false; freeFailed = false; readFree(); renderAll(false); }

  /** "Para hoy" on Hoy. */
  function card(slot) {
    const agenda = S.me && S.me.agenda;
    if (!agenda || S.mgr || !S.me.today) { slot.hidden = true; slot.replaceChildren(); return; }
    const ask = readOnly() ? [] : heldAsk(S.me.pending, agenda.meetings, today());
    const c = todoCard(agenda, freeFor === freeKey() ? free : null, ask);
    if (c.mode !== 'due') readFree();
    const counts = [c.late ? t('bk.card.late', { n: c.late }) : null, c.today ? t('bk.card.today', { n: c.today }) : null].filter(Boolean).join(' · ');
    slot.hidden = false;
    put(slot,
      h('div', { class: 'inst-card-h' }, h('span', { class: 'label', id: 'bkCardH', text: t('bk.card') }), counts ? h('span', { class: 'label num', text: counts }) : null),
      ask.length ? heldBlock(ask[0]) : null,
      c.mode === 'due' ? (c.rows.length ? h('ul', { class: 'inst-rows' }, c.rows.map((r) => dueRow(r, 'today'))) : null)
        : c.mode === 'free' ? [h('p', { class: 'bk-say', text: t('bk.card.free') }), h('ul', { class: 'inst-rows' }, c.rows.map((r) => freeRow(r, 'today')))]
          : ask.length ? null : freeFailed && freeFor === freeKey()
            ? h('button', { class: 'bz-more bk-retry', type: 'button', onclick: freeAgain }, h('span', { text: t('bk.failed') }), h('b', { text: t('bk.retry') }))
            : h('p', { class: 'bk-say', text: t('bk.card.empty') }),
      c.mode === 'due' || c.mode === 'free' ? h('div', { class: 'bz-acts' }, h('button', { class: 'mini-btn', type: 'button', text: c.more > 0 ? `${t('bk.card.all')} · ${num(c.more + c.rows.length)}` : t('bk.card.all'), onclick: (e) => open('today', e.currentTarget) })) : null);
  }

  /** The one line of Para hoy above Hoy's stage, when something is due: the first business and how late it is, or the
   *  question about a meeting, and how many more. A tap opens "Mis negocios". Absent with nothing due. */
  function line(node) {
    const agenda = S.me && S.me.agenda;
    const l = agenda && !S.mgr && S.me.today ? hoyLine(agenda, readOnly() ? [] : S.me.pending, today()) : null;
    node.hidden = !l;
    if (!l) { node.replaceChildren(); return; }
    // two rows: the business's name alone (or the question), then how late it is and how many more
    const held = l.key === 'bk.held.ask', more = l.more ? t('bk.line.more', { n: l.more }) : '';
    const rest = held ? (more ? [more] : []) : [h('span', { class: l.key === 'bk.line.late' ? 'bk-late' : null, text: t(l.key, { n: l.n }) }), more ? ` · ${more}` : null];
    put(node, h('span', { class: 'bk-ln-t' }, h('span', { class: 'bk-ln-n', text: held ? t(l.key, { name: l.name }) : l.name }), rest.length ? h('span', { class: 'bk-ln-s' }, ...rest) : null), icon('go'));
  }

  /** "¿Se hizo la reunión con …?": yes says it happened (the manager confirms it); "Se movió" opens the sheet on that
   *  business with the meeting result marked, to book its new day. */
  function heldBlock(m) {
    const when = `${m.when === today() ? t('nav.today') : dayMonth(m.when)}${m.time ? ` · ${m.time}` : ''}`;
    return h('div', { class: 'bk-held' }, h('p', { class: 'lead', text: t('bk.held.ask', { name: m.name }) }), h('small', { class: 'bk-sub', text: when }),
      h('div', { class: 'bz-acts' },
        h('button', { class: 'mini-btn primary', type: 'button', text: t('bk.held.yes'), onclick: (e) => once(e.currentTarget, async () => {
          try { const res = await api('POST', 'held', { logId: m.logId }); adopt(res.me); renderAll(false); toast(t('profile.held.toast')); } catch (err) { toastErr(errText(err)); }
        }) }),
        h('button', { class: 'mini-btn', type: 'button', text: t('bk.held.moved'), onclick: () => openLog({ lead: { id: m.id, name: m.name }, kind: 'meeting', from: 'today' }) })));
  }

  // ---- Mis negocios ----
  let back = 'today', lists = null, listsFor = null, failed = new Set(), none = false, loadedFor = '', loading = 0, taps = 0;
  const listPath = (list, offset) => readPath(`leads?list=${list}${offset ? `&offset=${offset}` : ''}`, mode(), S.as);
  const stamp = () => `${S.me.me.id}|${JSON.stringify(S.me.agenda && S.me.agenda.counts)}`;
  /** The four lists, first page each; a read for screens left meanwhile is dropped. A list that could not be read is
   *  marked (`failed`) and keeps what was read before for the same person, never an empty list (listsAfter). */
  async function load() {
    const mine = ++loading, key = stamp(), who = S.me.me.id;
    const settled = await Promise.allSettled(BOOK_LISTS.map((l) => api('GET', listPath(l, 0))));
    if (mine !== loading) return false;
    ({ lists, failed, none } = listsAfter(settled, listsFor === who ? lists : null));
    listsFor = who; loadedFor = key;
    return true;
  }
  /** `hit`: what was tapped (the line on Hoy, "Ver todos", the follow-up stop's button): busy at once, and the screen
   *  opens only if the rep is still where they tapped (stillHere). */
  async function open(from = 'today', hit = null) {
    if (hit && hit.getAttribute('aria-busy') === 'true') return;
    const tap = { n: ++taps, tab: S.tab };
    if (hit) hit.setAttribute('aria-busy', 'true');
    let ok = false;
    try { ok = await load(); } finally { if (hit) hit.removeAttribute('aria-busy'); }
    if (!ok || !stillHere(tap, { n: taps, tab: S.tab })) return;
    back = from;
    $('#bkList').replaceChildren();
    quiet(paint);
    // its arrival runs inside the change (setTab onArrive): started after it, the list showed whole, went blank and built again
    setTab('book', { onArrive: () => { reveal($('#bkGiant')); stagger($$('#bkList .inst-zone'), { delay: 140, step: 80, y: 12 }); } });
  }
  /** Drawn again when the person's view changed (a next step moved on a card, a log): the lists are read again first. */
  function render() {
    if (S.tab !== 'book') return;
    if (loadedFor !== stamp()) { load().then((ok) => { if (ok && S.tab === 'book') quiet(paint); }); return; }
    quiet(paint);
  }
  /** Read one list again, or all four (`list` null), from its retry. */
  async function again(list, btn) {
    await once(btn, async () => {
      if (!list) { await load(); quiet(paint); return; }
      try { const res = await api('GET', listPath(list, 0)); lists[list] = { leads: res.leads || [], total: res.total || 0 }; failed.delete(list); none = false; }
      catch (e) { toastErr(e && e.code === 'offline' ? t('err.offline') : errText(e)); }
      quiet(paint);
    });
  }
  async function more(list, btn) {
    const have = lists[list].leads.length;
    await once(btn, async () => {
      try { const res = await api('GET', listPath(list, have)); lists[list] = { leads: [...lists[list].leads, ...(res.leads || [])], total: res.total || 0 }; paint(); }
      catch (e) { toastErr(errText(e)); }
    });
  }
  function paint() {
    const counts = (S.me.agenda && S.me.agenda.counts) || { owned: 0, overdue: 0, today: 0 };
    const g = $('#bkGiant'), n = $('.num', g) || h('span', { class: 'num' });
    put(g, n, h('em', { text: '.' }));
    countTo(n, counts.owned);
    $('#bkSupport').textContent = t('bk.support', { n: counts.owned, late: counts.overdue });
    $('#bkCount').textContent = t('bk.card.today', { n: counts.today });
    $('#bkRO').hidden = !readOnly();
    const retry = (list, key) => h('button', { class: 'bz-more bk-retry', type: 'button', onclick: (e) => again(list, e.currentTarget) }, h('span', { text: t(key) }), h('b', { text: t('bk.retry') }));
    if (none) { put($('#bkList'), h('section', { class: 'inst-zone inst-prep', 'data-list': 'none' }, retry(null, 'bk.offline'))); return; }   // nothing read, nothing kept
    put($('#bkList'), BOOK_LISTS.map((list, i) => {
      const had = lists[list], sec = sectionOf(list, had, had ? had.leads.length : 0);
      const draw = list === 'free' ? (r) => freeRow(r, 'book') : list === 'nonext' ? (r) => row(r, 'book', [r.zone || t('log.nozone'), r.lastDay ? dayMonth(r.lastDay) : null].filter(Boolean).join(' · ')) : (r) => dueRow(r, 'book');
      return h('section', { class: `inst-zone ${i === 0 ? 'inst-prep' : 'inst-crew'}`, 'data-list': list, 'aria-labelledby': `bkH-${list}` },
        h('div', { class: 'inst-zh' }, h('b', { class: 'inst-k', 'aria-hidden': 'true', text: String(i + 1).padStart(2, '0') }), h('h2', { id: `bkH-${list}`, text: t(sec.key) }), had ? h('span', { class: 'label num', text: num(had.total) }) : null),
        // a list that could not be read says so, with a retry: never the words of an empty list
        sec.rows.length ? h('ul', { class: 'inst-rows' }, sec.rows.map(draw)) : had && !failed.has(list) ? h('div', { class: 'empty-line' }, restArt(), h('p', { class: 'note', text: t(sec.empty) })) : null,
        failed.has(list) ? retry(list, 'bk.failed') : sec.more ? h('button', { class: 'bz-more', type: 'button', text: t('bk.more'), onclick: (e) => more(list, e.currentTarget) }) : null);
    }));
    paintArt($('#bkArt'), leadArt('book', counts));
  }
  /** The profile keeps the way in. */
  const profileButtons = () => (S.me && S.me.agenda ? [h('button', { class: 'btn', type: 'button', onclick: () => open('profile') }, t('bk.chip'), h('span', { class: 'num lad-of', text: ` · ${num(S.me.agenda.counts.owned)}` }))] : []);
  function wire() { $('#bkBack').addEventListener('click', () => setTab(back)); }

  return { card, line, open, render, profileButtons, wire, forget };
}
