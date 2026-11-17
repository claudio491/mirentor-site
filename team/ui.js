// ui.js: the small tools every screen uses. Elements are always built node by node, never from a string of markup,
// so a name or a note typed by a person can never become part of the page's structure.
import { DICT, LANGS, LOCALE, makeT } from './i18n.js';

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
export const EASE = { lock: 'cubic-bezier(.34,1.56,.64,1)', track: 'cubic-bezier(.2,.8,.2,1)', move: 'cubic-bezier(.77,0,.175,1)', out: 'cubic-bezier(.23,1,.32,1)' };
const SVG = 'http://www.w3.org/2000/svg';

function fill(node, attrs, kids) {
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat(3)) if (kid != null && kid !== false) node.append(kid);
  return node;
}
/** h('button', { class: 'btn', onclick }, 'Guardar'): an HTML element. Strings become text, never markup. */
export const h = (tag, attrs, ...kids) => fill(document.createElement(tag), attrs, kids);
/** Replace a node's children. Unlike replaceChildren, a missing child (null, false) is skipped instead of written as text. */
export const put = (node, ...kids) => { node.replaceChildren(...kids.flat(3).filter((k) => k != null && k !== false)); return node; };
/** The same for SVG. */
export const s = (tag, attrs, ...kids) => fill(document.createElementNS(SVG, tag), attrs, kids);
let photoAddress = (person) => `/equipo/api/photo/${encodeURIComponent(person.id)}?v=${encodeURIComponent(person.photo)}`;
/** Where a person's photo is read from: the app's own server, unless a copy that runs without one says otherwise. */
export function setPhotoAddress(fn) { photoAddress = fn; }
/** A person's face in a round lens: their photo when there is one, their initials when not. The name is always
 *  written next to it, so the face itself says nothing to a screen reader. */
export function face(person, cls = '') {
  const letters = String(person.name || '').trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0)).join('').toUpperCase();
  const initials = () => h('span', { class: 'ini', text: letters });
  const node = h('span', { class: cls ? `face ${cls}` : 'face', 'aria-hidden': 'true' });
  if (!person.photo) { node.append(initials()); return node; }
  // The address carries the photo's version, so a new photo is a new address and an old one can stay on the phone.
  const img = h('img', { src: photoAddress(person), alt: '', decoding: 'async',
    onerror: () => node.replaceChildren(initials()) });
  node.append(img);
  return node;
}
/** Put a face in its slot only when the person or the photo changed: a repaint must not make the picture blink. */
export function putFace(slot, person, make = face) {
  const key = `${person.id}:${person.photo || ''}`;
  if (slot.dataset.key !== key) { slot.dataset.key = key; slot.replaceChildren(make(person)); }
}
/** An icon from the sprite in index.html. */
export const icon = (name, cls = 'ic') => s('svg', { class: cls, viewBox: '0 0 24 24', 'aria-hidden': 'true', focusable: 'false' }, s('use', { href: `#i-${name}` }));

// ---- language ----
let LANG = 'es', T = makeT('es');
export function setLang(l) { LANG = LANGS.includes(l) ? l : 'es'; T = makeT(LANG); document.documentElement.lang = LANG; return LANG; }
export const lang = () => LANG;
export const t = (key, vars) => T(key, vars);
const locale = () => LOCALE[LANG];
/** Fill the fixed labels of the page: data-t (text), data-t-aria (aria-label), data-t-ph (placeholder). */
/** Giant type ends in a signal full stop, like the brand's headlines. */
export function giant(node, text) {
  if (text.endsWith('.')) node.replaceChildren(text.slice(0, -1), h('em', { text: '.' })); else node.textContent = text;
}
export function applyStatic(root = document) {
  for (const n of $$('[data-t]', root)) { if (n.classList.contains('giant')) giant(n, T(n.dataset.t)); else n.textContent = T(n.dataset.t); }
  for (const n of $$('[data-t-aria]', root)) n.setAttribute('aria-label', T(n.dataset.tAria));
  for (const n of $$('[data-t-ph]', root)) n.setAttribute('placeholder', T(n.dataset.tPh));
}

