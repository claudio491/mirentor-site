// team-demo.mjs: build a copy of the sales team app that runs with no server, as ONE page.
//   node tools/team-demo.mjs <out-dir> [roster.json]
// It is for showing the app from anywhere before it is online: the page carries the app's own screens and the
// team's own server code (rules, event log, answers), started inside the browser by tools/demo/boot.js. What a viewer
// logs is kept in that browser only. Nobody signs in: the viewer chooses who to be, so this copy is never the real thing.
// The people come from a roster file (the format is at the top of tools/team-roster.mjs; default data-sample/team.json,
// which git ignores). Their names and photos end up inside the page: treat the output like the roster itself.
// Two files are written: artifact.html, the page without a document shell, which is what an artifact takes, and
// index.html, the same page as a whole document, to open from a folder or a local server. Open that one locally:
// the bare page says nothing about its encoding, and a browser would then misread every accent it stores.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readRoster } from './team-roster.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NODE = { 'node:crypto': 'tools/demo/node-crypto.js', 'node:fs': 'tools/demo/node-fs.js', 'node:path': 'tools/demo/node-path.js', 'node:url': 'tools/demo/node-url.js', 'node:zlib': 'tools/demo/node-zlib.js' };
const ENTRY = 'tools/demo/boot.js', DATA = 'tools/demo/demo-data.js';
const TITLE = 'Mirentor Sales Team App';

/** Where an import leads, as a path from the repository's root. */
function resolve(from, spec) {
  if (NODE[spec]) return NODE[spec];
  if (!spec.startsWith('.')) throw new Error(`${from}: cannot bundle "${spec}"`);
  return path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
}
/** One module as a function that takes the loader and answers its exports. The modules here only use plain forms. */
function transform(id, source) {
  const deps = [], names = [];
  const dep = (spec) => { const to = resolve(id, spec); deps.push(to); return JSON.stringify(to); };
  let code = source.replace(/^import\s+'([^']+)';?[ \t]*$/gm, (m, spec) => `__req(${dep(spec)});`);
  code = code.replace(/^import\s+([^;]*?)\s+from\s+'([^']+)';?[ \t]*$/gm, (m, what, spec) => {
    const w = what.trim();
    if (w.startsWith('{')) return `const ${w.replace(/\s+as\s+/g, ': ')} = __req(${dep(spec)});`;
    if (w.startsWith('* as ')) return `const ${w.slice(5)} = __req(${dep(spec)});`;
    return `const ${w} = __req(${dep(spec)}).default;`;
  });
  code = code.replace(/\bawait import\('([^']+)'\)/g, (m, spec) => `__req(${dep(spec)})`);
  code = code.replace(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/gm, (m, kind, name) => { names.push(name); return `${kind} ${name}`; });
  code = code.replace(/^export\s+\{([^}]*)\};?[ \t]*$/gm, (m, list) => { for (const part of list.split(',')) if (part.trim()) names.push(part.trim()); return ''; });
  let byDefault = false;
  code = code.replace(/^export\s+default\s+/gm, () => { byDefault = true; return 'const __default = '; });
  if (/^(import|export)\s/m.test(code)) throw new Error(`${id}: an import or export this bundler does not know`);
  return { deps, code: `__defs[${JSON.stringify(id)}] = function (__req) {\n${code}\nreturn { ${[...names, ...(byDefault ? ['default: __default'] : [])].join(', ')} };\n};` };
}
/** Every module the entry needs, as one script. Modules load on first use, so the entry decides the order. */
export function bundle(entry, made = {}) {
  const out = new Map(), open = new Set();
  const visit = (id) => {
    if (out.has(id)) return;
    if (open.has(id)) throw new Error(`${id} is imported in a circle`);
    open.add(id);
    const source = id in made ? made[id] : readFileSync(path.join(ROOT, id), 'utf8');
    const mod = transform(id, source);
    for (const next of mod.deps) visit(next);
    open.delete(id); out.set(id, mod.code);
  };
  visit(entry);
  return ['const __defs = {}, __mods = {};',
    'const __req = (id) => { if (!(id in __mods)) { if (!__defs[id]) throw new Error("no module " + id); __mods[id] = __defs[id](__req); } return __mods[id]; };',
    ...out.values()].join('\n');
}

