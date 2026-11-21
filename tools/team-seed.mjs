// team-seed.mjs: fill an EMPTY data folder with fictional reps and two weeks of work, for previews and demos.
//   node tools/team-seed.mjs <data-dir>
// Every person, business and number here is made up. The folder gets a SAMPLE marker, and the app then labels
// every screen as sample data. It refuses to touch a folder that already holds events.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openTeamStore } from '../lib/team/store.mjs';
import { saveConsent } from '../lib/team/consent.mjs';
import { channelOf, weekStart, monthStart, addDays, localDay } from '../lib/team/rules.mjs';

const TZ = 'America/Panama', UTC_OFFSET_H = 5;   // Panama is UTC-5 all year
export const at = (day, hhmm) => { const [hh, mm] = hhmm.split(':').map(Number); return new Date(Date.parse(`${day}T00:00:00Z`) + ((hh + UTC_OFFSET_H) * 60 + mm) * 60000).toISOString(); };

export const SAMPLE_REPS = [
  { id: 'r_sample_andrea', handle: 'andrea', name: 'Andrea Quintero', city: 'Panama City', role: 'rep' },
  { id: 'r_sample_omar', handle: 'omar', name: 'Omar Rivas', city: 'Colón', role: 'rep' },
  { id: 'r_sample_luis', handle: 'luis', name: 'Luis Batista', city: 'Panama City', role: 'rep' },
  { id: 'r_sample_camila', handle: 'camila', name: 'Camila Herrera', city: 'Panama City', role: 'rep' },
  { id: 'r_sample_nadia', handle: 'nadia', name: 'Nadia Pérez', city: 'Panama City', role: 'rep', isNew: true },
  { id: 'r_sample_lider', handle: 'lider', name: 'Líder de Ejemplo', city: 'Panama City', role: 'admin' },
];
// Fictional businesses. `known` gives the CRM an earlier contact, so a first log this week can be a follow-up.
const LEADS = {
  P1: ['Ferretería El Roble', 'Vía España', 'Panama City', true], P2: ['Taller Hermanos Pinzón', 'Río Abajo', 'Panama City'], P3: ['Distribuidora Istmo', 'Tumba Muerto', 'Panama City', true],
  P4: ['Panadería La Espiga', 'El Cangrejo', 'Panama City'], P5: ['Carpintería Don Chema', 'San Miguelito', 'Panama City'], P6: ['Lavandería Burbujas', 'Bella Vista', 'Panama City'],
  P7: ['Imprenta Tres Tintas', 'Calidonia', 'Panama City'], P8: ['Mueblería Casa Linda', 'Los Andes', 'Panama City', true], P9: ['Repuestos El Cruce', 'Juan Díaz', 'Panama City'],
  P10: ['Vidriería Cristal', 'Pueblo Nuevo', 'Panama City'], P11: ['Tapicería El Detalle', 'Parque Lefevre', 'Panama City', true], P12: ['Cerrajería La Llave', 'Betania', 'Panama City', true],
  P13: ['Herrería San José', 'Pedregal', 'Panama City'], P14: ['Zapatería El Paso', 'Santa Ana', 'Panama City'],
  C1: ['Bodega San Judas', 'Calle 10', 'Colón', true], C2: ['Taller Naval Atlántico', 'Cristóbal', 'Colón', true], C3: ['Costuras Marisol', 'Calle 7', 'Colón'],
  C4: ['Ferretería El Ancla', 'Avenida Central', 'Colón'], C5: ['Panadería Doña Tita', 'Barrio Sur', 'Colón'], C6: ['Refrigeración Polo Norte', 'Cativá', 'Colón'],
};
const leadId = (key) => `EJ-${key}`;
const leadOf = (key) => ({ id: leadId(key), name: LEADS[key][0], zone: LEADS[key][1] });

