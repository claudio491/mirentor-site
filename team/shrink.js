// shrink.js: a photo from the phone's camera, made small enough to send. An iPhone photo can be HEIC or weigh 4 MB; the
// server takes only JPEG, PNG or WebP under its limit. The browser decodes whatever it can show, and a canvas writes it
// back as JPEG, smaller on each pass until it fits. The photo is decoded at the size it will be drawn at, not at the
// camera's full size: a 12 MP photo decoded whole holds 48 MB of pixels on a phone that may not have them.

/** What to ask the browser to decode a photo at, from its own size: the longer side brought down to `maxSide`, given as
 *  that one side only, so the browser keeps the proportions however the photo is turned. Null when it already fits (it
 *  is never made larger) or its size is unknown. */
export function resizeFor(size, maxSide) {
  const w = size && size.width, h = size && size.height;
  if (!(w > 0) || !(h > 0) || Math.max(w, h) <= maxSide) return null;
  return w >= h ? { resizeWidth: maxSide } : { resizeHeight: maxSide };
}
/** A photo's width and height as its header states them, or null. A JPEG's markers are walked by their lengths up to
 *  the frame header, a PNG's are fixed: only a few bytes are read, and no pixel is decoded. (An image element would
 *  need a blob: address, which the page's policy does not allow.) Anything else, a HEIC for one, is unknown. */
export async function headerSize(file) {
  const at = async (pos, n) => new Uint8Array(await file.slice(pos, pos + n).arrayBuffer());
  const head = await at(0, 24), u16 = (b, i) => (b[i] << 8) | b[i + 1], u32 = (b, i) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
  if (head.length >= 24 && u32(head, 0) === 0x89504E47 && u32(head, 12) === 0x49484452) return { width: u32(head, 16), height: u32(head, 20) };
  if (head.length < 4 || head[0] !== 0xFF || head[1] !== 0xD8) return null;
  for (let pos = 2, steps = 0; pos < file.size && steps < 400; steps += 1) {
    const m = await at(pos, 9);
    if (m.length < 2 || m[0] !== 0xFF) return null;
    const type = m[1];
    if (type === 0xFF) { pos += 1; continue; }                                         // a fill byte
    if (type === 0x01 || (type >= 0xD0 && type <= 0xD8)) { pos += 2; continue; }        // a marker with no length
    if (type === 0xD9 || type === 0xDA || m.length < 4) return null;                    // the data starts with no frame header
    if (type >= 0xC0 && type <= 0xCF && type !== 0xC4 && type !== 0xC8 && type !== 0xCC) return m.length < 9 ? null : { width: u16(m, 7), height: u16(m, 5) };
    pos += 2 + u16(m, 2);
  }
  return null;
}
async function decode(file, maxSide) {
  if (typeof createImageBitmap === 'function') {
    const fit = resizeFor(await headerSize(file).catch(() => null), maxSide);
    if (fit) { try { return await createImageBitmap(file, { imageOrientation: 'from-image', ...fit, resizeQuality: 'high' }); } catch { /* a browser that does not take a size decodes it whole, below */ } }
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* some browsers decode only through an image element */ }
  }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.decoding = 'async'; img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}
const toJpeg = (canvas, quality) => new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('encode'))), 'image/jpeg', quality));

/** The photo as a JPEG whose longer side is at most `maxSide` and whose size is at most `maxBytes`. Throws when the
 *  browser cannot read the file as an image, and with code `too_big` when it cannot be brought under `maxBytes`. */
export async function shrink(file, { maxSide = 1600, maxBytes = 800 * 1024 } = {}) {
  const src = await decode(file, maxSide);
  const w0 = src.width || src.naturalWidth, h0 = src.height || src.naturalHeight;
  if (!w0 || !h0) throw new Error('decode');
  let side = Math.min(maxSide, Math.max(w0, h0)), quality = 0.86, out = null;
  for (let pass = 0; pass < 8; pass += 1) {
    const k = side / Math.max(w0, h0), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(w0 * k)); canvas.height = Math.max(1, Math.round(h0 * k));
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);   // a transparent PNG becomes paper, not black
    ctx.drawImage(src, 0, 0, canvas.width, canvas.height);
    out = await toJpeg(canvas, quality);
    if (out.size <= maxBytes) break;
    // first lower the quality a little, then the size: a signature stays readable longer that way
    if (quality > 0.66) quality -= 0.1; else side = Math.round(side * 0.8);
  }
  if (src.close) src.close();
  // still too heavy after every pass: the screen asks for another photo instead of sending one the server refuses
  if (!out || out.size > maxBytes) throw Object.assign(new Error('too_big'), { code: 'too_big' });
  return out;
}

/** The example consent for a practice site: a white page with one word on it (EJEMPLO or EXAMPLE) and a few grey lines
 *  where a form's text would be. Drawn here, so no picture with real content exists anywhere. A JPEG, like any consent. */
export async function examplePage(word) {
  const canvas = document.createElement('canvas');
  canvas.width = 600; canvas.height = 800;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 600, 800);
  ctx.fillStyle = '#d9d9d9';
  for (let i = 0; i < 9; i += 1) ctx.fillRect(70, 110 + i * 34, i % 3 === 2 ? 300 : 460, 10);
  ctx.fillRect(70, 660, 220, 3);   // where a signature would go
  ctx.save(); ctx.translate(300, 470); ctx.rotate(-0.32);
  ctx.fillStyle = '#9a9a9a'; ctx.font = '700 92px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(String(word || ''), 0, 0);
  ctx.restore();
  return toJpeg(canvas, 0.8);
}
