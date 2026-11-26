// docs.js: the team's documents inside the app. One screen, "Documentos", with the list in its four fixed groups (the
// look of "Aprender": porcelain and graphite zones, one row per document that opens it in a new tab), and small rows
// next to the step a document belongs to (the install's "Antes de grabar", the worker's consent, the ladder's first
// conversation, the contract when it is logged). Everyone on the team reads the list. A manager or an admin, on their
// own screens, adds, edits, moves and removes; never while acting as anyone. Opening a document tells the server nothing.
// A document with a text is a card: it opens in the card sheet, inside the app. The group "Para vender" is the script
// and the answers ("Guion"), one tap from the log sheet and the business. The last list read is kept on the phone
// (DOCS_KEY), so cards open with no signal; a failed read falls back to it and says so. A card's text is typed by a
// manager: it reaches the page only as text nodes.
import { $, $$, h, s, put, t, lang, giant, flipList, toast, toastErr, once, formSheet, quiet, newId, openSheet, closeSheet, copyText } from './ui.js';
import { reveal, stagger } from './fx.js';
import { paintArt } from './art-lead.js';
import { leadArt } from './craft-steps.js';
import { DOC_GROUPS, DOC_STEPS, BODY_MAX, DOCS_KEY, docGroups, docsFlat, docsAt, docRow, docsState, canManageDocs, moves, docBody, docFields, checkDoc,
  guionDocs, cardParas, cardsFromPaste, keepDocs, keptDocs, pasteIds, pasteLeft } from './docs-steps.js';
import { askTwice, guardList } from './taps.js';

