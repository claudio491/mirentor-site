// The documents screen decides a few things on the phone: how the list is grouped and ordered, which documents a screen
// shows next to its step, which language a title falls back to, what an empty list says, who sees the manager's
// controls, and the one url rule both sides share. Those decisions live in team/docs-steps.js, tested here.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DICT, LANGS } from '../team/i18n.js';
import { DOC_GROUPS, DOC_STEPS, DOC_ERRORS, docUrl, checkDoc, textIn, docGroups, docsFlat, docsAt, docRow, docsState, canManageDocs, moves, docBody, docFields, moveOrders, nextOrder } from '../team/docs-steps.js';
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
