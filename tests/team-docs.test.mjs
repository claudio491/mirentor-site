// Documents inside the app: a list a manager or an admin fills at runtime, read by everyone on the team (a leader and
// the practice rep included). Nothing about a real document is in the repository: every title and link here is a
// placeholder on example.com. Writes are a manager's own action: never taken from a rep, a leader, or while acting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start } from './team-helper.mjs';
import { emptyState, applyEvent } from '../lib/team/state.mjs';

const API = '/equipo/api';
const doc = (over = {}) => ({ title: { es: 'Documento de ejemplo', en: 'Sample document' }, note: { es: 'Úsalo para probar.', en: 'Use it to test.' },
  url: 'https://example.com/ejemplo-1', group: 'vender', lang: 'both', ...over });

async function setup(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), ana = await s.addRep(a.cookie, 'ana');
  const mgr = await s.addRep(a.cookie, 'memo', { role: 'manager' });
  const lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  const add = (body, cookie = a.cookie) => s.call('POST', `${API}/docs`, body, { cookie });
  const read = (cookie) => s.call('GET', `${API}/docs`, undefined, { cookie });
  const docEvents = () => s.lines().filter((e) => e.type.startsWith('doc.'));
  return { s, a, ana, mgr, lia, add, read, docEvents };
}

test('a manager and an admin add a document; the event carries who added it and the list comes back', async (t) => {
  const { s, a, mgr, add, docEvents } = await setup(t);
  const r = await add(doc(), mgr.cookie);
  assert.equal(r.status, 200);
  const ev = docEvents()[0];
  assert.equal(ev.type, 'doc.added');
  assert.match(ev.id, /^d_/);
  assert.deepEqual([ev.url, ev.group, ev.lang, ev.step, ev.by], ['https://example.com/ejemplo-1', 'vender', 'both', null, (await s.call('GET', `${API}/me`, undefined, { cookie: mgr.cookie })).json.viewer.id]);
  assert.deepEqual(r.json.groups.map((g) => g.group), ['vender']);
  assert.equal(r.json.groups[0].docs[0].title.es, 'Documento de ejemplo');
  assert.equal((await add(doc({ url: 'https://example.com/ejemplo-2' }))).status, 200);
  assert.equal(docEvents().filter((e) => e.type === 'doc.added').length, 2);
  // the same id again is a retry: one document
  const id = 'd_0123456789abcdef';
  assert.equal((await add(doc({ id }), a.cookie)).status, 200);
  assert.equal((await add(doc({ id }), a.cookie)).status, 200);
  assert.equal(docEvents().filter((e) => e.id === id).length, 1);
});

test('a rep and a leader read the list; neither can add, edit, move or remove, and nothing is appended', async (t) => {
  const { s, a, ana, lia, add, read, docEvents } = await setup(t);
  await add(doc());
  const id = docEvents()[0].id;
  for (const who of [ana, lia]) {
    const r = await read(who.cookie);
    assert.equal(r.status, 200);
    assert.equal(r.json.groups[0].docs[0].id, id);
  }
  const before = s.lines().length;
  assert.deepEqual([(await add(doc(), ana.cookie)).status, (await add(doc(), ana.cookie)).json.error], [403, 'manager_only']);
  assert.deepEqual([(await add(doc(), lia.cookie)).status, (await add(doc(), lia.cookie)).json.error], [403, 'read_only']);
  for (const who of [ana, lia]) {
    assert.equal((await s.call('POST', `${API}/docs/${id}`, { patch: { group: 'sitio' } }, { cookie: who.cookie })).status, 403);
    assert.equal((await s.call('POST', `${API}/docs/${id}/move`, { dir: 'down' }, { cookie: who.cookie })).status, 403);
    assert.equal((await s.call('POST', `${API}/docs/${id}/remove`, {}, { cookie: who.cookie })).status, 403);
  }
  assert.equal(s.lines().length, before);
  // signed out: nothing
  assert.equal((await s.call('GET', `${API}/docs`)).status, 401);
  assert.equal(a.id.length > 0, true);
});

