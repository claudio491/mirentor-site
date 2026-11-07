// ref.mjs: the email code for a lead. The same lead ID always gives the same six characters (a hash, nothing stored),
// so any report can map a visit code back to its lead from the lead IDs alone. The link puts it before the anchor:
// https://www.mirentor.com/?c=<code>#lista-de-espera. The site keeps it for the form and sends one visit beacon.
import { createHash } from 'node:crypto';

const ABC = 'abcdefghijklmnopqrstuvwxyz234567';
const SITE = 'https://www.mirentor.com/';

export function refCode(leadId) {
  const h = createHash('sha256').update(`mirentor-email-code:${String(leadId).trim().toUpperCase()}`).digest();
  let bits = 0, n = 0, out = '';
  for (const byte of h) {
    bits = (bits << 8) | byte; n += 8;
    while (n >= 5 && out.length < 6) { out += ABC[(bits >> (n - 5)) & 31]; n -= 5; }
    if (out.length === 6) break;
  }
  return out;
}

export const refLink = (leadId) => `${SITE}?c=${refCode(leadId)}#lista-de-espera`;
