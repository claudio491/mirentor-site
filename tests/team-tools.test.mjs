import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createTeam } from '../lib/team/api.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/team-admin.mjs', import.meta.url));
const TOKEN = 'tok-for-this-test-only';

test('team-admin creates the first manager, prints only the one-time link and never the token', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-tools-'));
  const team = createTeam({ dir, secret: 'test-secret', pushToken: TOKEN, dev: true });
  const srv = createServer({ store: openStore(dir), sheets: null, origins: [], team });
  await new Promise((r) => srv.listen(0, r)); t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const env = (token) => ({ ...process.env, TEAM_PUSH_TOKEN: token, DESK_PUSH_TOKEN: '' });

  const ok = await run(process.execPath, [TOOL, `${base}/`, 'Jefe', 'Jefe', 'Uno'], { env: env(TOKEN) });
  assert.match(ok.stdout.trim(), /^http:\/\/127\.0\.0\.1:\d+\/equipo\/alta\?t=[\w-]{32,}$/);
  assert.equal(`${ok.stdout}${ok.stderr}`.includes(TOKEN), false);
  // the link works: the manager sets a PIN and is an admin
  const token = new URL(ok.stdout.trim()).searchParams.get('t');
  const set = await fetch(`${base}/equipo/api/setup`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, pin: '482915' }) });
  assert.deepEqual([set.status, (await set.json()).role], [200, 'admin']);

  await assert.rejects(run(process.execPath, [TOOL, base, 'otro', 'Otro'], { env: env('not-the-token') }), (e) => e.code === 1 && /401/.test(e.stderr) && !e.stderr.includes('not-the-token'));
  await assert.rejects(run(process.execPath, [TOOL, base, 'otro', 'Otro'], { env: env('') }), (e) => e.code === 1 && /TEAM_PUSH_TOKEN/.test(e.stderr));
  await assert.rejects(run(process.execPath, [TOOL, base], { env: env(TOKEN) }), (e) => e.code === 1 && /usage/.test(e.stderr));
});
