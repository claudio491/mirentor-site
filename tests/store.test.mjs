import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openStore } from '../lib/store.mjs';

const dir = () => mkdtempSync(path.join(tmpdir(), 'wl-'));
const e = (id) => ({ id, leadId: `WL-${id}`, business: 'B' });

test('an entry put once is pending until marked synced, across a reopen', () => {
  const d = dir();
  const s = openStore(d);
  s.put(e('a'));
  s.put(e('b'));
  s.markSynced('a', 7);
  const again = openStore(d);
  assert.equal(again.get('a').row, 7);
  assert.deepEqual(again.pending().map((x) => x.id), ['b']);
});

test('putting a known id keeps the first entry', () => {
  const s = openStore(dir());
  s.put(e('a'));
  s.put({ ...e('a'), business: 'other' });
  assert.equal(s.get('a').business, 'B');
});
