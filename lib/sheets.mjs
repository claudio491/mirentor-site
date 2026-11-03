// sheets.mjs: the few Sheets API calls the waitlist needs, signed as a service account (RS256 JWT, no libraries).
import { createSign } from 'node:crypto';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const b64 = (v) => Buffer.from(typeof v === 'string' ? v : JSON.stringify(v)).toString('base64url');

export function sheetsClient({ sa, sheetId, fetch = globalThis.fetch, tab = 'Leads' }) {
  let token = null;
  let expires = 0;

  async function auth() {
    if (token && Date.now() < expires - 60_000) return token;
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(sa.private_key, 'base64url');
    const r = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${sig}` }),
    });
    if (!r.ok) throw new Error(`Google token ${r.status}`);
    const j = await r.json();
    token = j.access_token;
    expires = Date.now() + j.expires_in * 1000;
    return token;
  }

  async function call(suffix, init = {}) {
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values${suffix}`;
    const r = await fetch(url, { ...init, headers: { ...init.headers, authorization: `Bearer ${await auth()}` } });
    if (!r.ok) throw new Error(`Sheets ${r.status} on ${suffix.split('?')[0]}`);
    return r.json();
  }

  const column = async () => ((await call(`/${tab}!A:A`)).values || []).map((r) => r[0] ?? '');

  return {
    async findLead(leadId) {
      const i = (await column()).indexOf(leadId);
      return i < 0 ? null : i + 1;
    },
    async nextRow() {
      const ids = await column();
      let last = ids.length;
      while (last > 1 && !ids[last - 1]) last -= 1;
      return last + 1;
    },
    async writeRow(row, aToP, notes) {
      await call(':batchUpdate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ valueInputOption: 'RAW', data: [
          { range: `${tab}!A${row}:P${row}`, values: [aToP] },
          { range: `${tab}!Y${row}`, values: [[notes]] },
        ] }),
      });
    },
    async readRow(row) {
      return ((await call(`/${tab}!A${row}:Y${row}`)).values || [[]])[0] || [];
    },
  };
}
