// shrink.js: a photo from the phone's camera, made small enough to send. An iPhone photo can be HEIC or weigh 4 MB; the
// server takes only JPEG, PNG or WebP under its limit. The browser decodes whatever it can show, and a canvas writes it
// back as JPEG, smaller on each pass until it fits.

async function decode(file) {
  if (typeof createImageBitmap === 'function') {
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
 *  browser cannot read the file as an image. */
export async function shrink(file, { maxSide = 1600, maxBytes = 800 * 1024 } = {}) {
  const src = await decode(file);
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
  return out;
}
