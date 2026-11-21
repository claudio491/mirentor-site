// ladder-steps.js: what "Mis primeros días" and "Aprender" decide on the phone, away from the page so it can be tested.
// Which step is next, whether the ladder still belongs on Hoy, what a video looks like before it has an address, which
// controls a step offers, when opening a video tells the server, and how two zones are picked. The server stays the
// judge: these only shape the screen.

/** The first step not done, or null once all ten are. Steps the app ticks can finish out of order; the next one is
 *  still the earliest open step. */
export const nextStep = (ladder) => (ladder || []).find((s) => !s.done) || null;

/** How many steps are done, of how many. */
export function ladderCount(ladder) {
  const all = ladder || [];
  return { done: all.filter((s) => s.done).length, of: all.length };
}

/** The ladder keeps its card on Hoy while a step is open. After ten of ten it leaves Hoy and stays in the profile. */
export const ladderOnHoy = (ladder) => !!nextStep(ladder);

/** A video address the screen may open: a web address, nothing else. */
export function safeUrl(url) {
  if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return null;
  try { const u = new URL(url); return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : null; } catch { return null; }
}
const videoOf = (key, videos) => {
  const url = safeUrl(videos && videos[key]);
  return { kind: url ? 'play' : 'missing', key, url };
};

/** The video line of a step: `none` when the step has no video, `missing` while its video has no address (the screen
 *  says so in plain words, with no link and no player), `play` with the address once it exists. */
export function stepVideo(step, videos) {
  if (!step || !step.video) return { kind: 'none', key: null, url: null };
  return videoOf(step.video, videos);
}

/** The rows of Aprender: every video in the order the server lists them, whether it has an address, and whether this
 *  person already opened it. */
export function learnRows(videos, seen) {
  const opened = new Set(seen || []);
  return Object.keys(videos || {}).map((key) => ({ ...videoOf(key, videos), seen: opened.has(key) }));
}

const LOGGED = new Set(['talk', 'meeting', 'contract']);
/** Which controls a step offers. Through view-as (a manager reading a rep's screens) none: nothing that writes shows.
 *  The rep ticks their three own steps while open; the zones can be picked and changed again; the steps the app ticks
 *  point at what ticks them (logging, closing the day) only for someone who logs, so not in a manager's preview.
 *  The install and the first approved hour have no control here. */
export function ladderControls({ readOnly, step, canLog }) {
  const out = { tick: false, zones: false, log: false, close: false };
  if (readOnly || !step) return out;
  if (step.step === 'zones') return { ...out, zones: true };
  if (step.done) return out;
  if (step.by === 'rep') return { ...out, tick: true };
  if (LOGGED.has(step.step)) return { ...out, log: !!canLog };
  if (step.step === 'report') return { ...out, close: !!canLog };
  return out;
}

/** Opening a video tells the server the first time: never for a row with no address, never through view-as. */
export const postSeen = (row, seen, readOnly) => !readOnly && !!row && row.kind === 'play' && !(seen || []).includes(row.key);

/** A tap on a zone picks it or drops it. A third pick replaces the oldest one, so two stay picked. */
export function pickZone(picked, zone) {
  const now = [...(picked || [])];
  if (now.includes(zone)) return now.filter((z) => z !== zone);
  now.push(zone);
  return now.length > 2 ? now.slice(-2) : now;
}
/** Exactly two different zones, which is what the server accepts. */
export const zonesReady = (picked) => Array.isArray(picked) && picked.length === 2 && picked[0] !== picked[1];
