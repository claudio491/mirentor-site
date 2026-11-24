// A log the phone queued with no signal goes out later with the moment of the contact (clientAt) and, from the client
// that knows it, the moment the request left the phone (sentAt). The phone's clock is judged on sentAt: an honest
// rep who was offline is not flagged, a phone clock that is off still is. The log's day stays the server's.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { start, logBody, MON_10 } from './team-helper.mjs';

const API = '/equipo/api';
const iso = (ms) => new Date(ms).toISOString(), H = 3600 * 1000, M = 60 * 1000;

test('the phone clock is judged on when the request left the phone; without that, on the contact time as before', async (t) => {
  const s = await start(); t.after(() => s.srv.close());
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  let n = 0;
  const log = (over) => { n += 1; return s.call('POST', `${API}/log`, logBody(`sent-at-${String(n).padStart(4, '0')}`, { lead: { name: `Negocio ${n}`, zone: 'Centro' }, ...over }), { cookie: m.cookie }); };
  const cases = [
    // [what the phone sends, flagged]
    [{ clientAt: iso(MON_10 - 3 * H), sentAt: iso(MON_10 + 5000) }, false],    // queued three hours offline, honest clock
    [{ clientAt: iso(MON_10 - 3 * H) }, true],                                // an older client: judged on the contact time, as before
    [{ clientAt: iso(MON_10 - 3 * H), sentAt: iso(MON_10 + 20 * M) }, true],  // the phone clock runs 20 minutes ahead
    [{ clientAt: iso(MON_10 - 30 * M), sentAt: iso(MON_10 - 30 * M) }, true], // a contact back-dated on the phone's clock
    [{ clientAt: iso(MON_10), sentAt: iso(MON_10 + 2 * M) }, false],
    [{ clientAt: iso(MON_10 - 3 * H), sentAt: 'ayer por la tarde' }, true],   // unreadable: ignored, judged on the contact time
    [{ clientAt: iso(MON_10 - 3 * H), sentAt: 1763305200000 }, true],
    [{ clientAt: iso(MON_10 - 3 * H), sentAt: { at: 'now' } }, true],
    [{ clientAt: iso(MON_10), sentAt: iso(MON_10 - H) }, false],              // left the phone before the contact: absurd, ignored
    [{ clientAt: 'nunca', sentAt: iso(MON_10 + H) }, true],                   // no contact time: the request's own time is still judged
  ];
  for (const [body, late] of cases) {
    const r = await log(body);
    assert.equal(r.status, 200, `${JSON.stringify(body)} ${r.text}`);
    const e = s.lines().find((x) => x.type === 'log' && x.id === r.json.logId);
    assert.deepEqual([e.late === true, e.t], [late, iso(MON_10)], JSON.stringify(body));   // the time kept is the server's
  }
  const me = (await s.call('GET', `${API}/me`, undefined, { cookie: m.cookie })).json;
  assert.equal(me.today.day, '2026-11-16');
  assert.equal((await s.call('GET', `${API}/team`, undefined, { cookie: a.cookie })).json.needs.late.length, cases.filter(([, late]) => late).length);
});

test('a log queued last evening and sent this morning keeps the server\'s day, and is not flagged when its phone clock was right', async (t) => {
  const s = await start({ clock: Date.parse('2026-11-17T14:05:00Z') }); t.after(() => s.srv.close());   // Tuesday 09:05 in Panama
  const a = await s.admin(), m = await s.addRep(a.cookie, 'mario');
  const r = await s.call('POST', `${API}/log`, logBody('queued-mon-0001', { clientAt: '2026-11-16T23:30:00.000Z', sentAt: '2026-11-17T14:05:00.000Z', unknownFieldFromANewerClient: 1 }), { cookie: m.cookie });
  assert.equal(r.status, 200, r.text);
  const e = s.lines().find((x) => x.id === 'queued-mon-0001');
  assert.deepEqual([e.late, e.clientAt, e.sentAt, e.t], [undefined, '2026-11-16T23:30:00.000Z', '2026-11-17T14:05:00.000Z', '2026-11-17T14:05:00.000Z']);
  assert.equal(r.json.me.today.day, '2026-11-17');
  assert.equal(r.json.me.today.visits, 1, 'counted on the server\'s day, as the documented rule says');
});