// One line per log: [time, kind, business, extras]. 'close' closes the day with what comes next.
const THIS_WEEK = {
  andrea: [
    [['09:40', 'talk', 'P1'], ['11:15', 'call', 'P3'], ['15:30', 'absent', 'P2'], ['18:10', 'close', 'Volver a Taller Hermanos Pinzón a las 10']],
    [['10:05', 'talk', 'P4'], ['12:20', 'meeting', 'P5', { channel: 'visit', contact: 'Sra. Maritza, dueña', whenIn: 2, play: 'Pregunté quién decide las compras antes de presentar el programa. Me pasaron con la dueña.' }], ['16:00', 'call', 'P1'], ['18:40', 'close', 'Confirmar la reunión con Carpintería Don Chema']],
    [['09:50', 'absent', 'P6'], ['11:30', 'talk', 'P7'], ['14:10', 'message', 'P8', { channel: 'whatsapp' }], ['19:20', 'close', 'Dos visitas en Río Abajo']],
    [['10:20', 'talk', 'P2'], ['15:00', 'call', 'P9'], ['18:05', 'close', 'Reunión con Carpintería Don Chema a las 11']],
    [['09:30', 'talk', 'P10'], ['11:00', 'call', 'P4']],
  ],
  omar: [
    [['09:10', 'talk', 'C1'], ['10:40', 'talk', 'C2'], ['13:00', 'meeting', 'C3', { channel: 'visit', contact: 'Don Rogelio, dueño', whenIn: 1, confirmIn: 2, play: 'Llegué a las 9, antes de que abrieran al público. El dueño tuvo tiempo de escucharme.' }], ['17:50', 'close', 'Llevar el contrato a Costuras Marisol']],
    [['09:30', 'talk', 'C4'], ['11:00', 'call', 'C2'], ['15:10', 'contract', 'C3', { contact: 'Don Rogelio, dueño' }], ['18:00', 'close', 'Visitar Barrio Sur y Cativá']],
    [['09:20', 'talk', 'C5'], ['10:50', 'talk', 'C6'], ['14:00', 'call', 'C4'], ['17:45', 'close', 'Seguimiento a Bodega San Judas']],
    [['09:40', 'talk', 'C1'], ['11:30', 'call', 'C5'], ['18:15', 'close', 'Dos seguimientos y una visita nueva']],
    [['09:15', 'talk', 'C2'], ['10:45', 'call', 'C6']],
  ],
  luis: [
    [['10:30', 'talk', 'P11'], ['14:00', 'call', 'P12'], ['18:30', 'close', 'Volver a Herrería San José']],
    [['11:00', 'absent', 'P13'], ['15:20', 'call', 'P11']],
    [['10:10', 'talk', 'P14'], ['12:30', 'call', 'P12'], ['18:50', 'close', 'Llamar a Zapatería El Paso']],
    [['10:00', 'talk', 'P13']],
    [],
  ],
  camila: [
    [['11:20', 'absent', 'P9']],
    [['15:45', 'message', 'P10', { channel: 'email', lateBy: 180 }]],
    [['10:40', 'talk', 'P9']],
    [],
    [],
  ],
  nadia: [
    [['10:00', 'talk', 'P8'], ['18:00', 'close', 'Acompañar a Andrea en dos visitas']],
    [['10:30', 'call', 'P14']],
    [['11:10', 'talk', 'P12'], ['17:30', 'close', 'Mi primera reunión']],
    [['09:45', 'absent', 'P6']],
    [],
  ],
};
// Last week, in short: which days each rep worked a full day (F), had a conversation only (c) or nothing (-).
const LAST_WEEK = { andrea: 'FFcFc', omar: 'FFFFF', luis: 'cFccc', camila: 'c-c--', nadia: '-----' };
const LAST_LEADS = { andrea: ['P1', 'P3', 'P6'], omar: ['C1', 'C2', 'C4'], luis: ['P11', 'P12', 'P13'], camila: ['P9', 'P10', 'P2'], nadia: [] };

/** `names` shows a sample person under another label, by handle: { andrea: 'Vendedor A' }, and `handles` gives them
 *  another username: { andrea: 'vendedor.a' }. The person and their week of work stay the same. */