test('the practice rep reads the list; a manager acting as anyone cannot manage documents', async (t) => {
  const { s, a, ana, add, docEvents } = await setup(t);
  await add(doc());
  const P = (await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie })).json.practice.id;
  const asP = await s.call('GET', `${API}/docs?as=${P}`, undefined, { cookie: a.cookie });
  assert.equal(asP.status, 200);
  assert.equal(asP.json.groups[0].docs.length, 1);
  assert.equal((await s.call('GET', `${API}/docs?as=${ana.id}`, undefined, { cookie: a.cookie })).status, 200);
  const before = docEvents().length;
  const asPractice = await s.call('POST', `${API}/docs?as=${P}`, doc(), { cookie: a.cookie });
  assert.deepEqual([asPractice.status, asPractice.json.error], [403, 'read_only']);
  assert.equal((await s.call('POST', `${API}/docs?as=${ana.id}`, doc(), { cookie: a.cookie })).status, 403);
  assert.equal((await s.call('POST', `${API}/docs/${docEvents()[0].id}/remove?as=${P}`, {}, { cookie: a.cookie })).status, 403);
  assert.equal(docEvents().length, before);
});

test('a url that is not https is refused, server side, with nothing appended', async (t) => {
  const { add, docEvents } = await setup(t);
  for (const url of ['http://example.com/x', 'javascript:alert(1)', 'JavaScript:alert(1)', 'data:text/html,hola', '/ventas/doc.pdf', 'ejemplo.pdf', '//example.com/x', 'https://', '', 7, null, `https://example.com/${'a'.repeat(2100)}`]) {
    const r = await add(doc({ url }));
    assert.deepEqual([r.status, r.json.error], [400, 'doc_url'], String(url).slice(0, 40));
  }
  assert.equal(docEvents().length, 0);
});

test('every field is checked: a title in one language at least, a fixed group, a language, a step from the list', async (t) => {
  const { add, docEvents } = await setup(t);
  const bad = [[{ title: { es: '', en: ' ' } }, 'doc_title'], [{ title: 'Texto' }, 'doc_title'], [{ group: 'otro' }, 'doc_group'], [{ group: undefined }, 'doc_group'],
    [{ lang: 'fr' }, 'doc_lang'], [{ step: 'video' }, 'doc_step'], [{ step: 3 }, 'doc_step'], [{ order: -1 }, 'doc_order'], [{ order: 1.5 }, 'doc_order']];
  for (const [over, code] of bad) {
    const r = await add(doc(over));
    assert.deepEqual([r.status, r.json.error], [400, code], JSON.stringify(over));
  }
  assert.equal(docEvents().length, 0);
  // a title in one language is enough; each step from the list is taken
  assert.equal((await add(doc({ title: { es: 'Solo español' }, lang: 'es' }))).status, 200);
  for (const step of ['contract', 'install', 'consent', 'pitch']) assert.equal((await add(doc({ step, url: `https://example.com/${step}` }))).status, 200);
  assert.deepEqual(docEvents().map((e) => e.step), [null, 'contract', 'install', 'consent', 'pitch']);
});

test('GET docs is grouped in the fixed order, an empty group is left out, and each group is in its order', async (t) => {
  const { add, read, ana } = await setup(t);
  await add(doc({ group: 'equipo', title: { es: 'Equipo uno' } }));
  await add(doc({ group: 'contrato', title: { es: 'Contrato dos' }, order: 5 }));
  await add(doc({ group: 'contrato', title: { es: 'Contrato uno' }, order: 2 }));
  await add(doc({ group: 'contrato', title: { es: 'Contrato tres' } }));   // no order given: the end of its group
  const r = (await read(ana.cookie)).json;
  assert.deepEqual(r.groups.map((g) => g.group), ['contrato', 'equipo']);
  assert.deepEqual(r.groups[0].docs.map((d) => d.title.es), ['Contrato uno', 'Contrato dos', 'Contrato tres']);
  assert.deepEqual(r.groups[0].docs.map((d) => d.order), [2, 5, 6]);
  for (const d of r.groups[0].docs) assert.deepEqual(Object.keys(d).sort(), ['group', 'id', 'lang', 'note', 'order', 'step', 't', 'title', 'url']);
});

