// install-steps.js: what the install screens decide on the phone, away from the page so it can be tested.
// Which step of a worker is open, whether the Hoy card shows, how the list is ordered and what a worker looks like
// after a consent upload that did not reach the server. The server stays the judge: these only shape the screen.

/** IMEI: 15 digits, the last one a Luhn check digit. Spaces and dashes typed or scanned with it are dropped.
 *  The same rule as lib/team/install.mjs, so the screen refuses what the server would. */
export function cleanImei(input) {
  if (typeof input !== 'string') return null;
  const d = input.replace(/[\s-]/g, '');
  if (!/^\d{15}$/.test(d)) return null;
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    let n = Number(d[14 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0 ? d : null;
}

/** A worker's steps in order: the signed consent, the phone they receive, the test clip. A step opens only once the one
 *  before it is done: without a consent on file the phone step stays shut. A coworker who gets no phone has one step. */
export function workerSteps(w) {
  const consent = !!w.consent, phone = consent && !!w.imei;
  const steps = [{ key: 'consent', open: true, done: consent }];
  if (w.phone === false) return steps;
  steps.push({ key: 'phone', open: consent, done: phone }, { key: 'clip', open: phone, done: phone && !!w.clip });
  return steps;
}

/** The Hoy card for one of `me.installs`, or null. It needs the phones marked; a practice site reports `practice` at any
 *  stage, so its workers say whether it starts or continues. A closed or installed site has nothing left to do here. */
export function installCard(inst) {
  if (!inst || inst.phones == null) return null;
  const open = inst.practice || inst.state === 'ready_to_install' || inst.state === 'installing';
  if (!open) return null;
  return { id: inst.id, kind: inst.total > 0 ? 'continue' : 'start', practice: !!inst.practice, ready: inst.ready, total: inst.total, phones: inst.phones };
}

/** "Antes de grabar": the signs are up, the no-recording zones are marked, the site's coordinator is on file. */
export function prepRows(site) {
  const prep = (site && site.prep) || {};
  return [{ key: 'signs', done: !!prep.signs }, { key: 'zones', done: !!prep.zones }, { key: 'coordinator', done: !!(site && site.coordinator && site.coordinator.name) }];
}

const DONE = new Set(['ready', 'consent_only']);
/** Who is done comes first; who still needs something sits last, next to the button that adds the next person.
 *  Inside each group the order is the order they were added in, so a row only moves when its state changes. */
export function workerOrder(workers) {
  return [...workers.filter((w) => DONE.has(w.status)), ...workers.filter((w) => !DONE.has(w.status))];
}
export const isDone = (status) => DONE.has(status);

/** The words of a worker's state, as an i18n key. */
export const statusKey = (status) => `install.st.${status}`;

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
/** A worker's id, made on the phone before anything is sent: `w_` and 12 characters. Sending it again after a bad
 *  connection is the same worker, never a second one. `rand` is for tests; the phone uses its own random source. */
export function newWorkerId(rand = null) {
  let out = 'w_';
  if (rand) { for (let i = 0; i < 12; i += 1) out += CHARS[Math.floor(rand() * CHARS.length) % CHARS.length]; return out; }
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(12));
  for (const b of bytes) out += CHARS[b % CHARS.length];
  return out;
}

/** The worker after a consent upload that failed: still "Falta firma" (or whatever they were, if a consent was already on
 *  file), the same id kept for the retry, and the phone step still locked by the missing consent. */
export function consentFailed(w) {
  return { ...w, status: w.consent ? w.status : 'no_consent', retry: true };
}
