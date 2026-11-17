// node-fs.js: stands in for node:fs in the copy of the app that runs without a server. Files live in memory, and
// whoever starts the copy can keep them somewhere (the browser's own storage) by watching the writes.
import { Buffer } from './buffer.js';

const files = new Map(), folders = new Set();
let onWrite = () => {};
const missing = (path) => Object.assign(new Error(`ENOENT: no such file, ${path}`), { code: 'ENOENT' });
const asBytes = (data) => (typeof data === 'string' ? Buffer.from(data) : Buffer.from(data));

/** Put a file in place before the app starts, without telling the watcher. */
export function preload(path, text) { files.set(path, Buffer.from(text)); }
/** Forget every file: the next start is a fresh one. */
export function wipe() { files.clear(); folders.clear(); }
/** Call fn(path) after every write. */
export function watch(fn) { onWrite = fn; }

export const existsSync = (path) => files.has(path) || folders.has(path);
export function readFileSync(path, encoding) { const data = files.get(path); if (!data) throw missing(path); return encoding ? data.toString(encoding) : data; }
export function writeFileSync(path, data) { files.set(path, asBytes(data)); onWrite(path); }
export function appendFileSync(path, data) { files.set(path, Buffer.concat([files.get(path) || Buffer.alloc(0), asBytes(data)])); onWrite(path); }
export function mkdirSync(path) { folders.add(path); }
export function renameSync(from, to) { if (!files.has(from)) throw missing(from); files.set(to, files.get(from)); files.delete(from); onWrite(to); }
export function rmSync(path) { files.delete(path); }
export const readdirSync = () => [];
export const statSync = () => ({ isDirectory: () => false });
