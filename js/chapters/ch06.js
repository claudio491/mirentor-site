// ch06.js: "¿Su operación califica?". Four questions as segmented radio keys, a profile card that fills as answers
// come in, and concept B's verdict. Without this module the four questions stay one plain form (CSS gates the
// stepped states on .is-stepped, set here).
//
// Pointer: picking a key types the answer into the card (300 ms at most) and the next question enters 12 px from
// the right in 240 ms. Keyboard: arrows move inside a group (native radios) without advancing; Enter, Next and Back
// step at once, with no animation. Tier "still": same flow, no animation.
//
// "Join the waitlist" dispatches window "mirentor:prefill", then scrolls to #lista-de-espera, with
//   detail { industry, workers, pay, city, country, cityId, countryCode, verdict }
//   industry: warehouse | construction | workshop | other | office
//   workers:  lt50 | 50-99 | 100-500 | 501-5000 | gt5000 (a range, never a made-up head count)
//   pay:      yes | unsure | no
//   city, country: display names in the page language ("another city": the visitor's own text)
//   cityId:   panama | medellin | lima | cdmx | other;  countryCode: PA | CO | PE | MX ('' when typed)
//   verdict:  strong | possible | notyet

const STEPS = ['industry', 'workers', 'pay', 'city'];
const COUNTRY_CODE = { panama: 'PA', medellin: 'CO', lima: 'PE', cdmx: 'MX' };
const VERDICT = STEPS.length;
const ADVANCE_MS = 280;
const ENTER_MS = 240;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const pad = (n) => String(n).padStart(2, '0');

/** Pure: concept B's verdict rules (pending Scott's OK, see the review note on the page). "Not yet" wins over
 *  "possible"; among "not yet" reasons an unpaid team comes first, because the owner can change that answer. */
export function verdict({ industry, workers, pay }) {
  if (pay === 'no') return { level: 'notyet', reason: 'pay', checks: [] };
  if (industry === 'office') return { level: 'notyet', reason: 'office', checks: [] };
  if (workers === 'lt50') return { level: 'notyet', reason: 'small', checks: [] };
  if (workers === 'gt5000') return { level: 'notyet', reason: 'large', checks: [] };
  const checks = [];
  if (industry === 'other') checks.push('industry');
  if (workers === '50-99') checks.push('size-small');
  if (workers === '501-5000') checks.push('size-large');
  if (pay === 'unsure') checks.push('pay');
  return checks.length ? { level: 'possible', reason: 'possible', checks } : { level: 'strong', reason: 'strong', checks };
}

