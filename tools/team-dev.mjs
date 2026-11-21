// team-dev.mjs: run the sales team's board on this machine, to look at it.
//   node tools/team-dev.mjs [port] [--now] [--day=1..7] [--sample]
// With a roster file (data-sample/team.json, which git ignores; see tools/team-roster.mjs) it shows the actual team:
// their names and photos, the real time, and no activity, because nothing is made up. --sample forces the fictional
// sample below even when the roster file is there.
// Each start writes a fresh sample folder in the system's temp directory, with fictional people and businesses, and
// a practice site for the rep andrea with three placeholder workers, to look at the install screens.
// The preview clock starts on the Thursday of this week at 3:00 pm in Panama, so the week on screen is half lived:
// full days, gaps, things waiting for the manager. --day=5 moves it to that day of the week (1 is Monday), for example
// to see the Friday when next week's goal can be picked. Pass --now to use the real time instead.
// Nobody signs in here: the address lists the people and you choose who to be (see tools/team-preview.mjs).
import http from 'node:http';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { weekStart, addDays, localDay } from '../lib/team/rules.mjs';
import { seed, at } from './team-seed.mjs';
import { seedRoster, readRoster } from './team-roster.mjs';
import { previewApp, BASE } from './team-preview.mjs';

const rosterFile = fileURLToPath(new URL('../data-sample/team.json', import.meta.url));
const roster = !process.argv.includes('--sample') && existsSync(rosterFile) ? readRoster(rosterFile) : null;
const port = Number(process.argv[2] || 8772), real = process.argv.includes('--now') || !!roster;   // real people live in real time
const dayArg = Number((process.argv.find((a) => a.startsWith('--day=')) || '').slice(6)), weekday = dayArg >= 1 && dayArg <= 7 ? dayArg : 4;
const moment = at(addDays(weekStart(localDay(new Date().toISOString(), 'America/Panama')), weekday - 1), '15:00');
const offset = real ? 0 : Date.parse(moment) - Date.now();
const clock = () => new Date(Date.now() + offset);
const dir = mkdtempSync(path.join(tmpdir(), 'cancha-sample-'));
const started = roster ? seedRoster(dir, { now: clock(), ...roster }) : seed(dir, { now: clock(), practice: true });
const app = previewApp({ dir, now: clock, previewOffsetMs: offset });

http.createServer(app.listener).listen(port, '127.0.0.1', () => {
  console.log(`team board, ${roster ? 'the team in data-sample/team.json, no activity' : 'sample data'}, at http://localhost:${port}${BASE}/`);
  for (const s of (roster && started.skipped) || []) console.log(`left out for ${s.handle}: ${s.why}`);
  console.log(`preview clock: ${clock().toISOString()}${real ? '' : ` (3:00 pm in Panama on day ${weekday} of this week, 1 is Monday; --now uses the real time)`}`);
  console.log(`people: ${app.people().map((r) => `${r.handle} (${r.role})`).join(', ')}`);
  console.log(`nobody signs in on this machine: open the address and choose who to be, or go straight to http://localhost:${port}/dev/como?h=<handle>`);
});
