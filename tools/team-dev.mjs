// team-dev.mjs: run the sales team platform on this machine with sample data, to look at it.
//   node tools/team-dev.mjs [port] [data-dir]
// It seeds the folder the first time, gives the sample people a new PIN on every start (printed here, kept nowhere),
// signs sessions with a key made for this run only, and rereads the client files on every request.
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from '../server.mjs';
import { openStore } from '../lib/store.mjs';
import { createTeam } from '../lib/team/api.mjs';
import { seed, resetSamplePins, SAMPLE_REPS } from './team-seed.mjs';

const port = Number(process.argv[2] || 8772);
const dir = path.resolve(process.argv[3] || fileURLToPath(new URL('../data-sample', import.meta.url)));
const pin = existsSync(path.join(dir, 'team', 'events.jsonl')) ? resetSamplePins(dir) : seed(dir).pin;
const team = createTeam({ dir, secret: randomBytes(32).toString('hex'), pushToken: randomBytes(24).toString('hex'), dev: true });
createServer({ store: openStore(dir), sheets: null, origins: [], team }).listen(port, '127.0.0.1', () => {
  console.log(`team platform, sample data, at http://localhost:${port}/equipo`);
  console.log(`sample people: ${SAMPLE_REPS.map((r) => `${r.handle} (${r.role})`).join(', ')}`);
  console.log(`PIN for this run: ${pin}`);
});
