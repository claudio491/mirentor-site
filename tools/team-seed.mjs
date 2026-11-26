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
  // the business in the rep's hand: a meeting nobody marked, one for today, a lost one, one another rep holds, and free ones in Andrea's two zones
  P15: ['Taller de Motos Rayo', 'Río Abajo', 'Panama City'], P16: ['Panificadora Santa Rita', 'Vía España', 'Panama City'], P17: ['Aserradero Los Pinos', 'San Miguelito', 'Panama City'],
  P18: ['Fábrica de Hielo Polar', 'Calidonia', 'Panama City'], P19: ['Costura Fina', 'El Cangrejo', 'Panama City'], P20: ['Talabartería El Estribo', 'Bella Vista', 'Panama City'],
  P21: ['Marmolería Piedra Blanca', 'El Cangrejo', 'Panama City'], P22: ['Tornería Precisión', 'Bella Vista', 'Panama City'],
  C1: ['Bodega San Judas', 'Calle 10', 'Colón', true], C2: ['Taller Naval Atlántico', 'Cristóbal', 'Colón', true], C3: ['Costuras Marisol', 'Calle 7', 'Colón'],
  C4: ['Ferretería El Ancla', 'Avenida Central', 'Colón'], C5: ['Panadería Doña Tita', 'Barrio Sur', 'Colón'], C6: ['Refrigeración Polo Norte', 'Cativá', 'Colón'],
};
// What the CRM holds for each business, all made up: who to ask for, a phone of the 6000 series, an address under
// .test, a Maps link to an example host, the hands-on workers and the walk-in score. P2 has no contact yet, so the log
// sheet asks for one there.
const PEOPLE = ['Sra. Maritza Gómez', 'Don Rogelio Vega', 'Ing. Carla Ruiz', 'Sr. Tomás Ábrego', 'Lic. Yaritza Mora', 'Don Efraín Castillo', 'Sra. Gloria Batista', 'Sr. Iván Morales'];
const TITLES = ['Dueña', 'Dueño', 'Gerente de operaciones', 'Jefe de taller', 'Administradora', 'Dueño', 'Encargada', 'Supervisor de planta'];
const TRADE = { Ferretería: 'Comercio', Taller: 'Servicios', Distribuidora: 'Comercio', Panadería: 'Alimentos', Panificadora: 'Alimentos', Carpintería: 'Manufactura', Lavandería: 'Servicios', Imprenta: 'Manufactura',
  Mueblería: 'Manufactura', Repuestos: 'Comercio', Vidriería: 'Manufactura', Tapicería: 'Manufactura', Cerrajería: 'Servicios', Herrería: 'Manufactura', Zapatería: 'Manufactura', Bodega: 'Comercio',
  Costuras: 'Manufactura', Costura: 'Manufactura', Refrigeración: 'Servicios', Aserradero: 'Manufactura', Fábrica: 'Manufactura', Talabartería: 'Manufactura', Marmolería: 'Manufactura', Tornería: 'Manufactura' };
const slug = (name) => name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
function crmFields(key, i) {
  const [company, zone, city] = LEADS[key], word = company.split(' ')[0], s = slug(company);
  const out = { phone: `+507 6000-${String(101 + i).padStart(4, '0')}`, email: `contacto@${s}.ejemplo.test`, address: `Calle ${10 + (i % 40)}, local ${i + 1}, ${zone}`,
    maps: `https://maps.example/${s}`, industry: TRADE[word] || 'Servicios', category: word, workers: 6 + ((i * 7) % 38), walkin: 1 + ((i * 3) % 5), rating: Math.round((3.8 + (i % 12) / 10) * 10) / 10, reviews: 12 + i * 9 };
  if (key !== 'P2') Object.assign(out, { contact: PEOPLE[i % PEOPLE.length], title: TITLES[i % TITLES.length] });
  if (i % 3 === 0) out.website = `https://${s}.ejemplo.test`;
  if (city !== 'Panama City' && city !== 'Colón') delete out.maps;
  return out;
}
const leadId = (key) => `EJ-${key}`;
const leadOf = (key) => ({ id: leadId(key), name: LEADS[key][0], zone: LEADS[key][1] });

