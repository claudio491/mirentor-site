import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEntry, toCells } from '../lib/entry.mjs';

const NOW = new Date('2026-11-03T17:00:00Z');
const ID = '3f2b8c1e-9a4d-4e2b-8f6a-1c2d3e4f5a6b';
const body = (over = {}) => ({
  id: ID, lang: 'es', business: '  Almacenes Rivera ', workers: '1.200', industry: 'warehouse',
  city: 'Ciudad de Panamá', country: 'PA', contact: 'Ana Rivera', email: 'ana@rivera.com.pa',
  whatsapp: '+507 6000 0000', pay_ack: 'yes', website: '', ...over,
});

test('a valid body becomes an entry with a lead ID from the client id', () => {
  const r = parseEntry(body(), NOW);
  assert.equal(r.ok, true);
  assert.equal(r.entry.leadId, 'WL-3F2B8C1E');
  assert.equal(r.entry.business, 'Almacenes Rivera');
  assert.equal(r.entry.workers, 1200);
  assert.equal(r.entry.submittedAt, '2026-11-03T17:00:00.000Z');
  assert.equal(r.entry.payAck, true);
});

test('missing required fields are all listed', () => {
  const r = parseEntry(body({ business: '', email: ' ', pay_ack: '' }), NOW);
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, ['business', 'email', 'pay_ack']);
});

test('a bad client id, email, worker count, pick or WhatsApp is rejected', () => {
  assert.deepEqual(parseEntry(body({ id: 'x' }), NOW).errors, ['id']);
  assert.deepEqual(parseEntry(body({ email: 'ana@rivera' }), NOW).errors, ['email']);
  assert.deepEqual(parseEntry(body({ workers: 'muchos' }), NOW).errors, ['workers']);
  assert.deepEqual(parseEntry(body({ industry: 'mining', country: 'XX' }), NOW).errors, ['industry', 'country']);
  assert.deepEqual(parseEntry(body({ whatsapp: '6000 0000' }), NOW).errors, ['whatsapp']);
});

test('WhatsApp is optional', () => {
  assert.equal(parseEntry(body({ whatsapp: '' }), NOW).ok, true);
});

test('a filled honeypot is spam and stores nothing', () => {
  assert.deepEqual(parseEntry(body({ website: 'http://x' }), NOW), { ok: true, spam: true });
});

test('text is capped at 200 characters', () => {
  assert.equal(parseEntry(body({ business: 'a'.repeat(500) }), NOW).entry.business.length, 200);
});

test('toCells fills Leads A to P and the notes', () => {
  const { aToP, notes } = toCells(parseEntry(body(), NOW).entry);
  assert.equal(aToP.length, 16);
  assert.deepEqual(aToP, [
    'WL-3F2B8C1E', 'Almacenes Rivera', 'Ana Rivera', '', 'ana@rivera.com.pa', '+507 6000 0000', '',
    'Ciudad de Panamá', 'Panama', 'Warehouse or logistics', 1200, 'Waitlist form',
    'Site form, 2026-11-03, Spanish page', 'Spanish', '', 'Waitlist',
  ]);
  assert.equal(notes, 'Pay rule acknowledged on the form.');
});

test('an English entry from another country maps its names', () => {
  const { aToP } = toCells(parseEntry(body({ lang: 'en', country: 'other', industry: 'office' }), NOW).entry);
  assert.equal(aToP[8], 'Other');
  assert.equal(aToP[9], 'Office or services');
  assert.equal(aToP[12], 'Site form, 2026-11-03, English page');
  assert.equal(aToP[13], 'English');
});
