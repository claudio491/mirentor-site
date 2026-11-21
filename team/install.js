// install.js: the install of a site, as the rep who installs it sees it. Two zones on their own ground: "Antes de grabar"
// (the signs, the zones without recording, the site's coordinator) on porcelain, and the workers on graphite, with the
// count of who is ready filling as each one gets a consent, a phone and a test clip.
// The server answers every action with the whole install; the screen draws the difference and moves only what changed.
import { $, $$, h, s, put, icon, t, num, cityName, stamp, countTo, recount, flipList, toast, src, once, formSheet, ringAt, lock, reduce, isQuiet, quiet, EASE } from './ui.js';
import { reveal, stagger } from './fx.js';
import { lens, setLens, drawIn } from './hand.js';
import { workerOrder, workerSteps, prepRows, statusKey, newWorkerId, isDone } from './install-steps.js';

const tail = (imei) => (imei ? String(imei).slice(-4) : '');

/** A round tick: a disc that locks in and a check that draws itself. `now` rings it in signal: the next one to do. */
const tickNode = () => h('span', { class: 'inst-tick', 'aria-hidden': 'true' }, h('i'),
  s('svg', { viewBox: '0 0 24 24', focusable: 'false' }, s('path', { class: 'ck', d: 'M7.2 12.6l3.2 3.2 6.6-7', pathLength: 1 })));
function setTick(node, on, now = false) {
  const was = node.classList.contains('on');
  node.classList.toggle('on', on); node.classList.toggle('now', !on && now);
  if (on && !was && node.dataset.seen && !isQuiet()) { lock(node); ringAt(node); }
  node.dataset.seen = '1';
}

