// photo.mjs: a person's photo, kept as one file next to the event log (<data>/team/photos/<person id>.<version>.<ext>).
// Only JPEG, PNG and WebP are taken, and the kind is read from the file's first bytes, never from a name or a header.
// The event log says who has a photo and which version; this file only moves the bytes. A new version is written beside
// the one in force and the old one goes only once the event that names the new one is written. A photo filed by an
// older build sits under one name per kind (<person id>.<ext>): it is still read, and goes once a newer one is in force.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export const MAX_PHOTO = 400 * 1024;
const PNG_START = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const KINDS = [
  { ext: 'jpg', type: 'image/jpeg', is: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: 'png', type: 'image/png', is: (b) => b.length > 8 && b.subarray(0, 8).equals(PNG_START) },
  { ext: 'webp', type: 'image/webp', is: (b) => b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP' },
];
const SAFE_ID = /^[A-Za-z0-9_-]{1,80}$/;   // the id becomes a file name: nothing that could leave the folder
const VERSION = /^[a-f0-9]{12}$/;

/** What kind of image these bytes are: { ext, type }, or null when they are none of the three. */
export const photoKind = (bytes) => (Buffer.isBuffer(bytes) ? KINDS.find((k) => k.is(bytes)) : null) || null;
export const photoType = (ext) => (KINDS.find((k) => k.ext === ext) || {}).type || null;
const folder = (dir) => path.join(dir, 'team', 'photos');
const fileOf = (dir, id, ext, v = null) => path.join(folder(dir), v ? `${id}.${v}.${ext}` : `${id}.${ext}`);
const filed = (p) => !!p && VERSION.test(String(p.v)) && !!photoType(p.ext);

/** Write these bytes as a version of the person's photo, beside the one in force. Answers { ext, v, fresh } for the
 *  event (`fresh` is false when this version was already on disk), or null when they cannot be used. Then the caller
 *  writes the event and calls keepOnlyPhoto(), or discardPhoto() if the event could not be written. */
export function savePhoto(dir, id, bytes) {
  const kind = photoKind(bytes);
  if (!kind || !SAFE_ID.test(id) || bytes.length > MAX_PHOTO) return null;
  mkdirSync(folder(dir), { recursive: true });
  const v = createHash('sha256').update(bytes).digest('hex').slice(0, 12), target = fileOf(dir, id, kind.ext, v);
  const fresh = !existsSync(target);
  if (fresh) { const draft = `${target}.new`; writeFileSync(draft, bytes); renameSync(draft, target); }   // never a half-written photo
  return { ext: kind.ext, v, fresh };
}
/** The event naming a new version could not be written: its file goes back, unless it was already there before. */
export function discardPhoto(dir, id, kept) {
  if (kept && kept.fresh && SAFE_ID.test(id) && filed(kept)) rmSync(fileOf(dir, id, kept.ext, kept.v), { force: true });
}
/** The event naming `kept` is written: the version it replaced (`old`) leaves the disk, and so do the single names. */
export function keepOnlyPhoto(dir, id, kept, old = null) {
  if (!SAFE_ID.test(id)) return;
  for (const k of KINDS) rmSync(fileOf(dir, id, k.ext), { force: true });
  if (filed(old) && !(old.v === kept.v && old.ext === kept.ext)) rmSync(fileOf(dir, id, old.ext, old.v), { force: true });
}
/** The bytes of the version the state names, or of the photo an older build filed under the single name. */
export function readPhoto(dir, id, ext, v = null) {
  if (!SAFE_ID.test(id) || !photoType(ext)) return null;
  for (const file of [VERSION.test(String(v)) ? fileOf(dir, id, ext, v) : null, fileOf(dir, id, ext)]) if (file && existsSync(file)) return readFileSync(file);
  return null;
}
/** A person's photo leaves the disk: the version in force (`photo`, as the state holds it) and the single names. */
export function dropPhoto(dir, id, photo = null) {
  if (!SAFE_ID.test(id)) return;
  for (const k of KINDS) rmSync(fileOf(dir, id, k.ext), { force: true });
  if (filed(photo)) rmSync(fileOf(dir, id, photo.ext, photo.v), { force: true });
}
