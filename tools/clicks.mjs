// clicks.mjs: who opened the site from a link we emailed. Reads the backend's visit list (GET /api/visits, bearer token)
// and the links files we sent (outreach/*-links-*.csv: Code column), then prints one line per visit with the company,
// Panama time, country, device and how the visit counted. "interact" means the visitor scrolled, tapped or typed;
// "timer" means the page stayed open 5 s. A timer visit from outside the lead's country is most likely a mail
// security scanner opening the link, not a person, and is marked so.
//
//   node tools/clicks.mjs [links folder, default PRENTIS.AI/outreach]
// Token: VISITS_TOKEN, else DESK_PUSH_TOKEN from ~/.config/mirentor/desk.env. API: VISITS_API or the live backend.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

const PANAMA_OFFSET_H = -5; // Panama keeps UTC-5 all year

function splitCsv(line) {
  const out = []; let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** A links CSV (header with Lead ID, Company, Contact, Email, Code) as a Map from code to lead. */
export function parseLinks(csv) {
  const [head, ...lines] = csv.trim().split('\n');
  const h = splitCsv(head);
  const col = (name) => h.indexOf(name);
  const map = new Map();
  for (const line of lines) {
    const f = splitCsv(line);
    map.set(f[col('Code')], { lead: f[col('Lead ID')], company: f[col('Company')], contact: f[col('Contact')], email: f[col('Email')] });
  }
  return map;
}

const device = (ua = '') => (/iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android'
  : /Windows/.test(ua) ? 'Windows' : /Mac OS X|Macintosh/.test(ua) ? 'Mac' : /Linux|X11/.test(ua) ? 'Linux' : 'Other');

const panamaTime = (iso) => new Date(Date.parse(iso) + PANAMA_OFFSET_H * 3600e3).toISOString().slice(0, 16).replace('T', ' ');

/** One row per visit, oldest first. */
export function report(visits, links) {
  return [...visits].sort((a, b) => a.at.localeCompare(b.at)).map((v) => {
    const l = links.get(v.c);
    const home = l && /^([A-Z]{2})-/.test(l.lead) ? l.lead.slice(0, 2) : null;
    return {
      code: v.c, lead: l?.lead || '', company: l ? l.company : `(unknown code ${v.c})`, contact: l?.contact || '',
      time: panamaTime(v.at), country: v.country || '?', device: device(v.ua), how: v.how, page: v.page,
      likelyScanner: !!home && v.how === 'timer' && v.country !== home,
    };
  });
}

async function main() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const dir = path.resolve(process.argv[2] || path.join(here, '../../../../outreach'));
  const links = new Map();
  for (const f of fs.readdirSync(dir).filter((n) => /-links-.*\.csv$/.test(n))) for (const [k, v] of parseLinks(fs.readFileSync(path.join(dir, f), 'utf8'))) links.set(k, v);
  let token = process.env.VISITS_TOKEN;
  if (!token) {
    const env = fs.readFileSync(path.join(os.homedir(), '.config/mirentor/desk.env'), 'utf8');
    token = (env.match(/^DESK_PUSH_TOKEN=(.*)$/m) || [])[1]?.trim();
  }
  const api = process.env.VISITS_API || 'https://mirentor-waitlist.onrender.com/api/visits';
  const r = await fetch(api, { headers: { authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`${api} answered ${r.status}`);
  const rows = report((await r.json()).visits, links);
  console.log(`${links.size} coded links, ${rows.length} visits (${rows.filter((x) => !x.likelyScanner).length} likely people)`);
  for (const x of rows) console.log([x.time, x.lead || '-', x.company, x.country, x.device, x.how, x.page, x.likelyScanner ? 'likely scanner' : ''].join(' | '));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e.message); process.exit(1); });
