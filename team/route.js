// route.js: the site's route, as the rep sees it. Three places: the route of one business, six stops from interested to
// installed, the one to do open with what it asks for; "Mis sitios en camino", every business from the meeting on with
// the stop it is at; and a Hoy card for the business furthest along that has something to do now. The look is the
// ladder's: the contract on porcelain, the site on graphite, round ticks and a meter that fills.
// The server computes every route (lib/team/route.mjs) and judges every write; route-steps.js decides what each stop
// offers. Through view-as on a real rep nothing that writes shows, and no write leaves this module. Acting as the
// practice rep, the stops that wait on a manager offer the manager's part, labeled practice.
import { $, $$, h, s, put, t, num, stamp, countTo, recount, flipList, toast, src, once, ringAt, lock, reduce, isQuiet, quiet, formSheet, newId } from './ui.js';
import { reveal, stagger } from './fx.js';
import { stopLine, stopControls, routeCard, openSiteBody, routeCount } from './route-steps.js';
import { actingMode, readOnlyIn } from './practice-steps.js';
import { docsAt } from './docs-steps.js';

const DEAL = [0, 1, 2], SITE = [3, 4, 5];   // the contract's stops, then the site's

/** The ladder's round tick: a disc that locks in and a check that draws itself. `now` rings it: the stop to do. */
const tickNode = () => h('span', { class: 'inst-tick', 'aria-hidden': 'true' }, h('i'),
  s('svg', { viewBox: '0 0 24 24', focusable: 'false' }, s('path', { class: 'ck', d: 'M7.2 12.6l3.2 3.2 6.6-7', pathLength: 1 })));
function setTick(node, on, now = false) {
  const was = node.classList.contains('on');
  node.classList.toggle('on', on); node.classList.toggle('now', !on && now);
  if (on && !was && node.dataset.seen && !isQuiet()) { lock(node); ringAt(node); }
  node.dataset.seen = '1';
}

