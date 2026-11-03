import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetsClient } from '../lib/sheets.mjs';
import { syncOne } from '../lib/sync.mjs';
import { fakeGoogle, fakeServiceAccount } from './fakes.mjs';

const SA = fakeServiceAccount();
const entry = { id: 'x', leadId: 'WL-AAAA1111', submittedAt: '2026-11-03T17:00:00.000Z', lang: 'es', business: 'Almacenes', workers: 120,
  industry: 'warehouse', city: 'Panama City', country: 'PA', contact: 'Ana', email: 'a@b.co', whatsapp: '', payAck: true };
const memStore = () => { const m = {}; return { markSynced: (id, row) => { m[id] = row; }, m }; };

test('a new entry writes A:P and Y on the next empty row and reads it back', async () => {
  const g = fakeGoogle();
  const store = memStore();
  const row = await syncOne(store, sheetsClient({ sa: SA, sheetId: 'S', fetch: g.fetch }), entry);
  assert.equal(row, 3);
  assert.equal(g.rows[2][0], 'WL-AAAA1111');
  assert.equal(g.rows[2][11], 'Waitlist form');
  assert.equal(g.rows[2][24], 'Pay rule acknowledged on the form.');
  assert.equal(g.rows[2][16], undefined, 'Q stays the formula column');
  assert.equal(store.m.x, 3);
  const write = JSON.parse(g.calls.find((c) => c.path.endsWith('batchUpdate')).body);
  assert.equal(write.valueInputOption, 'RAW');
  assert.deepEqual(write.data.map((d) => d.range), ['Leads!A3:P3', 'Leads!Y3']);
});

test('an entry already in the sheet is found and not written again', async () => {
  const g = fakeGoogle({ rows: [['Lead ID'], ['PA-0001'], ['WL-AAAA1111', 'Almacenes']] });
  const row = await syncOne(memStore(), sheetsClient({ sa: SA, sheetId: 'S', fetch: g.fetch }), entry);
  assert.equal(row, 3);
  assert.equal(g.calls.some((c) => c.path.endsWith('batchUpdate')), false);
});

test('a read-back that does not match throws', async () => {
  const g = fakeGoogle({ tamper: true });
  await assert.rejects(syncOne(memStore(), sheetsClient({ sa: SA, sheetId: 'S', fetch: g.fetch }), entry), /read-back/);
});

test('Google down throws and marks nothing', async () => {
  const store = memStore();
  await assert.rejects(syncOne(store, sheetsClient({ sa: SA, sheetId: 'S', fetch: fakeGoogle({ down: true }).fetch }), entry));
  assert.deepEqual(store.m, {});
});

test('the access token is fetched once and reused', async () => {
  const g = fakeGoogle();
  const c = sheetsClient({ sa: SA, sheetId: 'S', fetch: g.fetch });
  await c.nextRow();
  await c.nextRow();
  assert.equal(g.calls.filter((x) => x.path === '/token').length, 1);
});
