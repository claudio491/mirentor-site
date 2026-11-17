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
import { openTeamStore } from '../lib/team/store.mjs';

const run = promisify(execFile);
const TOOL = fileURLToPath(new URL('../tools/team-admin.mjs', import.meta.url));
const TOKEN = 'tok-for-this-test-only';

test('team-admin makes the first manager from their work email, says where they sign in and never prints the token', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'team-tools-'));
  const team = createTeam({ dir, base: '/ventas/equipo', identify: () => null, domain: 'equipo.test', pushToken: TOKEN, dev: true });
  const srv = createServer({ store: openStore(dir), sheets: null, origins: [], team });
  await new Promise((r) => srv.listen(0, r)); t.after(() => srv.close());
  const base = `http://127.0.0.1:${srv.address().port}`;
  const env = (token) => ({ ...process.env, TEAM_PUSH_TOKEN: token, DESK_PUSH_TOKEN: '' });

  const ok = await run(process.execPath, [TOOL, `${base}/`, 'Jefe@Equipo.Test', 'Jefe', 'Uno'], { env: env(TOKEN) });
  assert.match(ok.stdout, /Jefe Uno \(jefe@equipo\.test\)/);
  assert.match(ok.stdout, new RegExp(`${base}/ventas/equipo/`));
  assert.equal(`${ok.stdout}${ok.stderr}`.includes(TOKEN), false);
  assert.deepEqual([...openTeamStore(dir).state.reps.values()].map((r) => [r.email, r.name, r.role]), [['jefe@equipo.test', 'Jefe Uno', 'admin']]);

  // the team has its admin: the token alone cannot make another, and the tool says how to open that door
  await assert.rejects(run(process.execPath, [TOOL, base, 'otro@equipo.test', 'Otro', 'Admin'], { env: env(TOKEN) }), (e) => e.code === 1 && /409/.test(e.stderr) && /TEAM_BOOTSTRAP/.test(e.stderr));
  await assert.rejects(run(process.execPath, [TOOL, base, 'otro@equipo.test', 'Otro'], { env: env('not-the-token') }), (e) => e.code === 1 && /401/.test(e.stderr) && !e.stderr.includes('not-the-token'));
  await assert.rejects(run(process.execPath, [TOOL, base, 'otro@equipo.test', 'Otro'], { env: env('') }), (e) => e.code === 1 && /TEAM_PUSH_TOKEN/.test(e.stderr));
  await assert.rejects(run(process.execPath, [TOOL, base], { env: env(TOKEN) }), (e) => e.code === 1 && /usage/.test(e.stderr));
});