// One line per log: [time, kind, business, extras]. 'close' closes the day with what comes next.
const THIS_WEEK = {
  andrea: [
    [['09:40', 'talk', 'P1', { q: { workers: '10_29', wifi: 'yes', lead: 'yes' } }], ['11:15', 'call', 'P3', { q: { workers: 'lt10', wifi: 'yes' } }], ['15:30', 'absent', 'P2'], ['18:10', 'close', 'Volver a Taller Hermanos Pinzón a las 10']],
    [['10:05', 'talk', 'P4'], ['12:20', 'meeting', 'P5', { channel: 'visit', contact: 'Sra. Maritza, dueña', whenIn: 2, play: 'Pregunté quién decide las compras antes de presentar el programa. Me pasaron con la dueña.' }], ['16:00', 'call', 'P1'], ['18:40', 'close', 'Confirmar la reunión con Carpintería Don Chema']],
    [['09:50', 'absent', 'P6'], ['11:30', 'talk', 'P7'], ['14:10', 'message', 'P8', { channel: 'whatsapp' }], ['19:20', 'close', 'Dos visitas en Río Abajo']],
    [['10:20', 'talk', 'P2'], ['15:00', 'call', 'P9'], ['18:05', 'close', 'Reunión con Carpintería Don Chema a las 11']],
    [['09:30', 'talk', 'P10'], ['11:00', 'call', 'P4']],
  ],
  omar: [
    [['09:10', 'talk', 'C1', { q: { wifi: 'no', lead: 'unknown' } }], ['10:40', 'talk', 'C2', { q: { lead: 'yes' } }], ['13:00', 'meeting', 'C3', { channel: 'visit', contact: 'Don Rogelio, dueño', whenIn: 1, confirmIn: 2, play: 'Llegué a las 9, antes de que abrieran al público. El dueño tuvo tiempo de escucharme.' }], ['17:50', 'close', 'Llevar el contrato a Costuras Marisol']],
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
    [['09:45', 'absent', 'P6'], ['14:30', 'close', 'Volver a Lavandería Burbujas']],
    [],
  ],
};
// Last week, in short: which days each rep worked a full day (F), had a conversation only (c) or nothing (-).
const LAST_WEEK = { andrea: 'FFcFc', omar: 'FFFFF', luis: 'cFccc', camila: 'c-c--', nadia: '-----' };
const LAST_LEADS = { andrea: ['P1', 'P3', 'P6'], omar: ['C1', 'C2', 'C4'], luis: ['P11', 'P12', 'P13'], camila: ['P9', 'P10', 'P2'], nadia: [] };

/** `names` shows a sample person under another label, by handle: { andrea: 'Vendedor A' }, and `handles` gives them
 *  another username: { andrea: 'vendedor.a' }. The person and their week of work stay the same. */
// A 1x1 PNG the color of paper stands in for a signed consent: the sample has the file on disk, and it shows nothing of anyone.
const BLANK_PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP49OEVAAWkAs0fqFFdAAAAAElFTkSuQmCC', 'base64');
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

/** What the leadership view needs to be looked at: a leader account, two weeks of hours and, in one city, a site
 *  installed before the app and one installed with it, with placeholder workers. Every name reads as a placeholder and
 *  every number is made up. */
