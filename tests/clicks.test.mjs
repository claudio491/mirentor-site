import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseLinks, report } from '../tools/clicks.mjs';

const CSV = '#,Lead ID,Company,Contact,Email,Code,Link\n1,PA-0023,Cochez,Arturo Cochez,a@cochez.com,5uf2cl,https://www.mirentor.com/?c=5uf2cl#lista-de-espera\n'
  + '2,PA-0045,"ESCO, S.A.",Víctor,v@esco.com,6gydyn,https://www.mirentor.com/?c=6gydyn#lista-de-espera\n';
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_6_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/156.0 Mobile/15E148 Safari/604.1';
const WIN = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36';

test('the links file maps each code to its lead, quoted names included', () => {
  const m = parseLinks(CSV);
  assert.deepEqual(m.get('6gydyn'), { lead: 'PA-0045', company: 'ESCO, S.A.', contact: 'Víctor', email: 'v@esco.com' });
});

test('the report names the company, Panama time, country, device and how, newest last', () => {
  const visits = [
    { c: '6gydyn', at: '2026-11-10T16:03:00.000Z', country: 'US', page: '/', how: 'timer', ua: WIN },
    { c: '5uf2cl', at: '2026-11-10T15:30:00.000Z', country: 'PA', page: '/', how: 'interact', ua: IPHONE },
    { c: 'zzzzzz', at: '2026-11-10T17:00:00.000Z', country: 'PA', page: '/en/', how: 'interact', ua: WIN },
  ];
  const rows = report(visits, parseLinks(CSV));
  assert.deepEqual(rows.map((r) => [r.company, r.time, r.country, r.device, r.how]), [
    ['Cochez', '2026-11-10 10:30', 'PA', 'iPhone', 'interact'],
    ['ESCO, S.A.', '2026-11-10 11:03', 'US', 'Windows', 'timer'],
    ['(unknown code zzzzzz)', '2026-11-10 12:00', 'PA', 'Windows', 'interact'],
  ]);
});

test('a visit from outside Panama that only waited is marked as a likely link scanner', () => {
  const rows = report([{ c: '6gydyn', at: '2026-11-10T16:03:00.000Z', country: 'US', page: '/', how: 'timer', ua: WIN },
    { c: '5uf2cl', at: '2026-11-10T15:30:00.000Z', country: 'PA', page: '/', how: 'timer', ua: IPHONE }], parseLinks(CSV));
  assert.deepEqual(rows.map((r) => [r.company, r.likelyScanner]), [['Cochez', false], ['ESCO, S.A.', true]]);
});
