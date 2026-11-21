// install.mjs: what an install looks like once workers, consents and phones are in the log.
// Pure reads over the state that state.mjs builds; nothing here writes.
import { localDay } from './rules.mjs';

const DEFAULT_TZ = 'America/Panama';

// IMEI: 15 digits, not all the same, the last one a Luhn check digit. Spaces and dashes typed or scanned with it are dropped.
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

// A coworker marked `phone: false` signs a consent and gets no phone: consent_only once the consent is on file.
export function workerStatus(worker) {
  if (!worker.consent) return 'no_consent';
  if (worker.phone === false) return 'consent_only';
  if (!worker.imei) return 'no_phone';
  if (!worker.clip) return 'no_clip';
  return 'ready';
}

const workersOf = (state, site) => (site ? site.workers.map((id) => state.workers.get(id)).filter(Boolean) : []);

// allRecordingHaveConsent: at least one worker will record, and every one of them has a consent on file.
export function siteProgress(state, siteId) {
  const workers = workersOf(state, state.sites.get(siteId));
  const recording = workers.filter((w) => w.phone !== false);
  return {
    total: workers.length,
    ready: workers.filter((w) => workerStatus(w) === 'ready').length,
    consents: workers.filter((w) => w.consent).length,
    phones: workers.filter((w) => w.imei).length,
    allRecordingHaveConsent: recording.length > 0 && recording.every((w) => w.consent),
  };
}

export function siteState(site) {
  if (site.practice) return 'practice';
  if (site.legacy) return 'legacy';
  if (site.steps.installed) return 'installed';
  if (site.closed) return 'closed';
  if (site.phones === null) return 'waiting_phones';
  return site.workers.length ? 'installing' : 'ready_to_install';
}

// One row per worker and phone for every worker with a consent on file; a worker with a consent and no phone gets one row
// with the phone empty. A returned phone stays in the record: returnedOn is empty only while the worker still holds it.
// Days are local to the rep who installs the site.
export function siteRecord(state, siteId) {
  const site = state.sites.get(siteId);
  const tz = state.reps.get(site?.rep)?.tz || DEFAULT_TZ;
  const day = (t) => (t ? localDay(t, tz) : null);
  const rows = [];
  for (const w of workersOf(state, site).filter((x) => x.consent)) {
    const base = { worker: w.name, email: w.email, signedOn: day(w.consent.t), form: w.consent.form };
    const pairs = [];
    for (const p of state.phoneLog.filter((x) => x.worker === w.id && x.site === site.id)) {
      if (p.what === 'given') pairs.push({ imei: p.imei, givenOn: day(p.t), returnedOn: null });
      else { const open = pairs.findLast((x) => x.imei === p.imei && !x.returnedOn); if (open) open.returnedOn = day(p.t); }
    }
    if (!pairs.length) rows.push({ ...base, imei: null, givenOn: null, returnedOn: null });
    else for (const pair of pairs) rows.push({ ...base, ...pair });
  }
  return rows;
}