export const SAMPLE_LEADER = { id: 'r_sample_liderazgo', handle: 'liderazgo', name: 'Liderazgo de Ejemplo', city: '', role: 'leader' };
function leadership(dir, rep, boss, ws) {
  const out = [], T = (day, hhmm) => at(day, hhmm), by = rep;
  // two weeks of hours, in minutes: one pushed from the Scorecard, one typed by a manager
  out.push({ type: 'hours.week', week: addDays(ws, -14), delivered: 1830, accepted: 1290, source: 'manual', by: boss, t: T(addDays(ws, -7), '09:00') });
  out.push({ type: 'hours.week', week: addDays(ws, -7), delivered: 2615, accepted: 2075, source: 'scorecard', t: T(ws, '09:00') });
  // a site from before the app: its consents are on paper, not here
  out.push({ type: 'site', id: 's_sample_legacy', rep, lead: { id: null, name: 'Sitio de ejemplo A' }, city: 'Panama City', eligible: 9, legacy: true, by: boss, t: T(addDays(ws, -30), '10:00') });
  // a site installed with the app: four placeholder workers, all signed, three with a phone
  const site = 's_sample_app', day = addDays(ws, -6);
  out.push({ type: 'site', id: site, rep, lead: { id: null, name: 'Sitio de ejemplo B' }, city: 'Panama City', eligible: 7, by: boss, t: T(addDays(ws, -9), '10:00') });
  out.push({ type: 'site.phones', siteId: site, count: 3, by: boss, t: T(day, '08:30') });
  const imeis = ['356938035643809', '358472091234566', '352099001761481'];   // valid check digits, none the practice site's
  for (let n = 1; n <= 4; n += 1) {
    const id = `w_sampleB${n}`, kept = saveConsent(dir, id, BLANK_PNG);
    out.push({ type: 'worker.added', siteId: site, id, name: `Persona de ejemplo ${n}`, email: `persona${n}@ejemplo.test`, phone: n <= 3, by, t: T(day, `09:${10 + n}`) });
    out.push({ type: 'worker.consent', workerId: id, ext: kept.ext, v: kept.v, form: 'v1', by, t: T(day, `09:${20 + n}`) });
    if (n <= 3) out.push({ type: 'worker.phone', workerId: id, imei: imeis[n - 1], by, t: T(day, `09:${30 + n}`) }, { type: 'worker.clip', workerId: id, by, t: T(day, `09:${40 + n}`) });
  }
  out.push({ type: 'install.close', siteId: site, by, t: T(day, '11:00') });
  out.push({ type: 'site.step', siteId: site, what: 'installed', by: boss, t: T(addDays(day, 1), '09:00') });
  return out;
}

/** Invented cards (documents with a text, read in the app): three in "Para vender", the script and its answers, and one
 *  in "Contratos" hooked to the contract step. Each says it is an example: the team's real script is loaded at runtime by
 *  a manager and never written here. */
export const SAMPLE_CARDS = [
  { id: 'd_sample-card-open', group: 'vender', order: 0, step: 'kit', title: { es: 'La apertura (ejemplo)', en: 'The opening (example)' },
    body: { es: 'Esta tarjeta es un ejemplo inventado: tu líder carga el guion real.\n\nDi: buenos días, soy de Mirentor. ¿Me regala dos minutos con quien decide?',
      en: 'This card is an invented example: your lead loads the real script.\n\nSay: good morning, I am with Mirentor. Could I have two minutes with whoever decides?' } },
  { id: 'd_sample-card-scam', group: 'vender', order: 1, title: { es: 'Si dicen que es una estafa (ejemplo)', en: 'If they say it is a scam (example)' },
    body: { es: 'Ejemplo inventado de una respuesta. Escucha primero y no discutas.\n\nDi: lo entiendo. Le dejo la página y el contrato para que lo lea con calma.',
      en: 'An invented example of an answer. Listen first and do not argue.\n\nSay: I understand. I will leave you the page and the contract to read calmly.' } },
  { id: 'd_sample-card-book', group: 'vender', order: 2, title: { es: 'Agendar la reunión (ejemplo)', en: 'Booking the meeting (example)' },
    body: { es: 'Ejemplo inventado: propón dos horas concretas en vez de preguntar cuándo.\n\nDi: ¿le queda mejor el martes a las 10 o el jueves a las 3?',
      en: 'Invented example: offer two exact times instead of asking when.\n\nSay: does Tuesday at 10 or Thursday at 3 work better for you?' } },
  { id: 'd_sample-card-contract', group: 'contrato', order: 0, step: 'contract', title: { es: 'Antes de enviar el contrato (ejemplo)', en: 'Before sending the contract (example)' },
    body: { es: 'Ejemplo inventado: confirma que hay wifi y alguien que coordine antes de enviarlo.\n\nEl contrato real lo carga tu líder.',
      en: 'Invented example: confirm there is Wi-Fi and someone to coordinate before sending it.\n\nYour lead loads the real contract.' } },
];
const sampleCards = (by, t) => SAMPLE_CARDS.map((c) => ({ type: 'doc.added', id: c.id, title: c.title, note: { es: '', en: '' }, url: '', group: c.group, lang: 'both', step: c.step || null, order: c.order, body: c.body, by, t }));

/** `practice` adds a practice site for the rep andrea with three placeholder workers, for looking at the install screens.
 *  `leader` adds what the leadership view needs (see leadership above). `lone` is the admin alone, with no reps and no
 *  work: a team that has not started, the way a new account opens (the other options are ignored with it). */
