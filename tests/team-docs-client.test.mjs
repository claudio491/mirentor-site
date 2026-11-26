// The documents screen decides a few things on the phone: how the list is grouped and ordered, which documents a screen
// shows next to its step, which language a title falls back to, what an empty list says, who sees the manager's
// controls, and the one url rule both sides share. Those decisions live in team/docs-steps.js, tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICT, LANGS } from '../team/i18n.js';
import { DOC_GROUPS, DOC_STEPS, DOC_ERRORS, docUrl, checkDoc, textIn, docGroups, docsFlat, docsAt, docRow, docsState, canManageDocs, moves, docBody, docFields, moveOrders, nextOrder,
  BODY_MAX, DOCS_KEY, guionDocs, cardParas, cardsFromPaste, keepDocs, keptDocs, pasteIds, pasteLeft } from '../team/docs-steps.js';
import { safeUrl } from '../team/ladder-steps.js';

let seq = 0;
const d = (over = {}) => ({ id: `d_test${String(seq += 1).padStart(6, '0')}`, title: { es: 'Ejemplo', en: 'Sample' }, note: { es: 'Nota', en: 'Note' }, url: 'https://example.com/x', group: 'vender', lang: 'both', step: null, order: 0, t: '2026-11-20T12:00:00Z', ...over });

