// Test-only fakes: a Google Sheets API stand-in that keeps the Leads tab in memory.
import { generateKeyPairSync } from 'node:crypto';

export function fakeServiceAccount() {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { client_email: 'waitlist@test.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) };
}

/** rows[0] is the header; rows[i] is sheet row i + 1. */
export function fakeGoogle({ rows = [['Lead ID'], ['PA-0001', 'Acme']], down = false, tamper = false } = {}) {
  const calls = [];
  const res = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({ method: init.method || 'GET', path: decodeURIComponent(u.pathname), body: init.body });
    if (down) return res(503, { error: 'down' });
    if (u.host === 'oauth2.googleapis.com') return res(200, { access_token: 'tok', expires_in: 3600 });
    if ((init.headers?.authorization || '') !== 'Bearer tok') return res(401, {});
    const path = decodeURIComponent(u.pathname);
    if (path.endsWith('/values/Leads!A:A')) return res(200, { values: rows.map((r) => [r[0] ?? '']) });
    const one = path.match(/\/values\/Leads!A(\d+):Y\1$/);
    if (one) return res(200, { values: [rows[one[1] - 1] ?? []] });
    if (path.endsWith('/values:batchUpdate')) {
      for (const d of JSON.parse(init.body).data) {
        const [, col, r] = d.range.match(/^Leads!([A-Z])(\d+)/);
        const row = (rows[r - 1] ||= []);
        d.values[0].forEach((v, i) => { row[col.charCodeAt(0) - 65 + i] = tamper && i === 1 ? 'X' : v; });
      }
      return res(200, {});
    }
    return res(404, {});
  };
  return { fetch, calls, rows };
}
