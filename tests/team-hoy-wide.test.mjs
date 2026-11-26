// Hoy on a wide screen: the stop sits on the left and everything else is stacked on the right, one row each. The rows
// are given only by CSS, so this reads team/app.css the way a browser would (the rules inside the wide screen's media
// query, the most specific and then the last one wins) and checks that no two things of Hoy can share a row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');

/** Every `selector{declarations}` inside each `@media (min-width:1080px){...}` block, in source order. */
function wideRules(css) {
  const rules = [];
  const open = '@media (min-width:1080px){';
  for (let at = css.indexOf(open); at !== -1; at = css.indexOf(open, at + 1)) {
    let depth = 1, i = at + open.length;
    const start = i;
    while (depth && i < css.length) { if (css[i] === '{') depth += 1; else if (css[i] === '}') depth -= 1; i += 1; }
    const body = css.slice(start, i - 1).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const m of body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) rules.push({ sels: m[1].split(',').map((s) => s.trim()), decls: m[2] });
  }
  return rules;
}

/** The grid row a child of Hoy with these classes gets on a wide screen, or null when no rule gives it one. */
function rowOf(classes, rules) {
  let best = null;
  rules.forEach((r, order) => {
    const row = r.decls.match(/grid-row:([^;}]+)/);
    if (!row) return;
    for (const sel of r.sels) {
      const m = sel.match(/^\.z-hoy>((?:\.[\w-]+|:not\(\.[\w-]+\))+)$/);
      if (!m) continue;
      const yes = [...m[1].replace(/:not\(\.[\w-]+\)/g, '').matchAll(/\.([\w-]+)/g)].map((x) => x[1]);
      const no = [...m[1].matchAll(/:not\(\.([\w-]+)\)/g)].map((x) => x[1]);
      if (!yes.every((c) => classes.includes(c)) || no.some((c) => classes.includes(c))) continue;
      const spec = 1 + yes.length + no.length;
      if (!best || spec > best.spec || (spec === best.spec && order >= best.order)) best = { spec, order, row: row[1].trim() };
    }
  });
  return best && best.row;
}

/** The direct children of Hoy's section, with their id and classes. */
function hoyChildren(page) {
  const from = page.indexOf('id="s-today"'), to = page.indexOf('</section>\n\n', from);
  const part = page.slice(page.indexOf('>', from) + 1, to);
  const kids = [];
  let depth = 0;
  for (const m of part.matchAll(/<(\/?)(\w+)([^>]*?)(\/?)>/g)) {
    const [, close, tag, attrs, self] = m;
    if (['br', 'img', 'input'].includes(tag) || self) continue;
    if (close) { depth -= 1; continue; }
    if (depth === 0) kids.push({ tag, id: (attrs.match(/\bid="([^"]+)"/) || [])[1], classes: ((attrs.match(/\bclass="([^"]+)"/) || [])[1] || '').split(/\s+/) });
    depth += 1;
  }
  return kids;
}

test('on a wide screen every card of Hoy has its own row: the stop on the left, the rest one under the other', () => {
  const rules = wideRules(read('team/app.css')), kids = hoyChildren(read('team/index.html'));
  const ids = kids.map((k) => k.id || k.classes[0]);
  for (const id of ['closeCard', 'bookCard', 'installCard', 'routeCard', 'ladderCard', 'reportCard', 'sitesCard', 'docsCard', 'hoyLine']) assert.ok(ids.includes(id), `${id} is a child of Hoy`);
  const right = kids.filter((k) => !k.classes.includes('stopstage'));
  const rows = new Map();
  for (const k of right) {
    const row = rowOf(k.classes, rules), name = k.id || k.classes[0];
    assert.ok(row && /^\d+$/.test(row), `${name} has a row of its own on a wide screen (got ${row})`);
    assert.ok(!rows.has(row), `${name} and ${rows.get(row)} both sit in row ${row}`);
    rows.set(row, name);
  }
  assert.equal(rowOf(['stopstage'], rules), '1 / span 7', 'the stop keeps the left column of the first seven rows');
});
