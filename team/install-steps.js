// install-steps.js: what the install screens decide on the phone, away from the page so it can be tested.
// Which step of a worker is open, whether the Hoy card shows, how the list is ordered and what a worker looks like
// after a consent upload that did not reach the server. The server stays the judge: these only shape the screen.
import { fromServer } from './queue.js';

/** IMEI: 15 digits, not all the same, the last one a Luhn check digit. Spaces and dashes typed or scanned with it are dropped.
 *  The same rule as lib/team/install.mjs, so the screen refuses what the server would. */
export function cleanImei(input) {
  if (typeof input !== 'string') return null;
  const d = input.replace(/[\s-]/g, '');
  if (!/^\d{15}$/.test(d) || /^(\d)\1{14}$/.test(d)) return null;   // one digit fifteen times is no phone, though 15 zeros pass Luhn
  let sum = 0;
  for (let i = 0; i < 15; i += 1) {
    let n = Number(d[14 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0 ? d : null;
}

/** On a practice site the phone step is open: any IMEI-shaped text, 4 to 20 letters, digits, spaces or dashes, with no
 *  check digit, kept in capitals with its spaces folded. The same rule as lib/team/install.mjs. */
export function practiceImei(input) {
  if (typeof input !== 'string') return null;
  const v = input.trim().replace(/\s+/g, ' ').toUpperCase();
  return /^[A-Z0-9 -]{4,20}$/.test(v) && /[A-Z0-9]/.test(v) ? v : null;
}
/** The phone identifier as the site's kind reads it: the real IMEI rule, or the open one on a practice site. */
export const imeiFor = (site, input) => (site && site.practice ? practiceImei(input) : cleanImei(input));

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
 *  stage, so its workers say whether it starts or continues. A closed one stays as `closed` until a manager confirms it. */
export function installCard(inst) {
  if (!inst || inst.phones == null) return null;
  // closed and not yet confirmed (a confirmed one is no longer in me.installs): the card stays and waits for the manager
  const open = inst.closed || inst.practice || inst.state === 'ready_to_install' || inst.state === 'installing';
  if (!open) return null;
  return { id: inst.id, kind: inst.closed ? 'closed' : inst.total > 0 ? 'continue' : 'start', practice: !!inst.practice, ready: inst.ready, total: inst.total, phones: inst.phones };
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

/** The IMEI among whatever a barcode reader saw on a box or a sticker: the first run of digits (dashes and spaces
 *  allowed inside) that is a valid IMEI. A label around it ("IMEI:") does not matter; a wrong check digit is never picked. */
export function imeiFromScan(values) {
  for (const v of values || []) {
    for (const run of String(v).match(/\d[\d\s-]{13,}\d/g) || []) {
      const whole = cleanImei(run);
      if (whole) return whole;
      const digits = run.replace(/[\s-]/g, '');
      for (let i = 0; i + 15 <= digits.length; i += 1) { const one = cleanImei(digits.slice(i, i + 15)); if (one) return one; }
    }
  }
  return null;
}

/** Which step a worker's screen stands on, counted from 1, and how many steps they have. */
export function stepNow(w) {
  const steps = workerSteps(w), i = steps.findIndex((x) => !x.done);
  return { at: i < 0 ? steps.length : i + 1, of: steps.length };
}

const localDayOf = (iso, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
/** The site's record as the close screen shows it: everyone with a consent on file, the local day they signed, and the
 *  phone they hold by its last four digits. Nobody without a consent is in it. */
export function recordRows(workers, tz) {
  return workers.filter((w) => w.consent).map((w) => ({ id: w.id, name: w.name, day: localDayOf(w.consent.t, tz), tail: w.imei ? String(w.imei).slice(-4) : null, phone: w.phone !== false }));
}

/** The close screen: closed (it then waits for a manager to confirm the install), ready to close with whoever is ready,
 *  or nobody ready yet. */
export function closeState(view) {
  if (view.site.closed) return { kind: 'closed', at: view.site.closed, installed: !!view.site.installed };
  return { kind: view.progress.ready > 0 ? 'ready' : 'nobody' };
}

/** Which controls a screen offers. A manager looking through a real rep's screens (view-as) reads only: no control that
 *  writes. Otherwise each one shows only when it can act: the phone with a consent and no phone yet, the return and the
 *  clip with a phone, the close until the install is closed. Late workers can still be added to a closed install. On a
 *  practice site, and only there, the consent step also offers an example photo while no consent is on file, so the lock
 *  can be opened without a camera. */
export function controls({ readOnly, site, worker }) {
  const none = { prep: false, addWorker: false, close: false, consent: false, example: false, phone: false, returnPhone: false, clip: false, edit: false, remove: false };
  if (readOnly) return none;
  // A legacy site (signed before the app) only loads the consents it already has: people and their photos, nothing else.
  if (site && site.legacy) return worker ? { ...none, addWorker: true, consent: true, edit: true, remove: true } : { ...none, addWorker: true };
  const out = { ...none, prep: true, addWorker: true, close: !(site && site.closed) };
  if (!worker) return out;
  const records = worker.phone !== false;
  // A name or an email typed wrong is corrected; someone who should not be there is removed (a phone comes back first).
  return { ...out, consent: true, example: !!(site && site.practice) && !worker.consent, phone: records && !!worker.consent && !worker.imei, returnPhone: records && !!worker.imei, clip: records && !!worker.imei && !worker.clip, edit: true, remove: true };
}

/** The body of POST worker/<id>/edit, or a refusal in words before the server says it: a name of two letters or more,
 *  and an email, which a legacy site may leave empty. */
export function workerEditBody(v, legacy = false) {
  const name = String(v.name ?? '').replace(/\s+/g, ' ').trim(), email = String(v.email ?? '').trim().toLowerCase();
  if (name.length < 2) throw Object.assign(new Error('fields'), { code: 'fields' });
  if (!email && !legacy) throw Object.assign(new Error('email'), { code: 'email' });
  return { name, email };
}

/** A consent photo is kept for "Reintentar con la misma foto" only when the signal or the server failed, or the answer
 *  was not the server's own (a captive portal's or a proxy's page: nobody looked at the photo). A refusal of the photo
 *  itself (too big, not an image) or of the person asks for a new photo or explains; retrying it would fail again. */
export const keepForRetry = (e) => !!e && (e.code === 'offline' || e.status >= 500 || !fromServer(e));