// ---- numbers, dates and times ----
export const num = (n) => Number(n).toLocaleString(locale());
export function ord(n) {
  if (LANG !== 'en') return `${n}°`;
  const k = n % 100, sfx = k >= 11 && k <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] || 'th';
  return `${n}${sfx}`;
}
const noon = (day) => new Date(`${day}T12:00:00Z`);
const part = (day, opts) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...opts }).format(noon(day)).replace(/\./g, '');
export const wdShort = (day) => part(day, { weekday: 'short' });
export const wdLong = (day) => part(day, { weekday: 'long' });
export const dayMonth = (day) => part(day, { day: 'numeric', month: 'short' });
export const monthName = (day) => part(day, { month: 'long' });
export const upper = (text) => String(text).toLocaleUpperCase(locale());
export const cap = (text) => { const v = String(text); return v.charAt(0).toLocaleUpperCase(locale()) + v.slice(1); };
export function isoWeek(day) {
  const d = noon(day), k = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - k);
  return Math.ceil(((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 864e5 + 1) / 7);
}
export const addDays = (day, n) => { const d = noon(day); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
/** The local day of a moment in a time zone, as YYYY-MM-DD. */
export const dayOf = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
/** One clock for both languages: 6:22 pm. */
export function clock(iso, tz) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.hour}:${p.minute} ${String(p.dayPeriod || '').toLowerCase()}`;
}
/** '19:00' as a person says it: 7 pm. */
export function hourName(hhmm) {
  const [H, M] = String(hhmm).split(':').map(Number), h12 = H % 12 || 12;
  return `${h12}${M ? `:${String(M).padStart(2, '0')}` : ''} ${H < 12 ? 'am' : 'pm'}`;
}
export const stamp = (iso, tz) => { const d = dayOf(iso, tz); return `${wdShort(d)} ${dayMonth(d)} · ${clock(iso, tz)}`; };
export function ago(iso, nowIso, tz) {
  const mins = Math.max(0, Math.round((Date.parse(nowIso) - Date.parse(iso)) / 60000)), day = dayOf(iso, tz), today = dayOf(nowIso, tz);
  if (mins < 1) return T('time.now');
  if (mins < 60) return T('time.min', { n: mins });
  if (day === today) return T('time.h', { n: Math.round(mins / 60) });
  if (addDays(day, 1) === today) return `${T('time.yesterday')} · ${clock(iso, tz)}`;
  return stamp(iso, tz);
}
const plain = (text) => String(text || '').normalize('NFD').replace(/\p{M}/gu, '');
/** Two spellings of the same word: accents and capitals do not count, as on the server. */
export const sameText = (a, b) => plain(a).toLowerCase().trim() === plain(b).toLowerCase().trim();
/** An id made on this device: sending the same form twice is then the same record, never two. */
export const newId = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
/** A city in the reader's language: Panama City is "Ciudad de Panamá" in Spanish. */
export const cityName = (city) => DICT[LANG][`city.${plain(city)}`] || city || '';
export const joinList = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')}${T('c.and')}${items.at(-1)}` : items[0] || '');

// ---- motion: joints lock, then bones draw; numbers run as counters ----
export function lock(node) {
  if (reduce || !node.animate) return;
  node.animate([{ transform: 'scale(.4)' }, { transform: 'scale(1)' }], { duration: 160, easing: EASE.lock });
}
// Haptics only after a real tap: browsers block vibration without one.
export function buzz(pattern) { try { if (navigator.vibrate && (!navigator.userActivation || navigator.userActivation.hasBeenActive)) navigator.vibrate(pattern); } catch { /* not available */ } }
let depth = 0;
/** Run a block with counters and moves switched off: for a first paint, a tab change or a language change. */
export function quiet(fn) {
  const root = document.documentElement;
  depth += 1; root.classList.add('still');
  try { fn(); } finally { depth -= 1; if (!depth) { void root.offsetWidth; root.classList.remove('still'); } }   // styles settle before transitions come back
}
export const isQuiet = () => depth > 0 || reduce;
export function countTo(node, to, show = num) {
  const from = node.dataset.v === undefined ? to : Number(node.dataset.v);
  node.dataset.v = to;
  if (isQuiet() || from === to || !Number.isFinite(from)) { node.textContent = show(to); return; }
  const t0 = performance.now(), dur = 620;
  const tick = (now) => {
    if (Number(node.dataset.v) !== to) return;   // a newer value took over
    const k = Math.min(1, (now - t0) / dur), e = 1 - (1 - k) ** 4;
    node.textContent = show(Math.round(from + (to - from) * e));
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
/** Keyed list: rows keep their element, and a row that changes place moves there instead of jumping. */
export function flipList(list, items, key, build, update) {
  const before = new Map([...list.children].map((n) => [n.dataset.key, n.getBoundingClientRect().top]));
  const rows = new Map([...list.children].map((n) => [n.dataset.key, n]));
  const want = new Set(items.map((it) => String(key(it))));
  for (const [k, n] of rows) if (!want.has(k)) { n.remove(); rows.delete(k); }
  items.forEach((it, i) => {
    const k = String(key(it));
    let n = rows.get(k);
    if (!n) { n = build(it); n.dataset.key = k; rows.set(k, n); }
    if (list.children[i] !== n) list.insertBefore(n, list.children[i] || null);
    update(n, it, i);
  });
  if (isQuiet()) return false;
  let moved = false;
  for (const n of list.children) {
    const top0 = before.get(n.dataset.key);
    if (top0 == null) continue;
    const dy = top0 - n.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) { moved = true; n.animate([{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }], { duration: 520, easing: EASE.move }); }
  }
  if (moved) scan(list);
  return moved;
}
/** The scan line that crosses a list when its order changes. */
export function scan(box) {
  if (reduce) return;
  const host = box.parentElement;
  let line = $(':scope > .scanline', host);
  if (!line) { line = h('i', { class: 'scanline', 'aria-hidden': 'true' }); host.classList.add('scanhost'); host.append(line); }
  const top = box.offsetTop, height = box.offsetHeight;
  line.animate([{ transform: `translateY(${top}px)`, opacity: 0.9 }, { transform: `translateY(${top + height}px)`, opacity: 0 }], { duration: 700, easing: EASE.track });
}

// ---- toast ----
let toastTimer;
export function toast(text, strong = '') {
  const box = $('#toast');
  $('#toastP').textContent = strong; $('#toastP').hidden = !strong; $('#toastT').textContent = text;
  box.classList.add('on');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => box.classList.remove('on'), Math.min(7000, 2400 + text.length * 35));
}

