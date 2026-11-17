// team-admin.mjs: create the first manager of the sales team platform, or give them a way back in after a lost PIN.
//   TEAM_PUSH_TOKEN=... node tools/team-admin.mjs <base-url> <handle> "<full name>"
// The token is read from the environment (TEAM_PUSH_TOKEN, or DESK_PUSH_TOKEN) and is never printed.
// The only thing printed is the one-time link: the manager opens it and chooses their own PIN.
const [base, handle, ...rest] = process.argv.slice(2);
const name = rest.join(' ').trim();
const token = process.env.TEAM_PUSH_TOKEN || process.env.DESK_PUSH_TOKEN;

if (!base || !handle || !name) { console.error('usage: node tools/team-admin.mjs <base-url> <handle> "<full name>"'); process.exit(1); }
if (!token) { console.error('Set TEAM_PUSH_TOKEN (or DESK_PUSH_TOKEN) in the environment first.'); process.exit(1); }

const url = `${base.replace(/\/$/, '')}/equipo/api/bootstrap`;
try {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ handle: handle.toLowerCase(), name }) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.setupUrl) { console.error(`The service answered ${res.status}${data && data.error ? ` (${data.error})` : ''}.`); process.exit(1); }
  console.log(data.setupUrl);
} catch (err) { console.error(`Could not reach ${url}: ${err.message}`); process.exit(1); }
