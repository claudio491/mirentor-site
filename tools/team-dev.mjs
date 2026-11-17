// team-dev.mjs: run the sales team platform on this machine with sample data, to look at it.
//   node tools/team-dev.mjs [port] [--now] [--day=1..7]
// Each start writes a fresh sample folder in the system's temp directory, with fictional people and businesses.
// The preview clock starts on the Thursday of this week at 3:00 pm in Panama, so the week on screen is half lived:
// full days, gaps, things waiting for the manager. --day=5 moves it to that day of the week (1 is Monday), for example
// to see the Friday when next week's goal can be picked. Pass --now to use the real time instead.
// The PIN for the sample people is made on every start and printed here; it is kept nowhere else.
import { randomBytes } from 'node:crypto';
import http from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createTeam } from '../lib/team/api.mjs';
import { weekStart, addDays, localDay } from '../lib/team/rules.mjs';
import { seed, at, SAMPLE_REPS } from './team-seed.mjs';

const port = Number(process.argv[2] || 8772), real = process.argv.includes('--now');
const dayArg = Number((process.argv.find((a) => a.startsWith('--day=')) || '').slice(6)), weekday = dayArg >= 1 && dayArg <= 7 ? dayArg : 4;
const moment = at(addDays(weekStart(localDay(new Date().toISOString(), 'America/Panama')), weekday - 1), '15:00');
const offset = real ? 0 : Date.parse(moment) - Date.now();
const clock = () => new Date(Date.now() + offset);
const dir = mkdtempSync(path.join(tmpdir(), 'cancha-sample-'));
const { pin } = seed(dir, { now: clock() });
const team = createTeam({ dir, secret: randomBytes(32).toString('hex'), pushToken: randomBytes(24).toString('hex'), dev: true, now: clock, previewOffsetMs: offset });
const app = createServer({ store: openStore(dir), sheets: null, origins: [], team });
// The preview opens at the root: send it to the app. Everything else goes to the service as it is.
http.createServer((req, res) => { if (req.url === '/') res.writeHead(302, { location: '/equipo' }).end(); else app.emit('request', req, res); }).listen(port, '127.0.0.1', () => {
  console.log(`team platform, sample data, at http://localhost:${port}/equipo`);
  console.log(`preview clock: ${clock().toISOString()}${real ? '' : ` (3:00 pm in Panama on day ${weekday} of this week, 1 is Monday; --now uses the real time)`}`);
  console.log(`sample people: ${SAMPLE_REPS.map((r) => `${r.handle} (${r.role})`).join(', ')}`);
  console.log(`PIN for this run: ${pin}`);
});
