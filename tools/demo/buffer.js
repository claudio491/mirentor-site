// buffer.js: the small part of Node's Buffer that the team's server code uses, for a browser.
// It is only for the copy of the app that runs without a server (tools/team-demo.mjs). The real service never loads it.
const encoder = new TextEncoder(), decoder = new TextDecoder();
const toBase64 = (bytes, url) => {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  const out = btoa(text);
  return url ? out.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : out;
};
const fromBase64 = (text) => {
  const bin = atob(String(text).replace(/-/g, '+').replace(/_/g, '/').replace(/\s+/g, ''));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
};

export class Buffer extends Uint8Array {
  static wrap(bytes) { return new Buffer(bytes.buffer, bytes.byteOffset, bytes.byteLength); }
  static from(value, encoding) {
    if (typeof value === 'string') {
      if (encoding === 'base64' || encoding === 'base64url') return Buffer.wrap(fromBase64(value));
      if (encoding === 'hex') return Buffer.wrap(Uint8Array.from(value.match(/../g) || [], (pair) => parseInt(pair, 16)));
      return Buffer.wrap(encoder.encode(value));
    }
    return Buffer.wrap(Uint8Array.from(value));   // an array of numbers, or bytes to copy
  }
  static alloc(size) { return new Buffer(size); }
  static concat(list) {
    const out = new Buffer(list.reduce((sum, part) => sum + part.length, 0));
    let at = 0;
    for (const part of list) { out.set(part, at); at += part.length; }
    return out;
  }
  static isBuffer(value) { return value instanceof Buffer; }
  toString(encoding = 'utf8', start = 0, end = this.length) {
    const part = this.subarray(start, end);
    if (encoding === 'hex') return Array.from(part, (b) => b.toString(16).padStart(2, '0')).join('');
    if (encoding === 'base64') return toBase64(part, false);
    if (encoding === 'base64url') return toBase64(part, true);
    if (encoding === 'latin1' || encoding === 'binary') return Array.from(part, (b) => String.fromCharCode(b)).join('');
    return decoder.decode(part);
  }
  equals(other) { return this.length === other.length && this.every((b, i) => b === other[i]); }
}
if (!globalThis.Buffer) globalThis.Buffer = Buffer;
