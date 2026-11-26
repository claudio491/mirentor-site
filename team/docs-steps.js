// docs-steps.js: the documents, decided away from the page so they can be tested, and shared with the server so one
// rule holds on both sides. A document is data a manager or an admin types at runtime: a title and a one-line note in
// each language, an https address, one of four fixed groups, its language, and an optional step it belongs next to.
// A document may carry a text body instead of an address, or beside it: a "card", read inside the app (the script,
// the answers to what owners say). The body is plain text: it reaches the page only as text nodes.
// The server (lib/team/api.mjs, lib/team/state.mjs) checks every write and every replayed event with checkDoc.
import { safeUrl } from './ladder-steps.js';

/** The groups, in the order the screen shows them. */
export const DOC_GROUPS = ['contrato', 'vender', 'sitio', 'equipo'];
/** The places in the app a document can sit next to: the contract step, the install site screen ("Antes de grabar"),
 *  the worker's consent step, and "primera conversación" on the first-days ladder. */
export const DOC_STEPS = ['contract', 'install', 'consent', 'pitch', 'kit', 'meeting'];
export const DOC_LANGS = ['es', 'en', 'both'];
/** A document's id: made where the form is filled, so the same form sent twice is one document. */
export const DOC_ID = /^d_[A-Za-z0-9-]{8,60}$/;
/** Every refusal checkDoc can answer. */
export const DOC_ERRORS = ['doc_title', 'doc_url', 'doc_group', 'doc_lang', 'doc_step', 'doc_order'];
const MAX = { title: 120, note: 200, url: 2000 };
/** The longest text a card keeps, per language. */
export const BODY_MAX = 2400;
/** Where the phone keeps the last list it read, so cards open with no signal. */
export const DOCS_KEY = 'cancha.docs.v1';

const line = (v, max) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');
const pair = (v, max) => { const o = v && typeof v === 'object' ? v : {}; return { es: line(o.es, max), en: line(o.en, max) }; };
const blank = (v) => v === undefined || v === null || v === '';

/** A card's text, as plain text: line breaks kept (Windows breaks made one, three or more made two), control characters
 *  dropped (a tab becomes a space), spaces at the ends trimmed, each line's trailing spaces too. Not cut. */
