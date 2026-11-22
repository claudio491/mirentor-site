// sites.js: what a rep's sites make. "Mis sitios activos", one tap from Hoy: the week's earnings as the headline, then
// each live site with who records, the phones on it, the consents, the hours of this week and the last and what it
// earned, with the way to add a worker, give or return a phone (the install's own screens, with the same lock). And a
// teammate's card, opened from their row on Equipo: their active sites by name, workers counted, hours and earnings.
// Every amount comes as cents from the server and becomes words in sites-steps.js; none is computed here.
import { $, $$, h, put, t, giant, toast, src, formSheet, reduce, quiet, dayMonth } from './ui.js';
import { reveal, stagger } from './fx.js';
import { money, paySource, mateCard, siteRows, hasSites } from './sites-steps.js';
import { siteHoursBody, recentMondays } from './manager-steps.js';
import { actingMode, readOnlyIn } from './practice-steps.js';
import { hm } from './leader-steps.js';

export function createSites({ api, S, errText, adopt, renderAll, setTab, openInstall }) {
  let back = 'today';
  const mode = () => actingMode(S.as, S.me);
  const readOnly = () => readOnlyIn(mode());

  function open(from = 'today') {
    back = from;
    $('#stList').replaceChildren();
    quiet(render);
    setTab('sites');
    if (!reduce) setTimeout(() => { if (S.tab !== 'sites') return; reveal($('#stGiant')); stagger($$('#stList .inst-zone'), { delay: 140, step: 90, y: 12 }); }, 90);
  }

  function render() {
    if (!S.me || !S.me.earn) return;
    const { earn, active } = S.me, rows = siteRows(active, t);
    $('#stCount').textContent = t('u.sites', { n: rows.length });
    // the headline: what the sites made this week, to the cent, opening into hours times rate; or "monto por definir"
    const g = $('#stGiant'), words = money(earn.week.cents, t), none = earn.week.cents == null;
    const amount = src(h('button', { class: 'src', type: 'button', text: words }), () => t('c.source'), () => paySource(earn.week.minutes, earn.rate, t));
    put(g, amount);   // an amount ends in its cents: no closing mark after it
    g.classList.toggle('word', none); g.classList.toggle('long', none);
    $('#stSupport').textContent = t('sites.support', { h: hm(earn.week.minutes || 0), l: hm(earn.last.minutes || 0) });
    $('#stRO').hidden = !readOnly();
    $('#stEmpty').hidden = rows.length > 0;
    put($('#stList'), rows.map((r, i) => zone(r, i)));
  }

  function zone(r, i) {
    const practice = mode() === 'practice';
    const cell = (label, value, cls = '') => h('div', { class: `sa-fig${cls ? ` ${cls}` : ''}` }, h('span', { class: 'label', text: label }), h('b', { class: 'num', text: value }));
    const earned = src(h('button', { class: 'src num', type: 'button', text: r.earned }), () => t('c.source'), () => {
      const x = S.me.active.find((a) => a.id === r.id);
      return paySource(x ? x.week : 0, x && x.cents != null ? S.me.earn.rate : null, t);
    });
    return h('section', { class: `inst-zone ${i % 2 ? 'inst-crew' : 'inst-prep'}`, 'data-site': r.id },
      h('div', { class: 'inst-zh' }, h('b', { class: 'inst-k', text: String(i + 1).padStart(2, '0') }), h('h2', { text: r.name }), r.practice ? h('span', { class: 'chip inst-prac', text: t('install.practice') }) : null),
      h('p', { class: 'sa-facts', text: r.facts }),
      h('div', { class: 'sa-figs' }, cell(t('sites.h.week'), r.week), cell(t('sites.h.last'), r.last), h('div', { class: 'sa-fig earn' }, h('span', { class: 'label', text: t('sites.h.earned') }), h('b', {}, earned))),
      h('div', { class: 'sa-acts' },
        readOnly() ? null : h('button', { class: 'mini-btn primary', type: 'button', 'data-act': 'add', text: t('sites.add'), onclick: () => openInstall(r.id, 'sites', 'add') }),
        h('button', { class: 'mini-btn', type: 'button', 'data-act': 'open', text: t('sites.open'), onclick: () => openInstall(r.id, 'sites') }),
        // a practice site's hours are recorded here, by the manager acting as its practice rep
        practice && r.practice ? h('button', { class: 'mini-btn', type: 'button', 'data-act': 'hours', text: t('sites.hours'), onclick: () => hoursForm(r) }) : null));
  }

  function hoursForm(r) {
    const today = S.me.today ? S.me.today.day : S.me.serverTime.slice(0, 10);
    formSheet({ title: t('sites.hours.title'), intro: t('sites.hours.p', { name: r.name }), submit: t('site.phones.submit'),
      fields: [{ name: 'week', type: 'select', label: t('site.hours.week'), value: recentMondays(today, 1)[0], options: recentMondays(today, 6).map((w) => ({ value: w, label: t('week.of', { date: dayMonth(w) }) })) },
        { name: 'h', type: 'number', label: t('site.hours.h') }, { name: 'm', type: 'number', label: t('site.hours.m') }],
      onSubmit: async (v) => {
        const { what, ...body } = siteHoursBody(v); void what;
        const res = await api('POST', 'route/hours', { site: r.id, ...body });
        adopt(res.me); renderAll(false); toast(t('site.hours.done'));
      } });
  }

  /** A teammate's card: their active sites by name with workers counted and hours, and the week's earnings with how
   *  they are worked out. Opened from their row on Equipo. */
  function mate(id, name) {
    const entry = (S.me.crew || []).find((c) => c.id === id);
    if (!entry) return;
    const card = mateCard(entry, S.me.earn ? S.me.earn.rate : null, t);
    const body = h('div', { class: 'sa-mate' },
      card.sites.length ? h('ul', { class: 'inst-rows' }, card.sites.map((x) => h('li', { class: 'inst-row two' }, h('span', { class: 'inst-n' }, h('b', { text: x.name }), h('small', { text: x.line }))))) : h('p', { class: 'note', text: t('mate.none') }),
      h('div', { class: 'sa-figs' }, h('div', { class: 'sa-fig' }, h('span', { class: 'label', text: t('sites.h.week') }), h('b', { class: 'num', text: card.hours })),
        h('div', { class: 'sa-fig earn' }, h('span', { class: 'label', text: t('mate.total') }), h('b', { class: 'num', text: card.total }))),
      h('p', { class: 'note sa-src', text: card.source }));
    formSheet({ title: name, intro: t('mate.intro'), body, submit: t('c.close'), onSubmit: async () => false });
  }

  /** The Hoy entry: once the person has a site live. */
  function entry(node) {
    if (!node) return;
    node.hidden = !hasSites(S.me);
    if (node.hidden) return;
    put(node, h('span', { class: 'sa-dot', 'aria-hidden': 'true' }), h('span', { text: t('sites.card') }), h('span', { class: 'label num', text: money(S.me.earn.week.cents, t) }));
  }

  function wire() {
    $('#stBack').addEventListener('click', () => setTab(back));
  }

  return { open, render, mate, entry, wire };
}
