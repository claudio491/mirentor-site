// alerts.mjs: speed to lead. A new waitlist sign-up goes, by Slack DM from the Mirentor Routines app, to the next rep
// of its city, with Claudio copied. A reply in that DM's thread means "taken". No reply in 15 minutes: the backup rep
// gets it. No reply 15 minutes later: Claudio hears nobody took it. Outside working hours the alert waits for the
// next opening and the clock starts then.
//
// Modes: off (nothing is sent), test (every message goes to Claudio only, saying who it would have reached, and a
// reply from Claudio stands in for the rep), live. The config, with the bot token, lives in alerts-config.json on the
// data disk (mode 600) and is set through PUT /api/alerts/config; the token never comes back out.
// Every alert and every change is one JSON line in alerts.jsonl, replayed on start, so a restart loses nothing.
import { appendFileSync, chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { cityName } from './entry.mjs';

const MIN = 60_000;
const MODES = new Set(['off', 'test', 'live']);
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const INDUSTRY_ES = {
  warehouse: 'bodega o logística',
  construction: 'construcción',
  workshop: 'taller o manufactura',
  other: 'otro trabajo manual',
  office: 'oficina o servicios',
};
const DEFAULTS = { mode: 'off', slackToken: '', claudio: '', reps: {}, routes: {}, minutes: 15, hours: { start: 8, end: 18, days: [1, 2, 3, 4, 5, 6], utcOffset: -5 } };
const OPEN = new Set(['queued', 'primary', 'backup']);
const LATE_WINDOW = 24 * 60 * MIN;

/** Slack Web API over fetch, with the token passed per call. */
export function slackApi(fetchFn = fetch) {
  return async (method, payload, token) => {
    const r = await fetchFn(`https://slack.com/api/${method}`, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify(payload),
    });
    return r.json();
  };
}

