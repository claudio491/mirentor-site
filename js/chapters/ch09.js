// ch09.js: chapter 09 "Lista de espera". The form is not wired to a backend yet: on submit it validates, never
// sends, and turns the card's camera on ("Cámara encendida") with a review note saying nothing was sent.
// Without this module the form still reads and validates natively (required fields, method post: nothing in a URL).
//
// Validation: on blur once a field has been touched, on every input while it shows an error, and on submit (focus
// moves to the first field to fix, a live line counts them). Errors are an icon plus text, tied to the field with
// aria-describedby and aria-invalid. A head count below 50 or above 5000 shows a calm note and still sends.
//
// Prefill: window "mirentor:prefill" (from 06 and 07; detail { industry, workers, pay, city, country, countryCode })
// fills industry, city and country and tags them. A worker range ('100-500') becomes a hint, never a made-up head
// count. The pay answer becomes a note: the pay box is always the owner's own click.
//
// Motion: the REC dot lights (240 ms) and beats three times at 1 Hz, then stays on; the corners let go 8 px and lock
// back (120 + 240 ms, as in the hero). The form fades out in 160 ms, the result rises 12 px in 360 ms. Tier "still":
// final states at once.

const ORDER = ['business', 'workers', 'industry', 'city', 'country', 'contact', 'email', 'whatsapp', 'pay_ack'];
const REQUIRED = ORDER.filter((n) => n !== 'whatsapp');
const RANGES = { lt50: 'ch09_range_lt50', '50-99': 'ch09_range_50_99', '100-500': 'ch09_range_100_500', '501-5000': 'ch09_range_501_5000', gt5000: 'ch09_range_gt5000' };
const ALIASES = { PA: ['panama'], CO: ['colombia'], PE: ['peru'], MX: ['mexico'], US: ['united states', 'estados unidos', 'usa', 'us', 'eeuu', 'ee uu', 'ee. uu.', 'ee.uu.'] };
const EMAIL = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/;
const EASE_OUT = 'cubic-bezier(0.22, 1, 0.36, 1)';
const CORNER = [[-8, -8], [8, -8], [8, 8], [-8, 8]];

const norm = (s) => String(s ?? '').trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Pure: the whole number people type ("120", "1.200", "1,200", "1 200"); NaN when it is not one. */
export function parseWorkers(raw) {
  const s = String(raw ?? '').trim();
  if (/^\d+$/.test(s)) return Number(s);
  if (/^\d{1,3}([.,\s]\d{3})+$/.test(s)) return Number(s.replace(/[.,\s]/g, ''));
  return NaN;
}

/** Pure: true when a valid head count sits below 50 or above 5000 (a calm note, never a block). */
export const outOfRange = (n) => Number.isInteger(n) && n > 0 && (n < 50 || n > 5000);

/** Pure: the error key for one field, '' when valid. Keys map to strings "ch09_err_<key>". */
export function check(name, value) {
  const v = typeof value === 'string' ? value.trim() : value;
  switch (name) {
    case 'workers': {
      if (!v) return 'workers';
      const n = parseWorkers(v);
      return Number.isInteger(n) && n > 0 ? '' : 'workers_num';
    }
    case 'email': return !v ? 'email' : EMAIL.test(v) ? '' : 'email_format';
    case 'whatsapp': return !v || /^(\+|00)[1-9]\d{7,14}$/.test(v.replace(/[\s().-]/g, '')) ? '' : 'whatsapp';
    case 'pay_ack': return v ? '' : 'pay';
    default: return v ? '' : name;
  }
}