const dataUri = (type, bytes) => `data:${type};base64,${Buffer.from(bytes).toString('base64')}`;
const PHOTO_TYPE = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

export function buildDemo({ people, photosDir = '.' } = {}) {
  if (!Array.isArray(people) || !people.length) throw new Error('the demo needs at least one person');
  // the people and their photos, as the page will carry them
  const photos = {}, list = people.map((p) => {
    const id = `r_${String(p.handle).replace(/[^a-z0-9]/g, '-')}`, file = p.photo ? path.resolve(photosDir, p.photo) : '';
    const type = PHOTO_TYPE[path.extname(file).toLowerCase()];
    let version = null;
    if (file && type && existsSync(file)) { const bytes = readFileSync(file); photos[id] = dataUri(type, bytes); version = createHash('sha256').update(bytes).digest('hex').slice(0, 12); }
    return { id, handle: p.handle, ...(typeof p.email === 'string' && p.email ? { email: p.email.trim().toLowerCase() } : {}), name: p.name, role: p.role || 'rep', city: p.city || '', country: p.country || 'PA', ...(p.tz ? { tz: p.tz } : {}), ...(p.startDate ? { startDate: p.startDate } : {}), photo: version };
  });
  const script = bundle(ENTRY, { [DATA]: `export const PEOPLE = ${JSON.stringify(list)};\nexport const PHOTOS = ${JSON.stringify(photos)};\n` });

  // the app's own page, with everything it loads carried inside
  const team = (name) => readFileSync(path.join(ROOT, 'team', name));
  const page = team('index.html').toString('utf8');
  const symbol = dataUri('image/svg+xml', team('img/mirentor-symbol-dark.svg'));
  const body = page.slice(page.indexOf('>', page.indexOf('<body')) + 1, page.lastIndexOf('</body>'))
    .replaceAll('img/mirentor-symbol-dark.svg', symbol).replaceAll('href="./"', 'href="#"');
  if (/(src|href)="(?!#|data:)/.test(body)) throw new Error('the page still points at the server for something');
  const css = team('app.css').toString('utf8')
    .replace('url(fonts/geist-v1.woff2)', `url(${dataUri('font/woff2', team('fonts/geist-v1.woff2'))})`)
    .replace('url(fonts/geist-mono-v1.woff2)', `url(${dataUri('font/woff2', team('fonts/geist-mono-v1.woff2'))})`)
    + readFileSync(path.join(ROOT, 'tools', 'demo', 'demo.css'), 'utf8');
  if (/url\((?!data:)/.test(css)) throw new Error('the styles still load a file');
  const inline = `${script}\n__req(${JSON.stringify(ENTRY)});`.replace(/<\/script/gi, '<\\/script');
  const fragment = `<title>${TITLE}</title>\n<style>${css}</style>\n${body}\n<script type="module">\n${inline}\n</script>\n`;
  const whole = `<!doctype html>\n<html lang="es">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n<meta name="robots" content="noindex, nofollow">\n</head>\n<body>\n${fragment}</body>\n</html>\n`;
  return { fragment, whole, script, people: list.map((p) => `${p.handle} (${p.role})`), photos: Object.keys(photos).length };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const out = process.argv[2], rosterFile = process.argv[3] || path.join(ROOT, 'data-sample', 'team.json');
  if (!out) { console.error('usage: node tools/team-demo.mjs <out-dir> [roster.json]'); process.exit(1); }
  try {
    const made = buildDemo(readRoster(rosterFile));
    mkdirSync(out, { recursive: true });
    writeFileSync(path.join(out, 'artifact.html'), made.fragment); writeFileSync(path.join(out, 'index.html'), made.whole);
    console.log(`demo written to ${out}: ${(Buffer.byteLength(made.fragment) / 1024).toFixed(0)} KB, ${made.people.length} people, ${made.photos} photos`);
  } catch (err) { console.error(err.message); process.exit(1); }
}
