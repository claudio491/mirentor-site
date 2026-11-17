// auth.mjs: six-digit PINs kept as scrypt hashes, one-time setup tokens, signed session cookies and a lockout.
// Nothing here ever logs or returns a PIN or a token hash's preimage.
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const SCRYPT = { N: 16384, r: 8, p: 1 };
const TRIVIAL = new Set(['123456', '654321', '012345', '543210', '123123', '112233']);
const SESSION_S = 30 * 24 * 3600;
const LOCK_MS = 15 * 60 * 1000, LOCK_TRIES = 5;

export const SETUP_HOURS = 72;
export const sha = (s) => createHash('sha256').update(String(s)).digest('base64url');
const same = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && timingSafeEqual(x, y); };

export const validPin = (pin) => typeof pin === 'string' && /^\d{6}$/.test(pin) && !/^(\d)\1{5}$/.test(pin) && !TRIVIAL.has(pin);

export function hashPin(pin, salt = randomBytes(16).toString('base64url')) {
  return { salt, hash: scryptSync(String(pin), salt, 32, SCRYPT).toString('base64url') };
}
export const checkPin = (pin, salt, hash) => same(hashPin(pin, salt).hash, hash);

export const hashToken = (token) => sha(`mirentor-team-setup|${token}`);
export function newSetupToken() {
  const token = randomBytes(24).toString('base64url');
  return { token, tokenHash: hashToken(token) };
}

/** Session cookies: `<repId>.<pinVersion>.<exp>.<signature>`. A new PIN or a new setup link changes pinVersion and signs the rep out. */
export function sessions(secret, now = () => Date.now()) {
  const key = createHash('sha256').update(`mirentor-team-session|${secret}`).digest();
  const sign = (body) => createHmac('sha256', key).update(body).digest('base64url');
  return {
    maxAge: SESSION_S,
    issue(repId, pinVersion) { const body = `${repId}.${pinVersion}.${Math.floor(now() / 1000) + SESSION_S}`; return `${body}.${sign(body)}`; },
    read(value) {
      const parts = String(value || '').split('.');
      if (parts.length !== 4) return null;
      const [repId, ver, exp, sig] = parts;
      if (!repId || !/^\d+$/.test(ver) || !/^\d+$/.test(exp) || !same(sig, sign(`${repId}.${ver}.${exp}`))) return null;
      if (Number(exp) * 1000 < now()) return null;
      return { repId, pinVersion: Number(ver) };
    },
  };
}

/** Five wrong tries on one handle lock it for 15 minutes. Kept in memory: a restart clears it, which only ever helps the rep. */
export function lockout(now = () => Date.now()) {
  const fails = new Map();
  const recent = (handle) => (fails.get(handle) || []).filter((t) => now() - t < LOCK_MS);
  return {
    fail(handle) { const list = recent(handle); list.push(now()); fails.set(handle, list); },
    blocked: (handle) => recent(handle).length >= LOCK_TRIES,
    clear: (handle) => { fails.delete(handle); },
  };
}