export function createAlerts({ dir, api, now = Date.now, log = console.error }) {
  const cfgFile = path.join(dir, 'alerts-config.json');
  const file = path.join(dir, 'alerts.jsonl');
  let cfg = { ...DEFAULTS };
  if (existsSync(cfgFile)) cfg = { ...DEFAULTS, ...JSON.parse(readFileSync(cfgFile, 'utf8')) };

  const byLead = new Map();
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (!line) continue;
      const rec = JSON.parse(line);
      if (rec.type === 'alert' && !byLead.has(rec.alert.leadId)) byLead.set(rec.alert.leadId, rec.alert);
      if (rec.type === 'update' && byLead.has(rec.leadId)) Object.assign(byLead.get(rec.leadId), rec.set);
    }
  }
  const add = (alert) => { appendFileSync(file, `${JSON.stringify({ type: 'alert', alert })}\n`); byLead.set(alert.leadId, alert); };
  const update = (a, set) => { appendFileSync(file, `${JSON.stringify({ type: 'update', leadId: a.leadId, set })}\n`); Object.assign(a, set); };

  // ---- config ----
  function configure(next) {
    const merged = { ...cfg, ...next, hours: { ...cfg.hours, ...(next.hours || {}) } };
    if (!next.slackToken) merged.slackToken = cfg.slackToken;
    if (!MODES.has(merged.mode)) throw new Error(`mode must be off, test or live, not "${merged.mode}"`);
    for (const [city, list] of Object.entries(merged.routes || {})) {
      if (!Array.isArray(list)) throw new Error(`route for ${city} must be a list of rep keys`);
      for (const key of list) if (!merged.reps?.[key]?.slack) throw new Error(`route ${city} names "${key}", who is not in reps with a slack id`);
    }
    if (merged.mode !== 'off' && (!merged.slackToken || !merged.claudio)) throw new Error('mode test or live needs slackToken and claudio');
    writeFileSync(cfgFile, JSON.stringify(merged, null, 2), { mode: 0o600 });
    chmodSync(cfgFile, 0o600);
    cfg = merged;
    return publicConfig();
  }
  function publicConfig() { return { ...cfg, slackToken: cfg.slackToken ? 'set' : '' }; }
  const on = () => cfg.mode !== 'off' && cfg.slackToken && cfg.claudio;

  // ---- time ----
  const local = (t) => new Date(t + cfg.hours.utcOffset * 60 * MIN);
  const isOpen = (t) => { const d = local(t); return cfg.hours.days.includes(d.getUTCDay()) && d.getUTCHours() >= cfg.hours.start && d.getUTCHours() < cfg.hours.end; };
  function nextOpen(t) {
    const d = local(t);
    let day = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), cfg.hours.start) - cfg.hours.utcOffset * 60 * MIN;
    for (let i = 0; i < 8; i++, day += 24 * 60 * MIN) if (day > t && isOpen(day)) return day;
    return t;
  }
  const whenText = (t) => { const d = local(t); return `el ${DAYS[d.getUTCDay()]} ${d.getUTCHours()}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

  // ---- slack ----
  async function call(method, payload) {
    const r = await api(method, payload, cfg.slackToken);
    if (!r || !r.ok) throw new Error(`slack ${method}: ${(r && r.error) || 'no answer'}`);
    return r;
  }
  async function dm(user, text, thread) {
    const { channel } = await call('conversations.open', { users: user });
    const r = await call('chat.postMessage', { channel: channel.id, text, unfurl_links: false, ...(thread ? { thread_ts: thread } : {}) });
    return { channel: channel.id, ts: r.ts };
  }
  const tellClaudio = (text) => dm(cfg.claudio, text).catch((err) => log(`alerts: to Claudio failed: ${err.message}`));
  /** A message for a rep: in test mode it goes to Claudio with a label naming the rep. */
  function toRep(key, text) {
    const rep = cfg.reps[key];
    return cfg.mode === 'live' ? dm(rep.slack, text) : dm(cfg.claudio, `[PRUEBA: esto iría a ${rep.name}]\n${text}`);
  }
  const nameOf = (key) => cfg.reps[key]?.name || key;

  // ---- text ----
  function card(a) {
    const wa = a.whatsapp ? ` · WhatsApp https://wa.me/${a.whatsapp.replace(/\D/g, '').replace(/^00/, '')}` : '';
    const site = a.siteWifi && a.siteLead
      ? `Sitio: Wi-Fi ${a.siteWifi === 'yes' ? 'sí' : 'no'}, encargado ${a.siteLead === 'yes' ? 'sí' : 'no'} (${a.siteWifi === 'yes' && a.siteLead === 'yes' ? 'cumple' : 'no cumple todavía'}).`
      : 'Sitio: no respondió Wi-Fi ni encargado.';
    return [
      `*${a.business}*, ${INDUSTRY_ES[a.industry] || a.industry}, ${a.workers} trabajadores.`,
      `Contacto: ${a.contact} · ${a.email}${wa}`,
      site,
      `Lead ${a.leadId}`,
    ].join('\n');
  }
  const nextStep = (a, after) => `Llámalo o escríbele ahora, de usted, y responde *lo tomo* en este hilo. Anota el contacto en el CRM. ${after}`;

  async function sendPrimary(a) {
    const after = a.backup ? `Si en ${cfg.minutes} minutos nadie responde, pasa a ${nameOf(a.backup)}.` : `Si en ${cfg.minutes} minutos nadie responde, le aviso a Claudio.`;
    const msg = await toRep(a.primary, `Registro nuevo en ${a.city}. Tienes ${cfg.minutes} minutos.\n${card(a)}\n${nextStep(a, after)}`);
    update(a, { stage: 'primary', sentAt: now(), threads: [{ rep: a.primary, ...msg }] });
    await tellClaudio(`Registro nuevo: ${a.business} (${a.city}). Se lo pasé a ${nameOf(a.primary)}${a.backup ? `, respaldo ${nameOf(a.backup)}` : ''}. Lead ${a.leadId}`);
  }

  // ---- the two entry points ----
  async function onEntry(e) {
    try {
      if (!on() || byLead.has(e.leadId)) return;
      const city = cityName(e.city, e.country);
      const route = cfg.routes[city] || [];
      const count = [...byLead.values()].filter((x) => x.city === city && x.primary).length;
      const primary = route.length ? route[count % route.length] : null;
      const backup = route.length > 1 ? route[(count + 1) % route.length] : null;
      const a = {
        leadId: e.leadId, city, business: e.business, industry: e.industry, workers: e.workers, contact: e.contact, email: e.email,
        whatsapp: e.whatsapp, siteWifi: e.siteWifi, siteLead: e.siteLead, mode: cfg.mode, createdAt: now(), primary, backup, stage: 'queued',
      };
      if (!primary) {
        add({ ...a, stage: 'none' });
        await tellClaudio(`Registro nuevo en ${city}, sin vendedor asignado. Tómalo tú.\n${card(a)}`);
        return;
      }
      if (isOpen(now())) { add(a); await sendPrimary(a); return; }
      add({ ...a, dueAt: nextOpen(now()) });
      await tellClaudio(`Registro nuevo fuera de horario: ${e.business} (${city}). Se lo paso a ${nameOf(primary)} ${whenText(byLead.get(e.leadId).dueAt)}. Lead ${e.leadId}`);
    } catch (err) {
      log(`alerts: ${e && e.leadId}: ${err.message}`);
    }
  }

  async function takenIn(a) {
    for (const th of a.threads || []) {
      const r = await call('conversations.replies', { channel: th.channel, ts: th.ts, limit: 20 });
      const human = (r.messages || []).find((m) => m.ts !== th.ts && m.user && !m.bot_id && (a.mode !== 'live' || m.user !== cfg.claudio));
      if (human) return th.rep;
    }
    return null;
  }

  let busy = false;
  async function tick() {
    if (busy || !on()) return;
    busy = true;
    try {
      for (const a of byLead.values()) {
        try {
          if (a.stage === 'queued') { if (now() >= a.dueAt) await sendPrimary(a); continue; }
          const late = a.stage === 'missed' && now() - a.sentAt < LATE_WINDOW;
          if (!OPEN.has(a.stage) && !late) continue;
          const who = await takenIn(a);
          if (who) {
            const mins = Math.round((now() - a.sentAt) / MIN);
            update(a, { stage: 'taken', takenBy: who, takenAt: now() });
            await tellClaudio(`${nameOf(who)} lo tomó en ${mins} min: ${a.business} (${a.city}). Lead ${a.leadId}`);
            continue;
          }
          if (late) continue;
          if (a.stage === 'primary' && now() - a.sentAt >= cfg.minutes * MIN) {
            if (a.backup) {
              const msg = await toRep(a.backup, `${nameOf(a.primary)} no respondió en ${cfg.minutes} minutos. Te toca a ti.\n${card(a)}\n${nextStep(a, `Si en ${cfg.minutes} minutos nadie responde, le aviso a Claudio.`)}`);
              update(a, { stage: 'backup', backupAt: now(), threads: [...a.threads, { rep: a.backup, ...msg }] });
              await tellClaudio(`${nameOf(a.primary)} no respondió en ${cfg.minutes} min; ${a.business} pasa a ${nameOf(a.backup)}. Lead ${a.leadId}`);
            } else {
              update(a, { stage: 'missed', missedAt: now() });
              await tellClaudio(`Nadie tomó ${a.business} (${a.city}) en ${cfg.minutes} min. Llámalo tú.\n${card(a)}`);
            }
            continue;
          }
          if (a.stage === 'backup' && now() - a.backupAt >= cfg.minutes * MIN) {
            update(a, { stage: 'missed', missedAt: now() });
            await tellClaudio(`Nadie tomó ${a.business} (${a.city}) en ${cfg.minutes * 2} min. Llámalo tú.\n${card(a)}`);
          }
        } catch (err) {
          log(`alerts: tick ${a.leadId}: ${err.message}`);
        }
      }
    } finally {
      busy = false;
    }
  }

  return { configure, publicConfig, onEntry, tick, list: () => [...byLead.values()] };
}