test('a manager edits, moves within a group and removes; a missing document is a 404', async (t) => {
  const { s, a, add, read, ana, docEvents } = await setup(t);
  const cookie = a.cookie;
  for (const n of [1, 2, 3]) await add(doc({ title: { es: `Placeholder ${n}` }, url: `https://example.com/${n}` }));
  const ids = docEvents().map((e) => e.id);
  const titles = async () => (await read(ana.cookie)).json.groups.flatMap((g) => g.docs.map((d) => d.title.es));
  // move the third up: 1, 3, 2
  const up = await s.call('POST', `${API}/docs/${ids[2]}/move`, { dir: 'up' }, { cookie });
  assert.equal(up.status, 200);
  assert.deepEqual(await titles(), ['Placeholder 1', 'Placeholder 3', 'Placeholder 2']);
  // the first cannot go further up: nothing changes and nothing is appended
  const n = s.lines().length;
  assert.equal((await s.call('POST', `${API}/docs/${ids[0]}/move`, { dir: 'up' }, { cookie })).status, 200);
  assert.equal(s.lines().length, n);
  assert.equal((await s.call('POST', `${API}/docs/${ids[0]}/move`, { dir: 'sideways' }, { cookie })).status, 400);
  // edit: a new title, a hook, a bad url refused
  assert.equal((await s.call('POST', `${API}/docs/${ids[0]}`, { patch: { title: { es: 'Placeholder uno', en: 'Placeholder one' }, step: 'install' } }, { cookie })).status, 200);
  const edited = docEvents().filter((e) => e.type === 'doc.updated').pop();
  assert.deepEqual(edited.patch, { title: { es: 'Placeholder uno', en: 'Placeholder one' }, step: 'install' });
  const refused = await s.call('POST', `${API}/docs/${ids[0]}`, { patch: { url: 'javascript:alert(1)' } }, { cookie });
  assert.deepEqual([refused.status, refused.json.error], [400, 'doc_url']);
  // moving to another group puts it at the end of that group
  await add(doc({ group: 'sitio', title: { es: 'Sitio uno' }, url: 'https://example.com/s1' }));
  assert.equal((await s.call('POST', `${API}/docs/${ids[0]}`, { patch: { group: 'sitio' } }, { cookie })).status, 200);
  const g = (await read(ana.cookie)).json.groups;
  assert.deepEqual(g.map((x) => [x.group, x.docs.map((d) => d.title.es)]), [['vender', ['Placeholder 3', 'Placeholder 2']], ['sitio', ['Sitio uno', 'Placeholder uno']]]);
  // remove
  assert.equal((await s.call('POST', `${API}/docs/${ids[1]}/remove`, {}, { cookie })).status, 200);
  assert.deepEqual(await titles(), ['Placeholder 3', 'Sitio uno', 'Placeholder uno']);
  assert.equal(docEvents().filter((e) => e.type === 'doc.removed').length, 1);
  assert.equal((await s.call('POST', `${API}/docs/${ids[1]}/remove`, {}, { cookie })).status, 404);
  assert.equal((await s.call('POST', `${API}/docs/d_doesnotexist00/move`, { dir: 'up' }, { cookie })).status, 404);
});

test('an old log with no documents replays, and GET docs answers an empty list', async (t) => {
  const { read, ana } = await setup(t);
  const state = emptyState();
  applyEvent(state, { type: 'rep.created', id: 'r_1', handle: 'ana', email: 'ana@equipo.test', name: 'Ana', t: '2026-10-01T12:00:00Z' });
  assert.equal(state.docs.size, 0);
  assert.deepEqual((await read(ana.cookie)).json, { ok: true, groups: [] });
});

test('replay ignores a document event that does not hold: a bad url, an unknown group, an update to nothing', () => {
  const state = emptyState();
  const base = { title: { es: 'Ejemplo' }, note: {}, group: 'vender', lang: 'both', step: null, order: 0, t: '2026-11-20T12:00:00Z' };
  applyEvent(state, { type: 'doc.added', id: 'd_bad0000001', ...base, url: 'javascript:alert(1)' });
  applyEvent(state, { type: 'doc.added', id: 'd_bad0000002', ...base, url: 'https://example.com/x', group: 'otro' });
  applyEvent(state, { type: 'doc.updated', id: 'd_nothing0001', patch: { group: 'sitio' } });
  applyEvent(state, { type: 'doc.removed', id: 'd_nothing0001' });
  assert.equal(state.docs.size, 0);
  applyEvent(state, { type: 'doc.added', id: 'd_good000001', ...base, url: 'https://example.com/x' });
  applyEvent(state, { type: 'doc.updated', id: 'd_good000001', patch: { url: 'http://example.com/x' } });   // a bad patch changes nothing
  assert.equal(state.docs.get('d_good000001').url, 'https://example.com/x');
  applyEvent(state, { type: 'doc.updated', id: 'd_good000001', patch: { step: 'pitch', order: 4 } });
  assert.deepEqual([state.docs.get('d_good000001').step, state.docs.get('d_good000001').order], ['pitch', 4]);
});
