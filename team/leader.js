// leader.js: the leadership view. One page, read only, every city at once. On top, the hours of video: the newest
// week's accepted hours as the headline, the share of what was delivered as a ring, and a track whose far end is the
// Scorecard's weekly goal (the Scorecard's number, shown as theirs), then the last weeks on one scale. Under it, each
// city is its own band: its sites on porcelain, its reps on deep graphite, as on the install screens.
// A leader lands here and has nothing else; a manager or admin opens it from the team view. Nothing here writes.
// Every number opens into where it comes from.
import { $, h, s, put, t, num, dayMonth, upper, cityName, countTo, src, toast, quiet, reduce, EASE } from './ui.js';
import { portrait, drawIn } from './hand.js';
import { reveal, stagger, lockIn } from './fx.js';
import { hm, siteCard, practiceNote, hoursModel } from './leader-steps.js';

const R = 40, C = 2 * Math.PI * R;
const WEEK_KEYS = [['visits', 'col.visits'], ['conversations', 'col.convs'], ['meetings', 'col.meetings'], ['contracts', 'col.contracts']];
const MAX_CELLS = 40;   // a site's meter draws one cell per eligible worker, up to this many

export function createLeader({ api, S, errText, setTab }) {
  let view = null;
  const H = (m) => hm(m, num);
  const pct = (p) => t('lead.pct.n', { pct: p });
  const share = (x) => Math.round(x * 1000) / 10;   // a fraction as a percentage with one decimal
  const weekSrc = (w) => t(w.source === 'scorecard' ? 'lead.src.scorecard' : 'lead.src.manual', { date: dayMonth(w.week) });
  /** A counter keeps how it writes its number (hours, a percentage), so running it again from zero writes it the same way. */
  const shows = new WeakMap();
  const counter = (node, value, show = num) => { shows.set(node, show); countTo(node, value, show); return node; };
  const rerun = (node) => {
    const to = Number(node && node.dataset.v);
    if (!Number.isFinite(to) || to <= 0) return;
    node.dataset.v = 0; countTo(node, to, shows.get(node) || num);
  };
  /** A number that opens its source, as a counter, so it can run up when the page arrives. */
  const srcNum = (cls, value, text, show = num) => src(counter(h('button', { class: `src num ${cls}`, type: 'button' }), value, show), () => t('c.source'), text);
  /** A sentence with some of its blanks as nodes: t(key) is split around each named blank. */
  const sentence = (key, nodes) => {
    const marks = Object.fromEntries(Object.keys(nodes).map((k) => [k, `\u0001${k}\u0001`]));
    return t(key, marks).split('\u0001').map((part, i) => (i % 2 ? nodes[part] : part));
  };

  async function load() { view = await api('GET', 'lead'); }
  /** A manager's way in, from the team view: the numbers are read first, then the page opens already drawn. */
  const open = async () => { await load(); quiet(render); setTab('lead'); };

  // ---- the hours, against the Scorecard's goal ----
  function renderHours() {
    const m = hoursModel(view.hours, view.goalAccepted), L = m.latest;
    $('#ldWeekChip').hidden = !L;
    if (L) $('#ldWeekChip').textContent = upper(t('lead.week', { date: dayMonth(L.week) }));
    $('#ldLead').textContent = L ? t('lead.lead', { date: dayMonth(L.week) }) : t('lead.lead.none');
    const giantNode = $('#ldGiant');
    if (L) put(giantNode, srcNum('ld-gn', L.accepted, () => weekSrc(L), H), h('em', { text: '.' }));
    else put(giantNode, t('lead.giant.none').slice(0, -1), h('em', { text: '.' }));
    put($('#ldSupport'), L ? (L.delivered > 0 ? sentence('lead.support', { d: srcNum('', L.delivered, () => weekSrc(L), H), a: srcNum('', L.accepted, () => weekSrc(L), H) }) : t('lead.support.zero')) : '');
    $('#ldSupport').hidden = !L;
    $('#ldHoursNone').hidden = !!L;

    // the ring: what the Scorecard accepted of what was delivered
    const ring = $('#ldRing');
    ring.hidden = !L || L.pct == null;
    if (!ring.hidden) {
      const p = Math.max(0, Math.min(1, L.pct / 100));
      put(ring, s('svg', { viewBox: '0 0 92 92', 'aria-hidden': 'true', focusable: 'false' },
        s('circle', { class: 'track', cx: 46, cy: 46, r: R }),
        s('circle', { class: 'arc', cx: 46, cy: 46, r: R, 'stroke-dasharray': `${C.toFixed(1)} ${C.toFixed(1)}`, 'stroke-dashoffset': (C * (1 - p)).toFixed(1), 'data-to': (C * (1 - p)).toFixed(1), transform: 'rotate(-90 46 46)' })),
      h('span', { class: 'ld-rv num' }), h('span', { class: 'label', text: t('lead.pct') }));
      counter($('.ld-rv', ring), L.pct, pct);
      ring.setAttribute('aria-label', t('lead.pct.aria', { pct: pct(L.pct) }));
      if (!ring.dataset.pop) src(ring, () => t('c.source'), () => weekSrc(hoursModel(view.hours, view.goalAccepted).latest));
    }

    // the track: its far end is the Scorecard's goal
    const goal = $('#ldGoal');
    goal.hidden = !L || !m.goal;
    if (!goal.hidden) {
      const v = (x) => String(x > 0 ? Math.max(Math.min(x, 1), 0.006) : 0);   // a sliver stays visible
      const del = h('i', { class: 'ld-del' }), acc = h('i', { class: 'ld-acc' });
      del.style.setProperty('--v', v(L.delivered / m.goal)); acc.style.setProperty('--v', v(L.accepted / m.goal));
      const goalNode = srcNum('ld-goalv', m.goal, () => t('lead.goal.src'), H);
      put(goal,
        h('div', { class: 'ld-gl' }, h('span', { class: 'label', text: t('lead.goal.label') }),
          h('span', { class: 'ld-gper' }, sentence('lead.goal.per', { goal: goalNode }))),
        h('div', { class: 'ld-track', role: 'img', 'aria-label': t('lead.goal.aria', { a: H(L.accepted), goal: H(m.goal) }) }, del, acc, h('i', { class: 'ld-ref' })),
        h('div', { class: 'ld-gfoot' },
          h('span', { class: 'ld-key acc' }, h('i'), sentence('lead.goal.of', { share: srcNum('', share(m.ofGoal), () => t('lead.goal.src'), (x) => pct(x)) })),
          h('span', { class: 'ld-key del' }, h('i'), t('lead.delivered'))));
    }

    // the last weeks, on one scale
    $('#ldWeeksH').hidden = m.weeks.length < 1;
    put($('#ldWeeks'), m.weeks.map((w) => {
      const bar = (kind, label, value, fill) => {
        const i = h('i'); i.style.setProperty('--v', String(fill));
        return h('div', { class: `ld-bar ${kind}` }, h('span', { class: 'ld-bl', text: label }), h('span', { class: 'ld-bt' }, i), srcNum('ld-bv', value, () => weekSrc(w), H));
      };
      return h('li', { class: 'ld-wk' },
        h('div', { class: 'ld-wh' }, h('span', { class: 'label', text: t('lead.week', { date: dayMonth(w.week) }) }),
          w.pct == null ? null : srcNum('ld-wp', w.pct, () => weekSrc(w), pct)),
        bar('del', t('lead.delivered'), w.delivered, w.d), bar('acc', t('lead.accepted'), w.accepted, w.a));
    }));
  }

  // ---- a city: its sites, then its reps ----
  function siteNode(site) {
    const card = siteCard(site, t), origin = () => t('lead.src.site');
    // A fact the site never had keeps its place, as an empty mark, and says so in words.
    const figs = card.figures.map((f) => h('div', { class: `ld-fig ${f.key}` },
      f.value == null ? h('span', { class: 'ld-fv none', 'aria-hidden': 'true' }) : srcNum('ld-fv', f.value, origin),
      h('span', { class: 'ld-fl' }, f.key === 'eligible' ? null : h('i'), f.value == null ? t('lead.site.missing', { what: f.label }) : f.label)));
    let cells = null;
    if (!card.legacy && site.eligible) {
      const n = Math.min(MAX_CELLS, Math.max(site.eligible, site.consents));
      cells = h('div', { class: 'ld-cells', 'aria-hidden': 'true' }, Array.from({ length: n }, (_, i) => h('i', { class: i < site.phones ? 'p' : i < site.consents ? 'c' : null })));
    }
    return h('li', { class: `ld-site${card.legacy ? ' legacy' : ''}` },
      h('div', { class: 'ld-sh' }, h('b', { text: card.name }), h('span', { class: `inst-tag ${['installed', 'legacy'].includes(card.stateKey) ? 'ok' : 'miss'}`, text: card.state })),
      card.line ? h('p', { class: 'ld-legacy', text: card.line }) : null,
      h('div', { class: 'ld-figs' }, figs), cells);
  }
  function repNode(rep) {
    const origin = () => t('lead.src.rep');
    return h('li', { class: 'ld-rep' },
      h('div', { class: 'ld-who' }, portrait({ id: rep.id, name: rep.first, photo: rep.photo }, { share: rep.isNew ? rep.ladderDone / 10 : null }),
        h('div', { class: 'ld-wn' }, h('b', { text: rep.first }), rep.isNew ? h('small', { text: t('lead.rep.new', { n: rep.ladderDone }) }) : null)),
      h('div', { class: 'ld-nums' }, WEEK_KEYS.map(([k, label]) => h('div', { class: 'ld-n' }, srcNum('ld-nv', rep.week[k], origin), h('span', { class: 'label', text: t(label) })))));
  }
  function cityNode(c) {
    const name = c.city ? cityName(c.city) : t('lead.city.none');
    const zone = (cls, title, count, list, empty) => h('section', { class: `inst-zone ${cls}` },
      h('div', { class: 'inst-zh' }, h('h3', { text: title }), h('span', { class: 'inst-k num', text: num(count) })),
      count ? list : h('p', { class: 'note', text: empty }));
    return h('section', { class: 'ld-city', 'aria-label': name },
      h('header', { class: 'ld-ch' }, h('h2', { class: 'giant ld-cname' }, name, h('em', { text: '.' })),
        h('div', { class: 'hud-row' }, h('span', { class: 'chip' }, h('i', { class: 'dot' }), t('u.sites', { n: c.sites.length })), h('span', { class: 'chip ghost', text: t('lead.reps.n', { n: c.reps.length }) }))),
      h('div', { class: 'ld-zones' },
        zone('inst-prep ld-sites', t('lead.sites.h'), c.sites.length, h('ul', { class: 'ld-cards' }, c.sites.map(siteNode)), t('lead.sites.none')),
        zone('inst-crew ld-reps', t('lead.reps.h'), c.reps.length, h('ul', { class: 'ld-people' }, c.reps.map(repNode)), t('lead.reps.none'))));
  }

  function render() {
    if (!view) return;
    $('#ldBack').hidden = S.me.viewer.role === 'leader';
    renderHours();
    put($('#ldCities'), view.cities.map(cityNode));
    $('#ldNone').hidden = view.cities.length > 0;
    const note = practiceNote(view, t);
    $('#ldPractice').hidden = !note; $('#ldPractice').textContent = note || '';
  }

  // ---- arrival: the headline rises, the ring and the track fill to what the Scorecard says, then each city puts itself
  // together when it comes into view. Every move ends on the state already drawn; reduced motion shows only that. ----
  const grow = (node, delay, dur = 760) => {
    const v = node.style.getPropertyValue('--v') || '0';
    node.animate([{ transform: 'scaleX(0)' }, { transform: `scaleX(${v})` }], { duration: dur, delay, easing: EASE.track, fill: 'backwards' });
  };
  function arriveCity(band) {
    stagger([band.querySelector('.ld-ch'), ...band.querySelectorAll('.inst-zone')], { step: 90 });
    stagger(band.querySelectorAll('.ld-site'), { delay: 160, step: 70 });
    band.querySelectorAll('.ld-site').forEach((card, k) => {
      [...card.querySelectorAll('.ld-cells i.c, .ld-cells i.p')].forEach((cell, i) => cell.animate([{ transform: 'scale(.3)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 220, delay: 420 + k * 70 + i * 45, easing: EASE.lock, fill: 'backwards' }));
      for (const n of card.querySelectorAll('.ld-fv[data-v]')) rerun(n);
    });
    lockIn(band.querySelectorAll('.ld-rep .portrait'), { delay: 260, step: 80 }); drawIn(band.querySelector('.ld-people'), 380, 80);
    stagger(band.querySelectorAll('.ld-rep .ld-nums'), { delay: 320, step: 80, y: 6 });
    for (const n of band.querySelectorAll('.ld-nv')) rerun(n);
  }
  function arrive() {
    if (reduce || !view) return;
    reveal($('#ldGiant'));
    rerun($('#ldGiant .ld-gn'));
    const arc = $('#ldRing:not([hidden]) .arc');
    if (arc && arc.animate) { arc.animate([{ strokeDashoffset: C.toFixed(1) }, { strokeDashoffset: arc.dataset.to }], { duration: 900, delay: 240, easing: EASE.track, fill: 'backwards' }); rerun($('#ldRing .ld-rv')); }
    if (!$('#ldGoal').hidden) {
      grow($('#ldGoal .ld-del'), 420); grow($('#ldGoal .ld-acc'), 560);
      $('#ldGoal .ld-ref').animate([{ transform: 'scaleY(0)', opacity: 0 }, { transform: 'scaleY(1)', opacity: 1 }], { duration: 300, delay: 300, easing: EASE.lock, fill: 'backwards' });
    }
    stagger([...document.querySelectorAll('#ldWeeks .ld-wk')], { delay: 520, step: 90 });
    document.querySelectorAll('#ldWeeks .ld-bt i').forEach((n, i) => grow(n, 600 + i * 60, 620));
    const bands = [...document.querySelectorAll('#ldCities .ld-city')];
    if (!('IntersectionObserver' in window)) { bands.forEach(arriveCity); return; }
    // A band under the fold puts itself together when it comes into view; until then it is simply drawn.
    for (const band of bands) {
      const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); arriveCity(band); } }, { threshold: 0.12 });
      io.observe(band);
    }
  }

  function wire() {
    $('#leadBtn').addEventListener('click', () => open().catch((e) => toast(errText(e))));
    $('#ldBack').addEventListener('click', () => setTab('team'));
  }
  return { load, open, render, arrive, wire, loaded: () => !!view };
}
