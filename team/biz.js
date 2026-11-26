// biz.js: one business in the rep's hand. Its card (a screen): whose it is, its stage and last contact, the links that
// call, write and map it, its next step with "Hecho" and "Mover", what the CRM says about it, every contact by anyone,
// its route when it has one, and what its holder or a manager may do with it. And the strip of the log sheet: who to
// ask for, the phone, whose it is and the last contact, in two lines.
// The server builds the card (lib/team/biz.mjs) and judges every write; biz-steps.js and next-steps.js decide the words.
// Through view-as nothing that writes shows and no write leaves this module.
import { $, $$, h, put, t, cap, dayMonth, toast, toastErr, formSheet, closeSheet, reduce, quiet, once } from './ui.js';
import { reveal, stagger } from './fx.js';
import { cardModel, ownerLine, ownerWords, stageLine, lastLine, dueLine, dueText as dueWords, readPath, telHref, modeOf, readOnlyOf, stillHere, assignList, donePreset } from './biz-steps.js';
import { quickDays, checkNext } from './next-steps.js';
import { askTwice } from './taps.js';
import { qualLine } from './qual-steps.js';

/** A line of words from a C3 model: a key with its blanks, or text the CRM wrote. */
export const said = (m, vars = {}) => (!m ? '' : m.text != null ? m.text : t(m.key, { ...m, ...vars }));

/** Whether the business qualifies, in words: "Califica", "No califica" or "Falta: wifi, quién coordina". */
export const qualWords = (q) => { const m = qualLine(q); return said(m, { what: (m.what || []).map((k) => t(k)).join(', ') }); };