export function init(el, { tier = 'full', strings = {} } = {}) {
  const body = el.querySelector('[data-fit]');
  if (!body) return;
  const $ = (s, r = body) => r.querySelector(s);
  const $$ = (s, r = body) => [...r.querySelectorAll(s)];
  const motion = tier !== 'still';
  const stage = $('.fit-stage');
  const panes = $$('.fit-q');
  const verdictEl = $('[data-verdict]');
  const rows = Object.fromEntries($$('[data-row]').map((r) => [r.dataset.row, r]));
  const rail = $$('.fit-rail i');
  const count = $('[data-count]');
  const back = $('[data-back]');
  const next = $('[data-next]');
  const error = $('[data-error]');
  const other = $('[data-other]');
  const cityIn = $('#ch06-city');
  const countryIn = $('#ch06-country');
  const join = $('[data-join]');
  const change = $('[data-change]');
  const cityLine = $('[data-cityline]');
  const answers = { industry: '', workers: '', pay: '', city: '' };
  let step = 0;
  let viaPointer = false;
  let timer = 0;

  const keyOf = (input) => input.closest('.fit-q')?.dataset.key;
  const keyEl = (key, value) => $(`.fit-q[data-key="${key}"] input[value="${value}"]`)?.closest('.fit-seg-key');
  const text = (node) => (node ? node.textContent.trim() : '');

  /** City and country as the visitor sees them. */
  function place() {
    if (answers.city === 'other') return { city: cityIn.value.trim(), country: countryIn.value.trim() };
    const k = keyEl('city', answers.city);
    return { city: text(k && $('.fit-seg-txt', k)), country: text(k && $('.fit-seg-sub', k)) };
  }

  function answerText(key) {
    const value = answers[key];
    if (!value) return '';
    if (key === 'city') {
      const { city, country } = place();
      return [city, country].filter(Boolean).join(', ') || text($('.fit-seg-txt', keyEl('city', 'other')));
    }
    return text($('.fit-seg-txt', keyEl(key, value)));
  }

  /** Mono value typed in: the full text is in the DOM at once (screen readers get it whole); a stepped clip
   *  reveals it one character at a time, 300 ms at most. */
  function type(node, value, animate) {
    for (const a of node.getAnimations?.() || []) a.cancel();
    node.textContent = value;
    if (!animate || !value || !node.animate) return;
    const n = [...value].length;
    node.animate([{ clipPath: 'inset(0 100% 0 0)' }, { clipPath: 'inset(0 0 0 0)' }], { duration: Math.min(300, 40 + n * 14), easing: `steps(${n}, end)` });
  }

  const fillRow = (key, animate) => rows[key] && type($('.fit-v', rows[key]), answerText(key), animate);

  function setError(kind) {
    error.textContent = kind ? strings[kind === 'city' ? 'ch06_err_city' : 'ch06_err_choose'] || '' : '';
  }

  function render() {
    body.dataset.step = String(step);
    panes.forEach((p, i) => p.classList.toggle('is-on', i === step));
    verdictEl.hidden = step !== VERDICT;
    rail.forEach((s, i) => { s.classList.toggle('is-done', i < step); s.classList.toggle('is-now', i === step); });
    count.textContent = `${pad(Math.min(step + 1, STEPS.length))} / ${pad(STEPS.length)}`;
    STEPS.forEach((k, i) => rows[k]?.classList.toggle('is-now', i === step));
    back.hidden = step === 0;
    for (const s of $$('[data-label]', next)) s.hidden = s.dataset.label !== (step === STEPS.length - 1 ? 'see' : 'next');
  }

  function go(to, { animate = false, dir = 1, focus = true } = {}) {
    clearTimeout(timer);
    step = to;
    setError('');
    render();
    const pane = to === VERDICT ? verdictEl : panes[to];
    if (animate && motion) {
      pane.animate([{ opacity: 0, transform: `translateX(${12 * dir}px)` }, { opacity: 1, transform: 'none' }], { duration: ENTER_MS, easing: EASE_OUT });
    }
    if (!focus) return;
    (to === VERDICT ? verdictEl : $('input:checked', pane) || $('input', pane))?.focus({ preventScroll: true });
    const header = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
    const top = stage.getBoundingClientRect().top - header - 16;
    if (top < 0) window.scrollBy({ top, behavior: animate && motion ? 'smooth' : 'auto' });
  }

  function showVerdict(animate) {
    const v = verdict(answers);
    verdictEl.dataset.level = v.level;
    for (const n of $$('[data-v]', verdictEl)) n.hidden = n.dataset.v !== v.level;
    for (const n of $$('[data-reason]', verdictEl)) n.hidden = n.dataset.reason !== v.reason;
    for (const n of $$('[data-check]', verdictEl)) n.hidden = !v.checks.includes(n.dataset.check);
    for (const n of $$('[data-next-line]', verdictEl)) n.hidden = n.dataset.nextLine !== v.level;
    change.hidden = v.reason !== 'pay';
    const { city } = place();
    const [before, after = ''] = (strings[answers.city === 'other' ? 'ch06_city_other' : 'ch06_city_named'] || '').split('{city}');
    const b = document.createElement('b');
    b.textContent = city;
    cityLine.replaceChildren(before, b, after);
    cityLine.hidden = !city || !before && !after;
    rows.result.dataset.level = v.level;
    type($('.fit-v', rows.result), text($(`[data-v="${v.level}"]`, verdictEl)), animate && motion);
    go(VERDICT, { animate, dir: 1 });
  }

  function advance(animate) {
    if (step >= VERDICT) return;
    const key = STEPS[step];
    if (!answers[key]) {
      setError('choose');
      ($('input:checked', panes[step]) || $('input', panes[step]))?.focus();
      return;
    }
    if (key === 'city' && answers.city === 'other' && !cityIn.value.trim()) {
      setError('city');
      cityIn.focus();
      return;
    }
    if (step < STEPS.length - 1) go(step + 1, { animate, dir: 1 });
    else showVerdict(animate);
  }

  function reset(animate) {
    for (const input of $$('input[type="radio"]')) input.checked = false;
    cityIn.value = '';
    countryIn.value = '';
    for (const k of STEPS) answers[k] = '';
    for (const r of Object.values(rows)) { type($('.fit-v', r), '', false); delete r.dataset.level; }
    other.hidden = true;
    go(0, { animate, dir: -1 });
  }

  // Input modality: a pointer pick advances on its own; keyboard picks wait for Enter or Next.
  body.addEventListener('pointerdown', () => { viaPointer = true; }, true);
  body.addEventListener('keydown', (e) => {
    viaPointer = false;
    if (e.key !== 'Enter' || e.isComposing || step >= VERDICT) return;
    if (e.target instanceof HTMLInputElement) { e.preventDefault(); advance(false); }
  }, true);

  body.addEventListener('change', (e) => {
    const input = e.target;
    if (!(input instanceof HTMLInputElement) || input.type !== 'radio') return;
    const key = keyOf(input);
    if (!key) return;
    answers[key] = input.value;
    setError('');
    if (key === 'city') other.hidden = input.value !== 'other';
    fillRow(key, viaPointer && motion);
    clearTimeout(timer);
    if (!viaPointer) return;
    if (key === 'city' && input.value === 'other') { cityIn.focus({ preventScroll: true }); return; }
    const at = step;
    timer = setTimeout(() => { if (step === at) advance(true); }, ADVANCE_MS);
  });

  for (const input of [cityIn, countryIn]) input.addEventListener('input', () => { setError(''); fillRow('city', false); });

  // e.detail is 0 for keyboard activation: keyboard steps are instant.
  back.addEventListener('click', (e) => { if (step > 0) go(step - 1, { animate: e.detail > 0, dir: -1 }); });
  next.addEventListener('click', (e) => advance(e.detail > 0));
  change.addEventListener('click', (e) => go(STEPS.indexOf('pay'), { animate: e.detail > 0, dir: -1 }));
  $('[data-restart]').addEventListener('click', (e) => reset(e.detail > 0));

  join.addEventListener('click', (e) => {
    e.preventDefault();
    const { city, country } = place();
    const detail = {
      industry: answers.industry, workers: answers.workers, pay: answers.pay, city, country,
      cityId: answers.city, countryCode: COUNTRY_CODE[answers.city] || '', verdict: verdict(answers).level,
    };
    window.dispatchEvent(new CustomEvent('mirentor:prefill', { detail }));
    const target = document.getElementById('lista-de-espera');
    if (!target) return;
    target.scrollIntoView({ behavior: motion && e.detail > 0 ? 'smooth' : 'auto', block: 'start' });
    if (!target.contains(document.activeElement)) {
      if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
      target.focus({ preventScroll: true });
    }
  });

  // Start: keep answers the browser restored (back/forward), resume at the first open question.
  for (const input of $$('input[type="radio"]:checked')) { const k = keyOf(input); if (k) answers[k] = input.value; }
  other.hidden = answers.city !== 'other';
  STEPS.forEach((k) => fillRow(k, false));
  body.classList.add('is-stepped');
  const open = STEPS.findIndex((k) => !answers[k]);
  go(open === -1 ? STEPS.length - 1 : open, { focus: false });
}
