// photo.mjs: a person's photo, kept as one file next to the event log (<data>/team/photos/<person id>.<ext>).
// Only JPEG, PNG and WebP are taken, and the kind is read from the file's first bytes, never from a name or a header.
// The event log says who has a photo and which version; this file only moves the bytes.
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

/** What kind of image these bytes are: { ext, type }, or null when they are none of the three. */
export const photoKind = (bytes) => (Buffer.isBuffer(bytes) ? KINDS.find((k) => k.is(bytes)) : null) || null;
export const photoType = (ext) => (KINDS.find((k) => k.ext === ext) || {}).type || null;
const folder = (dir) => path.join(dir, 'team', 'photos');
const fileOf = (dir, id, ext) => path.join(folder(dir), `${id}.${ext}`);

/** Keep these bytes as the person's photo. Answers { ext, v } for the event, or null when they cannot be used. */
export function savePhoto(dir, id, bytes) {
  const kind = photoKind(bytes);
  if (!kind || !SAFE_ID.test(id) || bytes.length > MAX_PHOTO) return null;
  mkdirSync(folder(dir), { recursive: true });
  const target = fileOf(dir, id, kind.ext), draft = `${target}.new`;
  writeFileSync(draft, bytes); renameSync(draft, target);   // never a half-written photo
  for (const other of KINDS) if (other.ext !== kind.ext) rmSync(fileOf(dir, id, other.ext), { force: true });
  return { ext: kind.ext, v: createHash('sha256').update(bytes).digest('hex').slice(0, 12) };
}
export function readPhoto(dir, id, ext) {
  if (!SAFE_ID.test(id) || !photoType(ext)) return null;
  const file = fileOf(dir, id, ext);
  return existsSync(file) ? readFileSync(file) : null;
}
export function dropPhoto(dir, id) {
  if (SAFE_ID.test(id)) for (const k of KINDS) rmSync(fileOf(dir, id, k.ext), { force: true });
}