export function createBiz({ api, S, errText, adopt, renderAll, setTab, openLog, openRoute, reps = () => [], today, changed = () => {}, guion = { has: () => false, open: () => {} } }) {
  let biz = null, back = 'today', ticket = 0, taps = 0;
  const mode = () => modeOf(S);
  const readOnly = () => readOnlyOf(S);
  const write = (body) => (readOnly() ? Promise.reject(Object.assign(new Error('read_only'), { code: 'read_only' })) : api('POST', `biz/${encodeURIComponent(biz.id)}`, body));
  const read = (id) => api('GET', readPath(`biz/${encodeURIComponent(id)}`, mode(), S.as));

  /** The last contact as one line: "Omar llamó · 24 nov", the CRM's own date, or none yet. */
  function lastText(b) {
    const l = lastLine(b);
    if (!l) return t('biz.last.none');
    if (l.crm || !l.kind) return t('biz.last.crm', { date: dayMonth(l.day) });
    return t('biz.last', { who: l.who || t('biz.history.crm'), did: t(`biz.did.${l.kind}`), date: dayMonth(l.day) });
  }
  const dueText = (next) => dueWords(next, today(), t, dayMonth);

  // ---- the card ----
  /** `hit`: the row tapped. It is busy at once (a second tap on it does nothing) until the answer comes; the card opens
   *  only if the rep is still on the screen they tapped from and tapped nothing newer (stillHere), else it is dropped. */
  async function open(id, from = 'today', hit = null) {
    if (!id || (hit && hit.getAttribute('aria-busy') === 'true')) return;
    const tap = { n: ++taps, tab: S.tab }, mine = ++ticket;
    if (hit) hit.setAttribute('aria-busy', 'true');
    let res;
    try { res = await read(id); }
    catch (e) { if (stillHere(tap, { n: taps, tab: S.tab })) toastErr(e && e.code === 'offline' ? t('biz.offline') : errText(e)); return; }
    finally { if (hit) hit.removeAttribute('aria-busy'); }
    if (mine !== ticket || !stillHere(tap, { n: taps, tab: S.tab })) return;   // the rep moved on meanwhile
    back = from; biz = res.biz;
    for (const sel of ['#bzActs', '#bzNextBody', '#bzFactsBody', '#bzHistoryBody', '#bzRoute', '#bzEnd']) $(sel).replaceChildren();
    quiet(paint);
    // its arrival runs inside the change (setTab onArrive): started after it, the card showed whole, went blank and built again
    setTab('biz', { onArrive: () => { reveal($('#bzGiant')); stagger([$('#bzActs'), ...$$('#s-biz .inst-zone')], { delay: 140, step: 80, y: 12 }); } });
  }
  /** Read the open card again (after a log on it, say), quietly. */
  async function refresh() {
    if (!biz) return;
    const id = biz.id, mine = ++ticket;
    try { const res = await read(id); if (mine === ticket && biz && biz.id === id) { biz = res.biz; quiet(paint); } } catch { /* the card stays as it was */ }
  }
  const render = () => { if (biz && S.tab === 'biz') quiet(paint); };
  const current = () => biz;

  function paint() {
    const b = biz, m = cardModel(b, mode());
    $('#bzZone').textContent = b.zone || t('log.nozone');
    const st = stageLine(b.stage);
    $('#bzStage').hidden = !st; $('#bzStage').textContent = said(st);
    $('#bzQual').textContent = qualWords(b.q);   // under the stage: whether it qualifies, or what is missing
    $('#bzLead').textContent = said(ownerLine(b));
    const g = $('#bzGiant');
    g.textContent = b.name;
    $('#bzSupport').textContent = lastText(b);
    $('#bzRO').hidden = !readOnly();

    // call, write, map: links that stay in every mode; the log is the holder's or anyone's on their own screens
    const link = (href, key, outside) => (href ? h('a', { class: 'mini-btn', href, text: t(key), ...(outside ? { target: '_blank', rel: 'noopener' } : {}) }) : null);
    put($('#bzActs'), m.acts.log && !S.mgr && !S.lead ? h('button', { class: 'mini-btn primary', type: 'button', text: t('biz.log'), onclick: () => openLog({ lead: { id: b.id, name: b.name, zone: b.zone }, kind: null, from: 'biz' }) }) : null,
      link(m.acts.call, 'biz.call'), link(m.acts.wa, 'biz.wa', true), link(m.acts.map, 'biz.map', true),
      // the script and the answers, last: only when there is one to show
      guion.has() ? h('button', { class: 'mini-btn guion-btn', type: 'button', onclick: () => guion.open() }, h('span', { class: 'doc-page', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i')), h('span', { text: t('guion.btn') })) : null);

    // 01 the next step: its words, when it is due, and "Hecho" and "Mover" for its holder
    const lost = b.lost && b.stage === 'Lost';
    const nextRows = [];
    if (lost) nextRows.push(h('p', { class: 'bz-line', text: t('biz.lost.line', { reason: t(`biz.reason.${b.lost.reason || 'other'}`) }) }));
    else if (b.next) {
      const due = dueLine(b.next, today());
      nextRows.push(h('div', { class: 'inst-row two bz-next' }, h('span', { class: 'inst-n' }, h('b', { text: b.next.step }), h('small', { class: due && due.key === 'biz.due.late' ? 'bz-late' : null, text: dueText(b.next) }))));
    } else nextRows.push(h('p', { class: 'bz-line', text: t(b.stage === 'Waitlist' ? 'nx.waitlist' : 'nx.none') }));
    // "Hecho" opens the sheet ready for that step: the results that do it first (donePreset), else as "Registrar"
    const done = () => openLog({ lead: { id: b.id, name: b.name, zone: b.zone }, kind: null, from: 'biz', ...(donePreset(b.next && b.next.step) || {}) });
    const acts = [m.next.done && !S.mgr ? h('button', { class: 'mini-btn primary', type: 'button', text: t('biz.next.done'), onclick: done }) : null,
      m.next.move && !lost ? h('button', { class: 'mini-btn', type: 'button', text: t('biz.next.move'), onclick: moveForm }) : null].filter(Boolean);
    put($('#bzNextBody'), ...nextRows, acts.length ? h('div', { class: 'bz-acts' }, acts) : null);

    // 02 what the CRM says: only the fields it has
    const facts = m.facts.flatMap((f) => [h('span', { class: 'label', text: t(f.key) }),
      f.href ? h('a', { href: f.href, text: String(f.value), ...(/^https?:/.test(f.href) ? { target: '_blank', rel: 'noopener' } : {}) }) : h('span', { text: String(f.value) })]);
    put($('#bzFactsBody'), facts.length ? h('div', { class: 'bz-facts' }, facts) : h('p', { class: 'note', text: t('biz.last.none') }));

    // 03 every contact, by anyone, newest first
    const hist = Array.isArray(b.history) ? b.history : [];
    put($('#bzHistoryBody'), hist.length ? h('ul', { class: 'inst-rows' }, hist.map((x) => {
      const who = x.crm ? t('biz.history.crm') : x.mine ? t('biz.history.you') : x.who;
      const bits = [who, dayMonth(x.day), x.tag ? t(`tag.${x.tag}`) : null].filter(Boolean).join(' · ');
      return h('li', { class: 'inst-row two' }, h('span', { class: 'inst-n' }, h('b', { text: cap(t(`biz.did.${x.kind}`)) }), h('small', { text: bits }), x.note ? h('small', { class: 'bz-note', text: x.note }) : null));
    })) : h('p', { class: 'note', text: t('biz.history.empty') }));
    $('#bzHistCount').textContent = hist.length ? String(hist.length) : '';

    // its route, when it is on one
    put($('#bzRoute'), b.route ? h('button', { class: 'btn wide lad-learn bz-route', type: 'button', onclick: () => openRoute(b.id, 'biz') },
      h('span', { text: t('biz.route') }), h('span', { class: 'label num', text: t('biz.route.at', { a: b.route.at + 1 > b.route.of ? b.route.of : b.route.at + 1, b: b.route.of }) })) : null);

    // release, give, open again
    const end = [];
    if (m.reopen) end.push(h('button', { class: 'btn wide', type: 'button', text: t('biz.reopen'), onclick: (e) => once(e.currentTarget, () => send({ reopen: true }, 'biz.reopened')) }));
    if (m.assign) end.push(h('button', { class: 'btn wide', type: 'button', text: t('biz.assign'), onclick: assignForm }));
    if (m.release && b.owner && !b.free) {
      const btn = h('button', { class: 'btn wide', type: 'button', text: t('biz.release') });
      btn.addEventListener('click', (e) => {
        const step = askTwice(btn, e, { onDisarm: () => { if (btn.isConnected) btn.textContent = t('biz.release'); } });
        if (step === 'arm') btn.textContent = t('biz.release.sure');
        else if (step === 'run') once(btn, () => send({ release: true }, 'biz.released'));
      });
      end.push(btn);
    }
    put($('#bzEnd'), ...end);
  }

  /** A write answered with the card and the person's whole view. */
  async function send(body, okKey, vars = {}) {
    try {
      const res = await write(body);
      biz = res.biz;
      if (res.me) adopt(res.me);
      changed(); renderAll(false); quiet(paint);
      toast(t(okKey, vars));
    } catch (e) { toastErr(errText(e)); throw e; }
  }

  /** "Mover": the quick days, a date, and the words. "Sin próximo paso" clears it. */
  function moveForm() {
    const b = biz, now = today();
    const dayIn = () => $('#fs-day');
    const quick = h('div', { class: 'chipset', role: 'group', 'aria-label': t('nx.title') }, quickDays(now).map((q) => h('button', { class: 'pick', type: 'button', 'aria-pressed': 'false', text: t(q.key), onclick: (e) => {
      const input = dayIn(); if (input) input.value = q.day;
      for (const p of $$('.pick', e.currentTarget.parentNode)) p.setAttribute('aria-pressed', String(p === e.currentTarget));
    } })));
    const none = h('button', { class: 'mini-btn bz-none', type: 'button', text: t('nx.none'), onclick: (e) => once(e.currentTarget, async () => {
      try { await send({ next: null }, 'biz.moved'); closeSheet($('#formSheet')); } catch { /* said in the toast */ }
    }) });
    formSheet({ title: cap(t('biz.move.title')), intro: b.name, submit: t('log.save'), body: h('div', {}, quick, h('div', { class: 'bz-acts' }, none)),
      fields: [{ name: 'day', type: 'date', label: t('nx.q.date'), value: b.next ? b.next.day : '' }, { name: 'step', label: t('nx.title'), placeholder: t('nx.step.ph'), max: 140, value: b.next ? b.next.step : '' }],
      onSubmit: async (v) => {
        const c = checkNext({ day: v.day, step: v.step }, now);
        if (c.error) throw Object.assign(new Error(c.error), { code: c.error });
        const res = await write({ next: c.next });
        biz = res.biz; if (res.me) adopt(res.me); changed(); renderAll(false); quiet(paint); toast(t('biz.moved'));
      } });
  }

  /** A manager gives the business to another rep of its city. */
  function assignForm() {
    const list = assignList(reps(), biz);   // its holder left out, by id when the card carries it
    if (!list.length) { toastErr(t('err.rep')); return; }
    formSheet({ title: cap(t('biz.assign.title')), intro: biz.name, submit: t('biz.assign'),
      fields: [{ name: 'owner', type: 'select', label: t('biz.assign.pick'), value: list[0].id, options: list.map((r) => ({ value: r.id, label: r.name })) }],
      onSubmit: async (v) => {
        const who = list.find((r) => r.id === v.owner);
        const res = await write({ owner: v.owner });
        biz = res.biz; if (res.me) adopt(res.me); changed(); renderAll(false); quiet(paint); toast(t('biz.assigned', { name: who ? who.name.split(/\s+/)[0] : '' }));
      } });
  }

  /** The strip of the log sheet, in two lines at most: who to ask for and the phone; whose it is, the last contact and
   *  the way to the card. `b` is the card once read, else the search row (whose it is and the last contact are there
   *  already). Offline, the card's details wait for the signal and the strip says so. */
  function strip(node, b, { offline = false, card = false, from = 'today', kind = null } = {}) {
    if (!b) { node.hidden = true; node.replaceChildren(); return; }
    node.hidden = false;
    const ask = b.contact ? t(b.title ? 'biz.ask.title' : 'biz.ask', { name: b.contact, title: b.title || '' }) : '';
    const tel = telHref(b.phone);
    const first = ask || tel ? h('p', { class: 'bz-l1' }, ask ? h('span', { class: 'bz-ask', text: ask }) : null,
      tel ? h('a', { class: 'bz-tel num', href: tel, text: b.phone }) : null) : null;
    const who = said(ownerWords(b, kind)), last = card || b.lastDay ? lastText(b) : '';   // a free one says it will be the rep's
    const qual = card ? qualWords(b.q) : '';   // whether it qualifies, once the card is read
    const second = h('p', { class: 'bz-l2' }, h('span', { class: 'bz-who', text: [who, qual, last].filter(Boolean).join(' · ') }),
      card && !offline ? h('button', { class: 'bz-see', type: 'button', text: t('biz.open'), onclick: () => { closeSheet($('#logSheet')); open(b.id, from); } }) : null);
    put(node, first, second, offline ? h('p', { class: 'bz-l2 bz-off', text: t('biz.offline') }) : null);
  }

  function wire() { $('#bzBack').addEventListener('click', () => setTab(back)); }

  return { open, refresh, render, current, wire, lastText, strip };
}