test('one url rule on both sides: https only', () => {
  assert.equal(docUrl('https://example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(docUrl('  https://example.com/a  '), 'https://example.com/a');
  for (const bad of ['http://example.com', 'javascript:alert(1)', 'data:text/html,x', '/x.pdf', 'x.pdf', '//example.com', 'https://', 'ftp://example.com', '', null, 3, `https://example.com/${'a'.repeat(2100)}`]) {
    assert.equal(docUrl(bad), null, String(bad).slice(0, 30));
  }
  // the videos' rule is the same one: an http address is not opened either
  assert.equal(safeUrl('http://example.com/v.mp4'), null);
  assert.equal(safeUrl('https://example.com/v.mp4'), 'https://example.com/v.mp4');
});

test('checkDoc takes a whole document and answers one error code, each with its words', () => {
  const ok = checkDoc({ title: { es: '  Ejemplo   uno ' }, url: 'https://example.com/a', group: 'sitio' });
  assert.deepEqual(ok.doc, { title: { es: 'Ejemplo uno', en: '' }, note: { es: '', en: '' }, url: 'https://example.com/a', group: 'sitio', lang: 'both', step: null });
  assert.equal(checkDoc({ ...ok.doc, order: 3 }).doc.order, 3);
  assert.equal(checkDoc({ ...ok.doc, url: 'http://example.com' }).error, 'doc_url');
  assert.equal(checkDoc({ ...ok.doc, title: { es: 'x' } }).error, 'doc_title');
  assert.equal(checkDoc({ ...ok.doc, step: 'video' }).error, 'doc_step');
  assert.equal(checkDoc(null).error, 'doc_title');
  for (const code of [...DOC_ERRORS, 'doc']) for (const lang of LANGS) assert.ok(`err.${code}` in DICT[lang], `${lang} lacks err.${code}`);
  for (const g of DOC_GROUPS) for (const lang of LANGS) assert.ok(`docs.group.${g}` in DICT[lang]);
  for (const st of DOC_STEPS) for (const lang of LANGS) assert.ok(`docs.step.${st}` in DICT[lang]);
});

test('grouping follows the fixed order, leaves an empty group out, and orders each group', () => {
  const list = [d({ group: 'equipo', order: 0 }), d({ group: 'contrato', order: 2, title: { es: 'C' } }), d({ group: 'contrato', order: 0, title: { es: 'A' } }), d({ group: 'contrato', order: 1, title: { es: 'B' } })];
  const g = docGroups(list);
  assert.deepEqual(g.map((x) => x.group), ['contrato', 'equipo']);
  assert.deepEqual(g[0].docs.map((x) => x.title.es), ['A', 'B', 'C']);
  assert.deepEqual(docGroups([]), []);
  assert.deepEqual(docGroups(undefined), []);
  // a document in a group this build does not know is not shown
  assert.deepEqual(docGroups([d({ group: 'otro' })]), []);
  // the server's groups flatten back to the list, in order
  assert.deepEqual(docsFlat(g).map((x) => x.title.es), ['A', 'B', 'C', 'Ejemplo']);
  assert.deepEqual(docsFlat(undefined), []);
  // the same order on equal numbers: oldest first, then the id
  const tie = docGroups([d({ id: 'd_b000000001', t: '2026-11-20T13:00:00Z' }), d({ id: 'd_a000000001', t: '2026-11-20T13:00:00Z' }), d({ id: 'd_c000000001', t: '2026-11-20T12:00:00Z' })]);
  assert.deepEqual(tie[0].docs.map((x) => x.id), ['d_c000000001', 'd_a000000001', 'd_b000000001']);
});

test('a screen shows only the documents hooked to its step, in the list order', () => {
  const list = [d({ step: 'install', group: 'sitio', order: 1, title: { es: 'S2' } }), d({ step: 'install', group: 'contrato', title: { es: 'C1' } }), d({ step: 'install', group: 'sitio', order: 0, title: { es: 'S1' } }),
    d({ step: 'consent' }), d({ step: 'pitch' }), d({ step: null })];
  assert.deepEqual(docsAt(list, 'install').map((x) => x.title.es), ['C1', 'S1', 'S2']);
  assert.equal(docsAt(list, 'consent').length, 1);
  assert.equal(docsAt(list, 'pitch').length, 1);
  assert.deepEqual(docsAt(list, 'contract'), []);
  assert.deepEqual(docsAt(undefined, 'install'), []);
  // a document whose url does not hold is never offered as a link
  assert.deepEqual(docsAt([d({ step: 'install', url: 'javascript:alert(1)' })], 'install'), []);
});

test('the language fallback: when one language is empty the other is shown', () => {
  assert.equal(textIn({ es: 'Hola', en: 'Hello' }, 'en'), 'Hello');
  assert.equal(textIn({ es: 'Hola', en: '' }, 'en'), 'Hola');
  assert.equal(textIn({ es: '', en: 'Hello' }, 'es'), 'Hello');
  assert.equal(textIn({}, 'es'), '');
  assert.equal(textIn(undefined, 'es'), '');
  const row = docRow(d({ title: { es: 'Contrato', en: '' }, note: { es: '', en: 'Before signing.' }, lang: 'es' }), 'en');
  assert.deepEqual([row.title, row.note, row.chip], ['Contrato', 'Before signing.', 'es']);
  assert.equal(docRow(d({ lang: 'both' }), 'es').chip, null);
  assert.equal(docRow(d({ url: 'http://example.com' }), 'es').url, null);
});

test('the empty states: no documents at all, or a list', () => {
  assert.equal(docsState([]), 'none');
  assert.equal(docsState(undefined), 'none');
  assert.equal(docsState([d({ group: 'otro' })]), 'none');
  assert.equal(docsState([d()]), 'list');
});

test('only a manager or an admin on their own screens manages documents; never while acting as anyone', () => {
  assert.equal(canManageDocs('manager', null), true);
  assert.equal(canManageDocs('admin', null), true);
  assert.equal(canManageDocs('admin', 'r_practice01'), false);
  assert.equal(canManageDocs('manager', 'r_ana000001'), false);
  assert.equal(canManageDocs('rep', null), false);
  assert.equal(canManageDocs('leader', null), false);
  assert.equal(canManageDocs(undefined, null), false);
});

test('moving within a group: the first cannot go up, the last cannot go down, and the server renumbers the group', () => {
  const g = [d({ id: 'd_one0000001', order: 0 }), d({ id: 'd_two0000001', order: 1 }), d({ id: 'd_three00001', order: 5 }), d({ id: 'd_other00001', group: 'sitio', order: 0 })];
  assert.deepEqual(moves(g, 'd_one0000001'), { up: false, down: true });
  assert.deepEqual(moves(g, 'd_two0000001'), { up: true, down: true });
  assert.deepEqual(moves(g, 'd_three00001'), { up: true, down: false });
  assert.deepEqual(moves(g, 'd_other00001'), { up: false, down: false });
  assert.deepEqual(moveOrders(g, 'd_three00001', 'up'), [{ id: 'd_three00001', order: 1 }, { id: 'd_two0000001', order: 2 }]);
  assert.deepEqual(moveOrders(g, 'd_one0000001', 'up'), []);
  assert.deepEqual(moveOrders(g, 'd_nobody0001', 'up'), []);
  assert.equal(nextOrder(g, 'vender'), 6);
  assert.equal(nextOrder(g, 'equipo'), 0);
});

test('the form: what a manager types becomes the document the server checks', () => {
  const values = { titleEs: 'Ejemplo', titleEn: '', noteEs: 'Cuándo usarlo', noteEn: '', url: 'https://example.com/a', group: 'contrato', lang: 'es', step: 'consent' };
  assert.deepEqual(docBody(values), { title: { es: 'Ejemplo', en: '' }, note: { es: 'Cuándo usarlo', en: '' }, url: 'https://example.com/a', group: 'contrato', lang: 'es', step: 'consent' });
  assert.equal(docBody({ ...values, step: '' }).step, null);
  assert.equal(checkDoc(docBody(values)).doc.step, 'consent');
  // editing fills the form from the document
  const f = docFields(d({ title: { es: 'A', en: 'B' }, step: 'pitch', group: 'sitio' }));
  assert.deepEqual([f.titleEs, f.titleEn, f.step, f.group], ['A', 'B', 'pitch', 'sitio']);
  assert.deepEqual(docFields(null).group, 'contrato');
});

test('an address carrying an account (a name or a password) is refused, for documents and videos alike', () => {
  for (const bad of ['https://usuario:clave@example.com/x', 'https://usuario@example.com/x', 'https://:clave@example.com/x']) {
    assert.equal(safeUrl(bad), null, bad);
    assert.equal(docUrl(bad), null, bad);
  }
  assert.equal(safeUrl('https://example.com/ruta?correo=a@b'), 'https://example.com/ruta?correo=a@b');
});

test('the next order never passes the last one a document may carry, so a new document is never dropped', () => {
  assert.equal(nextOrder([{ group: 'vender', order: 9999 }], 'vender'), 9999);
  assert.equal(nextOrder([{ group: 'vender', order: 9998 }], 'vender'), 9999);
  assert.equal(checkDoc({ title: { es: 'Ejemplo', en: '' }, url: 'https://example.com/x', group: 'vender', lang: 'es', order: nextOrder([{ group: 'vender', order: 9999 }], 'vender') }).error, undefined);
});

// Track F, F1: a document can be a card, its text read inside the app.
const card = (over = {}) => ({ title: { es: 'La apertura (ejemplo)', en: '' }, group: 'vender', ...over });
test('a card: a body in one language at least, plain text, breaks kept, cut to the limit; neither address nor body is doc_url', () => {
  assert.equal(BODY_MAX, 2400);
  // a body and no address: kept, url empty
  const ok = checkDoc(card({ body: { es: 'Hola.\r\nSoy de Mirentor.\n\n\n\nDi: buenos días.' } }));
  assert.deepEqual(ok.doc, { title: { es: 'La apertura (ejemplo)', en: '' }, note: { es: '', en: '' }, url: '', group: 'vender', lang: 'both', step: null, body: { es: 'Hola.\nSoy de Mirentor.\n\nDi: buenos días.', en: '' } });
  // markup and a script tag stay as the characters typed: they are drawn as text, never read as markup
  const tags = '<b>hola</b><script>alert(1)</script> <img src=x onerror=alert(1)>';
  assert.equal(checkDoc(card({ body: { es: tags } })).doc.body.es, tags);
  // 5,000 characters are cut to the limit
  assert.equal(checkDoc(card({ body: { es: 'a'.repeat(5000) } })).doc.body.es.length, 2400);
  // control characters go, spaces at the ends go
  assert.equal(checkDoc(card({ body: { en: '  uno\u0000dos\u0007\ttres\u001b  ' } })).doc.body.en, 'unodos tres');
  // only spaces is no body: with no address the answer is doc_url
  assert.equal(checkDoc(card({ body: { es: '   \n\n  ', en: ' ' } })).error, 'doc_url');
  assert.equal(checkDoc(card()).error, 'doc_url');
  assert.equal(checkDoc(card({ body: 'texto suelto' })).error, 'doc_url');
  // a body never makes a bad address good: a javascript: address is refused
  assert.equal(checkDoc(card({ body: { es: 'Texto.' }, url: 'javascript:alert(1)' })).error, 'doc_url');
  // an address and a body: both kept
  const both = checkDoc(card({ body: { en: 'Text.' }, url: 'https://example.com/a' })).doc;
  assert.deepEqual([both.url, both.body], ['https://example.com/a', { es: '', en: 'Text.' }]);
  // a document with an address and no body keeps the shape it had: no body key
  assert.equal('body' in checkDoc(card({ url: 'https://example.com/a' })).doc, false);
  assert.equal('body' in checkDoc(card({ url: 'https://example.com/a', body: { es: ' ' } })).doc, false);
});

test('a card is listed, shown and opened like a document; an older document with no body still shows', () => {
  const c = d({ url: '', body: { es: 'Texto de ejemplo.', en: '' } });
  assert.deepEqual(docGroups([c]).map((g) => g.docs.length), [1]);
  assert.equal(docsState([c]), 'list');
  const row = docRow(c, 'en');
  assert.deepEqual([row.url, row.card, row.body], [null, true, 'Texto de ejemplo.']);
  const old = docRow(d(), 'es');
  assert.deepEqual([old.card, old.body, old.url], [false, '', 'https://example.com/x']);
  // neither an address that holds nor a body: not shown
  assert.deepEqual(docGroups([d({ url: 'javascript:x' })]), []);
  assert.deepEqual(docsAt([d({ url: '', body: { es: 'x' }, step: 'kit' })], 'kit').length, 1);
});

test('the new steps: the first days\' "Leer el guion y el kit" and the meeting', () => {
  assert.deepEqual(DOC_STEPS, ['contract', 'install', 'consent', 'pitch', 'kit', 'meeting']);
  for (const st of DOC_STEPS) for (const lang of LANGS) assert.ok(`docs.step.${st}` in DICT[lang], `${lang} docs.step.${st}`);
});

test('the Guion sheet lists the group "vender" in its order, from the server\'s groups or a flat list', () => {
  const a = d({ group: 'vender', order: 1, title: { es: 'B' } }), b = d({ group: 'vender', order: 0, title: { es: 'A' }, url: '', body: { es: 'x' } }), c = d({ group: 'contrato', title: { es: 'C' } });
  assert.deepEqual(guionDocs(docGroups([a, b, c])).map((x) => x.title.es), ['A', 'B']);
  assert.deepEqual(guionDocs([a, b, c]).map((x) => x.title.es), ['A', 'B']);
  assert.deepEqual(guionDocs([c]), []);
  assert.deepEqual(guionDocs(undefined), []);
});

test('a card\'s text as paragraphs: split on blank lines, single breaks kept, a "Di:" or "Say:" line said aloud', () => {
  assert.deepEqual(cardParas('Uno\ndos\n\nTres'), [{ text: 'Uno\ndos', say: false }, { text: 'Tres', say: false }]);
  assert.deepEqual(cardParas('Entra.\nDi: buenos días, soy de Mirentor.\nEspera.'), [{ text: 'Entra.', say: false }, { text: 'Di: buenos días, soy de Mirentor.', say: true }, { text: 'Espera.', say: false }]);
  assert.deepEqual(cardParas('Say: good morning.\n\n  \n\nthen wait'), [{ text: 'Say: good morning.', say: true }, { text: 'then wait', say: false }]);
  assert.deepEqual(cardParas('Dime qué piensas'), [{ text: 'Dime qué piensas', say: false }]);
  assert.deepEqual(cardParas(''), []);
  assert.deepEqual(cardParas(undefined), []);
});

test('pasting several cards: separated by a line of ---, the first line is the title, the rest the body', () => {
  const three = 'La apertura\nDi: hola.\n---\nSi dicen que es caro\nNo cuesta nada.\n\nSegundo párrafo.\n---\nAgendar\nPropón dos horas.';
  assert.deepEqual(cardsFromPaste(three), [
    { title: 'La apertura', body: 'Di: hola.', error: null },
    { title: 'Si dicen que es caro', body: 'No cuesta nada.\n\nSegundo párrafo.', error: null },
    { title: 'Agendar', body: 'Propón dos horas.', error: null }]);
  // a blank card between two separators is no card
  assert.deepEqual(cardsFromPaste('Uno\ncuerpo\n---\n   \n---\nDos\ncuerpo dos').map((c) => c.title), ['Uno', 'Dos']);
  // a title only: no body
  assert.deepEqual(cardsFromPaste('Solo el título'), [{ title: 'Solo el título', body: '', error: 'body' }]);
  // a title of one letter
  assert.equal(cardsFromPaste('X\ncuerpo')[0].error, 'title');
  // a body of 2,401 characters is too long, and is not cut
  const long = cardsFromPaste(`Largo\n${'a'.repeat(2401)}`)[0];
  assert.deepEqual([long.error, long.body.length], ['long', 2401]);
  assert.equal(cardsFromPaste(`Justo\n${'a'.repeat(2400)}`)[0].error, null);
  // Windows line breaks, and a separator with spaces around it
  assert.deepEqual(cardsFromPaste('Uno\r\nlínea uno\r\nlínea dos\r\n  ---  \r\nDos\r\ncuerpo'), [{ title: 'Uno', body: 'línea uno\nlínea dos', error: null }, { title: 'Dos', body: 'cuerpo', error: null }]);
  assert.deepEqual(cardsFromPaste(''), []);
  assert.deepEqual(cardsFromPaste(null), []);
});

test('the list kept on the phone: one key, the viewer\'s, read back only for the same viewer', () => {
  assert.equal(DOCS_KEY, 'cancha.docs.v1');
  const list = [d(), d({ url: '', body: { es: 'x' } })];
  const kept = keepDocs('r_ana', list, 1000);
  assert.deepEqual(kept, { viewer: 'r_ana', at: 1000, docs: list });
  assert.deepEqual(keptDocs(kept, 'r_ana'), { docs: list, at: 1000 });
  assert.equal(keptDocs(kept, 'r_omar'), null);
  assert.equal(keptDocs(null, 'r_ana'), null);
  assert.equal(keptDocs({ viewer: 'r_ana', docs: 'x' }, 'r_ana'), null);
});

test('the form carries a card\'s text in both languages, and editing fills it', () => {
  const values = { titleEs: 'Ejemplo', titleEn: '', noteEs: '', noteEn: '', url: '', group: 'vender', lang: 'both', step: '', bodyEs: 'Texto.', bodyEn: '' };
  assert.deepEqual(docBody(values).body, { es: 'Texto.', en: '' });
  assert.equal(checkDoc(docBody(values)).doc.body.es, 'Texto.');
  const f = docFields(d({ body: { es: 'A', en: 'B' } }));
  assert.deepEqual([f.bodyEs, f.bodyEn], ['A', 'B']);
  assert.deepEqual([docFields(null).bodyEs, docFields(null).bodyEn], ['', '']);
});

test('pasting several cards: each row keeps the id it got when first shown, whatever is edited, and "Cargar" counts what is not kept yet', () => {
  let n = 0;
  const make = () => `d_paste${String(n += 1).padStart(6, '0')}`;
  const first = cardsFromPaste('La apertura\nDi: hola.\n---\nSi dicen que es caro\nNo cuesta nada.');
  const ids = pasteIds([], first.length, make);
  assert.deepEqual(ids, ['d_paste000001', 'd_paste000002']);
  // the manager edits the second card's text, then adds a third: the rows keep their ids, the new row gets its own
  const edited = cardsFromPaste('La apertura\nDi: hola.\n---\nSi dicen que es caro\nNo cuesta nada, y lo explico.\n---\nAgendar\nPropón dos horas.');
  const again = pasteIds(ids, edited.length, make);
  assert.deepEqual(again, ['d_paste000001', 'd_paste000002', 'd_paste000003']);
  // fewer rows than before keep the ids they had, and the later ones are not lost if they come back
  assert.deepEqual(pasteIds(again, 1, make), again);
  assert.deepEqual(pasteIds(again, 3, make), again);
  // "Cargar {n}": the cards that hold and are not kept yet
  const done = new Set(['d_paste000001']);
  assert.equal(pasteLeft(edited, again, new Set()), 3);
  assert.equal(pasteLeft(edited, again, done), 2);
  const bad = cardsFromPaste('La apertura\nDi: hola.\n---\nSolo título');
  assert.equal(pasteLeft(bad, pasteIds([], 2, make), new Set()), 1);   // a card that does not hold is never counted
  assert.equal(pasteLeft([], [], new Set()), 0);
});
