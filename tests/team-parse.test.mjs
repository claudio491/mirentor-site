// Every module of the client parses: a page whose module fails to parse shows nothing at all, and the other tests read
// most of the client as text, so they would not see it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

test('every module under team/ parses', () => {
  const dir = fileURLToPath(new URL('../team/', import.meta.url));
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.js'))) {
    assert.doesNotThrow(() => execFileSync(process.execPath, ['--check', `${dir}${f}`], { stdio: 'pipe' }), f);
  }
});
