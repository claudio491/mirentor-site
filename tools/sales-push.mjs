// Uploads the built sales portal to the service disk: node tools/sales-push.mjs <dir> <base-url>
// Example: node tools/sales-push.mjs ~/portal https://mirentor-waitlist.onrender.com/ventas
// Token: DESK_PUSH_TOKEN from the environment (local copy in ~/.config/mirentor/desk.env).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

const [dir, base] = process.argv.slice(2);
const token = process.env.DESK_PUSH_TOKEN;
if (!dir || !base || !token) { console.error('usage: DESK_PUSH_TOKEN=... node tools/sales-push.mjs <dir> <base-url>'); process.exit(1); }
const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); return statSync(p).isDirectory() ? walk(p) : [p]; });
let failed = 0;
for (const f of walk(dir)) {
  const rel = path.relative(dir, f).split(path.sep).join('/');
  const r = await fetch(`${base}/_files/${rel}`, { method: 'PUT', headers: { authorization: `Bearer ${token}` }, body: readFileSync(f) });
  console.log(`${r.status} ${rel}`);
  if (!r.ok) failed++;
}
process.exit(failed ? 1 : 0);