// ---- the source popover: every number opens into where it comes from ----
let popFor = null;
export function showPop(anchor, label, text) {
  const pop = $('#pop');
  if (popFor === anchor && pop.classList.contains('on')) { hidePop(); return; }
  pop.replaceChildren(h('span', { class: 'label', text: label }), h('span', { text }));
  pop.classList.remove('on'); void pop.offsetWidth; pop.classList.add('on');
  const r = anchor.getBoundingClientRect(), w = pop.offsetWidth, height = pop.offsetHeight;
  pop.style.left = `${Math.max(8, Math.min(innerWidth - w - 8, r.left))}px`;
  const below = r.bottom + 8;
  pop.style.top = `${below + height > innerHeight - 8 ? Math.max(8, r.top - height - 8) : below}px`;
  popFor = anchor; anchor.setAttribute('aria-expanded', 'true');
}
export function hidePop() {
  $('#pop').classList.remove('on');
  if (popFor) { popFor.setAttribute('aria-expanded', 'false'); popFor = null; }
}
export function initPop() {
  document.addEventListener('click', (e) => { if (!e.target.closest('[data-pop]')) hidePop(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hidePop(); });
  addEventListener('scroll', hidePop, { passive: true, capture: true });
  addEventListener('resize', hidePop, { passive: true });
}
/** A number or a label that opens its source. `text` is read when it is opened, so it is always in the current language. */
export function src(node, label, text) {
  node.dataset.pop = '1'; node.setAttribute('aria-expanded', 'false');
  node.addEventListener('click', (e) => { e.stopPropagation(); showPop(node, typeof label === 'function' ? label() : label, typeof text === 'function' ? text() : text); });
  return node;
}

// ---- sheets ----
export function openSheet(dlg) { hidePop(); dlg.classList.remove('closing'); if (!dlg.open) dlg.showModal(); dlg.scrollTop = 0; }
export function closeSheet(dlg) {
  if (!dlg.open) return;
  if (reduce) { dlg.close(); return; }
  dlg.classList.add('closing');
  setTimeout(() => { dlg.close(); dlg.classList.remove('closing'); }, 240);
}
export function initSheets() {
  for (const dlg of $$('dialog.sheet')) {
    dlg.addEventListener('click', (e) => { if (e.target === dlg || e.target.closest('[data-close]')) closeSheet(dlg); });
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(dlg); });
  }
}

/** A button that cannot fire twice: it stays off while its action runs. */
export async function once(btn, fn) {
  if (btn.disabled) return undefined;
  btn.disabled = true; btn.setAttribute('aria-busy', 'true');
  try { return await fn(); } finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { return false; }
}

/** The film grain of the brand pieces, from a fixed seed, as one small tile. */
export function grain() {
  let a = 7;
  const rnd = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let x = Math.imul(a ^ a >>> 15, 1 | a); x = x + Math.imul(x ^ x >>> 7, 61 | x) ^ x; return ((x ^ x >>> 14) >>> 0) / 4294967296; };
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const ctx = cv.getContext('2d'); if (!ctx) return;
  const im = ctx.createImageData(128, 128);
  for (let i = 0; i < im.data.length; i += 4) { const g = 90 + rnd() * 165 | 0; im.data[i] = im.data[i + 1] = im.data[i + 2] = g; im.data[i + 3] = 22; }
  ctx.putImageData(im, 0, 0);
  document.body.style.setProperty('--grain', `url(${cv.toDataURL()})`);   // a data: image, which the page's policy allows
}

