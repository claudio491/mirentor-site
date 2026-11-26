// Qualification on the phone: which rows a log asks, what it sends, what the business says about itself, the contract's
// warning and the offer to close it as not a fit. The server keeps the answers and stays the judge; these decide the page.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUAL_KINDS, QUAL_ROWS, mergeQ, qualOf, qualLine, qualRows, qualBody, contractWarn, notFitOffer, bizSwitch, notFitArmed } from '../team/qual-steps.js';
import * as rules from '../lib/team/rules.mjs';
import { DICT } from '../team/i18n.js';

test('which qualification rows a log asks, folded when the card already knows them, and what it sends', () => {
  assert.deepEqual(qualRows({ wifi: 'yes' }, {}, new Set()).map((r) => [r.key, r.value, r.folded]), [['workers', null, false], ['wifi', 'yes', true], ['lead', null, false]]);
  assert.equal(qualRows({ wifi: 'yes' }, {}, new Set(['wifi']))[1].folded, false);
  assert.equal(qualRows({ wifi: 'yes' }, { wifi: 'no' }, new Set())[1].value, 'no');
  assert.deepEqual(qualBody({ workers: '10_29', wifi: 'maybe' }), { workers: '10_29' }); assert.equal(qualBody({}), undefined);
  assert.equal(contractWarn('contract', { wifi: 'yes' }, {}), true); assert.equal(contractWarn('contract', { wifi: 'yes' }, { lead: 'yes' }), false); assert.equal(contractWarn('talk', null, {}), false);
  assert.deepEqual(notFitOffer({ lead: 'no' }), { tag: 'not_fit', lost: 'no_wifi_lead' }); assert.equal(notFitOffer({ wifi: 'unknown' }), null);
  assert.deepEqual(qualLine({ wifi: 'yes' }), { key: 'qf.state.missing', what: ['qf.miss.lead'] }); assert.deepEqual(qualLine(null), { key: 'qf.state.missing', what: ['qf.miss.wifi', 'qf.miss.lead'] });
  assert.deepEqual(qualLine({ wifi: 'yes', lead: 'yes' }), { key: 'qf.state.yes' });
  assert.deepEqual(qualLine({ wifi: 'yes', lead: 'no' }), { key: 'qf.state.no' });
  // a picked row tapped again is unanswered: the folded answer shows again
  assert.deepEqual(qualRows({ wifi: 'yes' }, { wifi: undefined }, new Set()).map((r) => r.value), [null, 'yes', null]);
  // every row and every answer has its words
  for (const r of QUAL_ROWS) { assert.ok(`qf.${r.key}` in DICT.es); for (const o of r.options) assert.ok((r.key === 'workers' ? `qf.workers.${o}` : `qf.${o}`) in DICT.es, `${r.key} ${o}`); }
});

test('qualOf and mergeQ say what the server says, on the same inputs', () => {
  assert.deepEqual(QUAL_KINDS, rules.QUAL_KINDS);
  assert.deepEqual(Object.fromEntries(QUAL_ROWS.map((r) => [r.key, r.options])), rules.QUAL);
  const qs = [null, {}, { wifi: 'yes' }, { lead: 'yes' }, { wifi: 'yes', lead: 'yes' }, { wifi: 'no' }, { lead: 'no', wifi: 'yes' }, { wifi: 'unknown', lead: 'yes' },
    { workers: '50plus' }, { wifi: 'unknown', lead: 'unknown' }, { wifi: 'yes', lead: 'unknown', workers: 'lt10' }, { wifi: 'no', lead: 'no' }];
  assert.equal(qs.length, 12);
  for (const q of qs) assert.deepEqual(qualOf(q), rules.qualOf(q), JSON.stringify(q));
  const pairs = [[null, { wifi: 'yes' }], [{ wifi: 'yes' }, { wifi: 'unknown' }], [{ wifi: 'no' }, { wifi: 'unknown' }], [{ wifi: 'unknown' }, { wifi: 'yes' }],
    [{ wifi: 'yes' }, { lead: 'no' }], [{ workers: 'lt10' }, { workers: '30_49' }], [{ lead: 'yes' }, { lead: 'no' }], [{ lead: 'unknown' }, { lead: 'unknown' }],
    [{}, {}], [{ wifi: 'yes', lead: 'yes' }, { wifi: 'unknown', lead: 'unknown', workers: '10_29' }], [{ wifi: 'no' }, null], [{ workers: '50plus' }, { wifi: 'no', lead: 'yes' }]];
  assert.equal(pairs.length, 12);
  for (const [a, b] of pairs) assert.deepEqual(mergeQ(a, b), rules.mergeQ(a, b), JSON.stringify([a, b]));
});

// Fix round C1 (K1): "Cerrar como No califica" belongs to the business it was armed on.
test('picking another business clears the taps and the not-fit close they armed, and keeps any other tag', () => {
  const armed = bizSwitch({ tag: 'not_fit', reason: 'no_wifi_lead', armed: true, qual: { wifi: 'no' } });
  assert.deepEqual({ ...armed, qOpen: [...armed.qOpen] }, { tag: null, reason: null, armed: false, qual: {}, qOpen: [] });
  // a tag the rep picked under "Cómo quedó" stays: only what the button armed follows it off
  const other = bizSwitch({ tag: 'not_now', reason: null, qual: { wifi: 'yes' } });
  assert.deepEqual([other.tag, other.reason, other.qual], ['not_now', null, {}]);
  const lost = bizSwitch({ tag: 'not_interested', reason: 'privacy', qual: {} });
  assert.deepEqual([lost.tag, lost.reason], ['not_interested', 'privacy']);
  assert.equal(notFitArmed({ tag: 'not_fit', reason: 'no_wifi_lead' }), true);
  assert.equal(notFitArmed({ tag: 'not_fit', reason: 'privacy' }), false);
  assert.equal(notFitArmed({ tag: null, reason: null }), false);
});

// Track F, F0: only the button's own arm follows the business off; the same tag and reason picked by hand stay.
test('a "No califica" with its reason picked by hand survives a business change; the button\'s arm does not', () => {
  const hand = bizSwitch({ tag: 'not_fit', reason: 'no_wifi_lead', armed: false, qual: { wifi: 'no' } });
  assert.deepEqual([hand.tag, hand.reason, hand.armed], ['not_fit', 'no_wifi_lead', false]);
  const old = bizSwitch({ tag: 'not_fit', reason: 'no_wifi_lead' });   // no mark: picked by hand
  assert.deepEqual([old.tag, old.reason], ['not_fit', 'no_wifi_lead']);
  const btn = bizSwitch({ tag: 'not_fit', reason: 'no_wifi_lead', armed: true });
  assert.deepEqual([btn.tag, btn.reason, btn.armed], [null, null, false]);
});