export function createInstall({ api, S, errText, refresh, setTab }) {
  let view = null, back = 'profile', siteId = null;
  const tz = () => S.me.me.tz;

  async function open(id, from) {
    siteId = id; back = from || (S.mgr ? 'team' : 'profile');
    try {
      view = await api('GET', `install/${encodeURIComponent(id)}`);
    } catch (e) { toast(errText(e)); return; }
    reset();
    quiet(() => render(false));
    setTab('install');
    setTimeout(arrive, reduce ? 0 : 90);
  }
  /** A new site on screen starts from empty: no row, no tick, no counter carries over from the last one. */
  function reset() {
    for (const sel of ['#instPrep', '#instList', '#instMeter']) $(sel).replaceChildren();
    $('#instLenses').replaceChildren();
    $('#instGiant').replaceChildren();
  }
  /** The screen has just arrived: the headline rises, the arcs draw, the zones and their rows come in, the meter fills. */
  function arrive() {
    if (reduce || S.tab !== 'install') return;
    reveal($('#instGiant'));
    const n = $('#instGiant .num'); if (n) recount(n);
    drawIn($('#instLenses'), 140, 90);
    stagger([$('#instPrepZone'), $('#instCrewZone')], { delay: 160, step: 120, y: 14 });
    stagger([...$$('#instPrep li'), ...$$('#instList li')], { delay: 300, step: 45, y: 6 });
    // the lit cells fill again, one after another
    const lit = $$('#instMeter i.on');
    lit.forEach((c, i) => { c.style.setProperty('--k', String(i + 4)); c.classList.toggle('on', false); });
    void $('#instMeter').offsetWidth;
    lit.forEach((c) => c.classList.toggle('on', true));
  }

  /** Run an install action. The answer is the whole install, drawn with motion; `me` follows so the counts elsewhere agree. */
  const act = (btn, call, okKey) => once(btn, async () => {
    try { view = await call(); render(true); if (okKey) toast(t(okKey)); refresh(false); } catch (e) { toast(errText(e)); }
  });

  function render(animate = false) {
    if (!view) return;
    const run = () => paint();
    if (animate) run(); else quiet(run);
  }

  function paint() {
    const { site, workers, progress } = view;
    const den = site.phones || progress.total || 0;
    $('#instSite').textContent = site.name;
    $('#instPractice').hidden = !site.practice;
    $('#instCity').textContent = cityName(site.city); $('#instCity').hidden = !site.city;
    $('#instPracticeNote').hidden = !site.practice;

    // The headline: who is ready out of the phones that reached the site. The number counts; it opens into its source.
    const g = $('#instGiant');
    const [pre, post = ''] = t('install.giant', { a: '\u0001', b: num(den) }).split('\u0001');
    const n = $('.num', g) || h('span', { class: 'num' });
    const srcBtn = g.firstChild && g.firstChild.classList && g.firstChild.classList.contains('src') ? g.firstChild
      : src(h('button', { class: 'src', type: 'button' }), () => t('c.source'), () => t('install.src.ready', { a: view.progress.ready, b: view.site.phones || view.progress.total || 0 }));
    put(srcBtn, pre, n, post.replace(/\.$/, ''));
    put(g, srcBtn, h('em', { text: '.' }));
    countTo(n, progress.ready);
    g.classList.toggle('full', den > 0 && progress.ready >= den);

    // Two lenses: consents on file of the people on the list, phones handed out of the phones received.
    const box = $('#instLenses');
    if (!box.childElementCount) box.append(
      src(lens('consents', ''), () => t('c.source'), () => t('install.src.consents', { a: view.progress.consents, b: view.progress.total })),
      src(lens('phones', ''), () => t('c.source'), () => t('install.src.phones', { a: view.progress.phones, b: view.site.phones || 0 })));
    $('[data-lens="consents"] .l', box).textContent = t('install.lens.consents');
    $('[data-lens="phones"] .l', box).textContent = t('install.lens.phones');
    setLens($('[data-lens="consents"]', box), progress.consents, progress.total);
    setLens($('[data-lens="phones"]', box), progress.phones, site.phones || 0);

    paintPrep(site);
    paintCrew(site, workers, progress, den);
  }

  // ---- zone 1: before recording ----
  function paintPrep(site) {
    const rows = prepRows(site);
    const now = rows.findIndex((r) => !r.done);
    flipList($('#instPrep'), rows, (r) => r.key,
      () => h('li', { class: 'inst-row' }, tickNode(), h('span', { class: 'inst-n' }, h('b'), h('small')), h('span', { class: 'inst-act' })),
      (li, r, i) => {
        setTick($('.inst-tick', li), r.done, i === now);
        $('b', li).textContent = t(`install.prep.${r.key}`);
        const when = r.key === 'coordinator' ? null : site.prep && site.prep[r.key];
        $('small', li).textContent = r.done ? (r.key === 'coordinator' ? `${site.coordinator.name} · ${site.coordinator.phone}` : t('install.prep.done', { when: stamp(when, tz()) })) : t(`install.prep.${r.key}.s`);
        const slot = $('.inst-act', li);
        if (r.key === 'coordinator') {
          put(slot, h('button', { class: 'mini-btn', type: 'button', text: t(r.done ? 'c.change' : 'install.prep.add'), onclick: () => coordinator(site) }));
        } else if (!r.done) {
          put(slot, h('button', { class: 'mini-btn', type: 'button', text: t('install.prep.mark'), 'aria-label': t('install.prep.mark.aria', { what: t(`install.prep.${r.key}`) }),
            onclick: (e) => act(e.currentTarget, () => api('POST', `install/${encodeURIComponent(siteId)}/prep`, { what: r.key }), 'install.prep.saved') }));
        } else put(slot);
      });
    $('#instPrepCount').textContent = t('install.zone.count', { a: rows.filter((r) => r.done).length, b: rows.length });
  }
  function coordinator(site) {
    formSheet({ title: t('install.coord.title'), intro: t('install.coord.p'), submit: t('install.coord.submit'),
      fields: [{ name: 'name', label: t('install.coord.name'), value: site.coordinator ? site.coordinator.name : '', max: 80 },
        { name: 'phone', type: 'tel', label: t('install.coord.phone'), value: site.coordinator ? site.coordinator.phone : '', max: 30 }],
      onSubmit: async (v) => { view = await api('POST', `install/${encodeURIComponent(siteId)}/coordinator`, { name: v.name, phone: v.phone }); render(true); toast(t('install.coord.saved')); refresh(false); } });
  }

  // ---- zone 2: the workers ----
  function paintCrew(site, workers, progress, den) {
    // The meter: one cell per phone that reached the site, lit as each worker becomes ready. Cells that light now
    // light one after another, from the first new one.
    const meter = $('#instMeter'), cells = Math.max(den, 1), lit = Math.min(progress.ready, cells);
    if (meter.childElementCount !== cells) meter.replaceChildren(...Array.from({ length: cells }, () => h('i')));
    const before = $$('i.on', meter).length;
    [...meter.children].forEach((c, i) => { c.style.setProperty('--k', String(Math.max(0, i - before))); c.classList.toggle('on', i < lit); });
    meter.setAttribute('aria-label', t('install.meter', { n: progress.ready, b: den }));
    $('#instMeterT').textContent = t('install.meter', { n: progress.ready, b: den });
    $('#instAdv').hidden = !progress.allRecordingHaveConsent;
    if (progress.allRecordingHaveConsent) setTick($('#instAdv .inst-tick'), true);

    const ordered = workerOrder(workers), nowId = (ordered.find((w) => !isDone(w.status)) || {}).id;
    const list = $('#instList');
    const known = new Set([...list.children].map((n) => n.dataset.key));
    flipList(list, ordered, (w) => w.id,
      () => h('li', { class: 'inst-row' }, tickNode(), h('span', { class: 'inst-n' }, h('b'), h('small')), h('span', { class: 'inst-tag' }), h('span', { class: 'inst-steps', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'))),
      (li, w) => {
        const done = isDone(w.status), was = li.dataset.st;
        setTick($('.inst-tick', li), done, w.id === nowId);
        $('b', li).textContent = w.name;
        $('small', li).textContent = t(`install.d.${w.status}`, { imei: tail(w.imei) });
        const tag = $('.inst-tag', li);
        tag.textContent = t(statusKey(w.status)); tag.classList.toggle('ok', done); tag.classList.toggle('miss', !done);
        if (was && was !== w.status && !isQuiet()) lock(tag);
        // three small joints: consent, phone, clip; a coworker who gets no phone has one
        const steps = workerSteps(w), dots = $$('.inst-steps i', li);
        dots.forEach((d, k) => { d.hidden = !steps[k]; d.classList.toggle('on', !!steps[k] && steps[k].done); });
        li.dataset.st = w.status;
        li.setAttribute('aria-label', `${w.name}: ${t(statusKey(w.status))}`);
        if (!known.has(w.id) && !isQuiet() && li.animate) li.animate([{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: EASE.out });
      });
    $('#instEmpty').hidden = workers.length > 0;
    $('#instCrewCount').textContent = t('install.zone.count', { a: workers.filter((w) => isDone(w.status)).length, b: workers.length });
  }

  function addWorker() {
    const id = newWorkerId();   // made once per sheet: a second tap after a bad connection sends the same person
    formSheet({ title: t('install.add.title'), intro: t('install.add.p'), submit: t('install.add.submit'),
      fields: [{ name: 'name', label: t('install.add.name'), max: 80 }, { name: 'email', type: 'email', label: t('install.add.email'), lower: true, max: 120 },
        { name: 'phone', type: 'select', label: t('install.add.phone'), value: 'yes', options: [{ value: 'yes', label: t('install.add.phone.yes') }, { value: 'no', label: t('install.add.phone.no') }] }],
      onSubmit: async (v) => {
        view = await api('POST', `install/${encodeURIComponent(siteId)}/workers`, { id, name: v.name, email: v.email, phone: v.phone !== 'no' });
        render(true); toast(t('install.add.done', { name: v.name })); refresh(false);
      } });
  }

  /** The temporary way in, until the Hoy card: a list of the installs that wait, in the profile and the team view. */
  function entry(slot) {
    const list = (S.me && S.me.installs) || [];
    slot.hidden = !list.length;
    if (!list.length) { slot.replaceChildren(); return; }
    put(slot, h('div', { class: 'inst-entry-h' }, h('h2', { class: 'sec-h', text: t('install.entry.title') }), h('span', { class: 'chip ghost', text: t('install.entry.temp') })),
      h('ul', { class: 'inst-entry' }, list.map((x) => {
        return h('li', {}, h('button', { class: 'leadopt', type: 'button', onclick: () => open(x.id, S.tab) },
          h('span', {}, h('b', { text: x.name }), h('small', { text: t('install.entry.s', { a: x.ready, b: x.phones }) })),
          h('span', { class: 'inst-entry-k' }, x.practice ? h('span', { class: 'chip', text: t('install.practice') }) : null, icon('go'))));
      })));
  }

  function wire() {
    $('#instBack').addEventListener('click', () => setTab(back));
    $('#instAdd').addEventListener('click', addWorker);
  }

  return { open, render, entry, wire, isOpen: () => !!view };
}