export function seed(dir, { now = new Date(), names = {}, handles = {}, practice = false, leader = false, lone = false } = {}) {
  const events = path.join(dir, 'team', 'events.jsonl');
  if (existsSync(events) && readFileSync(events, 'utf8').trim()) throw new Error(`${events} already holds events: the seed only fills an empty folder`);
  mkdirSync(path.join(dir, 'team'), { recursive: true });
  writeFileSync(path.join(dir, 'team', 'SAMPLE'), 'Sample data written by tools/team-seed.mjs. Every person and business here is fictional.\n');
  const nowIso = now.toISOString(), today = localDay(nowIso, TZ), ws = weekStart(today);
  const out = [];
  const push = (e) => { if (e.t <= nowIso) out.push(e); };

  const people = lone ? SAMPLE_REPS.filter((r) => r.role === 'admin') : leader ? [...SAMPLE_REPS, SAMPLE_LEADER] : SAMPLE_REPS;
  for (const r of people) {
    const start = r.isNew ? addDays(today, -5) : addDays(today, -60), t = at(start, '08:00');
    const handle = typeof handles[r.handle] === 'string' && /^[a-z0-9][a-z0-9._-]{1,39}$/.test(handles[r.handle]) ? handles[r.handle] : r.handle;
    // An address under .test, the ending kept for examples: it can never be anyone's.
    out.push({ type: 'rep.created', id: r.id, handle, email: `${handle}@ejemplo.test`, name: (typeof names[r.handle] === 'string' && names[r.handle].trim()) || r.name, role: r.role, country: 'PA', city: r.city, tz: TZ, workdays: [1, 2, 3, 4, 5], startDate: start, lang: 'es', t });
  }
  const id = (handle) => `r_sample_${handle}`;
  const store = openTeamStore(dir);
  const leads = () => store.setLeads(Object.entries(LEADS).map(([key, [company, zone, city, known]], i) => ({ id: leadId(key), company, zone, city, stage: known ? 'Contacted' : 'New', ...(known ? { lastContact: addDays(ws, -16) } : {}), ...crmFields(key, i) })));
  if (lone) { for (const e of out) store.append(e); leads(); return { events: out.length, reps: people.map((r) => `${r.handle} (${r.role})`) }; }
  let n = 0;
  const log = (handle, day, time, kind, key, x = {}) => {
    const logId = `sample-${handle}-${day}-${String(n += 1).padStart(3, '0')}`, t = at(day, time);
    const e = { type: 'log', id: logId, rep: id(handle), lead: leadOf(key), kind, clientAt: x.lateBy ? new Date(Date.parse(t) - x.lateBy * 60000).toISOString() : t, t };
    const ch = channelOf(kind, x.channel); if (ch) e.channel = ch;
    if (x.lateBy) e.late = true;
    if (LEADS[key][3]) e.prior = addDays(ws, -16);   // the CRM already had a contact with this business, as the API stamps it
    if (x.contact) e.contact = x.contact;
    if (x.whenIn != null) e.when = addDays(day, x.whenIn);
    if (x.when) e.when = x.when;
    if (x.time) e.time = x.time;
    if (x.tag) e.tag = x.tag;
    if (x.lost) e.lost = x.lost;
    if (x.next) e.next = x.next;
    if (x.q) e.q = x.q;   // the qualification: Wi-Fi, who coordinates, how many work with their hands
    if (x.demo) e.demo = true;   // "Pide demo"
    push(e);
    if (x.play) push({ type: 'play', logId, text: x.play, t: at(day, time.replace(/:\d\d$/, ':59')) });
    if (x.confirmIn != null) { push({ type: 'log.held', logId, t: at(addDays(day, x.whenIn ?? 1), '12:10') }); push({ type: 'confirm', logId, what: 'meeting_held', by: id('lider'), t: at(addDays(day, x.confirmIn), '08:40') }); }
    return logId;
  };
  // The blockers are dated from now, never from the weekday: Nadia closes today and Andrea closed yesterday, each with
  // one. A day the plan closes for them keeps the plan's hour and words; any other gets its own.
  const yesterday = addDays(today, -1);
  const blockers = new Map([[`nadia|${today}`, { blocker: 'No encuentro al encargado en la mañana', time: '17:30', tomorrow: 'Volver a Lavandería Burbujas' }],
    [`andrea|${yesterday}`, { blocker: 'Falta el contrato en Documentos', time: '19:20', tomorrow: 'Dos visitas en Río Abajo' }]]);
  const close = (handle, day, time, tomorrow, blocker = '') => {
    const b = blockers.get(`${handle}|${day}`);
    if (b) { Object.assign(b, { time, tomorrow }); return; }
    push({ type: 'day.close', rep: id(handle), day, tomorrow, blocker, t: at(day, time) });
  };

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
      for (const [time, kind, key, x] of entries) { if (kind === 'close') close(handle, day, time, key, x); else ids[`${handle}:${i}:${kind}`] = log(handle, day, time, kind, key, x); }
    });
  }
  push({ type: 'goal.pick', rep: id('andrea'), week: ws, k: 4, t: at(ws, '08:30') });
  // applause, a recognition and a signed site
  const clap = (by, target, day, time) => { if (target) push({ type: 'kudos', by: id(by), target, on: true, t: at(day, time) }); };
  clap('luis', ids['omar:0:meeting'], ws, '13:30'); clap('camila', ids['omar:0:meeting'], ws, '14:05'); clap('andrea', ids['omar:0:meeting'], ws, '16:10');
  clap('omar', ids['andrea:1:meeting'], addDays(ws, 1), '12:50'); clap('nadia', ids['andrea:1:meeting'], addDays(ws, 1), '13:15');
  push({ type: 'badge.give', id: 'sample-badge-1', rep: id('luis'), text: 'Volvió tres veces a la misma cuadra hasta encontrar al dueño.', by: id('lider'), t: at(addDays(ws, 2), '17:00') });
  const ms = monthStart(today), signed = addDays(ms, 2) < ws ? addDays(ms, 2) : addDays(ws, -3);
  push({ type: 'site', id: 's_sample_1', rep: id('omar'), lead: { id: null, name: 'Astillero El Faro' }, city: 'Colón', by: id('lider'), t: at(signed, '16:00') });
  push({ type: 'site.step', siteId: 's_sample_1', what: 'installed', by: id('lider'), t: at(addDays(signed, 3), '11:00') });
  // wave 2: the phones the site asked for and the two shipments that came; a site that asked and got nothing yet, with a
  // worker who has no email on purpose; a meeting three days past nobody marked; a contract out nine days, unsigned
  push({ type: 'site.request', siteId: 's_sample_1', count: 30, by: id('lider'), t: at(signed, '16:05') });
  push({ type: 'site.phones.added', siteId: 's_sample_1', count: 4, by: id('lider'), t: at(addDays(signed, 1), '10:00') });
  push({ type: 'site.phones.added', siteId: 's_sample_1', count: 6, by: id('lider'), t: at(addDays(signed, 2), '10:00') });
  push({ type: 'site', id: 's_sample_2', rep: id('omar'), lead: { id: leadId('C4'), name: LEADS.C4[0] }, city: 'Colón', by: id('lider'), t: at(addDays(ws, -2), '10:00') });
  push({ type: 'site.request', siteId: 's_sample_2', count: 12, by: id('lider'), t: at(addDays(ws, -2), '10:05') });
  // the advance: requested four days ago on the site still waiting for phones, and requested and paid on the installed one
  push({ type: 'site.advance', siteId: 's_sample_2', asked: addDays(today, -4), paid: null, by: id('lider'), t: at(today, '07:30') });
  push({ type: 'site.advance', siteId: 's_sample_1', asked: addDays(signed, 1), paid: addDays(signed, 3), by: id('lider'), t: at(addDays(signed, 3), '12:00') });
  push({ type: 'worker.added', siteId: 's_sample_2', id: 'w_sampleNoEmail1', name: 'Persona sin correo', email: '', noEmail: true, phone: true, by: id('omar'), t: at(addDays(ws, -2), '11:00') });
  log('omar', addDays(ws, -10), '10:30', 'meeting', 'C6', { channel: 'visit', contact: 'Sra. Gloria Batista, dueña', when: addDays(today, -3), time: '11:00' });
  const out9 = log('omar', addDays(today, -9), '16:00', 'contract', 'C5', { contact: 'Lic. Yaritza Mora, administradora' });
  push({ type: 'confirm', logId: out9, what: 'contract_sent', by: id('lider'), t: at(addDays(today, -8), '09:00') });

  // Andrea's book, through the events a phone would have sent: her two zones, two meetings booked the week before last
  // (one for yesterday that nobody marked as held, one for today), a business she lost and why, one Omar holds in her
  // city, and next steps that fall due today, overdue and in the coming days.
  const early = addDays(ws, -10), before = addDays(today, -6);
  push({ type: 'zones.pick', rep: id('andrea'), zones: ['El Cangrejo', 'Bella Vista'], t: at(addDays(ws, -20), '08:30') });
  log('andrea', early, '10:10', 'meeting', 'P15', { channel: 'visit', contact: 'Don Rogelio Vega, dueño', when: addDays(today, -1), next: { day: addDays(today, -1), step: 'Reunión con quien decide' } });
  log('andrea', early, '12:40', 'meeting', 'P16', { channel: 'visit', contact: 'Sra. Maritza Gómez, dueña', when: today, time: '10:30', next: { day: today, step: 'Reunión con quien decide' } });
  log('andrea', addDays(early, 1), '11:20', 'call', 'P17', { tag: 'not_interested', lost: 'not_priority' });
  log('omar', addDays(early, 1), '15:10', 'talk', 'P18', { next: { day: addDays(today, 3), step: 'Llamar para agendar la reunión de 20 min' } });
  const next = (key, day, step) => push({ type: 'biz.next', lead: leadId(key), rep: id('andrea'), next: { day, step }, t: at(before, '19:00') });
  next('P1', today, 'Llamar para agendar la reunión de 20 min');
  next('P3', addDays(today, -3), 'Volver a llamar para agendar la reunión');
  next('P2', addDays(today, 1), 'Volver y preguntar por el dueño');
  next('P4', addDays(today, 2), 'Llamar si no responde');
  next('P7', addDays(today, 4), 'Volver a llamar');
  // Camila has a follow-up due today, so her follow-up stop opens Para hoy
  push({ type: 'biz.next', lead: leadId('P10'), rep: id('camila'), next: { day: today, step: 'Llamar si no responde' }, t: at(before, '18:00') });
  // Luis has one follow-up overdue too, so a manager sees more than one rep in "seguimientos vencidos"
  push({ type: 'biz.next', lead: leadId('P11'), rep: id('luis'), next: { day: addDays(today, -1), step: 'Volver a llamar' }, t: at(before, '18:30') });

  // the blockers' closes (today's no later than now), and a meeting booked yesterday for tomorrow that asks for a demo
  for (const [key, b] of blockers) {
    const [handle, day] = key.split('|'), planned = at(day, b.time), t = planned <= nowIso ? planned : new Date(now.getTime() - 60000).toISOString();
    if (localDay(t, TZ) === day) push({ type: 'day.close', rep: id(handle), day, tomorrow: b.tomorrow, blocker: b.blocker, t });
  }
  log('luis', yesterday, '12:15', 'meeting', 'P22', { channel: 'visit', contact: 'Sr. Iván Morales, supervisor de planta', when: addDays(today, 1), time: '09:00', demo: true });

  out.push(...sampleCards(id('lider'), at(addDays(today, -10), '08:30')));
  if (practice) out.push(...practiceSite(dir, id('andrea'), id('lider'), addDays(today, -1)));
  if (leader) out.push(...leadership(dir, id('luis'), id('lider'), ws).filter((e) => e.t <= nowIso));

  out.sort((x, y) => (x.t < y.t ? -1 : x.t > y.t ? 1 : 0));
  // Who holds each business, as the server decides at each log: a result other than bad data on a free business takes
  // it, and the holder's own later logs hold it (lib/team/biz.mjs). Every sample business starts free in the CRM.
  const holder = new Map();
  for (const e of out) {
    if (e.type !== 'log' || e.kind === 'baddata') continue;
    const was = holder.get(e.lead.id);
    if (!was) { holder.set(e.lead.id, e.rep); e.took = true; e.holds = true; } else if (was === e.rep) e.holds = true;
  }
  for (const e of out) store.append(e);
  leads();
  return { events: out.length, reps: people.map((r) => `${r.handle} (${r.role})`) };
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