// ---- one sheet for every short form: a reason, a play, a new rep, a day off ----
let explain = (err) => String((err && err.message) || err);
/** How a refusal becomes a sentence. The app sets it once, so the forms here never know about the API. */
export function setExplain(fn) { explain = fn; }
const OTHER = '__other__';
function fieldNode(f) {
  const id = `fs-${f.name}`;
  if (f.type === 'days') {
    return h('fieldset', { class: 'field', 'data-name': f.name, 'data-type': 'days' }, h('legend', { class: 'label', text: f.label }),
      h('div', { class: 'checks' }, f.options.map((o) => h('label', { class: 'check' }, h('input', { type: 'checkbox', value: o.value, checked: (f.value || []).includes(o.value) }), h('span', { text: o.label })))));
  }
  if (f.type === 'pick') {   // choose from a list, or write a value the list does not have yet
    const other = h('input', { id: `${id}-other`, type: 'text', 'aria-label': f.otherLabel, maxlength: f.max || 120, autocomplete: 'off', hidden: true });
    const hint = f.hint ? h('span', { class: 'hint', text: f.hint }) : null;
    const select = h('select', { id, name: f.name, 'aria-label': f.label, onchange: () => { other.hidden = select.value !== OTHER; if (hint) hint.textContent = other.hidden ? f.hint : (f.otherHint || f.hint); if (!other.hidden) other.focus(); } },
      f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value ?? ''), text: o.label })), h('option', { value: OTHER, text: f.other }));
    return h('label', { class: 'field', 'data-name': f.name, 'data-type': 'pick' }, h('span', { class: 'label', text: f.label }), select, other, hint);
  }
  let input;
  if (f.type === 'select') input = h('select', { id, name: f.name, 'aria-label': f.label }, f.options.map((o) => h('option', { value: o.value, selected: String(o.value) === String(f.value ?? ''), text: o.label })));
  else if (f.type === 'textarea') { input = h('textarea', { id, name: f.name, 'aria-label': f.label, rows: 3, maxlength: f.max || 280, placeholder: f.placeholder }); input.value = f.value || ''; }
  else { input = h('input', { id, name: f.name, 'aria-label': f.label, type: f.type || 'text', maxlength: f.max || 120, placeholder: f.placeholder, autocomplete: 'off', autocapitalize: f.lower ? 'none' : null, spellcheck: f.lower ? 'false' : null }); input.value = f.value || ''; }
  return h('label', { class: 'field', 'data-name': f.name, 'data-type': f.type || 'text' }, h('span', { class: 'label', text: f.label }), input, f.hint ? h('span', { class: 'hint', text: f.hint }) : null);
}
/** Open the form sheet. onSubmit(values) may return true to keep it open; a thrown error is shown in the form. */
export function formSheet({ title, intro = '', fields = [], body = null, submit, skip = null, note = '', onSubmit }) {
  const dlg = $('#formSheet'), form = $('#fsForm'), err = $('#fsErr'), btn = $('#fsBtn'), skipBtn = $('#fsSkip');
  $('#fsH').textContent = title;
  $('#fsIntro').textContent = intro; $('#fsIntro').hidden = !intro;
  $('#fsFields').replaceChildren(...[body, ...fields.map(fieldNode)].filter(Boolean));
  btn.textContent = submit; skipBtn.textContent = skip || ''; skipBtn.hidden = !skip;
  $('#fsNote').textContent = note; $('#fsNote').hidden = !note;
  err.hidden = true;
  form.onsubmit = (e) => {
    e.preventDefault();
    const values = {};
    for (const node of $$('[data-name]', form)) {
      if (node.dataset.type === 'days') values[node.dataset.name] = $$('input:checked', node).map((i) => Number(i.value));
      else if (node.dataset.type === 'pick') values[node.dataset.name] = ($('select', node).value === OTHER ? $('input', node).value : $('select', node).value).trim();
      else values[node.dataset.name] = $('input,select,textarea', node).value.trim();
    }
    once(btn, async () => {
      err.hidden = true;
      try { if ((await onSubmit(values)) !== true) closeSheet(dlg); } catch (e2) { err.textContent = explain(e2); err.hidden = false; }
    });
  };
  openSheet(dlg);
  return dlg;
}