// A blank 1x1 PNG stands in for a signed consent: the sample has the file on disk, and it shows nothing of anyone.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mN8/58BAAAEAQH/7k3ULwAAAABJRU5ErkJggg==', 'base64');
/** The practice site of the sample's first rep (it reaches her Hoy as a card), with its phones marked and three placeholder workers: one ready, one who still
 *  needs a consent, one with a consent who still needs a phone. Every name says it is a placeholder. */
function practiceSite(dir, rep, boss, day) {
  const site = 's_sample_practice', T = (hhmm) => at(day, hhmm), by = rep, out = [];
  out.push({ type: 'site', id: site, rep, lead: { id: null, name: 'Sitio de práctica' }, city: 'Panama City', eligible: 3, practice: true, by: boss, t: T('09:00') });
  out.push({ type: 'site.phones', siteId: site, count: 3, by: boss, t: T('09:05') });
  out.push({ type: 'site.prep', siteId: site, what: 'signs', by, t: T('09:20') });
  const worker = (n, hhmm) => { const id = `w_sampleWorker${n}`; out.push({ type: 'worker.added', siteId: site, id, name: `Trabajador ${n}`, email: `trabajador${n}@ejemplo.test`, phone: true, by, t: T(hhmm) }); return id; };
  const consent = (id, hhmm) => { const kept = saveConsent(dir, id, BLANK_PNG); out.push({ type: 'worker.consent', workerId: id, ext: kept.ext, v: kept.v, form: 'v1', by, t: T(hhmm) }); };
  const w1 = worker(1, '09:30'); consent(w1, '09:34');
  out.push({ type: 'worker.phone', workerId: w1, imei: '490154203237518', by, t: T('09:36') }, { type: 'worker.clip', workerId: w1, by, t: T('09:40') });
  worker(2, '09:45');
  const w3 = worker(3, '09:50'); consent(w3, '09:55');
  return out;
}