export function init(el, { tier = 'full', strings = {} } = {}) {
  const form = el.querySelector('[data-form]');
  const card = el.querySelector('[data-card]');
  const done = el.querySelector('[data-done]');
  if (!form || !card || !done) return;
  const $ = (sel) => el.querySelector(sel);
  const t = (key, vars = {}) => (strings[key] || '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  const motion = () => tier !== 'still' && !matchMedia('(prefers-reduced-motion: reduce)').matches;
  const input = (name) => form.elements.namedItem(name);
  const valueOf = (name) => (input(name).type === 'checkbox' ? input(name).checked : input(name).value);
  const touched = new Set();
  let tried = false;
  let payAnswer = '';

  form.noValidate = true;
  const summary = $('[data-summary]');
  const ticks = [...el.querySelectorAll('.ch09-ticks s')];
  const count = $('[data-count]');
  const note = $('[data-workers-note]');
  const hint = $('[data-workers-hint]');
  const payNote = $('[data-pay-note]');
  const prefillMsg = $('[data-prefill-msg]');
  const dot = $('.ch09-dot');

  /** Show or clear one field's error. Returns the error key ('' when valid). */
  function validate(name) {
    const key = check(name, valueOf(name));
    const box = $(`[data-err="${name}"]`);
    input(name).setAttribute('aria-invalid', key ? 'true' : 'false');
    if (box) { box.textContent = key ? t(`ch09_err_${key}`) : ''; box.hidden = !key; }
    return key;
  }

  function meter() {
    const ok = REQUIRED.filter((n) => !check(n, valueOf(n))).length;
    ticks.forEach((s, i) => s.classList.toggle('is-on', i < ok));
    if (count) count.textContent = `${ok} / ${REQUIRED.length}`;
  }

  function sizeNote() {
    note.hidden = !outOfRange(parseWorkers(input('workers').value));
  }

  const tag = (name, on) => $(`[data-field="${name}"]`)?.classList.toggle('is-prefilled', on);

  /** After a first submit, the live line keeps counting the fields still marked (and clears at zero). */
  function recount() {
    if (!tried) return;
    const n = ORDER.filter((k) => input(k).getAttribute('aria-invalid') === 'true').length;
    const text = !n ? '' : n === 1 ? t('ch09_err_summary_one') : t('ch09_err_summary_many', { n });
    if (summary.textContent !== text) summary.textContent = text;
  }

  /** A "yes" from the fit check asks for the owner's own tick; once ticked, that note has done its job. */
  const payHint = () => { if (payAnswer === 'yes') payNote.hidden = input('pay_ack').checked; };

  form.addEventListener('input', (e) => {
    const { name } = e.target;
    if (!ORDER.includes(name)) return;
    touched.add(name);
    tag(name, false);
    if (name === 'workers') { hint.hidden = true; if (!outOfRange(parseWorkers(e.target.value))) note.hidden = true; }
    if (e.target.getAttribute('aria-invalid') === 'true') validate(name);
    meter();
    recount();
  });
  form.addEventListener('change', (e) => {
    const { name } = e.target;
    if (!ORDER.includes(name)) return;
    touched.add(name);
    if (e.target.tagName === 'SELECT') tag(name, false);
    if (e.target.getAttribute('aria-invalid') === 'true' || (e.target.type === 'checkbox' && tried)) validate(name);
    if (name === 'pay_ack') payHint();
    meter();
    recount();
  });
  form.addEventListener('focusout', (e) => {
    const { name } = e.target;
    if (!ORDER.includes(name) || !touched.has(name)) return;
    validate(name);
    if (name === 'workers') sizeNote();
    recount();
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    tried = true;
    const bad = ORDER.filter((n) => validate(n));
    sizeNote();
    meter();
    if (bad.length) {
      summary.textContent = bad.length === 1 ? t('ch09_err_summary_one') : t('ch09_err_summary_many', { n: bad.length });
      input(bad[0]).focus();
      return;
    }
    summary.textContent = '';
    turnOn();
  });

  function turnOn() {
    const city = input('city').value.trim();
    $('[data-done-text]').textContent = t('ch09_done_text', { business: input('business').value.trim(), city });
    card.classList.add('is-rec');
    $('[data-status="idle"]').hidden = true;
    $('[data-status="rec"]').hidden = false;
    const show = () => {
      form.hidden = true;
      done.hidden = false;
      done.focus({ preventScroll: true });
      const head = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
      if (card.getBoundingClientRect().top < head) card.scrollIntoView({ block: 'start', behavior: motion() ? 'smooth' : 'auto' });
    };
    if (!motion()) { show(); return; }
    dot.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1)', opacity: 1 }], { duration: 240, easing: EASE_OUT });
    dot.animate([{ opacity: 1 }, { opacity: 1, offset: 0.5 }, { opacity: 0.35, offset: 0.62 }, { opacity: 0.35, offset: 0.88 }, { opacity: 1 }], { duration: 1000, delay: 240, iterations: 3 });
    el.querySelectorAll('.ch09-corners i').forEach((c, i) => c.animate(
      [{ transform: 'none' }, { transform: `translate(${CORNER[i][0]}px, ${CORNER[i][1]}px)`, offset: 1 / 3, easing: EASE_OUT }, { transform: 'none' }],
      { duration: 360, easing: EASE_OUT },
    ));
    form.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 160, easing: EASE_OUT }).finished.then(() => {
      show();
      done.animate([{ opacity: 0, transform: 'translateY(12px)' }, { opacity: 1, transform: 'none' }], { duration: 360, easing: EASE_OUT });
    });
  }

  /** Back to the form with every value kept (the "Edit details" button, or a new prefill). */
  function reopen(focus) {
    card.classList.remove('is-rec');
    $('[data-status="idle"]').hidden = false;
    $('[data-status="rec"]').hidden = true;
    done.hidden = true;
    form.hidden = false;
    if (focus) input('business').focus();
  }
  $('[data-edit]').addEventListener('click', () => reopen(true));

  // Prefill from 06 (fit check) and 07 (cities). Overwrites: the visitor just asked for it.
  function countryCode(code, name) {
    const sel = input('country');
    const options = [...sel.options].map((o) => o.value);
    const c = String(code ?? '').toUpperCase();
    if (c && options.includes(c)) return c;
    const n = norm(name);
    if (!n) return '';
    for (const [k, list] of Object.entries(ALIASES)) if (list.includes(n)) return k;
    const hit = [...sel.options].find((o) => o.value && norm(o.textContent) === n);
    return hit ? hit.value : 'other';
  }
  function put(name, value) {
    input(name).value = value;
    tag(name, true);
    if (tried || input(name).getAttribute('aria-invalid') === 'true') validate(name);
  }
  window.addEventListener('mirentor:prefill', (e) => {
    const d = e.detail || {};
    if (form.hidden) reopen(false);
    let filled = 0;
    if (d.industry && [...input('industry').options].some((o) => o.value && o.value === d.industry)) { put('industry', d.industry); filled++; }
    const w = String(d.workers ?? '').trim();
    if (/^\d+$/.test(w)) { put('workers', w); hint.hidden = true; sizeNote(); filled++; }
    else if (RANGES[w]) { hint.textContent = t('ch09_prefill_workers', { range: t(RANGES[w]) }); hint.hidden = false; }
    if (d.city && String(d.city).trim()) { put('city', String(d.city).trim()); filled++; }
    const code = countryCode(d.countryCode, d.country);
    if (code) { put('country', code); filled++; }
    if (['yes', 'unsure', 'no'].includes(d.pay)) { payAnswer = d.pay; payNote.textContent = t(`ch09_prefill_pay_${d.pay}`); payNote.hidden = false; payHint(); }
    prefillMsg.textContent = filled ? t('ch09_prefill_msg') : '';
    meter();
    recount();
  });

  // Values the browser restored (back/forward) count from the start.
  meter();
  sizeNote();
  el.dataset.ready = 'true';
}
