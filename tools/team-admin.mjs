// team-admin.mjs: make the first admin of the sales team's board, from their work email.
//   TEAM_PUSH_TOKEN=... node tools/team-admin.mjs <service-url> <email> "<full name>" [--role leader]
//   Example: node tools/team-admin.mjs https://mirentor-waitlist.onrender.com nombre@mirentor.com "Nombre Apellido"
// The token is read from the environment (TEAM_PUSH_TOKEN, or DESK_PUSH_TOKEN) and is never printed.
// There is no password and no link to hand over: that person opens the board and signs in with that Google account.
// Once the team has an admin the service refuses to make another this way; TEAM_BOOTSTRAP=1 on the service opens it again.
// With --role leader the person is a leader instead: they read every city and change nothing, and the service adds one at any time.
const args = process.argv.slice(2);
const at = args.indexOf('--role');
const role = at < 0 ? 'admin' : args[at + 1];
if (at >= 0) args.splice(at, 2);
const [base, email, ...rest] = args;
const name = rest.join(' ').trim();
const token = process.env.TEAM_PUSH_TOKEN || process.env.DESK_PUSH_TOKEN;

if (!base || !email || !name || !['admin', 'leader'].includes(role)) { console.error('usage: node tools/team-admin.mjs <service-url> <email> "<full name>" [--role leader]'); process.exit(1); }
if (!token) { console.error('Set TEAM_PUSH_TOKEN (or DESK_PUSH_TOKEN) in the environment first.'); process.exit(1); }

const board = `${base.replace(/\/+$/, '')}/ventas/equipo`;
const WHY = {
  bootstrap_closed: 'The team already has an admin, who adds everyone else inside the board. To make another one from here, set TEAM_BOOTSTRAP=1 on the service and run this again.',
  email_domain: 'That address is not on the company domain.',
  email_taken: 'That address already belongs to someone on the team with another role.',
  fields: 'The email or the name cannot be used as written.',
  token: 'The service did not accept the token.',
};
try {
  const res = await fetch(`${board}/api/bootstrap`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` }, body: JSON.stringify({ email, name, role }) });
  const data = await res.json().catch(() => null);
  if (!res.ok || !data || !data.id) { console.error(`The service answered ${res.status}${data && data.error ? ` (${data.error})` : ''}. ${(data && WHY[data.error]) || ''}`.trim()); process.exit(1); }
  console.log(`${name} (${data.email}) is ${role === 'leader' ? 'a leader' : 'an admin'} of the board.`);
  console.log(`They open ${board}/ and sign in with that Google account. On the public site the same board is at /ventas/equipo/.`);
} catch (err) { console.error(`Could not reach ${board}: ${err.message}`); process.exit(1); }
