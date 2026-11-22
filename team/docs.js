// docs.js: the team's documents inside the app. One screen, "Documentos", with the list in its four fixed groups (the
// look of "Aprender": porcelain and graphite zones, one row per document that opens it in a new tab), and small rows
// next to the step a document belongs to (the install's "Antes de grabar", the worker's consent, the ladder's first
// conversation, the contract when it is logged). Everyone on the team reads the list. A manager or an admin, on their
// own screens, adds, edits, moves and removes; never while acting as anyone. Opening a document tells the server nothing.
import { $, $$, h, s, put, t, lang, giant, flipList, toast, once, formSheet, reduce, quiet, newId } from './ui.js';
import { reveal, stagger } from './fx.js';
import { DOC_GROUPS, DOC_STEPS, docGroups, docsFlat, docsAt, docRow, docsState, canManageDocs, moves, docBody, docFields, checkDoc } from './docs-steps.js';

/** A small page: the paper of the consent step, at the size of a row. */
const page = () => h('span', { class: 'doc-page', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'));
const arrow = (up) => s('svg', { class: 'ic', viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, s('path', { d: up ? 'M6 14l6-6 6 6' : 'M6 10l6 6 6-6' }));

export function createDocs({ api, S, errText, setTab }) {
  let back = 'today', ticket = 0;
  const list = () => (Array.isArray(S.docs) ? S.docs : []);
  const manage = () => !!S.me && !!S.me.viewer && canManageDocs(S.me.viewer.role, S.as);
  const take = (res) => { S.docs = docsFlat(res.groups); };

  /** Read the list. A slow answer that comes back after a newer one is dropped. */
  async function load() {
    const mine = ++ticket;
    const res = await api('GET', 'docs');
    if (mine === ticket) take(res);
  }

  async function open(from = null) {
    back = from || (S.lead ? 'lead' : S.mgr ? 'team' : 'today');
    $('#docList').replaceChildren();
    quiet(render);
    setTab('docs');
    if (!reduce) setTimeout(() => { if (S.tab !== 'docs') return; reveal($('#docGiant')); stagger([$('#docAdd'), ...$$('#docList .inst-zone')], { delay: 140, step: 90, y: 12 }); stagger($$('#docList .doc-row'), { delay: 260, step: 35, y: 6 }); }, 90);
    // the list as it is now: someone may have added a document since this phone last asked
    try { await load(); if (S.tab === 'docs') render(); } catch (e) { if (S.tab === 'docs' && !list().length) toast(errText(e)); }
  }

  function render() {
    const docs = list(), groups = docGroups(docs), n = groups.reduce((a, g) => a + g.docs.length, 0), mgr = manage();
    const g = $('#docGiant'), word = t('docs.giant');
    giant(g, word);
    g.classList.add('word'); g.classList.toggle('long', word.length >= 10);   // the word is long: a size that keeps it on one line
    $('#docCount').textContent = t('docs.count', { n });
    $('#docAdd').hidden = !mgr;
    const empty = $('#docEmpty');
    empty.hidden = docsState(docs) !== 'none';
    empty.textContent = t(mgr ? 'docs.empty.mgr' : 'docs.empty');
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
        const hit = $('.inst-hit', li);
        hit.href = row.url; hit.setAttribute('aria-label', t('docs.open.aria', { title: row.title }));
        const acts = $('.doc-acts', li);
        acts.hidden = !mgr;
        li.classList.toggle('mgr', mgr);
        if (!mgr) { put(acts); return; }
        const can = moves(all, d.id);
        put(acts,
          h('button', { class: 'mini-btn doc-mv', type: 'button', disabled: !can.up, 'aria-label': t('docs.up.aria', { title: row.title }), onclick: (e) => move(e.currentTarget, d.id, 'up') }, arrow(true)),
          h('button', { class: 'mini-btn doc-mv', type: 'button', disabled: !can.down, 'aria-label': t('docs.down.aria', { title: row.title }), onclick: (e) => move(e.currentTarget, d.id, 'down') }, arrow(false)),
          h('button', { class: 'mini-btn', type: 'button', text: t('docs.edit'), 'aria-label': t('docs.edit.aria', { title: row.title }), onclick: () => edit(d) }),
          h('button', { class: 'mini-btn', type: 'button', text: t('docs.remove'), 'aria-label': t('docs.remove.aria', { title: row.title }), onclick: (e) => remove(e.currentTarget, d.id) }));
      });
  }

  // ---- a manager's controls ----
  /** Every write answers the whole list: it is drawn with motion and the step rows elsewhere follow on their next draw. */
  const write = async (path, body) => { if (!manage()) throw Object.assign(new Error('read_only'), { code: 'read_only' }); take(await api('POST', path, body)); render(); };
  const act = (btn, path, body, okKey) => once(btn, async () => { try { await write(path, body); if (okKey) toast(t(okKey)); } catch (e) { toast(errText(e)); } });
  const move = (btn, id, dir) => act(btn, `docs/${encodeURIComponent(id)}/move`, { dir });
  /** Removing takes two taps: the first arms the button and says what will happen. */
  function remove(btn, id) {
    if (!btn.classList.contains('armed')) { btn.classList.add('armed'); toast(t('docs.remove.confirm')); setTimeout(() => btn.classList.remove('armed'), 6000); return; }
    btn.classList.remove('armed');
    act(btn, `docs/${encodeURIComponent(id)}/remove`, {}, 'docs.removed');
  }
  /** The form, for a new document or to edit one. A new one carries an id made when the form opens: sent twice, it is one. */
  function form(doc = null) {
    if (!manage()) return;
    const v = docFields(doc), id = doc ? null : `d_${newId()}`;
    const opt = (key, values) => values.map((x) => ({ value: x, label: t(`${key}.${x}`) }));
    formSheet({ title: t(doc ? 'docs.form.edit' : 'docs.form.add'), intro: t('docs.form.p'), submit: t('docs.form.submit'),
      fields: [{ name: 'titleEs', label: t('docs.form.titleEs'), value: v.titleEs, max: 120 }, { name: 'titleEn', label: t('docs.form.titleEn'), value: v.titleEn, max: 120 },
        { name: 'noteEs', label: t('docs.form.noteEs'), value: v.noteEs, max: 200 }, { name: 'noteEn', label: t('docs.form.noteEn'), value: v.noteEn, max: 200 },
        { name: 'url', label: t('docs.form.url'), value: v.url, max: 2000, lower: true, placeholder: 'https://', hint: t('docs.form.url.hint') },
        { name: 'group', type: 'select', label: t('docs.form.group'), value: v.group, options: opt('docs.group', DOC_GROUPS) },
        { name: 'lang', type: 'select', label: t('docs.form.lang'), value: v.lang, options: opt('docs.form.lang', ['both', 'es', 'en']) },
        { name: 'step', type: 'select', label: t('docs.form.step'), value: v.step, options: [{ value: '', label: t('docs.form.step.none') }, ...opt('docs.step', DOC_STEPS)] }],
      onSubmit: async (values) => {
        const body = docBody(values), got = checkDoc(body);
        if (got.error) throw Object.assign(new Error(got.error), { code: got.error });   // said in the form, before anything is sent
        if (doc) await write(`docs/${encodeURIComponent(doc.id)}`, { patch: body }); else await write('docs', { ...body, id });
        toast(t(doc ? 'docs.saved' : 'docs.added'));
      } });
  }
  const edit = (doc) => form(doc);

  // ---- next to a step ----
  /** Fill `node` with the documents hooked to `step`: small rows that open each one. With none, the node hides. */
  function hooks(node, step) {
    if (!node) return;
    const docs = docsAt(list(), step), key = `${lang()}|${docs.map((d) => `${d.id}:${d.lang}:${d.url}:${d.title.es}:${d.title.en}:${d.note.es}:${d.note.en}`).join('|')}`;
    node.hidden = !docs.length;
    if (node.dataset.key === key) return;
    node.dataset.key = key;
    if (!docs.length) { node.replaceChildren(); return; }
    node.replaceChildren(h('p', { class: 'label', text: t('docs.hooks') }), h('ul', {}, docs.map((d) => {
      const row = docRow(d, lang());
      return h('li', {}, h('a', { class: 'doc-hook', href: row.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('docs.open.aria', { title: row.title }) },
        page(), h('span', { class: 'doc-hook-t' }, h('b', { text: row.title }), row.note ? h('small', { text: row.note }) : null), row.chip ? h('span', { class: 'inst-tag', text: t(`docs.chip.${row.chip}`) }) : null));
    })));
  }

  /** The way in from Hoy and the profile: the word and how many there are. */
  function entry(node) {
    if (!node) return;
    const n = docGroups(list()).reduce((a, g) => a + g.docs.length, 0);
    put(node, page(), h('span', { text: t('docs.chip') }), h('span', { class: 'label num', text: t('docs.count', { n }) }));
  }

  function wire() {
    $('#docBack').addEventListener('click', () => setTab(back));
    $('#docAdd').addEventListener('click', () => form());
  }

  return { load, open, render, hooks, entry, wire };
}
