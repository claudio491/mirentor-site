// install.js: the install of a site, as the rep who installs it sees it. Four places: the Hoy card that says an install
// waits; the site, with "Antes de grabar" (signs, zones without recording, the coordinator) on porcelain and the workers
// on graphite; one worker, whose consent photo opens the phone step and whose phone opens the clip step; and the close,
// with the site's record. Every screen labels a practice site "Práctica".
// The server answers every action with the whole install; the screen draws the difference and moves only what changed.
import { $, $$, h, s, put, t, num, cityName, stamp, dayMonth, giant, countTo, recount, flipList, toast, src, once, formSheet, ringAt, lock, buzz, reduce, isQuiet, quiet, showErr, EASE } from './ui.js';
import { reveal, stagger } from './fx.js';
import { lens, setLens, drawIn } from './hand.js';
import { workerOrder, workerSteps, prepRows, statusKey, newWorkerId, isDone, installCard, imeiFor, imeiFromScan, stepNow, recordRows, closeState, consentFailed, controls, keepForRetry } from './install-steps.js';
import { shrink, examplePage } from './shrink.js';
import { actingMode, readOnlyIn } from './practice-steps.js';

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
  let view = null, back = 'today', siteId = null, wid = null;
  const failed = new Map();   // worker id -> the shrunk photo whose upload did not arrive, kept for the retry
  const tz = () => S.me.me.tz;
  // A manager looking through a real rep's screens (view-as) reads only: the screens show no control that writes, and no
  // install write leaves this module, whatever is tapped. Acting as the practice rep is not read only.
  const readOnly = () => readOnlyIn(actingMode(S.as, S.me));
  const ctl = (w = null) => controls({ readOnly: readOnly(), site: view.site, worker: w });
  const write = (method, path, body) => (readOnly() ? Promise.reject(Object.assign(new Error('read_only'), { code: 'read_only' })) : api(method, path, body));

  /** Open a site's install. `to` is the screen to land on: the site, or its close (from a closed install's card). */
  async function open(id, from, to = 'install') {
    siteId = id; back = from || 'today';
    try {
      view = await api('GET', `install/${encodeURIComponent(id)}`);
    } catch (e) { toast(errText(e)); return; }
    reset();
    quiet(() => render(false));
    if (to === 'iclose') { openClose(); return; }
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

  /** Why the server said no, in words that say what to do next. An IMEI held elsewhere names that site to a manager. */
  const why = (e) => (e && e.code === 'imei_taken' && e.data && e.data.site ? t('err.imei_taken.site', { site: e.data.site }) : errText(e));
  /** Run an install action. The answer is the whole install, drawn with motion; `me` follows so the counts elsewhere agree.
   *  A refusal is said in `errNode` when there is one (next to the button), or in a toast. */
  const act = (btn, call, okKey, errNode = null) => once(btn, async () => {
    if (errNode) errNode.hidden = true;
    try { view = await call(); render(true); if (okKey) toast(t(okKey)); refresh(false); return true; } catch (e) { if (errNode) showErr(errNode, why(e)); else toast(why(e)); return false; }
  });

  /** Draw whichever install screen is open, and the site screen under it, so going back finds it current. */
  function render(animate = false) {
    if (!view) return;
    const run = () => { paint(); if (S.tab === 'worker') paintWorker(); if (S.tab === 'iclose') paintClose(); };
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
    $('#instRO').hidden = !readOnly();
    $('#instAdd').hidden = !ctl().addWorker;
    // the way to the close: once someone is ready, or to see it again once it is closed (read only, it only looks)
    const cs = closeState(view), go = $('#instToClose');
    go.hidden = cs.kind === 'nobody';
    go.textContent = t(cs.kind === 'closed' || readOnly() ? 'install.c.view' : 'install.c.go');
    go.classList.toggle('primary', cs.kind !== 'closed' && !readOnly());   // only looking is never the call to action
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
        if (!ctl().prep) put(slot);
        else if (r.key === 'coordinator') {
          put(slot, h('button', { class: 'mini-btn', type: 'button', text: t(r.done ? 'c.change' : 'install.prep.add'), onclick: () => coordinator(site) }));
        } else if (!r.done) {
          put(slot, h('button', { class: 'mini-btn', type: 'button', text: t('install.prep.mark'), 'aria-label': t('install.prep.mark.aria', { what: t(`install.prep.${r.key}`) }),
            onclick: (e) => act(e.currentTarget, () => write('POST', `install/${encodeURIComponent(siteId)}/prep`, { what: r.key }), 'install.prep.saved') }));
        } else put(slot);
      });
    $('#instPrepCount').textContent = t('install.zone.count', { a: rows.filter((r) => r.done).length, b: rows.length });
  }
  function coordinator(site) {
    formSheet({ title: t('install.coord.title'), intro: t('install.coord.p'), submit: t('install.coord.submit'),
      fields: [{ name: 'name', label: t('install.coord.name'), value: site.coordinator ? site.coordinator.name : '', max: 80 },
        { name: 'phone', type: 'tel', label: t('install.coord.phone'), value: site.coordinator ? site.coordinator.phone : '', max: 30 }],
      onSubmit: async (v) => { view = await write('POST', `install/${encodeURIComponent(siteId)}/coordinator`, { name: v.name, phone: v.phone }); render(true); toast(t('install.coord.saved')); refresh(false); } });
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
      () => h('li', { class: 'inst-row tap' }, tickNode(), h('span', { class: 'inst-n' }, h('b'), h('small')), h('span', { class: 'inst-tag' }), h('span', { class: 'inst-steps', 'aria-hidden': 'true' }, h('i'), h('i'), h('i')),
        h('button', { class: 'inst-hit', type: 'button', onclick: (e) => openWorker(e.currentTarget.closest('li').dataset.key) })),
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
        $('.inst-hit', li).setAttribute('aria-label', t('install.w.open.aria', { name: w.name, state: t(statusKey(w.status)) }));
        if (!known.has(w.id) && !isQuiet() && li.animate) li.animate([{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 360, easing: EASE.out });
      });
    $('#instEmpty').hidden = workers.length > 0;
    $('#instCrewCount').textContent = t('install.zone.count', { a: workers.filter((w) => isDone(w.status)).length, b: workers.length });
  }

  function addWorker() {
    if (!ctl().addWorker) return;
    const id = newWorkerId();   // made once per sheet: a second tap after a bad connection sends the same person
    formSheet({ title: t('install.add.title'), intro: t('install.add.p'), submit: t('install.add.submit'),
      fields: [{ name: 'name', label: t('install.add.name'), max: 80 }, { name: 'email', type: 'email', label: t('install.add.email'), lower: true, max: 120 },
        { name: 'phone', type: 'select', label: t('install.add.phone'), value: 'yes', options: [{ value: 'yes', label: t('install.add.phone.yes') }, { value: 'no', label: t('install.add.phone.no') }] }],
      onSubmit: async (v) => {
        view = await write('POST', `install/${encodeURIComponent(siteId)}/workers`, { id, name: v.name, email: v.email, phone: v.phone !== 'no' });
        render(true); toast(t('install.add.done', { name: v.name })); refresh(false);
        setTimeout(() => openWorker(id), reduce ? 0 : 260);   // the sheet leaves, then their own screen: the consent is next
      } });
  }

  // ---- one worker ----
  const worker = () => (view && view.workers.find((w) => w.id === wid)) || null;
  function openWorker(id) {
    wid = id;
    for (const n of ['#wkErr1', '#wkErr2', '#wkErr3']) $(n).hidden = true;
    $('#wkImei').value = ''; $('#wkShot').replaceChildren(); delete $('#wkGiant').dataset.k;
    for (const tk of $$('#s-worker .inst-tick')) { tk.classList.toggle('on', false); tk.classList.toggle('now', false); delete tk.dataset.seen; }
    for (const st of $$('#s-worker .inst-step')) delete st.dataset.locked;
    delete $('#wkReturn').dataset.armed;
    $('#wkShot').dataset.k = '';
    quiet(paintWorker);
    setTab('worker');
    if (reduce) return;
    setTimeout(() => { reveal($('#wkGiant')); stagger($$('#s-worker .inst-step'), { delay: 140, step: 110, y: 14 }); }, 90);
  }
  function paintWorker() {
    const w = worker();
    if (!w) return;
    const site = view.site, steps = workerSteps(w), now = stepNow(w), all = steps.every((x) => x.done), c = ctl(w);
    $('#wkRO').hidden = !readOnly();
    $('#wkSite').textContent = site.name; $('#wkPractice').hidden = !site.practice;
    $('#wkName').textContent = all ? w.name : t('install.w.lead', { name: w.name });
    const g = $('#wkGiant'), key = all ? 'done' : `${now.at}/${now.of}`;
    if (g.dataset.k !== key) { giant(g, all ? t('install.w.done') : t('install.w.giant', { a: now.at, b: now.of })); if (g.dataset.k && !isQuiet()) reveal(g); g.dataset.k = key; }
    g.classList.toggle('full', all);
    $('#wkSupport').textContent = t(`install.w.s.${w.status}`);

    // 1 · the consent: the photo itself once it is on file, with the form version and the server's time
    const s1 = $('#wkS1'), retry = failed.has(w.id) && !w.consent;
    setTick($('#wkS1 .inst-tick'), !!w.consent, !w.consent);
    s1.classList.toggle('done', !!w.consent);
    const shot = $('#wkShot');
    shot.classList.toggle('has', !!w.consent);
    const key1 = w.consent ? `${w.id}:${w.consent.v}` : `${w.id}:none`;
    if (shot.dataset.k !== key1) {
      shot.dataset.k = key1;
      put(shot, w.consent ? h('img', { src: `api/consent/${encodeURIComponent(w.id)}?v=${encodeURIComponent(w.consent.v)}`, alt: t('install.w.photo.alt', { name: w.name }), decoding: 'async' })
        : [h('span', { class: 'inst-doc', 'aria-hidden': 'true' }, h('i'), h('i'), h('i'), h('i'), h('i'), h('i')), h('span', { class: 'inst-shot-t', text: t('install.w.photo.hint') })]);
    }
    $('#wkMeta').hidden = !w.consent;
    if (w.consent) $('#wkMeta').textContent = t('install.w.saved', { form: w.consent.form, when: stamp(w.consent.t, tz()) });
    $('#wkFileT').textContent = t(w.consent ? 'install.w.photo.again' : 'install.w.photo');
    $('#wkFileBtn').hidden = !c.consent;
    $('#wkFileBtn').classList.toggle('primary', !w.consent && !retry);
    $('#wkRetry').hidden = !retry || !c.consent;
    $('#wkRetry').classList.toggle('primary', retry);
    $('#wkExample').hidden = !c.example;   // a practice site only: a drawn page instead of a camera

    // 2 · the phone: locked until the consent is on file. A coworker who signs only has no phone step.
    const only = w.phone === false, open2 = !only && steps[1].open, s2 = $('#wkS2');
    s2.classList.toggle('locked', !only && !open2); s2.classList.toggle('done', !only && steps[1].done); s2.classList.toggle('only', only);
    setTick($('#wkS2 .inst-tick'), !only && steps[1].done, open2 && !steps[1].done);
    $('#wkLock2').hidden = only || open2;
    $('#wkOnly').hidden = !only;
    $('#wkPhoneBody').hidden = !c.phone;
    $('#wkPhoneDone').hidden = only || !steps[1].done;
    // giving the phone back: a second tap, then the worker needs a phone again and can be given another one
    const ret = $('#wkReturn');
    ret.hidden = !c.returnPhone;
    ret.classList.toggle('armed', !!ret.dataset.armed);
    ret.textContent = t(ret.dataset.armed ? 'install.w.return.again' : 'install.w.return');
    if (w.imei) $('#wkImeiShown').textContent = t('install.w.imei.shown', { imei: `···${tail(w.imei)}` });
    $('#wkScanBtn').hidden = !('BarcodeDetector' in window);
    imeiHint();
    // a step that has just opened says so: its lock gives way and what it asks for arrives
    const opened = (node, open, body) => { if (open && node.dataset.locked === '1' && !isQuiet()) { stagger([body], { y: 10 }); ringAt($('.inst-tick', node)); } node.dataset.locked = open ? '0' : '1'; };
    opened(s2, c.phone, $('#wkPhoneBody'));

    // 3 · the clip: locked until the phone is handed out
    const s3 = $('#wkS3'), open3 = !only && steps[2] && steps[2].open;
    s3.hidden = only;
    s3.classList.toggle('locked', !open3); s3.classList.toggle('done', !!(steps[2] && steps[2].done));
    setTick($('#wkS3 .inst-tick'), !!(steps[2] && steps[2].done), open3 && !steps[2].done);
    $('#wkLock3').hidden = !!open3;
    $('#wkClipBody').hidden = !c.clip;
    $('#wkClipDone').hidden = !(steps[2] && steps[2].done);
    opened(s3, c.clip, $('#wkClipBody'));
  }
  /** The IMEI as it is typed: how many digits are there, and whether the check digit holds. On a practice site any
   *  IMEI-shaped text will do, and the hint says so. */
  function imeiHint() {
    const v = $('#wkImei').value, digits = v.replace(/[\s-]/g, ''), practice = !!(view && view.site.practice), ok = !!imeiFor(view && view.site, v);
    const input = $('#wkImei');
    input.placeholder = t(practice ? 'install.w.imei.practice.ph' : 'install.w.imei.ph'); input.inputMode = practice ? 'text' : 'numeric';
    $('#wkImeiSave').disabled = !ok;
    $('#wkImeiHint').textContent = practice ? t(ok ? 'install.w.imei.practice.ok' : 'install.w.imei.practice')
      : ok ? t('install.w.imei.ok') : digits.length === 15 && /^\d+$/.test(digits) ? t('install.w.imei.check') : /[^\d\s-]/.test(v) ? t('install.w.imei.chars') : t('install.w.imei.count', { n: digits.length });
    $('#wkImeiHint').classList.toggle('ok', ok);
  }
  /** A consent photo: shrunk to JPEG on the phone, then sent for this worker's id. A failed upload keeps the photo and
   *  the id, so the retry is the same worker and the same photo; until it arrives the worker stays "Falta firma". */
  async function sendConsent(blob) {
    const id = wid, err = $('#wkErr1'), btn = $('#wkRetry');
    if (readOnly()) return;
    err.hidden = true; $('#wkFileBtn').classList.add('busy'); $('#wkFileT').textContent = t('install.w.sending');
    try {
      view = await write('PUT', `worker/${encodeURIComponent(id)}/consent`, blob);
      failed.delete(id);
      render(true); buzz(12); toast(t('install.w.consent.saved')); refresh(false);
    } catch (e) {
      // the signal or the server failed: the photo waits on the phone for the retry. A refused photo (too big, not an
      // image) or a refused person asks for a new photo or explains, and nothing is kept.
      const keep = keepForRetry(e);
      if (keep) failed.set(id, blob); else failed.delete(id);
      const w = view.workers.find((x) => x.id === id);
      if (w) Object.assign(w, consentFailed(w));
      render(true); showErr(err, e && e.code === 'offline' ? t('install.w.failed') : keep ? t('install.w.failed.server') : why(e));
      if (keep && btn) btn.focus();
    } finally { $('#wkFileBtn').classList.remove('busy'); if (worker()) $('#wkFileT').textContent = t(worker().consent ? 'install.w.photo.again' : 'install.w.photo'); }
  }
  async function pickConsent(file) {
    if (!file) return;
    let blob;
    $('#wkFileT').textContent = t('install.w.shrinking');
    try { blob = await shrink(file); } catch (e) { showErr($('#wkErr1'), e && e.code === 'too_big' ? errText(e) : t('install.err.read')); $('#wkFileT').textContent = t('install.w.photo'); return; }
    await sendConsent(blob);
  }
  /** A photo of the box or the sticker: the browser's barcode reader looks for an IMEI in it. */
  async function scanImei(file) {
    if (!file || !('BarcodeDetector' in window)) return;
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      const reader = new window.BarcodeDetector({ formats: formats.filter((f) => ['code_128', 'code_39', 'ean_13', 'qr_code', 'data_matrix', 'pdf417', 'itf'].includes(f)) });
      const found = await reader.detect(await createImageBitmap(file));
      const imei = imeiFromScan(found.map((b) => b.rawValue));
      if (!imei) { showErr($('#wkErr2'), t('install.w.scan.none')); return; }
      $('#wkImei').value = imei; imeiHint(); lock($('#wkImei'));
    } catch { showErr($('#wkErr2'), t('install.w.scan.none')); }
  }

  // ---- the close ----
  function openClose() {
    delete $('#clsGo').dataset.armed;
    $('#clsErr').hidden = true;
    for (const tk of $$('#s-iclose .inst-tick')) { tk.classList.remove('on', 'now'); delete tk.dataset.seen; }
    $('#clsGiant').replaceChildren();
    quiet(paintClose);
    setTab('iclose');
    if (reduce) return;
    setTimeout(() => { reveal($('#clsGiant')); const n = $('#clsGiant .num'); if (n) recount(n); stagger($$('#s-iclose .inst-zone'), { delay: 160, step: 120, y: 14 }); stagger($$('#clsTable tr'), { delay: 320, step: 45, y: 6 }); }, 90);
  }
  const recordTable = (rows) => h('table', { class: 'inst-tbl' },
    h('thead', {}, h('tr', {}, h('th', { text: t('install.c.col.worker') }), h('th', { text: t('install.c.col.signed') }), h('th', { text: t('install.c.col.phone') }))),
    h('tbody', {}, rows.map((r) => h('tr', {}, h('td', { text: r.name }), h('td', { class: 'num', text: dayMonth(r.day) }),
      h('td', { class: 'num inst-imei', text: r.tail ? `···${r.tail}` : t(r.phone ? 'install.c.nophone' : 'install.st.consent_only') })))));
  function paintClose() {
    const { site, workers, progress } = view, cs = closeState(view), den = site.phones || progress.total || 0;
    $('#clsSite').textContent = site.name; $('#clsPractice').hidden = !site.practice;
    $('#clsState').textContent = t(`install.c.state.${cs.kind === 'closed' && cs.installed ? 'installed' : cs.kind}`);
    $('#clsLead').textContent = t(`install.c.lead.${cs.kind}`);
    const g = $('#clsGiant'), [pre, post = ''] = t('install.giant', { a: '\u0001', b: num(den) }).split('\u0001');
    const n = $('.num', g) || h('span', { class: 'num' });
    put(g, pre, n, post.replace(/\.$/, ''), h('em', { text: '.' }));
    countTo(n, progress.ready);
    g.classList.toggle('full', den > 0 && progress.ready >= den);
    $('#clsSupport').textContent = cs.kind === 'closed' ? t(cs.installed ? 'install.c.s.installed' : 'install.c.s.closed', { when: stamp(cs.at, tz()) })
      : t(`install.c.s.${cs.kind}`, { n: progress.ready });

    const rows = recordRows(workers, tz()), shown = rows.slice(0, 4);
    put($('#clsTable'), rows.length ? [recordTable(shown), rows.length > shown.length ? h('p', { class: 'note', text: t('install.c.more', { n: rows.length - shown.length }) }) : null] : h('p', { class: 'note', text: t('install.c.empty') }));
    $('#clsRecCount').textContent = t('install.c.count', { n: rows.length });
    $('#clsSee').hidden = !rows.length;

    $('#clsAdv').hidden = !progress.allRecordingHaveConsent;
    setTick($('#clsAdv .inst-tick'), progress.allRecordingHaveConsent);
    $('#clsAdvS').textContent = t('install.c.adv.s', { n: progress.consents });
    setTick($('#clsInst .inst-tick'), cs.kind === 'closed' && cs.installed, cs.kind === 'closed' && !cs.installed);
    $('#clsInstS').textContent = t(cs.kind !== 'closed' ? 'install.c.inst.open' : cs.installed ? 'install.c.inst.done' : 'install.c.inst.wait');
    $('#clsNote').textContent = cs.kind === 'closed' ? t('install.c.note.after') : t('install.c.note');
    const go = $('#clsGo');
    $('#clsRO').hidden = !readOnly();
    go.hidden = !ctl().close;
    go.disabled = cs.kind === 'nobody';
    go.classList.toggle('armed', !!go.dataset.armed);
    go.textContent = t(go.dataset.armed ? 'install.c.go.again' : 'install.c.go');
  }
  /** Closing cannot be taken back: the first tap arms the button and says so, the second closes. */
  function closeTap() {
    const go = $('#clsGo');
    if (!ctl().close) return;
    if (!go.dataset.armed) {
      go.dataset.armed = '1'; paintClose(); lock(go);
      setTimeout(() => { if (go.dataset.armed) { delete go.dataset.armed; if (S.tab === 'iclose') quiet(paintClose); } }, 5000);
      return;
    }
    delete go.dataset.armed;
    act(go, () => write('POST', `install/${encodeURIComponent(siteId)}/close`, {}), 'install.c.closed', $('#clsErr')).then((ok) => { if (ok) { buzz([10, 40, 10]); ringAt($('#clsGiant em'), { whole: false }); } });
  }
  /** Giving a phone back cannot be taken back either: the first tap arms, the second returns it. */
  function returnTap() {
    const btn = $('#wkReturn'), w = worker();
    if (!w || !ctl(w).returnPhone) return;
    if (!btn.dataset.armed) {
      btn.dataset.armed = '1'; paintWorker(); lock(btn);
      setTimeout(() => { if (btn.dataset.armed) { delete btn.dataset.armed; if (S.tab === 'worker') quiet(paintWorker); } }, 5000);
      return;
    }
    delete btn.dataset.armed;
    $('#wkImei').value = '';
    act(btn, () => write('POST', `worker/${encodeURIComponent(w.id)}/phone/return`, {}), 'install.w.returned', $('#wkErr2'));
  }
  function seeRecord() {
    const rows = recordRows(view.workers, tz());
    formSheet({ title: t('install.c.record.title'), intro: t('install.c.record.p', { site: view.site.name }), body: h('div', { class: 'inst-rec' }, recordTable(rows)), submit: t('c.close'), onSubmit: async () => false });
  }

  // ---- the Hoy card: an install waits ----
  function card(slot) {
    const list = ((S.me && S.me.installs) || []).map(installCard).filter(Boolean);
    const c = list[0];
    slot.hidden = !c;
    if (!c) { slot.replaceChildren(); return; }
    const x = S.me.installs.find((i) => i.id === c.id), closed = c.kind === 'closed';
    const go = closed ? 'install.card.closed.go' : readOnly() ? 'install.card.view' : c.kind === 'start' ? 'install.card.start' : 'install.card.go';
    slot.classList.toggle('waiting', closed);
    put(slot,
      h('div', { class: 'inst-card-h' }, h('span', { class: 'label', text: t(closed ? 'install.card.closed' : 'install.card.label') }), c.practice ? h('span', { class: 'chip inst-prac', text: t('install.practice') }) : null),
      h('p', { class: 'lead', id: 'icName', text: x.name }),
      h('ul', { class: 'inst-rows' },
        h('li', { class: 'inst-row two' }, h('span', { class: 'inst-n' }, h('b', { text: t('install.card.phones') }), h('small', { text: t('install.card.phones.s') })), h('b', { class: 'inst-v num', text: num(c.phones) })),
        h('li', { class: 'inst-row two' }, h('span', { class: 'inst-n' }, h('b', { text: t('install.card.ready') }), h('small', { text: t('install.card.ready.s') })), h('b', { class: 'inst-v num', text: t('install.zone.count', { a: c.ready, b: c.phones }) }))),
      closed ? h('p', { text: t('install.card.closed.s') }) : null,
      h('button', { class: 'btn', type: 'button', text: t(go), onclick: () => open(c.id, 'today', closed ? 'iclose' : 'install') }),
      list.length > 1 ? h('p', { text: t('install.card.more', { n: list.length - 1 }) }) : null);
  }

  function wire() {
    $('#instBack').addEventListener('click', () => setTab(back));
    $('#instAdd').addEventListener('click', addWorker);
    $('#instToClose').addEventListener('click', openClose);
    $('#wkBack').addEventListener('click', () => setTab('install'));
    $('#clsBack').addEventListener('click', () => setTab('install'));
    $('#wkFile').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; pickConsent(f); });
    $('#wkRetry').addEventListener('click', (e) => { const blob = failed.get(wid); if (blob) once(e.currentTarget, () => sendConsent(blob)); });
    // On a practice site: a page drawn here, with only the word EJEMPLO on it, is filed as the consent so the lock can be shown opening.
    $('#wkExample').addEventListener('click', (e) => { const w = worker(); if (w && ctl(w).example) once(e.currentTarget, async () => sendConsent(await examplePage(t('install.w.example.word')))); });
    $('#wkScan').addEventListener('change', (e) => { const f = e.target.files[0]; e.target.value = ''; scanImei(f); });
    $('#wkImei').addEventListener('input', () => { $('#wkErr2').hidden = true; imeiHint(); });
    $('#wkImeiSave').addEventListener('click', (e) => { const imei = imeiFor(view && view.site, $('#wkImei').value); if (imei) act(e.currentTarget, () => write('POST', `worker/${encodeURIComponent(wid)}/phone`, { imei }), 'install.w.phone.saved', $('#wkErr2')); });
    $('#wkClipBtn').addEventListener('click', (e) => act(e.currentTarget, () => write('POST', `worker/${encodeURIComponent(wid)}/clip`, {}), 'install.w.clip.saved', $('#wkErr3')));
    $('#wkReturn').addEventListener('click', returnTap);
    $('#clsGo').addEventListener('click', closeTap);
    $('#clsSee').addEventListener('click', seeRecord);
  }

  return { open, render, card, wire, isOpen: () => !!view };
}
