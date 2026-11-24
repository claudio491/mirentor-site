// consent.mjs: a worker's signed consent, kept as one photo next to the event log (<data>/team/consents/<worker id>.<ext>).
// Same shape as photo.mjs: only JPEG, PNG and WebP are taken, the kind is read from the first bytes, and the event log says
// who has a consent and which version; this file only moves the bytes.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { photoKind, photoType } from './photo.mjs';

export const MAX_CONSENT = 900 * 1024;
/** The versions of the worker consent form a consent can be on: "Worker Consent Form Template (Spanish)", version 1,
 *  17 Nov 2026. A new version of the form adds its name here. */
export const CONSENT_FORMS = Object.freeze(['v1']);
/** No consent of this program was signed before this day: an earlier date is a typo. */
export const FIRST_CONSENT_DAY = '2026-01-01';
const EXTS = ['jpg', 'png', 'webp'];
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;   // the id becomes a file name: nothing that could leave the folder
const folder = (dir) => path.join(dir, 'team', 'consents');
const fileOf = (dir, id, ext) => path.join(folder(dir), `${id}.${ext}`);

/** Keep these bytes as the worker's consent. Answers { ext, v } for the event, or null when they cannot be used. */
export function saveConsent(dir, workerId, bytes) {
  const kind = photoKind(bytes);
  if (!kind || !SAFE_ID.test(workerId) || bytes.length > MAX_CONSENT) return null;
  mkdirSync(folder(dir), { recursive: true });
  const target = fileOf(dir, workerId, kind.ext), draft = `${target}.new`;
  writeFileSync(draft, bytes); renameSync(draft, target);   // never a half-written consent
  for (const ext of EXTS) if (ext !== kind.ext) rmSync(fileOf(dir, workerId, ext), { force: true });
  return { ext: kind.ext, v: createHash('sha256').update(bytes).digest('hex').slice(0, 12) };
}
export function readConsent(dir, workerId, ext) {
  if (!SAFE_ID.test(workerId) || !photoType(ext)) return null;
  const file = fileOf(dir, workerId, ext);
  return existsSync(file) ? readFileSync(file) : null;
}
export function dropConsent(dir, workerId) {
  if (SAFE_ID.test(workerId)) for (const ext of EXTS) rmSync(fileOf(dir, workerId, ext), { force: true });
}
