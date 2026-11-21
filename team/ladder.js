// ladder.js: a new rep's first days, as the rep sees them. Three places: "Mis primeros días", the ten steps up to the
// first site, the next one open with what it asks for; the zone picker, where the rep picks the two zones they work;
// and "Aprender", six short videos, one per question. A Hoy card points at the ladder while a step is open.
// A manager opens the same screens for their own account as a preview of what a new rep sees, and says so on screen.
// Through view-as (a manager reading a rep's screens) nothing that writes shows, and no write leaves this module.
// The look is the install's: porcelain for what the rep does, graphite for what the app reads from the day.
import { $, $$, h, s, put, t, num, cityName, joinList, giant, countTo, recount, flipList, toast, src, once, ringAt, lock, reduce, isQuiet, quiet, showErr } from './ui.js';
import { reveal, stagger } from './fx.js';
import { nextStep, ladderCount, ladderOnHoy, stepVideo, learnRows, ladderControls, postSeen, pickZone, zonesReady } from './ladder-steps.js';

const START = ['video', 'kit', 'whatsapp', 'zones'];   // the rep's own steps: the porcelain zone

/** The install's round tick: a disc that locks in and a check that draws itself. `now` rings it: the next one to do. */
const tickNode = () => h('span', { class: 'inst-tick', 'aria-hidden': 'true' }, h('i'),
  s('svg', { viewBox: '0 0 24 24', focusable: 'false' }, s('path', { class: 'ck', d: 'M7.2 12.6l3.2 3.2 6.6-7', pathLength: 1 })));
function setTick(node, on, now = false) {
  const was = node.classList.contains('on');
  node.classList.toggle('on', on); node.classList.toggle('now', !on && now);
  if (on && !was && node.dataset.seen && !isQuiet()) { lock(node); ringAt(node); }
  node.dataset.seen = '1';
}
/** A small picture of a video: the play mark when it can be opened, an empty dashed frame while it has no address. */
const thumb = (playable) => h('span', { class: `lrn-thumb${playable ? '' : ' none'}`, 'aria-hidden': 'true' }, playable ? h('i') : null);