/** `practice` adds a practice site for the rep andrea with three placeholder workers, for looking at the install screens. */
export function seed(dir, { now = new Date(), names = {}, handles = {}, practice = false } = {}) {
  const events = path.join(dir, 'team', 'events.jsonl');
  if (existsSync(events) && readFileSync(events, 'utf8').trim()) throw new Error(`${events} already holds events: the seed only fills an empty folder`);
  mkdirSync(path.join(dir, 'team'), { recursive: true });
  writeFileSync(path.join(dir, 'team', 'SAMPLE'), 'Sample data written by tools/team-seed.mjs. Every person and business here is fictional.\n');
  const nowIso = now.toISOString(), today = localDay(nowIso, TZ), ws = weekStart(today);
  const out = [];
  const push = (e) => { if (e.t <= nowIso) out.push(e); };

  for (const r of SAMPLE_REPS) {
    const start = r.isNew ? addDays(today, -5) : addDays(today, -60), t = at(start, '08:00');
    const handle = typeof handles[r.handle] === 'string' && /^[a-z0-9][a-z0-9._-]{1,39}$/.test(handles[r.handle]) ? handles[r.handle] : r.handle;
    // An address under .test, the ending kept for examples: it can never be anyone's.
    out.push({ type: 'rep.created', id: r.id, handle, email: `${handle}@ejemplo.test`, name: (typeof names[r.handle] === 'string' && names[r.handle].trim()) || r.name, role: r.role, country: 'PA', city: r.city, tz: TZ, workdays: [1, 2, 3, 4, 5], startDate: start, lang: 'es', t });
  }
  const id = (handle) => `r_sample_${handle}`;
  let n = 0;
  const log = (handle, day, time, kind, key, x = {}) => {
    const logId = `sample-${handle}-${day}-${String(n += 1).padStart(3, '0')}`, t = at(day, time);
    const e = { type: 'log', id: logId, rep: id(handle), lead: leadOf(key), kind, clientAt: x.lateBy ? new Date(Date.parse(t) - x.lateBy * 60000).toISOString() : t, t };
    const ch = channelOf(kind, x.channel); if (ch) e.channel = ch;
    if (x.lateBy) e.late = true;
    if (LEADS[key][3]) e.prior = addDays(ws, -16);   // the CRM already had a contact with this business, as the API stamps it
    if (x.contact) e.contact = x.contact;
    if (x.whenIn != null) e.when = addDays(day, x.whenIn);
    push(e);
    if (x.play) push({ type: 'play', logId, text: x.play, t: at(day, time.replace(/:\d\d$/, ':59')) });
    if (x.confirmIn != null) { push({ type: 'log.held', logId, t: at(addDays(day, x.whenIn ?? 1), '12:10') }); push({ type: 'confirm', logId, what: 'meeting_held', by: id('lider'), t: at(addDays(day, x.confirmIn), '08:40') }); }
    return logId;
  };
  const close = (handle, day, time, tomorrow) => push({ type: 'day.close', rep: id(handle), day, tomorrow, blocker: '', t: at(day, time) });

  // last week: enough for a streak and a suggested goal
  for (const [handle, pattern] of Object.entries(LAST_WEEK)) {
    const [a, b, c] = LAST_LEADS[handle];
    [...pattern].forEach((mark, i) => {
      const day = addDays(ws, i - 7);
      if (mark === '-') return;
      log(handle, day, '09:45', 'talk', i % 2 ? b : a);
      if (mark === 'F') { log(handle, day, '11:30', 'call', i % 2 ? a : b); log(handle, day, '15:00', 'call', c); close(handle, day, '18:15', 'Seguir con la lista de la zona'); }
    });
  }
  // this week
  const ids = {};
  for (const [handle, days] of Object.entries(THIS_WEEK)) {
    days.forEach((entries, i) => {
      const day = addDays(ws, i);
      for (const [time, kind, key, x] of entries) { if (kind === 'close') close(handle, day, time, key); else ids[`${handle}:${i}:${kind}`] = log(handle, day, time, kind, key, x); }
    });
  }
  push({ type: 'goal.pick', rep: id('andrea'), week: ws, k: 4, t: at(ws, '08:30') });
  // applause, a recognition and a signed site
  const clap = (by, target, day, time) => { if (target) push({ type: 'kudos', by: id(by), target, on: true, t: at(day, time) }); };
  clap('luis', ids['omar:0:meeting'], ws, '13:30'); clap('camila', ids['omar:0:meeting'], ws, '14:05'); clap('andrea', ids['omar:0:meeting'], ws, '16:10');
  clap('omar', ids['andrea:1:meeting'], addDays(ws, 1), '12:50'); clap('nadia', ids['andrea:1:meeting'], addDays(ws, 1), '13:15');
  push({ type: 'badge.give', id: 'sample-badge-1', rep: id('luis'), text: 'Volvió tres veces a la misma cuadra hasta encontrar al dueño.', by: id('lider'), t: at(addDays(ws, 2), '17:00') });
  const ms = monthStart(today), signed = addDays(ms, 2) < ws ? addDays(ms, 2) : addDays(ws, -3);
  push({ type: 'site', id: 's_sample_1', rep: id('omar'), lead: { id: null, name: 'Astillero El Faro' }, by: id('lider'), t: at(signed, '16:00') });
  push({ type: 'site.step', siteId: 's_sample_1', what: 'installed', by: id('lider'), t: at(addDays(signed, 3), '11:00') });

  if (practice) out.push(...practiceSite(dir, id('andrea'), id('lider'), addDays(today, -1)));

  out.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  const store = openTeamStore(dir);
  for (const e of out) store.append(e);
  store.setLeads(Object.entries(LEADS).map(([key, [company, zone, city, known]]) => ({ id: leadId(key), company, zone, city, stage: known ? 'Contacted' : 'New', ...(known ? { lastContact: addDays(ws, -16) } : {}) })));
  return { events: out.length, reps: SAMPLE_REPS.map((r) => `${r.handle} (${r.role})`) };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  const dir = process.argv[2];
  if (!dir) { console.error('usage: node tools/team-seed.mjs <data-dir>'); process.exit(1); }
  try {
    const r = seed(dir);
    console.log(`Sample data written to ${dir}: ${r.events} events, all fictional.`);
    console.log(`People: ${r.reps.join(', ')}. To look at it, run tools/team-dev.mjs --sample and choose who to be.`);
  } catch (err) { console.error(err.message); process.exit(1); }
}
