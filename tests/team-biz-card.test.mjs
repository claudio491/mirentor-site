// Each business has a card: what the CRM knows, the history of contacts by anyone, its route. Its holder moves the next
// step and lets it go; a manager releases it or gives it to another rep; a leader reads it and writes nothing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody } from './team-helper.mjs';

const API = '/equipo/api';
const B = { bearer: 'push-token' };
const LEADS = [
  { id: 'PA-0001', company: 'Taller Uno', city: 'Panama City', zone: 'Centro', stage: 'New', contact: 'Ana Ruiz', title: 'Dueña', phone: '+507 6000-0000', email: 'ana@ejemplo.test',
    address: 'Calle 50, local 3', maps: 'https://maps.app.goo.gl/abc', website: 'https://taller.ejemplo.test', industry: 'Talleres', category: 'Mecánica', type: 'Taller', rating: 4.5, reviews: 120, walkin: 8, workers: 12, notes: 'Abre a las 8' },
  { id: 'PA-0002', company: 'Taller Colón', city: 'Colón', zone: 'Centro', stage: 'New' },
  { id: 'PA-0003', company: 'Taller Tres', city: 'Panama City', zone: 'Centro', stage: 'New' },
];

async function team(t) {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), mario = await s.addRep(a.cookie, 'mario'), jose = await s.addRep(a.cookie, 'jose');
  const cata = await s.addRep(a.cookie, 'cata', { city: 'Colón' }), lia = await s.addRep(a.cookie, 'lia', { role: 'leader' });
  assert.equal((await s.call('PUT', `${API}/leads`, LEADS, B)).status, 200);
  const log = (who, id, over = {}) => s.call('POST', `${API}/log`, logBody(id, { lead: { id: 'PA-0001' }, channel: 'visit', ...over }), { cookie: who.cookie });
  const card = async (who, id = 'PA-0001') => s.call('GET', `${API}/biz/${id}`, undefined, { cookie: who.cookie });
  const write = (who, body, id = 'PA-0001') => s.call('POST', `${API}/biz/${id}`, body, { cookie: who.cookie });
  return { s, a, mario, jose, cata, lia, log, card, write };
}

test('a rep of the city reads the card: the CRM\'s facts and the history of contacts by anyone, newest first', async (t) => {
  const { mario, jose, log, card } = await team(t);
  await log(mario, 'card-log-0001', { next: { day: '2026-11-18', step: 'Llamar' } });
  await log(jose, 'card-log-0002', { kind: 'call', channel: 'call', note: 'Pidió volver', clientAt: new Date(Date.parse('2026-11-16T16:00:00Z')).toISOString() });
  const r = await card(mario);
  assert.equal(r.status, 200, r.text);
  const b = r.json.biz;
  assert.deepEqual(Object.keys(b).sort(), ['address', 'can', 'category', 'city', 'contact', 'email', 'free', 'history', 'id', 'industry', 'known', 'lastDay', 'lastKind', 'lost', 'maps', 'name', 'next', 'notes',
    'owner', 'phone', 'q', 'qual', 'rating', 'reviews', 'route', 'stage', 'title', 'type', 'walkin', 'website', 'workers', 'zone']);
  assert.deepEqual([b.contact, b.title, b.phone, b.email, b.address, b.maps, b.website, b.rating, b.reviews, b.notes, b.q, b.route], ['Ana Ruiz', 'Dueña', '+507 6000-0000', 'ana@ejemplo.test', 'Calle 50, local 3',
    'https://maps.app.goo.gl/abc', 'https://taller.ejemplo.test', 4.5, 120, 'Abre a las 8', null, null]);
  assert.deepEqual([b.owner, b.next, b.can], [{ name: 'mario', mine: true }, { day: '2026-11-18', step: 'Llamar' }, { next: true, release: true, assign: false }]);
  assert.equal(b.history.length, 2);
  assert.deepEqual(b.history.map((h) => [h.who, h.mine, h.kind]), [['jose', false, 'call'], ['mario', true, 'talk']]);
  assert.deepEqual(Object.keys(b.history[0]).sort(), ['channel', 'crm', 'day', 'kind', 'mine', 'note', 'tag', 'who']);
  assert.deepEqual([b.history[0].day, b.history[0].note, b.history[0].crm], ['2026-11-16', 'Pidió volver', false]);
  const theirs = (await card(jose)).json.biz;
  assert.deepEqual([theirs.history[1].mine, theirs.can, theirs.owner], [false, { next: false, release: false, assign: false }, { name: 'mario', mine: false }]);
});