/** A small page: the paper of the consent step, at the size of a row. */
const page = () => h('span', { class: 'doc-page', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
const arrow = (up) => s('svg', { class: 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: up ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6' }));

export function createDocs({ api, S, errText, setTab }) {
  let back = 'today', ticket = 0, old = false;   // old: the last read failed, the list shown is the last copy kept
  const list = () => (Array.isArray(S.docs) ? S.docs : []);
  const manage = () => !!S.me && !!S.me.viewer && canManageDocs(S.me.viewer.role, S.as);
  /** Whose phone this is: the person signed in (view-as reads the same team list). A leader keeps nothing on the phone. */
  const viewer = () => (S.me && S.me.viewer && !S.lead ? S.me.viewer.id : null);
  const kept = () => { try { return keptDocs(JSON.parse(localStorage.getItem(DOCS_KEY) || 'null'), viewer()); } catch { return null; } };
  const keep = () => { const who = viewer(); if (!who) return; try { localStorage.setItem(DOCS_KEY, JSON.stringify(keepDocs(who, list(), Date.now()))); } catch { /* a full or closed storage keeps nothing */ } };
  const take = (res) => { S.docs = docsFlat(res.groups); old = false; keep(); };

  /** Read the list. A slow answer that comes back after a newer one is dropped. A failed read falls back to the copy
   *  kept on the phone, when there is one and nothing is shown yet, and the sheets say it is the last copy. */
  async function load() {
    const mine = ++ticket;
    let res;
    try { res = await api('GET', 'docs'); }
    catch (e) {
      if (mine === ticket) { const k = kept(); if (k && !list().length) S.docs = k.docs; if (list().length) old = true; }
      throw e;
    }
    if (mine === ticket) take(res);
  }
  /** At the start, before the first read: the copy kept for this person, so a card opens with no signal. */
  function restore() { if (list().length) return; const k = kept(); if (k) S.docs = k.docs; }
  /** Signing out forgets the copy. */
  const forget = () => { try { localStorage.removeItem(DOCS_KEY); } catch { /* nothing kept */ } };

  async function open(from = null) {
    back = from || (S.lead ? 'lead' : S.mgr ? 'team' : 'today');
    $('#docList').replaceChildren();
    quiet(render);
    setTab('docs', { onArrive: () => { reveal($('#docGiant')); stagger([$('#docAdd'), ...$$('#docList .inst-zone')], { delay: 140, step: 90, y: 12 }); stagger($$('#docList .doc-row'), { delay: 260, step: 35, y: 6 }); } });
    // the list as it is now: someone may have added a document since this phone last asked
    try { await load(); if (S.tab === 'docs') render(); } catch (e) { if (S.tab === 'docs' && !list().length) toastErr(errText(e)); }
  }

  function render() {
    const docs = list(), groups = docGroups(docs), n = groups.reduce((a, g) => a + g.docs.length, 0), mgr = manage();
    const g = $('#docGiant'), word = t('docs.giant');
    giant(g, word);
    g.classList.add('word'); g.classList.toggle('long', word.length >= 10);   // the word is long: a size that keeps it on one line
    $('#docCount').textContent = t('docs.count', { n });
    $('#docAdd').hidden = !mgr; $('#docPaste').hidden = !mgr;
    const empty = $('#docEmpty');
    empty.hidden = docsState(docs) !== 'none';
    empty.textContent = t(mgr ? 'docs.empty.mgr' : 'docs.empty');
    paintArt($('#docArt'), leadArt('docs', { count: n }));
    flipList($('#docList'), groups, (g) => g.group,
      (g) => h('section', { class: 'inst-zone doc-zone', 'aria-labelledby': `docH-${g.group}` },
        h('div', { class: 'inst-zh' }, h('b', { class: 'inst-k', 'aria-hidden': 'true' }), h('h2', { id: `docH-${g.group}` }), h('span', { class: 'label num' })), h('ul', { class: 'inst-rows' })),
      (zone, g, i) => {
        // numbered and shaded in the order shown, porcelain first, the way the install and the ladder number their zones
        zone.classList.toggle('inst-prep', i % 2 === 0); zone.classList.toggle('inst-crew', i % 2 === 1);
        $('.inst-k', zone).textContent = String(i + 1).padStart(2, '0');
        $('h2', zone).textContent = t(`docs.group.${g.group}`);
        $('.label', zone).textContent = t('docs.count', { n: g.docs.length });
        paintRows($('ul', zone), g.docs, docs, mgr);
      });
  }

  function paintRows(ul, docs, all, mgr) {
    flipList(ul, docs, (d) => d.id,
      () => h('li', { class: 'inst-row lrn-row tap doc-row' }, h('span', { class: 'lrn-slot' }, page()), h('span', { class: 'inst-n' }, h('b'), h('small')), h('span', { class: 'inst-tag' }),
        h('a', { class: 'inst-hit', target: '_blank', rel: 'noopener noreferrer' }), h('div', { class: 'doc-acts' })),
      (li, d) => {
        const row = docRow(d, lang());
        $('b', li).textContent = row.title;
        const note = $('small', li); note.textContent = row.note; note.hidden = !row.note;
        const tag = $('.inst-tag', li); tag.hidden = !row.chip; tag.textContent = row.chip ? t(`docs.chip.${row.chip}`) : '';
        const had = $('.inst-hit', li), hit = hitFor(d, row);
        had.replaceWith(hit);
        const acts = $('.doc-acts', li);
        acts.hidden = !mgr;
        li.classList.toggle('mgr', mgr);
        if (!mgr) { put(acts); return; }
        const can = moves(all, d.id);
        put(acts,
          h('button', { class: 'mini-btn doc-mv', type: 'button', disabled: !can.up, 'aria-label': t('docs.up.aria', { title: row.title }), onclick: (e) => move(e.currentTarget, d.id, 'up') }, arrow(true)),
          h('button', { class: 'mini-btn doc-mv', type: 'button', disabled: !can.down, 'aria-label': t('docs.down.aria', { title: row.title }), onclick: (e) => move(e.currentTarget, d.id, 'down') }, arrow(false)),
          h('button', { class: 'mini-btn', type: 'button', text: t('docs.edit'), 'aria-label': t('docs.edit.aria', { title: row.title }), onclick: () => edit(d) }),
          h('button', { class: 'mini-btn', type: 'button', text: t('docs.remove'), 'aria-label': t('docs.remove.aria', { title: row.title }), onclick: (e) => remove(e, d.id) }));
      });
  }

  /** The whole row's hit: a card opens in the card sheet, an address alone in a new tab. */
  function hitFor(d, row) {
    if (row.card) return h('button', { class: 'inst-hit', type: 'button', 'aria-label': t('card.open.aria', { title: row.title }), onclick: () => openCard(d) });
    return h('a', { class: 'inst-hit', href: row.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('docs.open.aria', { title: row.title }) });
  }

  // ---- a card, read in the app ----
  /** The card sheet: the title, the text in paragraphs (a "Di:" line drawn as what the rep says aloud), "Copiar el
   *  texto", and "Abrir el documento" when it also has an address. Opened over the Guion list, the list stays behind. */
  function openCard(d) {
    const row = docRow(d, lang());
    if (!row.card) { if (row.url) window.open(row.url, '_blank', 'noopener'); return; }
    $('#cardH').textContent = row.title;
    $('#cardOld').hidden = !old;
    put($('#cardText'), ...cardParas(row.body).map((p) => h('p', { class: p.say ? 'card-say' : 'card-p', text: p.text })));
    put($('#cardActs'),
      row.url ? h('a', { class: 'mini-btn', href: row.url, target: '_blank', rel: 'noopener noreferrer', text: t('card.open') }) : null,
      h('button', { class: 'mini-btn', type: 'button', text: t('card.copy'), onclick: async () => toast(t(await copyText(`${row.title}\n\n${row.body}`) ? 'card.copied' : 'card.copy.fail')) }));
    openSheet($('#cardSheet'));
    $('#cardSheet').scrollTop = 0;
  }

  // ---- the script and the answers ----
  /** Whether there is a script to show: the group "Para vender" has a document. Without one, "Guion" is not drawn. */
  const hasGuion = () => guionDocs(list()).length > 0;
  /** The Guion sheet: one row per document of "Para vender", the title (and its note), in the manager's order. A card
   *  opens in place over the list; an address opens outside, marked so. */
  function openGuion() {
    const docs = guionDocs(list());
    if (!docs.length) return;
    $('#guionOld').hidden = !old;
    put($('#guionList'), docs.map((d) => {
      const row = docRow(d, lang());
      // the row Documentos draws: the page mark, the title, the note
      return h('li', { class: 'inst-row lrn-row tap doc-row guion-row' }, h('span', { class: 'lrn-slot' }, page()), h('span', { class: 'inst-n' }, h('b', { text: row.title }), row.note ? h('small', { text: row.note }) : null),
        row.card ? null : h('span', { class: 'inst-tag', text: t('docs.out') }), hitFor(d, row));
    }));
    openSheet($('#guionSheet'));
  }

  /** Every write answers the whole list: it is drawn with motion and the step rows elsewhere follow on their next draw. */
  const write = async (path, body) => { if (!manage()) throw Object.assign(new Error('read_only'), { code: 'read_only' }); take(await api('POST', path, body)); render(); };
  const act = (btn, path, body, okKey) => once(btn, async () => { try { await write(path, body); if (okKey) toast(t(okKey)); } catch (e) { toastErr(errText(e)); } });
  const move = (btn, id, dir) => act(btn, `docs/${encodeURIComponent(id)}/move`, { dir });
  /** Removing takes two taps (taps.js): the first arms the button and says what will happen, the second removes it, and
   *  counts only after a pause, so one double tap never does both. */
  function remove(e, id) {
    const btn = e.currentTarget, step = askTwice(btn, e);
    if (step === 'arm') toast(t('docs.remove.confirm'));
    else if (step === 'run') act(btn, `docs/${encodeURIComponent(id)}/remove`, {}, 'docs.removed');
  }
  /** The form, for a new document or to edit one. A new one carries an id made when the form opens: sent twice, it is one.
   *  `preset` opens a new one with its group and step already chosen ("Cargar" in Pendientes); `after` runs once it is kept. */
  function form(doc = null, preset = null, after = null) {
    if (!manage()) return;
    const v = { ...docFields(doc), ...(!doc && preset ? { group: preset.group, step: preset.step || '' } : {}) }, id = doc ? null : `d_${newId()}`;
    const opt = (key, values) => values.map((x) => ({ value: x, label: t(`${key}.${x}`) }));
    formSheet({ title: t(doc ? 'docs.form.edit' : 'docs.form.add'), intro: t('docs.form.p'), submit: t('docs.form.submit'),
      fields: [{ name: 'titleEs', label: t('docs.form.titleEs'), value: v.titleEs, max: 120 }, { name: 'titleEn', label: t('docs.form.titleEn'), value: v.titleEn, max: 120 },
        { name: 'noteEs', label: t('docs.form.noteEs'), value: v.noteEs, max: 200 }, { name: 'noteEn', label: t('docs.form.noteEn'), value: v.noteEn, max: 200 },
        { name: 'bodyEs', type: 'textarea', label: t('docs.form.bodyEs'), value: v.bodyEs, max: BODY_MAX, rows: 6, count: true },
        { name: 'bodyEn', type: 'textarea', label: t('docs.form.bodyEn'), value: v.bodyEn, max: BODY_MAX, rows: 6, count: true },
        { name: 'url', label: t('docs.form.url'), value: v.url, max: 2000, lower: true, placeholder: 'https://', hint: t('docs.form.url.hint') },
        { name: 'group', type: 'select', label: t('docs.form.group'), value: v.group, options: opt('docs.group', DOC_GROUPS) },
        { name: 'lang', type: 'select', label: t('docs.form.lang'), value: v.lang, options: opt('docs.form.lang', ['both', 'es', 'en']) },
        { name: 'step', type: 'select', label: t('docs.form.step'), value: v.step, options: [{ value: '', label: t('docs.form.step.none') }, ...opt('docs.step', DOC_STEPS)] }],
      onSubmit: async (values) => {
        const body = docBody(values), got = checkDoc(body);
        if (got.error) throw Object.assign(new Error(got.error), { code: got.error });   // said in the form, before anything is sent
        if (doc) await write(`docs/${encodeURIComponent(doc.id)}`, { patch: body }); else await write('docs', { ...body, id });
        toast(t(doc ? 'docs.saved' : 'docs.added'));
        if (after) after();
      } });
  }
  const edit = (doc) => form(doc);

  /** "Pegar varias tarjetas": one text, cut into cards on a line of `---` (docs-steps cardsFromPaste), with the group
   *  and the language of the text. The preview lists what was found; a card that does not hold says why and is not
   *  sent. "Cargar" sends them one by one in the order pasted, each with the id its row got when the preview first
   *  showed it (docs-steps pasteIds), so a second tap or a retry makes no duplicate, whatever was edited in between.
   *  It ends saying how many were kept and which were not; "Cargar {n}" counts the ones not kept yet. */
  function pasteForm() {
    if (!manage()) return;
    let ids = [];   // the preview's rows' ids, kept while the sheet stays open
    const done = new Set();   // the ids already kept
    const area = h('textarea', { id: 'fs-paste', rows: 10, maxlength: 60000, 'aria-label': t('docs.paste.text'), placeholder: t('docs.paste.ph') });
    const preview = h('ul', { class: 'inst-rows paste-rows', 'aria-live': 'polite' }), said = h('p', { class: 'note', hidden: true });
    const found = () => cardsFromPaste(area.value);
    function paint() {
      const cards = found();
      ids = pasteIds(ids, cards.length, () => `d_${newId()}`);
      put(preview, cards.map((c) => h('li', { class: c.error ? 'inst-row two paste-bad' : 'inst-row two' }, h('span', { class: 'inst-n' }, h('b', { text: c.title || t('docs.paste.untitled') }),
        h('small', { text: c.error ? t(`docs.paste.err.${c.error}`, { max: BODY_MAX }) : t('docs.paste.chars', { n: c.body.length }) })))));
      $('#fsBtn').textContent = t('docs.paste.load', { n: pasteLeft(cards, ids, done) });
    }
    area.addEventListener('input', () => { said.hidden = true; paint(); });
    const box = h('div', { class: 'field' }, h('span', { class: 'label', text: t('docs.paste.text') }), area, h('span', { class: 'hint', text: t('docs.paste.hint') }));
    formSheet({ title: t('docs.paste.title'), intro: t('docs.paste.p'), submit: t('docs.paste.load', { n: 0 }), body: h('div', {}, box, preview, said),
      fields: [{ name: 'group', type: 'select', label: t('docs.form.group'), value: 'vender', options: DOC_GROUPS.map((x) => ({ value: x, label: t(`docs.group.${x}`) })) },
        { name: 'lang', type: 'select', label: t('docs.paste.lang'), value: 'es', options: ['es', 'en'].map((x) => ({ value: x, label: t(`docs.form.lang.${x}`) })) }],
      onSubmit: async (v) => {
        const all = found(), group = DOC_GROUPS.includes(v.group) ? v.group : 'vender', lng = v.lang === 'en' ? 'en' : 'es';
        ids = pasteIds(ids, all.length, () => `d_${newId()}`);   // every id made before the first send
        const rows = all.map((c, i) => ({ c, id: ids[i] })).filter((r) => !r.c.error);
        if (!rows.length) throw Object.assign(new Error('fields'), { code: 'paste_none' });
        const failed = [];
        for (const { c, id } of rows) {
          if (done.has(id)) continue;
          const body = { id, title: { [lng]: c.title }, note: {}, url: '', group, lang: lng, step: null, body: { [lng]: c.body } };
          try { await write('docs', body); done.add(id); } catch { failed.push(c.title); }
        }
        const kept = rows.filter((r) => done.has(r.id)).length;
        if (!failed.length) { toast(t('docs.paste.done', { n: kept })); return undefined; }
        paint();
        said.hidden = false;
        said.textContent = `${t('docs.paste.done', { n: kept })} ${t('docs.paste.failed', { list: failed.join(', ') })}`;
        return true;   // the sheet stays: "Cargar" tries the ones not kept again
      } });
    paint();
  }

  // ---- next to a step ----
  /** Fill `node` with the documents hooked to `step` (or any of a list of steps): small rows that open each one. With
   *  none, the node hides. */
  function hooks(node, step) {
    if (!node) return;
    const docs = docsAt(list(), step), key = `${lang()}|${docs.map((d) => `${d.id}:${d.lang}:${d.url}:${d.title.es}:${d.title.en}:${d.note.es}:${d.note.en}:${d.body ? `${d.body.es}:${d.body.en}` : ''}`).join('|')}`;
    node.hidden = !docs.length;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    if (!docs.length) { node.replaceChildren(); return; }
    node.replaceChildren(h('p', { class: 'label', text: t('docs.hooks') }), h('ul', {}, docs.map((d) => {
      const row = docRow(d, lang());
      const inside = [page(), h('span', { class: 'doc-hook-t' }, h('b', { text: row.title }), row.note ? h('small', { text: row.note }) : null), row.chip ? h('span', { class: 'inst-tag', text: t(`docs.chip.${row.chip}`) }) : null];
      // a card opens in the card sheet; an address alone in a new tab
      return h('li', {}, row.card ? h('button', { class: 'doc-hook', type: 'button', 'aria-label': t('card.open.aria', { title: row.title }), onclick: () => openCard(d) }, ...inside)
        : h('a', { class: 'doc-hook', href: row.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('docs.open.aria', { title: row.title }) }, ...inside));
    })));
  }

  /** The way in from Hoy and the profile: the word and how many there are. */
  function entry(node) {
    if (!node) return;
    const n = docGroups(list()).reduce((a, g) => a + g.docs.length, 0);
    put(node, page(), h('span', { text: t('docs.chip') }), h('span', { class: 'label num', text: t('docs.count', { n }) }));
  }

  function wire() {
    // moving a document moves its row, and the next one slides under the finger: a double click acts once (taps.js)
    guardList($('#docList'));
    $('#docBack').addEventListener('click', () => setTab(back));
    $('#docAdd').addEventListener('click', () => form());
    $('#docPaste').addEventListener('click', pasteForm);
  }

  return { load, restore, forget, open, render, hooks, entry, wire, openCard, openGuion, hasGuion, form, isOld: () => old };
}