export function createRoute({ api, S, errText, adopt, renderAll, setTab, openLog, openInstall, hooks = () => {} }) {
  let leadId = null, fetched = null, back = 'today', waysBack = 'today';
  const mode = () => actingMode(S.as, S.me);
  const readOnly = () => readOnlyIn(mode());
  const write = (method, path, body) => (readOnly() ? Promise.reject(Object.assign(new Error('read_only'), { code: 'read_only' })) : api(method, path, body));
  const routes = () => (S.me && Array.isArray(S.me.routes) ? S.me.routes : []);
  const tz = () => S.me.me.tz;
  /** The route on screen: the one in the person's view when the business is on the way, or the one read for it. */
  const current = () => routes().find((r) => r.lead.id === leadId) || (fetched && fetched.lead.id === leadId ? fetched : null);
  const stopName = (r) => t(`route.stop.${r.stops[Math.min(r.at, 5)].key}`);
  /** What the route says now, in one line: whose move it is and on which stop. */
  /** whose move a stop is, as the word in its keys: the rep's, a manager's, or a wait that expired (the rep's again) */
  const whose = (st) => (st.status === 'wait' ? (st.expired ? 'expired' : 'wait') : 'now');
  const summary = (r) => (r.complete ? t('route.support.done') : t(`route.support.${whose(r.stops[r.at])}`, { stop: stopName(r) }));

  // ---- one business ----
  async function open(id, from = null) {
    if (!id) return;
    leadId = id; back = from || 'today';
    if (!routes().some((r) => r.lead.id === id)) {
      try { fetched = (await api('GET', `route?lead=${encodeURIComponent(id)}`)).route; } catch (e) { toast(errText(e)); return; }
    }
    for (const sel of ['#rtDeal', '#rtSite', '#rtMeter']) $(sel).replaceChildren();
    $('#rtGiant').replaceChildren();
    quiet(paint);
    setTab('route');
    setTimeout(arrive, reduce ? 0 : 90);
  }
  /** The screen has just arrived: the headline rises, the meter fills again, the two zones and their stops come in. */
  function arrive() {
    if (reduce || S.tab !== 'route') return;
    reveal($('#rtGiant'));
    const n = $('#rtGiant .num'); if (n) recount(n);
    stagger([$('#rtDealZone'), $('#rtSiteZone')], { delay: 160, step: 120, y: 14 });
    stagger([...$$('#rtDeal li'), ...$$('#rtSite li')], { delay: 300, step: 45, y: 6 });
    const lit = $$('#rtMeter i.on');
    lit.forEach((c, i) => { c.style.setProperty('--k', String(i + 3)); c.classList.toggle('on', false); });
    void $('#rtMeter').offsetWidth;
    lit.forEach((c) => c.classList.toggle('on', true));
  }

  /** Draw the route of the business last opened, so coming back from its install finds it current, and the list when it
   *  is open. Quiet unless `animate`: then a stop that finished locks in. */
  function render(animate = false) {
    const run = () => { if (leadId) paint(); if (S.tab === 'ways') paintWays(); };
    if (animate) run(); else quiet(run);
  }

  function paint() {
    const r = current();
    if (!r) return;
    const c = routeCount(r), practice = mode() === 'practice' && r.practice;
    $('#rtName').textContent = r.lead.name;
    $('#rtPractice').hidden = !r.practice;
    $('#rtRO').hidden = !readOnly();
    $('#rtPracNote').hidden = !practice;
    $('#rtLead').textContent = t('route.lead');

    // The headline: stops done of six. The number counts; it opens into where each stop is read from.
    const g = $('#rtGiant');
    const [pre, post = ''] = t('route.giant', { a: '\u0001', b: num(c.of) }).split('\u0001');
    const n = $('.num', g) || h('span', { class: 'num' });
    const srcBtn = g.firstChild && g.firstChild.classList && g.firstChild.classList.contains('src') ? g.firstChild
      : src(h('button', { class: 'src', type: 'button' }), () => t('c.source'), () => { const k = current() ? routeCount(current()) : c; return t('route.src', { a: k.done, b: k.of }); });
    put(srcBtn, pre, n, post.replace(/\.$/, ''));
    put(g, srcBtn, h('em', { text: '.' }));
    countTo(n, c.done);
    g.classList.toggle('full', r.complete);
    $('#rtSupport').textContent = summary(r);

    const meter = $('#rtMeter');
    if (meter.childElementCount !== c.of) meter.replaceChildren(...r.stops.map(() => h('i')));
    const before = $$('i.on', meter).length;
    [...meter.children].forEach((cell, i) => { cell.style.setProperty('--k', String(Math.max(0, i - before))); cell.classList.toggle('on', r.stops[i].status === 'done'); cell.classList.toggle('now', i === r.at); });
    meter.setAttribute('aria-label', t('route.meter', { n: c.done, b: c.of }));
    $('#rtMeterT').textContent = t('route.meter', { n: c.done, b: c.of });

    paintRows($('#rtDeal'), r, DEAL);
    paintRows($('#rtSite'), r, SITE);
    $('#rtDealCount').textContent = t('install.zone.count', { a: DEAL.filter((i) => r.stops[i].status === 'done').length, b: DEAL.length });
    $('#rtSiteCount').textContent = t('install.zone.count', { a: SITE.filter((i) => r.stops[i].status === 'done').length, b: SITE.length });
  }

  function paintRows(list, r, idx) {
    flipList(list, idx.map((i) => ({ i, stop: r.stops[i] })), (x) => x.stop.key,
      () => h('li', { class: 'inst-row lad-row rt-row' }, tickNode(), h('span', { class: 'inst-n' }, h('b'), h('small')), h('span', { class: 'inst-tag' }), h('div', { class: 'lad-more' }), h('div', { class: 'doc-hooks lad-docs', hidden: true })),
      (li, { i, stop }) => {
        const now = i === r.at, was = li.classList.contains('lad-now'), ctl = stopControls(r, i, mode()), line = stopLine(r, i, { agreement: docsAt(S.docs || [], 'contract').length > 0 });
        setTick($('.inst-tick', li), stop.status === 'done', now);
        li.classList.toggle('lad-now', now); li.classList.toggle('done', stop.status === 'done');
        $('b', li).textContent = t(`route.stop.${stop.key}`);
        $('small', li).textContent = t(line.key, { when: line.at ? stamp(line.at, tz()) : '' });
        // whose move it is, on the stop to do
        const tag = $('.inst-tag', li);
        tag.hidden = !now || stop.status === 'later';
        tag.textContent = now ? t(`route.tag.${whose(stop)}`) : '';
        tag.classList.toggle('ok', now && stop.status === 'now'); tag.classList.toggle('miss', now && stop.status === 'wait');
        const more = $('.lad-more', li), nodes = controls(r, i, ctl);
        more.hidden = !nodes.length;
        put(more, ...nodes);
        if (now && nodes.length && !was && li.dataset.painted && !isQuiet()) { stagger([more], { y: 10, delay: 220 }); ringAt($('.inst-tick', li)); }
        // the agreement at hand while the contract is sent and signed
        const docsBox = $('.lad-docs', li);
        if (ctl.docs) hooks(docsBox, 'contract'); else docsBox.hidden = true;
        li.dataset.painted = '1';
      });
  }

  /** What a stop offers: its own button, the practice control in the manager's place, or the way into the install. */
  function controls(r, i, ctl) {
    const out = [];
    if (ctl.log) out.push(h('button', { class: 'btn primary wide', type: 'button', text: t(`route.btn.${ctl.log}`), onclick: () => openLog({ lead: r.lead, kind: ctl.log, from: 'route' }) }));
    if (ctl.openSite) out.push(h('button', { class: 'btn primary wide', type: 'button', text: t('route.btn.site'), onclick: () => siteForm(r) }));
    if (ctl.practice) out.push(h('button', { class: 'btn primary wide rt-prac', type: 'button', text: t(`route.btn.${ctl.practice}`), onclick: (e) => practiceMove(e.currentTarget, r, ctl.practice) }));
    if (ctl.install) out.push(h('button', { class: ctl.install === 'open' && r.stops[i].status === 'now' ? 'btn primary wide' : 'btn wide', type: 'button', text: t(ctl.install === 'open' ? 'route.btn.install' : 'route.btn.install.view'), onclick: () => openInstall(r.site.id, 'route') }));
    if (out.length) out.push(h('p', { class: 'formerr', role: 'alert', hidden: true }));
    return out;
  }

  /** A write answered with the whole view: everything follows, and the route draws the difference with motion. */
  const took = (res, okKey) => { adopt(res.me); renderAll(false); render(true); if (okKey) toast(t(okKey)); };

  /** The manager's part, done from the route while acting as the practice rep. */
  function practiceMove(btn, r, what) {
    if (what === 'phones') {
      formSheet({ title: t('route.btn.phones'), intro: t('site.phones.intro', { name: r.lead.name }), submit: t('site.phones.submit'),
        fields: [{ name: 'count', type: 'number', label: t('site.phones.count'), value: r.site && r.site.eligible ? String(Math.min(500, r.site.eligible)) : '' }],
        onSubmit: async (v) => {
          const count = Number(v.count);
          if (!/^\d+$/.test(v.count) || count < 1 || count > 500) throw Object.assign(new Error('fields'), { code: 'fields' });
          took(await write('POST', 'route/phones', { lead: r.lead.id, count }), 'route.prac.saved');
        } });
      return;
    }
    once(btn, async () => {
      const err = btn.parentNode && $('.formerr', btn.parentNode);
      if (err) err.hidden = true;
      try {
        const res = what === 'installed' ? await write('POST', 'route/installed', { lead: r.lead.id }) : await write('POST', 'route/confirm', { lead: r.lead.id, what });
        took(res, 'route.prac.saved');   // practice: nothing of it counts, so no toast says points do
      } catch (e) { if (err) { err.textContent = errText(e); err.hidden = false; } else toast(errText(e)); }
    });
  }

  /** "Abrir el sitio": the name comes from the business; the city, the eligible workers and the coordinator are typed.
   *  The id is made when the form opens: sending it twice opens one site. */
  function siteForm(r) {
    const siteId = `s_${newId()}`;
    formSheet({ title: t('route.site.title'), intro: t('route.site.p', { name: r.lead.name }), submit: t('route.btn.site'),
      fields: [{ name: 'city', label: t('site.form.city'), value: S.me.me.city || '', max: 60 },
        { name: 'eligible', type: 'number', label: t('site.form.eligible'), hint: t('site.form.eligible.hint') },
        { name: 'coordName', label: t('site.form.coord.name'), max: 80 }, { name: 'coordPhone', type: 'tel', label: t('site.form.coord.phone'), max: 30 }],
      onSubmit: async (v) => { took(await write('POST', 'route/site', openSiteBody(v, siteId, r.lead.id)), 'route.site.done'); } });
  }

  // ---- my sites on the way ----
  function openWays(from = null) {
    waysBack = from || 'today';
    $('#wyList').replaceChildren();
    quiet(paintWays);
    setTab('ways');
    if (!reduce) setTimeout(() => { reveal($('#wyGiant')); stagger($$('#wyList li'), { delay: 160, step: 45, y: 8 }); }, 90);
  }
  function paintWays() {
    const list = routes();
    $('#wyRO').hidden = !readOnly();
    const g = $('#wyGiant'), n = $('.num', g) || h('span', { class: 'num' });
    put(g, n, h('em', { text: '.' }));
    countTo(n, list.length);
    $('#wySupport').textContent = list.length ? t('ways.support', { n: list.filter((r) => !r.complete && r.stops[r.at].status === 'now').length }) : t('ways.empty');
    flipList($('#wyList'), list, (r) => r.lead.id,
      () => h('li', { class: 'inst-row tap rt-way' }, tickNode(), h('span', { class: 'inst-n' }, h('b'), h('small')), h('span', { class: 'inst-tag' }),
        h('button', { class: 'inst-hit', type: 'button', onclick: (e) => open(e.currentTarget.closest('li').dataset.key, 'ways') })),
      (li, r) => {
        const st = r.complete ? null : r.stops[r.at];
        setTick($('.inst-tick', li), r.complete, !!st && st.status === 'now');
        $('b', li).textContent = r.lead.name;
        $('small', li).textContent = r.complete ? t('ways.complete') : t('ways.stop', { n: r.at + 1, b: r.stops.length, stop: stopName(r) });
        const tag = $('.inst-tag', li);
        tag.hidden = r.complete;
        tag.textContent = st ? t(`route.tag.${whose(st)}`) : '';
        tag.classList.toggle('ok', !!st && st.status === 'now'); tag.classList.toggle('miss', !!st && st.status === 'wait');
        $('.inst-hit', li).setAttribute('aria-label', t('route.row.aria', { lead: r.lead.name }));
      });
    $('#wyCount').textContent = t('ways.count', { n: list.length });
  }

  // ---- Hoy and the profile ----
  /** The Hoy card: the business furthest along with something to do now, its stop and the way to its route. */
  function card(slot) {
    const r = S.mgr ? null : routeCard(routes(), mode());
    if (!r) { slot.hidden = true; slot.replaceChildren(); return; }
    slot.hidden = false;
    const c = routeCount(r);
    const meter = $('.inst-meter', slot) || h('div', { class: 'inst-meter', 'aria-hidden': 'true' });
    if (meter.childElementCount !== c.of) meter.replaceChildren(...r.stops.map(() => h('i')));
    const before = $$('i.on', meter).length;
    [...meter.children].forEach((cell, i) => { cell.style.setProperty('--k', String(Math.max(0, i - before))); cell.classList.toggle('on', r.stops[i].status === 'done'); });
    const more = routes().length - 1;
    put(slot,
      h('div', { class: 'inst-card-h' }, h('span', { class: 'label', text: t('route.chip') }), r.practice ? h('span', { class: 'chip inst-prac', text: t('install.practice') }) : h('span', { class: 'label num', text: t('install.zone.count', { a: c.done, b: c.of }) })),
      meter,
      h('p', { class: 'lead', id: 'rtCardName', text: r.lead.name }),
      h('p', { text: summary(r) }),
      h('button', { class: 'btn', type: 'button', text: t(readOnly() ? 'route.card.view' : 'route.card.go'), onclick: () => open(r.lead.id, 'today') }),
      more > 0 ? h('button', { class: 'mini-btn rt-more', type: 'button', text: t('route.card.more', { n: more }), onclick: () => openWays('today') }) : null);
  }
  /** The profile keeps the way to the list. */
  const profileButtons = () => (routes().length ? [h('button', { class: 'btn', type: 'button', onclick: () => openWays('profile') }, t('ways.chip'), h('span', { class: 'num lad-of', text: ` · ${num(routes().length)}` }))] : []);

  function wire() {
    $('#rtBack').addEventListener('click', () => setTab(back));
    $('#wyBack').addEventListener('click', () => setTab(waysBack));
  }

  return { open, openWays, render, card, profileButtons, wire };
}