test('a rep of another city, or a real rep on a practice business, is told it does not exist', async (t) => {
  const { s, a, mario, cata, card } = await team(t);
  for (const [who, id] of [[mario, 'PA-0002'], [cata, 'PA-0001'], [mario, 'PA-9999']]) {
    const r = await card(who, id);
    assert.deepEqual([r.status, r.json.error], [404, 'not_found'], id);
  }
  assert.equal((await card(cata, 'PA-0002')).status, 200);
  // the practice rep's business
  await s.call('POST', `${API}/practice`, {}, { cookie: a.cookie });
  const prac = s.lines().find((e) => e.type === 'rep.practice').id;
  const made = await s.call('POST', `${API}/log?as=${prac}`, logBody('prac-log-0001', { lead: { name: 'Taller de Práctica', zone: 'Centro' } }), { cookie: a.cookie });
  assert.equal(made.status, 200, made.text);
  const pid = s.lines().find((e) => e.type === 'practice.lead.added').lead.id;
  assert.deepEqual([(await card(mario, pid)).status, (await card(mario, pid)).json.error], [404, 'not_found']);
  const own = await s.call('GET', `${API}/biz/${pid}?as=${prac}`, undefined, { cookie: a.cookie });
  assert.deepEqual([own.status, own.json.biz.owner.name, own.json.biz.can], [200, 'Vendedor', { next: true, release: true, assign: true }]);
});

test('the holder moves the next step; nobody else does, and a bad one is refused', async (t) => {
  const { s, mario, jose, log, write } = await team(t);
  await log(mario, 'card-log-0001', { next: { day: '2026-11-18', step: 'Llamar' } });
  const ok = await write(mario, { next: { day: '2026-11-20', step: 'Volver' } });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([ok.json.ok, ok.json.biz.next, !!ok.json.me], [true, { day: '2026-11-20', step: 'Volver' }, true]);
  assert.deepEqual(s.lines().at(-1), { ...s.lines().at(-1), type: 'biz.next', lead: 'PA-0001', rep: mario.id, next: { day: '2026-11-20', step: 'Volver' } });
  const cleared = await write(mario, { next: null });
  assert.deepEqual([cleared.status, cleared.json.biz.next], [200, null]);
  const before = s.lines().length;
  for (const [who, body, want] of [[jose, { next: { day: '2026-11-20', step: 'Mío' } }, [403, 'not_yours']], [mario, { next: { day: '2026-11-01', step: 'x' } }, [400, 'next']],
    [mario, { next: { day: '2026-11-20', step: 'x' }, release: true }, [400, 'fields']], [mario, {}, [400, 'fields']], [mario, { release: false }, [400, 'fields']], [mario, { bogus: 1 }, [400, 'fields']]]) {
    const r = await write(who, body);
    assert.deepEqual([r.status, r.json.error], want, JSON.stringify(body));
  }
  assert.equal(s.lines().length, before, 'nothing was appended');
});

