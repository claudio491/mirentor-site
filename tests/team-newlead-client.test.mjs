// A business typed as new: its near twins before it becomes a second row ("¿Es alguno de estos?"), its zone picked from
// the city's, and when the sheet may save it. The server finds the twins and stays the judge; these decide the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { similarAsk, zoneOptions, zoneOf, newReady, dupNote, zonePickFor, zonesOnOpen, sureFor, restoredNew } from '../team/newlead-steps.js';
import { DICT } from '../team/i18n.js';

test('a typed business shows its near twins before it is new, and its zone comes from the list', () => {
  assert.equal(similarAsk('Ta'), null); assert.equal(similarAsk('  Taller Gomez S.A. '), 'Taller Gomez S.A.');
  assert.equal(similarAsk('Ña 12'), null, 'no word of three letters');
  assert.equal(similarAsk('Ñandú'), 'Ñandú');
  assert.equal(similarAsk(null), null);
  assert.deepEqual(zoneOptions(['Centro', 'San Miguelito']), ['Centro', 'San Miguelito', '__other']);
  assert.deepEqual(zoneOptions(null), ['__other']);
  assert.equal(zoneOf('__other', ' S. Miguelito '), 'S. Miguelito'); assert.equal(zoneOf('Centro', 'x'), 'Centro');
  assert.equal(zoneOf('', ''), '');
  assert.equal(newReady({ name: 'Taller Gomez', similar: [{ id: 'PA-1' }], sure: false }), false);
  assert.equal(newReady({ name: 'Taller Gomez', similar: [{ id: 'PA-1' }], sure: true }), true);
  assert.equal(newReady({ name: 'Taller Gomez', similar: null, offline: true }), true);
  assert.equal(newReady({ name: 'Taller Gomez', similar: [], sure: false }), true, 'no twins: it is new');
  assert.equal(newReady({ name: 'T', similar: [], sure: true }), false, 'a name of two letters or more');
  // a twin that cannot be picked says why: do not call, or a stage that already closed it
  assert.equal(dupNote({ pick: true, stage: 'Contacted' }), null);
  assert.deepEqual(dupNote({ pick: false, stage: 'Contacted' }), { key: 'log.dup.dnc' });
  assert.deepEqual(dupNote({ pick: false, stage: 'Live' }), { key: 'biz.stage.live' });
  for (const k of ['log.dup.title', 'log.dup.new', 'log.dup.dnc', 'log.zone.other', 'log.zone.other.ph']) for (const l of ['es', 'en']) assert.ok(DICT[l][k], `${l} ${k}`);
});

// Fix round C1 (K5): a zone typed before the city's zones arrive is kept; a failed read of the zones is tried again.
test('the zone typed before the zones arrive stays, as "Otra", and a failed read of the zones is read again next time', () => {
  assert.equal(zonePickFor({ zones: ['Centro', 'Norte'], had: '', typed: 'Calle 50' }), '__other');
  assert.equal(zonePickFor({ zones: ['Centro', 'Norte'], had: '', typed: '  ' }), '');
  assert.equal(zonePickFor({ zones: ['Centro', 'Norte'], had: 'Norte', typed: 'Calle 50' }), 'Norte', 'a zone already picked stays');
  assert.equal(zonePickFor({ zones: ['Centro'], had: 'Gone', typed: '' }), '');
  assert.equal(zonePickFor({ zones: [], had: '', typed: 'Calle 50' }), '', 'no zones: the field is the zone');
  assert.equal(zonesOnOpen({ zones: [], failed: true }), null, 'read again');
  assert.deepEqual(zonesOnOpen({ zones: [], failed: false }), [], 'a city with no zones is not asked again');
  assert.deepEqual(zonesOnOpen({ zones: ['Centro'], failed: false }), ['Centro']);
  assert.equal(zonesOnOpen({ zones: null, failed: false }), null);
});

test('a draft of a new business keeps "Es nuevo" with the name it was said for, and its restore asks about the twins again', () => {
  // what the draft keeps: the name "Es nuevo" was said for, or nothing
  assert.equal(sureFor({ sure: true, name: '  Herrería San José ' }), 'Herrería San José');
  assert.equal(sureFor({ sure: false, name: 'Herrería San José' }), null);
  assert.equal(sureFor({ sure: true, name: ' ' }), null);
  // restored with a name: the twins are asked again and Guardar waits for the answer, as when the name is typed
  const back = restoredNew({ isNew: true, name: 'Herrería San José', sureFor: null });
  assert.deepEqual(back, { ask: 'Herrería San José', sure: false, wait: true });
  // while it waits, and once twins come back with no "Es nuevo", the sheet may not save
  assert.equal(!back.wait && newReady({ name: 'Herrería San José', similar: null, sure: back.sure }), false);
  assert.equal(newReady({ name: 'Herrería San José', similar: [{ id: 'APP-9', name: 'Herrería San José' }], sure: back.sure }), false);
  // a kept "Es nuevo" stands only for the same name
  assert.equal(restoredNew({ isNew: true, name: 'Herrería San José', sureFor: 'Herrería San José' }).sure, true);
  assert.equal(restoredNew({ isNew: true, name: 'Herrería San Juan', sureFor: 'Herrería San José' }).sure, false);
  assert.equal(newReady({ name: 'Herrería San José', similar: [{ id: 'APP-9' }], sure: true }), true);
  // no name worth asking about, or not a new business: nothing to ask, nothing to wait for
  assert.deepEqual(restoredNew({ isNew: true, name: 'ab', sureFor: null }), { ask: null, sure: false, wait: false });
  assert.deepEqual(restoredNew({ isNew: false, name: 'Herrería San José', sureFor: 'Herrería San José' }), { ask: null, sure: false, wait: false });
});
