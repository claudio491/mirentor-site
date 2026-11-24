// consent.mjs: a worker's signed consent, kept as one photo next to the event log
// (<data>/team/consents/<worker id>.<version>.<ext>). Same shape as photo.mjs: only JPEG, PNG and WebP are taken, the
// kind is read from the first bytes, and the event log says who has a consent and which version; this file only moves
// the bytes. A new version is written beside the one in force and the old one goes only once the event that names the
// new one is written, so a disk that stops taking writes never leaves a worker without the consent they signed.
// A consent filed by an older build sits under one name per kind (<worker id>.<ext>): it is still read, and goes once
// a newer version is in force.
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
const VERSION = /^[a-f0-9]{12}$/;
const folder = (dir) => path.join(dir, 'team', 'consents');
const fileOf = (dir, id, ext, v = null) => path.join(folder(dir), v ? `${id}.${v}.${ext}` : `${id}.${ext}`);
const filed = (c) => !!c && VERSION.test(String(c.v)) && EXTS.includes(c.ext);

/** Write these bytes as a version of the worker's consent, beside the one in force: nothing in force is touched here.
 *  Answers { ext, v, fresh } for the event (`fresh` is false when this version was already on disk), or null when the
 *  bytes cannot be used. Then the caller writes the event and calls keepOnlyConsent(), or discardConsent() if the
 *  event could not be written. */
export function saveConsent(dir, workerId, bytes) {
  const kind = photoKind(bytes);
  if (!kind || !SAFE_ID.test(workerId) || bytes.length > MAX_CONSENT) return null;
  mkdirSync(folder(dir), { recursive: true });
  const v = createHash('sha256').update(bytes).digest('hex').slice(0, 12), target = fileOf(dir, workerId, kind.ext, v);
  const fresh = !existsSync(target);
  if (fresh) { const draft = `${target}.new`; writeFileSync(draft, bytes); renameSync(draft, target); }   // never a half-written consent
  return { ext: kind.ext, v, fresh };
}
/** The event naming a new version could not be written: its file goes back, unless it was already there before. */
export function discardConsent(dir, workerId, kept) {
  if (kept && kept.fresh && SAFE_ID.test(workerId) && filed(kept)) rmSync(fileOf(dir, workerId, kept.ext, kept.v), { force: true });
}
/** The event naming `kept` is written: the version it replaced (`old`, the consent in force before) leaves the disk, and
 *  so does any consent an older build filed under the single names. */
export function keepOnlyConsent(dir, workerId, kept, old = null) {
  if (!SAFE_ID.test(workerId)) return;
  for (const ext of EXTS) rmSync(fileOf(dir, workerId, ext), { force: true });
  if (filed(old) && !(old.v === kept.v && old.ext === kept.ext)) rmSync(fileOf(dir, workerId, old.ext, old.v), { force: true });
}
/** The bytes of the version the state names, or of the consent an older build filed under the single name. */
export function readConsent(dir, workerId, ext, v = null) {
  if (!SAFE_ID.test(workerId) || !photoType(ext)) return null;
  for (const file of [VERSION.test(String(v)) ? fileOf(dir, workerId, ext, v) : null, fileOf(dir, workerId, ext)]) if (file && existsSync(file)) return readFileSync(file);
  return null;
}
/** A worker's consent leaves the disk: the version in force (`consent`, as the state holds it) and the single names. */
export function dropConsent(dir, workerId, consent = null) {
  if (!SAFE_ID.test(workerId)) return;
  for (const ext of EXTS) rmSync(fileOf(dir, workerId, ext), { force: true });
  if (filed(consent)) rmSync(fileOf(dir, workerId, consent.ext, consent.v), { force: true });
}