test('the holder lets it go; a manager releases it or gives it; reopen brings back a Lost one', async (t) => {
  const { s, a, mario, jose, log, write, card } = await team(t);
  await log(mario, 'card-log-0001', { next: { day: '2026-11-18', step: 'Llamar' } });
  const go = await write(mario, { release: true });
  assert.deepEqual([go.status, go.json.biz.free, go.json.biz.owner], [200, true, null]);
  assert.deepEqual([s.lines().at(-1).type, s.lines().at(-1).owner], ['biz.owner', null]);
  const again = await write(mario, { release: true });
  assert.deepEqual([again.status, again.json.error], [409, 'free']);
  const gave = await write(a, { owner: jose.id });
  assert.deepEqual([gave.status, gave.json.biz.owner], [200, { name: 'jose', mine: false, id: jose.id }]);   // a manager's card names the holder's id (S0)
  assert.equal((await card(jose)).json.biz.owner.mine, true);
  assert.deepEqual([(await write(mario, { owner: mario.id })).json.error, (await write(a, { owner: 'r_nobody' })).json.error], ['manager_only', 'rep']);
  assert.deepEqual([(await write(mario, { release: true })).json.error, (await write(a, { release: true })).status], ['not_yours', 200]);
  // an open business has nothing to reopen; Lost, then opened again
  await log(jose, 'card-log-0002', { lead: { id: 'PA-0003' } });
  assert.deepEqual([(await write(jose, { reopen: true }, 'PA-0003')).status, (await write(jose, { reopen: true }, 'PA-0003')).json.error], [409, 'open']);
  await log(jose, 'card-log-0003', { lead: { id: 'PA-0003' }, kind: 'call', channel: 'call', tag: 'not_interested', lost: 'no_trust' });
  assert.equal((await card(jose, 'PA-0003')).json.biz.stage, 'Lost');
  assert.equal((await write(mario, { reopen: true }, 'PA-0003')).json.error, 'not_yours');
  const open = await write(jose, { reopen: true }, 'PA-0003');
  assert.deepEqual([open.status, open.json.biz.stage, open.json.biz.lost], [200, 'Contacted', null]);
});

test('the history holds 15 contacts at most', async (t) => {
  const { s, mario, card } = await team(t);
  for (let i = 0; i < 20; i += 1) {
    const r = await s.call('POST', `${API}/log`, logBody(`many-log-${String(i).padStart(4, '0')}`, { lead: { id: 'PA-0001' }, kind: 'noanswer', channel: 'call' }), { cookie: mario.cookie });
    assert.equal(r.status, 200, r.text);
    s.time.now += 86400000;
  }
  const h = (await card(mario)).json.biz.history;
  assert.deepEqual([h.length, h[0].day > h[14].day], [15, true]);
});

test('a leader searches every city and reads any card, and writes nothing', async (t) => {
  const { s, mario, lia, log, card, write } = await team(t);
  await log(mario, 'card-log-0001');
  const found = await s.call('GET', `${API}/leads?q=taller`, undefined, { cookie: lia.cookie });
  assert.equal(found.status, 200, found.text);
  assert.deepEqual(found.json.leads.map((l) => l.id).sort(), ['PA-0001', 'PA-0002', 'PA-0003']);
  const r = await card(lia, 'PA-0002');
  assert.deepEqual([r.status, r.json.biz.can], [200, { next: false, release: false, assign: false }]);
  assert.deepEqual((await card(lia)).json.biz.can, { next: false, release: false, assign: false });
  const before = s.lines().length;
  const no = await write(lia, { release: true });
  assert.deepEqual([no.status, no.json.error], [403, 'read_only']);
  assert.equal(s.lines().length, before);
});

test('a manager\'s card knows its holder by id; a rep\'s and a leader\'s never do', async (t) => {
  const { a, mario, jose, lia, log, card } = await team(t);
  await log(mario, 'card-log-0001');
  const boss = (await card(a)).json.biz;
  assert.deepEqual(boss.owner, { name: 'mario', mine: false, id: mario.id });
  for (const who of [mario, jose, lia]) {
    const b = (await card(who)).json.biz;
    assert.equal('id' in b.owner, false, who.cookie);
  }
  // free: no owner at all, for anyone
  assert.equal((await card(a, 'PA-0003')).json.biz.owner, null);
});
