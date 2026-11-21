// install.mjs: what an install looks like once workers, consents and phones are in the log.
// Pure reads over the state that state.mjs builds; nothing here writes.
import { localDay } from './rules.mjs';

const DEFAULT_TZ = 'America/Panama';

// IMEI: 15 digits, the last one a Luhn check digit. Spaces and dashes typed or scanned with it are dropped.
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

// One row per worker with a consent on file; days are local to the rep who installs the site.
export function siteRecord(state, siteId) {
  const site = state.sites.get(siteId);
  const tz = state.reps.get(site?.rep)?.tz || DEFAULT_TZ;
  const day = (t) => (t ? localDay(t, tz) : null);
  return workersOf(state, site).filter((w) => w.consent).map((w) => {
    const given = w.imei ? state.phoneLog.findLast((p) => p.worker === w.id && p.what === 'given' && p.imei === w.imei) : null;
    return { worker: w.name, email: w.email, signedOn: day(w.consent.t), form: w.consent.form, imei: w.imei, givenOn: day(given?.t) };
  });
}