function plain(v) {
  if (typeof v !== 'string') return '';
  return v.replace(/\r\n?/g, '\n').replace(/\t/g, ' ').replace(/[\u0000-\u0009\u000B-\u001F\u007F-\u009F]/g, '')
    .replace(/[ \u00A0]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
const bodyPair = (v) => { const o = v && typeof v === 'object' && !Array.isArray(v) ? v : {}; return { es: plain(o.es).slice(0, BODY_MAX).trim(), en: plain(o.en).slice(0, BODY_MAX).trim() }; };
/** Whether a document carries a text in one language at least. */
export const hasBody = (doc) => !!doc && !!doc.body && typeof doc.body === 'object' && (!!doc.body.es || !!doc.body.en);

/** The address a document may open: https, nothing else. The same rule as the videos' (safeUrl). */
export const docUrl = (v) => (typeof v === 'string' && v.length <= MAX.url ? safeUrl(v.trim()) : null);

/** A whole document, checked: `{ doc }` in its kept shape, or `{ error }` with the first thing that does not hold.
 *  A title is needed in one language at least; the note may be empty. An address or a text (`body`, in one language at
 *  least) is needed: with neither the answer is doc_url, and an address given must hold even beside a text. The kept
 *  shape has `body` only when one language has text. `order` is kept only when it was given. */
export function checkDoc(input) {
  const d = input && typeof input === 'object' ? input : {};
  const title = pair(d.title, MAX.title);
  if (title.es.length < 2 && title.en.length < 2) return { error: 'doc_title' };
  const body = bodyPair(d.body), text = !!(body.es || body.en);
  const given = !blank(typeof d.url === 'string' ? d.url.trim() : d.url);
  const url = given ? docUrl(d.url) : '';
  if (url === null || (!url && !text)) return { error: 'doc_url' };
  if (!DOC_GROUPS.includes(d.group)) return { error: 'doc_group' };
  const lang = blank(d.lang) ? 'both' : d.lang;
  if (!DOC_LANGS.includes(lang)) return { error: 'doc_lang' };
  const step = blank(d.step) ? null : d.step;
  if (step !== null && !DOC_STEPS.includes(step)) return { error: 'doc_step' };
  if (d.order !== undefined && !(Number.isInteger(d.order) && d.order >= 0 && d.order <= MAX_ORDER)) return { error: 'doc_order' };
  return { doc: { title, note: pair(d.note, MAX.note), url, group: d.group, lang, step, ...(d.order !== undefined ? { order: d.order } : {}), ...(text ? { body } : {}) } };
}

/** A title or a note in the reader's language; when that one is empty, the other. */
export function textIn(p, lang) {
  const o = p && typeof p === 'object' ? p : {};
  return o[lang] || o[lang === 'en' ? 'es' : 'en'] || '';
}

/** The list order: the groups' order, then each document's `order`, then the oldest first, then the id. Only documents
 *  this build can show (a known group, an https address or a text) are kept. */
function sorted(docs) {
  return (Array.isArray(docs) ? docs : []).filter((d) => d && DOC_GROUPS.includes(d.group) && (docUrl(d.url) || hasBody(d)))
    .sort((a, b) => DOC_GROUPS.indexOf(a.group) - DOC_GROUPS.indexOf(b.group) || (a.order || 0) - (b.order || 0) || String(a.t || '').localeCompare(String(b.t || '')) || String(a.id).localeCompare(String(b.id)));
}
/** The documents in their groups, in the fixed order. An empty group is left out. */
export function docGroups(docs) {
  const all = sorted(docs);
  return DOC_GROUPS.map((group) => ({ group, docs: all.filter((d) => d.group === group) })).filter((g) => g.docs.length);
}
/** The server's groups as one list, in order. */
export const docsFlat = (groups) => (Array.isArray(groups) ? groups : []).flatMap((g) => (g && Array.isArray(g.docs) ? g.docs : []));
/** The documents a screen shows next to its step (or any of its steps), in the list order. `step` may also be
 *  `{ steps, guion: true }`: those steps' documents, or, when none is hooked to them, the Guion's (guionDocs). */
export const docsAt = (docs, step) => {
  if (step && typeof step === 'object' && !Array.isArray(step)) {
    const hooked = docsAt(docs, step.steps || []);
    return hooked.length || !step.guion ? hooked : guionDocs(docs);
  }
  const st = Array.isArray(step) ? step : [step];
  return sorted(docs).filter((d) => st.includes(d.step));
};
/** The steps of the first days that list documents, and the document steps each one shows. */
export const LADDER_DOCS = { kit: ['kit'], talk: ['pitch'], meeting: ['meeting'], contract: ['contract'], install: ['install', 'consent'] };
/** The steps that list the Guion when nothing is hooked to them: "Leer el guion y el kit" always has the script to read
 *  once there is one (cards pasted with "Pegar varias tarjetas" have no step). */
export const LADDER_GUION = new Set(['kit']);
/** What a step of the first days asks the documents for (docsAt), or null when it lists none. */
export const ladderHook = (ladderStep) => (LADDER_DOCS[ladderStep] ? (LADDER_GUION.has(ladderStep) ? { steps: LADDER_DOCS[ladderStep], guion: true } : LADDER_DOCS[ladderStep]) : null);
/** The documents a step of the first days lists, in the list order. */
export const ladderDocs = (docs, ladderStep) => (ladderHook(ladderStep) ? docsAt(docs, ladderHook(ladderStep)) : []);
/** What a row shows: the title and note in the reader's language (or the other), the address it opens, a language
 *  chip only when the document is in one language, and whether it is a card (its text in the reader's language, or the
 *  other): a card opens in the app, an address alone opens outside. */
export function docRow(doc, lang) {
  const card = hasBody(doc);
  return { id: doc.id, title: textIn(doc.title, lang), note: textIn(doc.note, lang), url: docUrl(doc.url), chip: doc.lang === 'es' || doc.lang === 'en' ? doc.lang : null,
    card, body: card ? textIn(doc.body, lang) : '' };
}

/** The Guion sheet's list: the documents of the group "vender", in the manager's order. Takes the server's groups or a
 *  flat list. */
export function guionDocs(groups) {
  const all = Array.isArray(groups) && groups.some((g) => g && Array.isArray(g.docs)) ? docsFlat(groups) : groups;
  return sorted(all).filter((d) => d.group === 'vender');
}

/** A card's text as the blocks the sheet draws: paragraphs split on blank lines, single breaks kept inside one; a line
 *  that starts with "Di:" or "Say:" is a block of its own, what the rep says aloud (`say`). */
export function cardParas(text) {
  const out = [];
  for (const para of plain(text).split(/\n[ \t]*\n/)) {
    let held = [];
    const flush = () => { const x = held.join('\n').trim(); if (x) out.push({ text: x, say: false }); held = []; };
    for (const ln of para.split('\n')) {
      if (/^\s*(di|say)\s*:/i.test(ln)) { flush(); out.push({ text: ln.trim(), say: true }); } else held.push(ln);
    }
    flush();
  }
  return out;
}

/** "Pegar varias tarjetas": cards separated by a line that holds only `---`; the first line of each is its title, the
 *  rest its body. A blank card between two separators is no card. `error`: 'title' (under 2 or over 120 characters),
 *  'body' (none), 'long' (over BODY_MAX: it is not cut, it is not sent). */
export function cardsFromPaste(text) {
  if (typeof text !== 'string') return [];
  return text.replace(/\r\n?/g, '\n').split(/^[ \t]*---[ \t]*$/m).map((chunk) => chunk.replace(/^\s*\n/, '').trim()).filter(Boolean).map((chunk) => {
    const at = chunk.indexOf('\n');
    const title = (at < 0 ? chunk : chunk.slice(0, at)).replace(/\s+/g, ' ').trim(), body = at < 0 ? '' : plain(chunk.slice(at + 1));
    const error = title.length < 2 || title.length > MAX.title ? 'title' : !body ? 'body' : body.length > BODY_MAX ? 'long' : null;
    return { title, body, error };
  });
}

/** "Pegar varias tarjetas": the ids of the preview's rows. Each row gets one (`make`) when the preview first shows it
 *  and keeps it while the sheet stays open, whatever is edited afterwards, so a retry never sends a card twice. */
export function pasteIds(ids, count, make) {
  const out = Array.isArray(ids) ? [...ids] : [];
  while (out.length < count) out.push(make());
  return out;
}
/** What "Cargar {n}" counts: the cards that hold and are not kept yet (`done`: the ids kept). */
export const pasteLeft = (cards, ids, done) => (Array.isArray(cards) ? cards : []).filter((c, i) => !c.error && !done.has(ids[i])).length;

/** The list as the phone keeps it: whose it is (the person signed in), when, and the documents. */
export const keepDocs = (viewer, docs, at) => ({ viewer, at, docs });
/** The kept list, read back only for the same person; anything else is nothing. */
export function keptDocs(kept, viewer) {
  if (!kept || typeof kept !== 'object' || !viewer || kept.viewer !== viewer || !Array.isArray(kept.docs)) return null;
  return { docs: kept.docs, at: kept.at };
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
/** The number a new document takes at the end of its group. It never passes the last number a document may carry
 *  (MAX_ORDER): past it the document would be refused on replay and lost. Two at the end share it and sort by age. */
export const MAX_ORDER = 9999;
export const nextOrder = (docs, group) => Math.min(MAX_ORDER, (Array.isArray(docs) ? docs : []).filter((d) => d && d.group === group).reduce((m, d) => Math.max(m, (d.order || 0) + 1), 0));

/** The form's flat values as the document the server checks (a card's text when the form carries it). */
export function docBody(v) {
  const out = { title: { es: v.titleEs || '', en: v.titleEn || '' }, note: { es: v.noteEs || '', en: v.noteEn || '' }, url: v.url || '', group: v.group, lang: v.lang || 'both', step: blank(v.step) ? null : v.step };
  if ('bodyEs' in v || 'bodyEn' in v) out.body = { es: v.bodyEs || '', en: v.bodyEn || '' };
  return out;
}
/** The form's values from a document being edited; a new one starts in the first group, in both languages, with no step. */
export function docFields(doc) {
  const x = doc || {};
  return { titleEs: (x.title && x.title.es) || '', titleEn: (x.title && x.title.en) || '', noteEs: (x.note && x.note.es) || '', noteEn: (x.note && x.note.en) || '',
    url: x.url || '', group: x.group || DOC_GROUPS[0], lang: x.lang || 'both', step: x.step || '', bodyEs: (x.body && x.body.es) || '', bodyEn: (x.body && x.body.en) || '' };
}