export function createLadder({ api, S, errText, adopt, renderAll, setTab, openLog }) {
  let back = 'today', learnBack = 'ladder', zones = null, picked = [];
  const readOnly = () => !!S.as;
  const preview = () => !!S.mgr;   // a manager or an admin, on their own account
  const canLog = () => !S.mgr && !readOnly() && !!(S.me && S.me.today);
  const write = (method, path, body) => (readOnly() ? Promise.reject(Object.assign(new Error('read_only'), { code: 'read_only' })) : api(method, path, body));
  const ladder = () => (S.me && S.me.ladder) || [];
  const has = () => !!(S.me && Array.isArray(S.me.ladder) && S.me.ladder.length);

  /** The answer of a write is the whole view: the ladder draws the difference with motion, everything else follows. */
  const took = (res, okKey) => { adopt(res.me); render(true); renderAll(false); if (okKey) toast(t(okKey)); };

  // ---- the ladder ----
  async function open(from = null) {
    if (!has()) return;
    back = from || (S.mgr ? 'team' : 'today');
    quiet(() => render(false));
    setTab('ladder');
    setTimeout(arrive, reduce ? 0 : 90);
    loadZones();
  }
  /** The zones of the person's city and the two picked, for the zone step's line and the picker. Read only never asks:
   *  the answer would be the manager's own, not the rep's. */
  async function loadZones() {
    if (readOnly()) { zones = null; return; }
    try { zones = await api('GET', 'zones'); render(false); } catch { zones = null; }
  }
  /** The screen has just arrived: the headline rises, the meter fills again, the zones and their rows come in. */
  function arrive() {
    if (reduce || S.tab !== 'ladder') return;
    reveal($('#ladGiant'));
    const n = $('#ladGiant .num'); if (n) recount(n);
    stagger([$('#ladStartZone'), $('#ladStreetZone'), $('#ladLearn')], { delay: 160, step: 120, y: 14 });
    stagger([...$$('#ladStart li'), ...$$('#ladStreet li')], { delay: 300, step: 40, y: 6 });
    const lit = $$('#ladMeter i.on');
    lit.forEach((c, i) => { c.style.setProperty('--k', String(i + 3)); c.classList.toggle('on', false); });
    void $('#ladMeter').offsetWidth;
    lit.forEach((c) => c.classList.toggle('on', true));
  }

  /** Draw whichever of the three screens is open. Quiet unless `animate`: then a step that finished locks in. */
  function render(animate = false) {
    if (!has()) return;
    const run = () => { paint(); if (S.tab === 'learn') paintLearn(); if (S.tab === 'zones') paintZones(); };
    if (animate) run(); else quiet(run);
  }

  function paint() {
    const steps = ladder(), next = nextStep(steps), c = ladderCount(steps);
    for (const id of ['#ladPreview', '#ladPreviewNote']) $(id).hidden = !preview();
    $('#ladRO').hidden = !readOnly();
    $('#ladLead').textContent = t(c.done === c.of ? 'ladder.lead.done' : 'ladder.lead');

    // The headline: steps done of ten. The number counts; it opens into where each step comes from.
    const g = $('#ladGiant');
    const [pre, post = ''] = t('ladder.giant', { a: '\u0001', b: num(c.of) }).split('\u0001');
    const n = $('.num', g) || h('span', { class: 'num' });
    const srcBtn = g.firstChild && g.firstChild.classList && g.firstChild.classList.contains('src') ? g.firstChild
      : src(h('button', { class: 'src', type: 'button' }), () => t('c.source'), () => { const k = ladderCount(ladder()); return t('ladder.src', { a: k.done, b: k.of }); });
    put(srcBtn, pre, n, post.replace(/\.$/, ''));
    put(g, srcBtn, h('em', { text: '.' }));
    countTo(n, c.done);
    g.classList.toggle('full', c.of > 0 && c.done === c.of);
    $('#ladSupport').textContent = next ? t('ladder.support', { step: t(`ladder.step.${next.step}`) }) : t('ladder.support.done');

    // The meter: one cell per step, lit as each one is done. Cells that light now light one after another.
    const meter = $('#ladMeter');
    if (meter.childElementCount !== c.of) meter.replaceChildren(...steps.map(() => h('i')));
    const before = $$('i.on', meter).length;
    [...meter.children].forEach((cell, i) => { cell.style.setProperty('--k', String(Math.max(0, i - before))); cell.classList.toggle('on', !!steps[i].done); cell.classList.toggle('now', !!next && steps[i].step === next.step); });
    meter.setAttribute('aria-label', t('ladder.meter', { n: c.done, b: c.of }));
    $('#ladMeterT').textContent = t('ladder.meter', { n: c.done, b: c.of });

    const start = steps.filter((x) => START.includes(x.step)), street = steps.filter((x) => !START.includes(x.step));
    paintRows($('#ladStart'), start, next);
    paintRows($('#ladStreet'), street, next);
    $('#ladStartCount').textContent = t('install.zone.count', { a: start.filter((x) => x.done).length, b: start.length });
    $('#ladStreetCount').textContent = t('install.zone.count', { a: street.filter((x) => x.done).length, b: street.length });
    const lr = learnRows(S.me.videos, S.me.seen);
    $('#ladLearnN').textContent = t('learn.count', { n: lr.length });
  }

  /** The small line of a step that is not the next one: who ticks it, or what it holds once done. */
  function byLine(x) {
    if (x.done) return x.step === 'zones' && zones && zones.picked.length === 2 ? joinList(zones.picked) : t('ladder.done');
    return t(`ladder.by.${x.by}`);
  }

  function paintRows(list, steps, next) {
    flipList(list, steps, (x) => x.step,
      () => h('li', { class: 'inst-row lad-row' }, tickNode(), h('span', { class: 'inst-n' }, h('b'), h('small')), h('span', { class: 'inst-act' }), h('div', { class: 'lad-more' })),
      (li, x) => {
        const now = !!next && next.step === x.step, was = li.classList.contains('lad-now'), c = ladderControls({ readOnly: readOnly(), step: x, canLog: canLog() });
        setTick($('.inst-tick', li), x.done, now);
        li.classList.toggle('lad-now', now); li.classList.toggle('done', x.done);
        $('b', li).textContent = t(`ladder.step.${x.step}`);
        $('small', li).textContent = now ? t(`ladder.s.${x.step}`) : byLine(x);
        // a step that is done keeps one control: the zones can be changed again
        put($('.inst-act', li), x.done && c.zones ? h('button', { class: 'mini-btn', type: 'button', text: t('c.change'), 'aria-label': t('zones.change.aria'), onclick: () => openZones() }) : null);
        const more = $('.lad-more', li);
        more.hidden = !now;
        if (now) {
          put(more, ...expanded(x, c));
          // the step that is next now opens: what it asks for arrives, and its ring answers
          if (!was && li.dataset.painted && !isQuiet()) { stagger([more], { y: 10, delay: 220 }); ringAt($('.inst-tick', li)); }
        } else put(more);
        li.dataset.painted = '1';
      });
  }

  /** What the next step asks for: how it gets done, its video (or the plain line that there is none yet), its button. */
  function expanded(x, c) {
    const out = [h('p', { text: t(`ladder.how.${x.step}`) })];
    const v = stepVideo(x, S.me.videos);
    if (v.kind === 'missing') out.push(h('p', { class: 'lad-novid', text: t('learn.none') }));
    if (v.kind === 'play') out.push(videoLink(v, t('ladder.watch', { title: t(`video.${v.key}`) }), 'lad-play'));
    let btn = null;
    if (c.tick) btn = h('button', { class: 'btn primary wide', type: 'button', text: t('ladder.btn.tick'), onclick: (e) => tick(e.currentTarget, x.step) });
    else if (c.zones) btn = h('button', { class: 'btn primary wide', type: 'button', text: t('ladder.btn.zones'), onclick: () => openZones() });
    else if (c.log) btn = h('button', { class: 'btn primary wide', type: 'button', text: t('nav.log'), onclick: () => openLog() });
    else if (c.close) btn = h('button', { class: 'btn primary wide', type: 'button', text: t('ladder.btn.close'), onclick: () => setTab('today') });
    if (btn) out.push(btn, h('p', { class: 'formerr', role: 'alert', hidden: true }));
    return out;
  }
  const tick = (btn, step) => once(btn, async () => {
    const err = btn.nextElementSibling;
    if (err) err.hidden = true;
    try { took(await write('POST', 'ladder', { step }), 'ladder.saved'); } catch (e) { if (err) showErr(err, errText(e)); else toast(errText(e)); }
  });

  /** A link that opens a video in a new tab and tells the server the first time, except through view-as. */
  function videoLink(v, label, cls) {
    return h('a', { class: cls, href: v.url, target: '_blank', rel: 'noopener noreferrer', onclick: () => seen(v) }, thumb(true), h('span', { text: label }));
  }
  async function seen(v) {
    if (!postSeen(v, S.me.seen, readOnly())) return;
    try { took(await write('POST', 'seen', { video: v.key })); } catch { /* the video opened all the same; the next open tells the server again */ }
  }

  // ---- the zone picker ----
  async function openZones() {
    if (readOnly()) return;
    if (!zones) { try { zones = await api('GET', 'zones'); } catch (e) { toast(errText(e)); return; } }
    picked = [...zones.picked];
    $('#znErr').hidden = true;
    $('#znList').replaceChildren();
    quiet(paintZones);
    setTab('zones');
    if (!reduce) setTimeout(() => { reveal($('#znGiant')); stagger($$('#znList li'), { delay: 160, step: 30, y: 6 }); }, 90);
  }
  function paintZones() {
    if (!zones) return;
    $('#znPreview').hidden = !preview();
    $('#znCity').textContent = cityName(S.me.me.city); $('#znCity').hidden = !S.me.me.city;
    const g = $('#znGiant'), n = $('.num', g) || h('span', { class: 'num' });
    const [pre, post = ''] = t('zones.giant', { a: '\u0001' }).split('\u0001');
    put(g, pre, n, post.replace(/\.$/, ''), h('em', { text: '.' }));
    countTo(n, picked.length);
    g.classList.toggle('full', picked.length === 2);
    flipList($('#znList'), zones.zones, (z) => z,
      () => h('li', { class: 'inst-row tap zn-row' }, tickNode(), h('span', { class: 'inst-n' }, h('b'), h('small')),
        h('button', { class: 'inst-hit', type: 'button', onclick: (e) => tapZone(e.currentTarget.closest('li').dataset.key) })),
      (li, z) => {
        const at = picked.indexOf(z);
        setTick($('.inst-tick', li), at >= 0, false);
        $('b', li).textContent = z;
        $('small', li).textContent = at >= 0 ? t(`zones.pick.${at + 1}`) : '';
        $('.inst-hit', li).setAttribute('aria-pressed', String(at >= 0));
        $('.inst-hit', li).setAttribute('aria-label', z);
      });
    $('#znEmpty').hidden = zones.zones.length > 0;
    $('#znCount').textContent = t('install.zone.count', { a: picked.length, b: 2 });
    const save = $('#znSave');
    save.disabled = !zonesReady(picked);
    save.hidden = readOnly() || !zones.zones.length;
  }
  function tapZone(z) {
    picked = pickZone(picked, z);
    $('#znErr').hidden = true;
    paintZones();
  }
  const saveZones = (btn) => once(btn, async () => {
    if (!zonesReady(picked)) return;
    try {
      const res = await write('POST', 'zones', { zones: picked });
      zones = { ...zones, picked: [...picked] };
      adopt(res.me);
      // back on the ladder first, then the zone step locks in where the person can see it
      setTab('ladder');
      setTimeout(() => { render(true); renderAll(false); toast(t('zones.saved')); }, reduce ? 0 : 320);
    } catch (e) { showErr($('#znErr'), errText(e)); }
  });

  // ---- Aprender ----
  function openLearn(from = null) {
    if (!has()) return;
    learnBack = from || (S.tab === 'ladder' ? 'ladder' : S.mgr ? 'team' : 'profile');
    $('#lrnList').replaceChildren();
    quiet(paintLearn);
    setTab('learn');
    if (!reduce) setTimeout(() => { reveal($('#lrnGiant')); stagger($$('#lrnList li'), { delay: 160, step: 50, y: 8 }); }, 90);
  }
  function paintLearn() {
    const rows = learnRows(S.me.videos, S.me.seen), playable = rows.filter((r) => r.kind === 'play');
    $('#lrnPreview').hidden = !preview();
    $('#lrnRO').hidden = !readOnly();
    $('#lrnCount').textContent = t('learn.count', { n: rows.length });
    giant($('#lrnGiant'), t('learn.giant'));
    $('#lrnSupport').textContent = playable.length ? t('learn.support', { a: playable.filter((r) => r.seen).length, b: playable.length }) : t('learn.support.none');
    flipList($('#lrnList'), rows, (r) => r.key,
      () => h('li', { class: 'inst-row lrn-row' }, h('span', { class: 'lrn-slot' }), h('span', { class: 'inst-n' }, h('b'), h('small'), h('span', { class: 'lad-novid' })), h('span', { class: 'inst-tag' }), h('span', { class: 'lrn-link' })),
      (li, r) => {
        const title = t(`video.${r.key}`);
        put($('.lrn-slot', li), thumb(r.kind === 'play'));
        $('b', li).textContent = title;
        $('small', li).textContent = t(`video.${r.key}.s`);
        // no address: the plain line, and the row is not a link
        const none = $('.lad-novid', li); none.hidden = r.kind === 'play'; none.textContent = t('learn.none');
        li.classList.toggle('tap', r.kind === 'play');
        const tag = $('.inst-tag', li), wasSeen = tag.classList.contains('ok');
        tag.hidden = !r.seen; tag.textContent = t('learn.seen'); tag.classList.toggle('ok', r.seen);
        if (r.seen && !wasSeen && !isQuiet()) lock(tag);
        put($('.lrn-link', li), r.kind === 'play' ? h('a', { class: 'inst-hit', href: r.url, target: '_blank', rel: 'noopener noreferrer', 'aria-label': t('ladder.watch', { title }), onclick: () => seen(r) }) : null);
      });
  }

  // ---- the Hoy card and the profile's way in ----
  /** The Hoy card while a step is open: how far, the next step, and the way to it. After ten of ten it is gone. */
  function card(slot) {
    const steps = ladder();
    if (!has() || S.mgr || !ladderOnHoy(steps)) { slot.hidden = true; slot.replaceChildren(); return; }
    const next = nextStep(steps), c = ladderCount(steps);
    slot.hidden = false;
    const meter = $('.inst-meter', slot) || h('div', { class: 'inst-meter', 'aria-hidden': 'true' });
    if (meter.childElementCount !== c.of) meter.replaceChildren(...steps.map(() => h('i')));
    const before = $$('i.on', meter).length;
    [...meter.children].forEach((cell, i) => { cell.style.setProperty('--k', String(Math.max(0, i - before))); cell.classList.toggle('on', !!steps[i].done); });
    put(slot,
      h('div', { class: 'inst-card-h' }, h('span', { class: 'label', text: t('ladder.chip') }), h('span', { class: 'label num', text: t('install.zone.count', { a: c.done, b: c.of }) })),
      meter,
      h('p', { class: 'lead', id: 'ladCardName', text: t(`ladder.step.${next.step}`) }),
      h('p', { text: t(`ladder.s.${next.step}`) }),
      h('button', { class: 'btn', type: 'button', text: t(readOnly() ? 'ladder.card.view' : 'ladder.card.go'), onclick: () => open('today') }));
  }
  /** The profile keeps the way in after the ladder leaves Hoy, and the way to Aprender. */
  const profileButtons = () => (has() ? [
    h('button', { class: 'btn', type: 'button', onclick: () => open('profile') }, t('ladder.chip'), h('span', { class: 'num lad-of', text: ` · ${t('install.zone.count', { a: ladderCount(ladder()).done, b: ladderCount(ladder()).of })}` })),
    h('button', { class: 'btn', type: 'button', text: t('learn.chip'), onclick: () => openLearn('profile') }),
  ] : []);

  function wire() {
    $('#ladBack').addEventListener('click', () => setTab(back));
    $('#ladLearn').addEventListener('click', () => openLearn('ladder'));
    $('#lrnBack').addEventListener('click', () => setTab(learnBack));
    $('#znBack').addEventListener('click', () => setTab('ladder'));
    $('#znSave').addEventListener('click', (e) => saveZones(e.currentTarget));
  }

  return { open, openLearn, render, card, profileButtons, wire };
}
