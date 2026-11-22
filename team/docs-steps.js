// docs-steps.js: the documents, decided away from the page so they can be tested, and shared with the server so one
// rule holds on both sides. A document is data a manager or an admin types at runtime: a title and a one-line note in
// each language, an https address, one of four fixed groups, its language, and an optional step it belongs next to.
// The server (lib/team/api.mjs, lib/team/state.mjs) checks every write and every replayed event with checkDoc.
import { safeUrl } from './ladder-steps.js';

/** The groups, in the order the screen shows them. */
export const DOC_GROUPS = ['contrato', 'vender', 'sitio', 'equipo'];
/** The places in the app a document can sit next to: the contract step, the install site screen ("Antes de grabar"),
 *  the worker's consent step, and "primera conversación" on the first-days ladder. */
export const DOC_STEPS = ['contract', 'install', 'consent', 'pitch'];
export const DOC_LANGS = ['es', 'en', 'both'];
/** A document's id: made where the form is filled, so the same form sent twice is one document. */
export const DOC_ID = /^d_[A-Za-z0-9-]{8,60}$/;
/** Every refusal checkDoc can answer. */
export const DOC_ERRORS = ['doc_title', 'doc_url', 'doc_group', 'doc_lang', 'doc_step', 'doc_order'];
const MAX = { title: 120, note: 200, url: 2000 };

const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const pair = (v, max) => { const o = v && typeof v === 'object' ? v : {}; return { es: line(o.es, max), en: line(o.en, max) }; };
const blank = (v) => v === undefined || v === null || v === '';

/** The address a document may open: https, nothing else. The same rule as the videos' (safeUrl). */
export const docUrl = (v) => (typeof v === 'string' && v.length <= MAX.url ? safeUrl(v.trim()) : null);

/** A whole document, checked: `{ doc }` in its kept shape, or `{ error }` with the first thing that does not hold.
 *  A title is needed in one language at least; the note may be empty. `order` is kept only when it was given. */
export function checkDoc(input) {
  const d = input && typeof input === 'object' ? input : {};
  const title = pair(d.title, MAX.title);
  if (title.es.length < 2 && title.en.length < 2) return { error: 'doc_title' };
  const url = docUrl(d.url);
  if (!url) return { error: 'doc_url' };
  if (!DOC_GROUPS.includes(d.group)) return { error: 'doc_group' };
  const lang = blank(d.lang) ? 'both' : d.lang;
  if (!DOC_LANGS.includes(lang)) return { error: 'doc_lang' };
  const step = blank(d.step) ? null : d.step;
  if (step !== null && !DOC_STEPS.includes(step)) return { error: 'doc_step' };
  if (d.order !== undefined && !(Number.isInteger(d.order) && d.order >= 0 && d.order <= 9999)) return { error: 'doc_order' };
  return { doc: { title, note: pair(d.note, MAX.note), url, group: d.group, lang, step, ...(d.order !== undefined ? { order: d.order } : {}) } };
}

/** A title or a note in the reader's language; when that one is empty, the other. */
export function textIn(p, lang) {
  const o = p && typeof p === 'object' ? p : {};
  return o[lang] || o[lang === 'en' ? 'es' : 'en'] || '';
}

/** The list order: the groups' order, then each document's `order`, then the oldest first, then the id. Only documents
 *  this build can show (a known group, an https address) are kept. */
function sorted(docs) {
  return (Array.isArray(docs) ? docs : []).filter((d) => d && DOC_GROUPS.includes(d.group) && docUrl(d.url))
    .sort((a, b) => DOC_GROUPS.indexOf(a.group) - DOC_GROUPS.indexOf(b.group) || (a.order || 0) - (b.order || 0) || String(a.t || '').localeCompare(String(b.t || '')) || String(a.id).localeCompare(String(b.id)));
}
/** The documents in their groups, in the fixed order. An empty group is left out. */
export function docGroups(docs) {
  const all = sorted(docs);
  return DOC_GROUPS.map((group) => ({ group, docs: all.filter((d) => d.group === group) })).filter((g) => g.docs.length);
}
/** The server's groups as one list, in order. */
export const docsFlat = (groups) => (Array.isArray(groups) ? groups : []).flatMap((g) => (g && Array.isArray(g.docs) ? g.docs : []));
/** The documents a screen shows next to its step, in the list order. */
export const docsAt = (docs, step) => sorted(docs).filter((d) => d.step === step);
/** What a row shows: the title and note in the reader's language (or the other), the address it opens, and a language
 *  chip only when the document is in one language. */
export function docRow(doc, lang) {
  return { id: doc.id, title: textIn(doc.title, lang), note: textIn(doc.note, lang), url: docUrl(doc.url), chip: doc.lang === 'es' || doc.lang === 'en' ? doc.lang : null };
}
/** 'none' when there is nothing to show (the screen says so plainly), 'list' otherwise. */
export const docsState = (docs) => (sorted(docs).length ? 'list' : 'none');

/** Managing documents is a manager's own action: a manager or an admin, on their own screens, never while acting as
 *  anyone (a real rep or the practice rep). */
export const canManageDocs = (role, as) => (role === 'manager' || role === 'admin') && !as;

const groupOf = (docs, id) => { const doc = sorted(docs).find((d) => d.id === id); return doc ? sorted(docs).filter((d) => d.group === doc.group) : []; };
/** Whether a document can move up or down within its group. */
export function moves(docs, id) {
  const g = groupOf(docs, id), i = g.findIndex((d) => d.id === id);
  return { up: i > 0, down: i >= 0 && i < g.length - 1 };
}
/** Moving a document one place within its group: the group is numbered again from 0, and only the documents whose
 *  number changes are listed. Nothing to move is an empty list. */
export function moveOrders(docs, id, dir) {
  const g = groupOf(docs, id), i = g.findIndex((d) => d.id === id), j = dir === 'up' ? i - 1 : dir === 'down' ? i + 1 : -1;
  if (i < 0 || j < 0 || j >= g.length) return [];
  const next = [...g]; [next[i], next[j]] = [next[j], next[i]];
  return next.map((d, k) => ({ id: d.id, order: k })).filter((x, k) => (next[k].order || 0) !== x.order);
}
/** The number a new document takes at the end of its group. */
export const nextOrder = (docs, group) => (Array.isArray(docs) ? docs : []).filter((d) => d && d.group === group).reduce((m, d) => Math.max(m, (d.order || 0) + 1), 0);

/** The form's flat values as the document the server checks. */
export function docBody(v) {
  return { title: { es: v.titleEs || '', en: v.titleEn || '' }, note: { es: v.noteEs || '', en: v.noteEn || '' }, url: v.url || '', group: v.group, lang: v.lang || 'both', step: blank(v.step) ? null : v.step };
}
/** The form's values from a document being edited; a new one starts in the first group, in both languages, with no step. */
export function docFields(doc) {
  const x = doc || {};
  return { titleEs: (x.title && x.title.es) || '', titleEn: (x.title && x.title.en) || '', noteEs: (x.note && x.note.es) || '', noteEn: (x.note && x.note.en) || '',
    url: x.url || '', group: x.group || DOC_GROUPS[0], lang: x.lang || 'both', step: x.step || '' };
}
