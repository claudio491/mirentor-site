// app.js: the rep's side of the sales team platform, and the shell both sides share.
// The server answers codes and numbers; every sentence comes from i18n.js through t().
import { APP_NAME, LANGS } from './i18n.js';
import { $, $$, h, put, icon, t, setLang, lang, applyStatic, giant, num, ord, wdShort, wdLong, dayMonth, monthName, upper, cap, isoWeek, addDays, clock, hourName, stamp, ago, cityName, joinList,
  lock, buzz, quiet, EASE, countTo, recount, ringAt, flipList, toast, showPop, hidePop, initPop, src, openSheet, closeSheet, initSheets, once, copyText, grain, reduce, formSheet, setExplain, newId, putFace, face, dayOf, showErr } from './ui.js';
import { buildHand, paintHand, miniHand, rowWrist, levelBone, badgeGlyph, portrait, setPortrait, replayHand, drawIn, handGlyph, stepsGlyph, teachHand, daysBone } from './hand.js';
import { swap, roll, floatUp, flyDot, reveal, stagger, lockIn, greet, isGreeting, celebrate, dayDone } from './fx.js';
import { entrance, dayPart, localMinutes, nextStep, moments, stake, raceShare, tableNote, firstDays, untouched, anyLog, shortNames, closeCard, crewOf, historyRows } from './moments.js';
import { STOPS, stopsOf, standOn, loopOf, rewardOf, landed, stepOf } from './stops.js';
import { createStage } from './stage.js';
import { ART, STEPS } from './art.js';
import { createManager } from './manager.js';
import { createInstall } from './install.js';
import { createLadder } from './ladder.js';
import { createLeader } from './leader.js';
import { createDocs } from './docs.js';
import { createRoute } from './route.js';
import { createSites } from './sites.js';
import { createReport } from './report.js';
import { nudgeOf } from './report-steps.js';
import { mateLine } from './sites-steps.js';
import { shellFor } from './leader-steps.js';
import { verdict, mine as waitingOf, requestTimeout } from './queue.js';
import { sessionMove, HOME, LEAVE } from './door.js';
import { actingMode, readOnlyIn, repControls, withAs, logLocked, staleAs, practiceBarName } from './practice-steps.js';

const API = 'api';   // every address is relative to the page, so the app works wherever it is mounted
const KEY = { lang: 'cancha.lang', queue: 'cancha.queue', me: 'cancha.me', greet: 'cancha.greet' };
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: the app still works online */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* same */ } },
};

// ---- the API ----
class ApiError extends Error { constructor(code, status, data = null) { super(code); this.code = code; this.status = status; this.data = data; } }
async function api(method, path, body) {
  let res;
  path = withAs(path, mode(), S.as);   // acting as the practice rep: every request names it, and the server judges
  // A request that hangs is treated as no signal: a log then waits on the phone and goes out again with the same id.
  // A consent photo gets longer than the rest (queue.js says how long).
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), requestTimeout(body));
  try {
    // A photo goes as its own bytes (the server reads what it is from them); everything else goes as JSON.
    const blob = typeof Blob !== 'undefined' && body instanceof Blob;
    const headers = body === undefined ? {} : { 'content-type': blob ? (body.type || 'application/octet-stream') : 'application/json' };
    res = await fetch(`${API}/${path}`, { method, headers, body: body === undefined ? undefined : blob ? body : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal: stop.signal });
  } catch { throw new ApiError('offline', 0); } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* an answer that is not JSON is treated as a failure below */ }
  if (!res.ok || !data || data.ok === false) throw new ApiError((data && data.error) || 'unknown', res.status, data);
  return data;
}
const errText = (e) => { try { return t(`err.${(e && e.code) || 'unknown'}`); } catch { return t('err.unknown'); } };
setExplain(errText);

// ---- state ----
const S = { me: null, sig: '', tab: null, docs: [], period: 'week', as: null, mgr: false, lead: false, queue: store.get(KEY.queue, []), seenFeed: null, lastLoad: 0, lastPaint: 0, arrived: new Set(), ledgerAll: false,
  stop: null,     // the stop the person tapped on the route; null follows the day
  hold: null,     // the stop a log landed on, kept on the stage until its answer has played
  owed: null,     // an answer that waits for a sheet to close
  taught: false };
const SCREENS = ['boot', 'gate', 'today', 'week', 'table', 'profile', 'team', 'needs', 'reps', 'install', 'worker', 'iclose', 'ladder', 'zones', 'learn', 'lead', 'docs', 'route', 'ways', 'sites'];
// A rep's three zones. On a wide screen they are one page, a band under the other; anywhere else one shows at a time.
const BANDS = ['today', 'week', 'table'], WIDE = matchMedia('(min-width:1080px)');
const banded = () => WIDE.matches && !S.mgr && !S.lead && !!S.me;
const inBands = (name) => banded() && BANDS.includes(name);
const REST_LOOP = [[0, 1500], [1, 1500], [2, 1900], [3, 1500]];   // a day off: the hammock swings
const FOLLOWS = new Set(['talk', 'absent', 'call', 'reply', 'meeting']);
const CHANNELS = { message: ['whatsapp', 'linkedin', 'email', 'sms'], meeting: ['visit', 'call', 'whatsapp'], reply: ['whatsapp', 'linkedin', 'email', 'sms', 'call'], baddata: ['call', 'email'] };
const TAGGED = new Set(['talk', 'call', 'reply']);
const TAGS = ['meeting', 'waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call'];
const ONE_LEVEL = new Set(['first_log', 'first_meeting', 'first_site_live']);
/** The history rows that belong to a business's route: a tap on their button opens it. */
const ROUTE_CODES = new Set(['meeting_booked', 'meeting_held', 'contract_sent', 'contract_signed', 'site_signed', 'site_installed', 'site_first_hour']);
const MAIN_KINDS = ['talk', 'absent', 'call', 'message', 'meeting', 'contract'], MORE_KINDS = ['noanswer', 'reply', 'baddata'];
const LEDGER_RULE = { visit: 'visit', conversation: 'conversation', followup: 'followup', message: 'message', reply: 'reply', meeting_booked: 'meetingBooked', meeting_held: 'meetingHeld',
  contract_sent: 'contractSent', contract_signed: 'contractSigned', site_signed: 'siteSigned', site_installed: 'siteInstalled', site_first_hour: 'siteFirstHour', day_closed: 'dayClosedOnTime' };
/** How a rep's screens are open: a person's own, a real rep through view-as (read only), or the practice rep (writes allowed). */
const mode = () => actingMode(S.as, S.me);
const readOnly = () => readOnlyIn(mode());
const may = () => repControls(mode());
const INSTALL_TABS = new Set(['install', 'worker', 'iclose']);   // the install's own screens: renderAll draws the open one again, so a language change or a poll reaches it
const LADDER_TABS = new Set(['ladder', 'zones', 'learn']);   // the first days' screens, drawn again the same way
const tz = () => S.me.me.tz;
const pts = (n) => t('u.points', { n });
/** The word of a counted unit without its number: "sitios" from "3 sitios". */
const unitWord = (key, n) => t(key, { n }).replace(num(n), '').trim();

function show(name) { const all = inBands(name); for (const n of SCREENS) $(`#s-${n}`).hidden = all ? !BANDS.includes(n) : n !== name; }
/** A sentence with one part set apart: t(key) is split around the blank named `mark`. */
function withEm(node, key, vars, mark, tail = '') {
  const [a, b = ''] = t(key, { ...vars, [mark]: '\u0001' }).split('\u0001');
  node.replaceChildren(a, h('em', { text: String(vars[mark]) }), b + tail);
}
const bold = (strong, rest = '') => [h('b', { text: strong }), rest ? ` ${rest}` : ''];

// ---- shell: top bar, navigation, language ----
function renderTop() {
  $('#brandName').textContent = APP_NAME;
  const st = S.me && S.me.streak, chip = $('#streakChip');
  chip.hidden = !st || st.current === 0;
  if (st) {
    countTo($('#streakN'), st.current); chip.setAttribute('aria-label', t('top.streak.aria', { n: t('u.days', { n: st.current }) }));
    const day = S.me.today;
    chip.classList.toggle('open', !!day && day.isWork && day.conversations < 1);   // today has not earned its place in the streak yet
  }
  // A rep's week in points, and their own face with the day as its arc: the face opens their profile.
  const rep = !!(S.me && S.me.today && S.me.week && !S.mgr), meBtn = $('#meBtn');
  $('#ptsChip').hidden = !rep; meBtn.hidden = !rep;
  if (rep) {
    const now = S.me.today;
    countTo($('#ptsN'), S.me.week.points);
    putFace($('#meLens'), S.me.me, (person) => portrait(person, { share: 0 }));
    setPortrait($('#meLens .portrait'), now.isWork ? now.habits.filter(Boolean).length / 4 : 0);
    if (S.tab === 'profile') meBtn.setAttribute('aria-current', 'page'); else meBtn.removeAttribute('aria-current');
  }
  const waiting = myQueue().length;
  $('#queueChip').hidden = !waiting;
  $('#queueN').textContent = t('top.queue', { n: waiting });
  $('#queueChip').setAttribute('aria-label', t('top.queue.aria'));
  for (const b of $$('#langSeg button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang()));
  $('#asBar').hidden = !S.as;
  // the practice rep says so on every screen: its chip and one line that nothing here counts
  // (on a phone the bar stays in view while the screen scrolls, so it says the same in one short line)
  const pracName = practiceBarName(S.me, t('reps.practice.name'));
  if (S.as && S.me) put($('#asText'), ...(mode() === 'practice' ? [h('span', { class: 'chip inst-prac', text: t('install.practice') }), ' ',
    h('span', { class: 'as-long', text: S.me.me.example ? t('top.practice.example', { name: S.me.me.name }) : t('top.practice') }), h('span', { class: 'as-short', text: t('top.practice.short', { name: pracName }) })] : [t('top.viewAs', { name: S.me.me.name })]));
  $('#asBar').classList.toggle('prac', !!S.as && mode() === 'practice');
}
function renderNav() {
  // A leader reads one page: no tabs and nothing to log, so there is no bar at all.
  const shell = shellFor(S.lead ? 'leader' : S.mgr ? 'manager' : 'rep');
  const nav = $('#nav'), canLog = shell.log && !readOnly() && !!S.me.today;
  if (!shell.tabs.length) { put(nav); nav.hidden = true; return; }
  const tabs = shell.tabs;
  const count = S.mgr ? manager.needsCount() : 0;
  put(nav, h('div', { class: 'tabs' }, tabs.map((id) => h('button', { class: 'tab', type: 'button', 'data-tab': id, 'aria-label': id === 'needs' && count ? `${t('nav.needs')}: ${count}` : t(`nav.${id}`), 'aria-current': S.tab === id ? 'page' : null, onclick: () => setTab(id) },
    icon(id), h('span', { text: t(`nav.${id}`) }), id === 'needs' && count ? h('span', { class: 'count num', text: String(count), 'aria-hidden': 'true' }) : null))),
  canLog ? h('button', { class: 'btn log', type: 'button', id: 'logBtn', onclick: openLog }, icon('plus'), t('nav.log')) : null);
  nav.classList.toggle('three', !canLog);
  markTab();
  nav.hidden = false;
}
/** The marker over the tabs sits on the open one; a screen that has no tab (the profile) leaves none marked. */
function markTab() {
  const box = $('#nav .tabs');
  if (!box) return;
  const i = [...box.children].findIndex((b) => b.dataset.tab === S.tab);
  box.classList.toggle('none', i < 0);
  if (i >= 0) box.style.setProperty('--i', String(i));
}
function setTab(name, { instant = false } = {}) {
  const from = S.tab, changed = from !== name;
  // coming back to "Mis sitios activos" from a site's screens: it shows what those screens just changed
  if (name === 'sites' && S.me && !S.mgr && !S.lead) quiet(() => sites.render());
  S.tab = name;
  // The screen shown is always the last one asked for: two quick taps may run this twice, in either order.
  const go = () => {
    const open = S.tab;
    show(open); hidePop();
    for (const b of $$('#nav .tab')) { if (b.dataset.tab === open) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    markTab();
    if ($('#meBtn')) { if (open === 'profile') $('#meBtn').setAttribute('aria-current', 'page'); else $('#meBtn').removeAttribute('aria-current'); }
    // On a wide screen a zone is already there: the page only moves to it.
    if (inBands(open) && open !== BANDS[0]) $(`#s-${open}`).scrollIntoView({ block: 'start', behavior: reduce || instant ? 'auto' : 'smooth' });
    else scrollTo({ top: 0, behavior: inBands(open) && !reduce && !instant ? 'smooth' : 'auto' });
  };
  const sameSheet = inBands(name) && BANDS.includes(from);
  if (instant || !changed || sameSheet) { go(); return; }
  swap(go);
  const mark = $(`#nav [data-tab="${name}"] svg`);
  if (mark) lock(mark);
  // A screen puts itself together the first time it is opened in a visit; after that it is simply there.
  for (const n of inBands(name) ? BANDS : [name]) if (!S.arrived.has(n)) { S.arrived.add(n); setTimeout(() => arrive(n), reduce ? 0 : 90); }
}
/** Run `fn` once, when `el` is at least a third on screen (at once where the browser cannot tell). */
function whenSeen(el, fn) {
  if (!el || !('IntersectionObserver' in window)) { fn(); return; }
  const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) { io.disconnect(); fn(); } }, { threshold: 0.34 });
  io.observe(el);
}
/** A screen has just arrived: its headline rises, its picture and its rows come in, once. */
function arrive(name, { fast = false, landed: lensLanded = false } = {}) {
  if (reduce || !S.me) return;
  if (S.tab !== name && !(inBands(name) && BANDS.includes(S.tab))) return;
  const zero = (nodes, read, write) => { for (const n of nodes) { const v = read(n); write(n, true); void n.getBoundingClientRect(); setTimeout(() => write(n, false, v), 40); } };
  const there = (nodes) => nodes.filter((n) => n && !n.hidden);
  if (name === 'today' && S.me.today) {
    reveal($('#todayGiant'));
    const dio = $('#dio');
    if (dio.animate) dio.animate([{ opacity: 0, transform: 'translateY(-34px) scale(.94)' }, { opacity: 1, transform: 'none' }], { duration: 760, delay: 160, easing: EASE.lock, fill: 'backwards' });
    stagger(there([$('#stopChip'), $('#stopCopy'), $('#nextBtn'), ...$$('#route .stop'), $('#closeCard'), $('#installCard'), $('#routeCard'), $('#ladderCard')]), { delay: 380, step: 60 });
    if (!lensLanded) drawIn($('#meLens'), 140);   // after the entrance the lens lands already drawn
    recount($('#ptsN'));
  } else if (name === 'week' && S.me.week) {
    reveal($('#weekGiant'));
    const took = replayHand($('#hand'), { fast });
    stagger(there([$('.handcard'), $('#legend'), $('#goalBox'), ...$$('#results .result'), $('.chart')]), { delay: 120, step: 70 });
    zero($$('#bars li'), (n) => n.style.getPropertyValue('--v'), (n, empty, v) => n.style.setProperty('--v', empty ? '0' : v));
    recount($('#weekPts'));
    // A week with no light yet shows how the hand works, once in a visit.
    // It waits until the hand is on screen: on a wide page the week may still be below the fold.
    if (!S.taught && !fast && S.me.week.marks === 0 && !readOnly()) {
      S.taught = true;
      whenSeen($('.handcard'), () => setTimeout(() => { if (S.me && !stopTeach && (S.tab === 'week' || inBands('week')) && !$('dialog[open]') && !isGreeting()) teach(); }, took + 1100));
    }
  } else if (name === 'table') {
    reveal($('#goalGiant'));
    lockIn($$('#squad .fl .pt'), { delay: 60 }); drawIn($('#squad'), 220, 60);
    stagger(there([$('#climb'), ...$$('#tableRows .trow, #restRows .trow')]), { delay: 160, step: 45 });
    zero($$('#tableRows .trow'), (n) => n.style.getPropertyValue('--share'), (n, empty, v) => n.style.setProperty('--share', empty ? '0' : v));
  } else if (name === 'profile') {
    reveal($('#profileGiant'));
    drawIn($('#portrait'), 120);
    zero($$('#lvl .bone.on'), (n) => n.getAttribute('stroke-dashoffset'), (n, empty, v) => n.setAttribute('stroke-dashoffset', empty ? '100' : v));
    lockIn($$('#badges .badge svg'), { delay: 220, step: 50 }); stagger($$('#ledger li'), { delay: 320, step: 30, y: 6 });
  } else if (name === 'team') {
    reveal($('#teamGiant'));
    lockIn($$('#wall .wl .pt'), { delay: 80 }); drawIn($('#wall'), 260, 60); drawIn($('#teamLenses'), 320, 90);
    stagger($$('#teamRows .brow'), { delay: 240, step: 45 });
  } else if (name === 'lead') leader.arrive();
  else if (name === 'needs') { reveal($('#needsGiant')); stagger($$('#needsBody .items li'), { delay: 140, step: 40 }); }
  else if (name === 'reps') { reveal($('#repsGiant')); stagger($$('#repsBody .items li'), { delay: 140, step: 40 }); }
}
function renderAll(animate = false) {
  S.lastPaint = Date.now();
  const run = () => {
    renderTop(); renderNav();
    if (S.lead) leader.render();
    else if (S.mgr) manager.render(animate); else { renderToday(animate); renderWeek(animate); renderTable(animate); renderProfile(); renderRules(); }
    if (S.mgr && S.tab === 'lead') leader.render();
    $('#leadBtn').hidden = !S.mgr;   // a manager's way to the leadership view
    if (INSTALL_TABS.has(S.tab)) install.render(false);
    if (LADDER_TABS.has(S.tab)) ladder.render(false);
    if (S.tab === 'docs') docs.render();
    if (S.tab === 'sites' && !S.mgr && !S.lead) sites.render();
    if (!S.mgr && !S.lead) route.render(false);   // the route last opened, so coming back from its install finds it current
    $('#docsBtn').hidden = !S.mgr;   // a manager's way to the documents; a rep's is on Hoy and in the profile
    // a manager's way to what a new rep sees, on their own account
    $('#previewBtn').hidden = !(S.mgr && Array.isArray(S.me.ladder) && S.me.ladder.length);
  };
  if (animate) run(); else quiet(run);
}
async function switchLang(next) {
  if (!LANGS.includes(next) || next === lang()) return;
  setLang(next); store.set(KEY.lang, next); applyStatic();
  if (S.me) { renderAll(false); if (!readOnly()) api('POST', 'lang', { lang: next }).catch(() => { /* the choice is kept on this phone; it follows the person once the signal is back */ }); }
  else { for (const b of $$('#langSeg button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang())); if (S.gate) showGate(S.gate.kind, S.gate.detail); }
  toast(t('toast.lang'));
}

// ---- today: a route of four stops, and the one the day stands on fills the stage ----
const stage = createStage({ onPick: (i) => { if (S.hold != null || !S.me || !S.me.today || !S.me.today.isWork) return; S.stop = i; paintStage(true); } });
function renderToday(animate) {
  const { me, today } = S.me;
  if (!today) return;
  $('#dateChip').textContent = `${upper(wdShort(today.day))} ${upper(dayMonth(today.day))} · ${upper(t('time.week', { n: isoWeek(today.day) }))}`;
  $('#sampleChip').hidden = !S.me.sample;
  // the place in the week's table, at a glance: a tap goes to the team
  const mine = S.me.table.week.me, place = $('#placeChip');
  place.hidden = !mine || mine.place == null;
  if (!place.hidden) {
    const vars = { ord: ord(mine.place), n: S.me.table.week.ranked }, text = t('rank.place', vars);
    $('#placeChipT').textContent = text; $('#placeChipS').textContent = t('rank.short', vars);   // the short one is for the narrowest phones
    place.setAttribute('aria-label', `${cap(text)}. ${t('rank.open.aria')}`);
  }
  const done = today.habits.filter(Boolean).length, head = $('#todayGiant'), sup = $('#todaySupport');
  head.classList.toggle('full', today.isWork && done === 4);   // a full finger: the count turns to signal
  sup.hidden = today.isWork;
  if (!today.isWork) {
    $('#todayLead').textContent = t('today.lead.rest', { name: me.first });
    giant(head, t('today.rest.giant'));
    sup.textContent = t('today.rest.support');
  } else if (untouched(today)) {
    // A working day with nothing logged leads with the start, not with a zero.
    $('#todayLead').textContent = t('today.lead.zero', { name: me.first });
    giant(head, t('today.zero.giant'));
  } else {
    $('#todayLead').textContent = t('today.lead', { name: me.first });
    // The count keeps its own node, so only the number that changed moves.
    const first = !$('.gl', head);
    if (first) head.replaceChildren(h('span', { class: 'gl' }), h('em', { text: '.' }));
    roll($('.gl', head), t('today.of', { a: done, b: 4 }));
    if (first && animate) reveal(head);   // the count takes the headline over from the invitation
  }
  paintStage(animate);
  renderCloseCard();
  install.card($('#installCard'));   // an install that waits: the phones reached the site
  route.card($('#routeCard'));       // the business furthest along on its route, with something to do now
  ladder.card($('#ladderCard'));     // the first days, while a step is open
  reportNudge($('#reportCard'));   // from 5 pm, a live site with no daily report yet
  sites.entry($('#sitesCard'));   // my active sites and what they made, one tap from Hoy, once a site is live
  $('#docsCard').hidden = false; docs.entry($('#docsCard'));   // the documents, one tap from Hoy
}
/** What the stage shows: the stop the day stands on, or the one the person tapped. While a log is being answered
 *  (S.hold) the stop it landed on keeps its picture, and nothing here moves until the answer has played. */
function paintStage(animate = false) {
  const { today, rules } = S.me, chip = $('#stopChipT'), cta = $('#nextBtn'), copy = $('#stopCopy'), dio = $('#dio');
  if (S.hold != null) return;
  const work = today.isWork;
  $('#route').hidden = !work; copy.hidden = !work;
  if (!work) {
    stage.show('rest', REST_LOOP, { swap: animate });
    dio.setAttribute('aria-label', t('art.rest')); chip.textContent = t('stop.chip.rest'); cta.hidden = true;
    return;
  }
  const stops = stopsOf(today, rules), at = standOn(stops), sel = S.stop != null ? S.stop : at, stop = stops[sel];
  stage.show(STOPS[sel], loopOf(sel, stop), { swap: animate });
  dio.setAttribute('aria-label', t(`art.${sel}`));
  chip.textContent = today.closed && sel === 3 ? t('stop.chip.closed') : stop.done ? t('stop.chip.done', { n: sel + 1 }) : sel === at ? t('stop.chip.next') : t('stop.chip', { n: sel + 1 });
  $('#stopTitle').textContent = t(`habit.${sel}`);
  $('#stopSub').textContent = sel === 3 ? t('habit.3.s', { time: hourName(rules.closeBy) }) : t(`habit.${sel}.s`);
  if (animate && copy.dataset.sel != null && copy.dataset.sel !== String(sel)) stagger([$('#stopTitle'), $('#stopSub')], { step: 60, y: 8 });
  copy.dataset.sel = String(sel);
  // One button: log this stop, or go on to the next one when this one is done. A closed day has none, and neither
  // does a manager who is only looking.
  const step = readOnly() ? null : nextStep(today, rules, localMinutes(S.me.serverTime, tz()));
  cta.hidden = !step || today.closed || step.habit == null;
  if (!cta.hidden) {
    const onward = stop.done;
    cta.classList.toggle('onward', onward);
    if (onward) { $('#nextText').textContent = t('stop.next'); $('#nextPts').textContent = ''; cta.dataset.step = 'next'; cta.removeAttribute('aria-label'); }
    else {
      const P = rules.points, [hh, mm] = String(rules.closeBy).split(':').map(Number), onTime = localMinutes(S.me.serverTime, tz()) < hh * 60 + mm;
      const worth = [P.visit, P.conversation, P.followup, onTime ? P.dayClosedOnTime : 0][sel], pays = worth > 0 ? t('pts.plus', { n: worth }) : '';
      $('#nextText').textContent = t(`stop.cta.${sel}`); $('#nextPts').textContent = pays;
      cta.dataset.step = sel === 3 ? 'close' : 'log';
      cta.setAttribute('aria-label', `${sel === 3 ? t('next.aria.close') : t('next.aria', { what: t(`habit.${sel}`) })} ${pays}`.trim());
    }
    $('#nextPts').hidden = !$('#nextPts').textContent;
  }
  stage.paintRoute(stops, { sel, at: today.closed ? null : at });
}
/** A log, or the close, landed on a stop: the stage shows that stop as it was, plays what happened there with the
 *  tracking ring around it, and only then lets the day move on. `before` and `after` are the day on each side. */
let answers = 0;
async function answer(hit, before, after) {
  const rules = S.me.rules, a = stopsOf(before, rules)[hit], b = stopsOf(after, rules)[hit], mine = ++answers;
  S.hold = hit; S.stop = null;
  try {
    await stage.hold(STOPS[hit], loopOf(hit, a)[0][0]);
    if (mine !== answers) return;   // a newer answer took the stage while this one was getting on it
    stage.burst(); buzz(12);
    await stage.play(STOPS[hit], rewardOf(hit, a.have, b.have, b.need), { once: true });
  } finally {
    // an answer that a newer one cut short leaves the stage to it, and so does one that ends while the close of the
    // day waits behind its sheet
    if (mine === answers && !S.owed) { S.hold = null; if (S.me && S.me.today) paintStage(true); }
  }
}

// ---- the week: a hand whose joints are lights, and what the week has brought ----
let stopTeach = null;
function handCaption(text = null) {
  const { week, today } = S.me, full = !!today && today.isWork && today.habits.every(Boolean);
  $('#handCap').textContent = text || (week.marks === 0 ? t('hand.cap.zero') : full ? t('hand.cap.full') : t('hand.cap', { a: week.marks, b: week.marksMax }));
}
function resultCard(key, art, why) {
  const n = src(h('button', { class: 'src num', type: 'button' }), () => t('c.source'), why);
  return h('div', { class: 'result', 'data-result': key }, h('span', { class: 'robj', 'data-art': art, 'aria-hidden': 'true' }, h('i', { class: 'base' }), h('i', { class: 'glow' })),
    h('h3'), h('div', { class: 'row' }, h('span', { class: 'pips', 'aria-hidden': 'true' }), h('span', { class: 'n' }, n, h('small'))), h('p'));
}
function paintResult(key, have, of) {
  const el = $(`[data-result="${key}"]`), pips = $('.pips', el);
  $('h3', el).textContent = t(`result.${key}`); $('p', el).textContent = t(`result.${key}.s`);
  if (pips.childElementCount !== of) pips.replaceChildren(...Array.from({ length: of }, () => h('i')));
  [...pips.children].forEach((pip, i) => pip.classList.toggle('on', i < have));
  countTo($('.src', el), have); $('small', el).textContent = ` ${t('result.of', { n: of })}`;
  el.classList.toggle('lit', have > 0);
}
function renderWeek(animate) {
  const { today, week, goal, goalPick, rules } = S.me;
  if (!week) return;
  const ws = week.start;
  $('#weekLead').textContent = `${t('time.week', { n: isoWeek(ws) })} · ${t('time.range', { a: dayMonth(ws), b: dayMonth(addDays(ws, 6)) })}`;
  giant($('#weekGiant'), t('week.giant'));
  $('#weekGiant').classList.toggle('word', t('week.giant').length > 9);
  $('#weekSupport').replaceChildren(...bold(t('week.sup.b'), t('week.sup')));
  const hand = $('#hand');
  if (!hand.hand) buildHand(hand);
  if (!stopTeach) {
    const open = today && today.isWork && !today.closed ? today.habits.findIndex((x) => !x) : -1;
    paintHand(hand, week.days, { wrist: week.anyLog, today: today ? today.day : null, animate, next: open >= 0 ? open : null });
    handCaption();
  }
  $('#teachT').textContent = t(stopTeach ? 'teach.stop' : 'teach.play');
  // which light is each habit: the four stops again, small and lit
  const legend = $('#legend');
  if (!legend.childElementCount) legend.append(...STOPS.map((art) => h('li', {}, h('span', { class: 'sl' }, h('i', { 'data-art': art })), h('b', { class: 'slabel' }), h('small', { class: 'tag' }))));
  [...legend.children].forEach((li, i) => { $('b', li).textContent = t(`stop.short.${i}`); $('small', li).textContent = t(`legend.n.${i}`); });

  // the weekly goal
  const box = $('#goalBox');
  box.hidden = !goal || !goal.options.length;
  if (!box.hidden) {
    $('#goalText').replaceChildren(...bold(t('goal.line', { goal: goalName(goal.picked, week.workFingers) }), goal.reached ? t('goal.reached') : goal.fullFingers > 0 ? t('goal.progress', { a: goal.fullFingers, b: goal.picked }) : ''),
      goalPick && goalPick.which === 'next' && !goalPick.isDefault ? ` ${t('goal.next.picked', { goal: goalName(goalPick.picked, goalPick.options.at(-1)) })}` : '');
    $('#goalBtn').hidden = readOnly() || !goalPick;
    $('#goalBtn').textContent = t(goalPick && goalPick.which === 'next' ? 'goal.pick.next' : 'c.change');
  }

  // what the week has brought: each a small scene that lights when there is something in it
  const results = $('#results');
  if (!results.childElementCount) results.append(resultCard('meet', 'meeting', () => t('src.meetings', { goal: S.me.rules.goals.meetings })), resultCard('con', 'contract', () => t('src.contract', { goal: S.me.rules.goals.contracts })));
  paintResult('meet', week.counts.meetings, rules.goals.meetings);
  paintResult('con', week.counts.contracts, rules.goals.contracts);

  // points, day by day. Saturday and Sunday have no finger: they share one bar, and only in a week when they brought something.
  const bars = $('#bars'), row = $('#dayRow'), extra = week.weekendPoints || 0;
  const cols = [...week.days.map((d) => ({ day: d.day, v: d.points || 0 })), { day: null, v: extra }];
  if (!bars.childElementCount) { bars.append(...cols.map(() => h('li', {}, h('i'), h('em', { class: 'num' })))); row.append(...cols.map(() => h('span', { class: 'flabel' }))); }
  bars.parentNode.classList.toggle('six', extra > 0);
  const top = Math.max(20, ...cols.map((c) => c.v)), offDay = !!today && !week.days.some((d) => d.day === today.day);
  cols.forEach((c, i) => {
    const li = bars.children[i], label = row.children[i], isToday = !!today && (c.day ? c.day === today.day : offDay);
    li.hidden = !c.day && !extra; label.hidden = li.hidden;
    li.classList.toggle('today', isToday); li.classList.toggle('has', c.v > 0);
    li.style.setProperty('--v', (c.v / top).toFixed(3)); $('em', li).textContent = num(c.v);
    li.setAttribute('aria-label', `${c.day ? cap(wdLong(c.day)) : t('week.wkd.aria')}: ${pts(c.v)}`);
    label.textContent = c.day ? upper(wdShort(c.day)) : t('week.wkd'); label.classList.toggle('today', isToday);
  });
  countTo($('#weekPts'), week.points);
}
/** "Cómo se enciende": the hand explains itself on the real object, then shows what is true again. */
function teach() {
  if (stopTeach) { stopTeach(); return; }
  if (!S.me || !S.me.week) return;
  const hand = $('#hand'), bars = $$('#teachSteps i'), btn = $('#teachBtn'), today = S.me.today;
  const f = today ? S.me.week.days.findIndex((d) => d.day === today.day && d.kind === 'work') : -1;
  hidePop();
  $('#teachSteps').classList.add('show'); btn.classList.add('playing'); $('use', btn).setAttribute('href', '#i-pause'); $('#teachT').textContent = t('teach.stop');
  stopTeach = teachHand(hand, { finger: f >= 0 ? f : 2,
    say: (n) => { handCaption(t(`teach.${n}`)); stagger([$('#handCap')], { y: 6 }); },
    beat: (n, ms) => { bars.forEach((b, i) => { b.className = i < n ? 'was' : ''; }); bars[n].style.setProperty('--ms', `${ms}ms`); void bars[n].getBoundingClientRect(); bars[n].classList.add('on'); },
    hot: (j) => [...$('#legend').children].forEach((li, i) => li.classList.toggle('hot', i === j)),
    done: () => {
      stopTeach = null;
      $('#teachSteps').classList.remove('show'); bars.forEach((b) => { b.className = ''; });
      btn.classList.remove('playing'); $('use', btn).setAttribute('href', '#i-play');
      if (S.me && S.me.week) renderWeek(true);
    } });
}
function goalName(k, fingers) { return k >= 5 && k === fingers ? t('goal.name.hand') : t('goal.name', { n: k }); }

function fingerDetail(hit) {
  const d = S.me.week.days[Number(hit.dataset.day)], today = S.me.today.day, name = `${cap(wdLong(d.day))} ${dayMonth(d.day)}`;
  if (d.kind === 'rest') return showPop(hit, name, t('finger.rest'));
  if (d.kind === 'future') return showPop(hit, name, t('finger.future'));
  const names = [0, 1, 2, 3].map((i) => t(`habitname.${i}`)), ok = names.filter((_, i) => d.habits[i]), no = names.filter((_, i) => !d.habits[i]);
  const parts = [];
  if (ok.length) parts.push(t('finger.done', { list: joinList(ok) }));
  parts.push(no.length ? t(d.day === today ? 'finger.missing.today' : 'finger.missing.past', { list: joinList(no) }) : t(d.repaired ? 'finger.repaired' : 'finger.full'));
  parts.push(t('finger.counts', { v: d.visits, c: d.conversations }));
  return showPop(hit, t('finger.title', { day: name, a: d.marks }), parts.join(' '));
}

// ---- the table, on the strip and on its own screen ----
function newRow(tag) {
  return () => h(tag, { class: 'trow' }, h('span', { class: 'pos num' }), h('span', { class: 'fc' }), h('span', { class: 'h' }), h('span', { class: 'who' }, h('b'), h('small'), h('button', { class: 'mate-ln', type: 'button' })),
    h('span', { class: 'sc' }, h('span', { class: 'pts num' }, h('span', { class: 'pv' }), h('small')), h('span', { class: 'gap num' })),
    h('i', { class: 'race', 'aria-hidden': 'true' }, h('i', { class: 'run' })), h('i', { class: 'vf', 'aria-hidden': 'true' }));
}
function paintRow(row, r, period, lead) {
  const ranked = r.place != null;
  row.classList.toggle('me', !!r.mine); row.classList.toggle('p1', r.place === 1); row.classList.toggle('open', !ranked);
  $('.pos', row).textContent = ranked ? String(r.place) : '·';
  putFace($('.fc', row), r);
  row.style.setProperty('--share', String(ranked && period !== 'month' ? raceShare(r.score, lead) : 0));
  $('.h', row).replaceChildren(miniHand(r.hand, rowWrist(r)));
  $('.who b', row).textContent = r.mine ? t('table.you', { name: r.first }) : r.name;
  put($('.who small', row), cityName(r.city), r.isNew ? h('span', { class: 'tag', text: t('table.new') }) : null);
  paintMate($('.mate-ln', row), r);
  const pv = $('.pv', row), unit = $('.pts small', row), gap = $('.gap', row);
  if (!ranked) { delete pv.dataset.v; pv.textContent = num(r.marks); unit.textContent = `/${num(r.marksMax)}`; gap.textContent = t('u.marks'); }
  else if (period === 'month') { delete pv.dataset.v; pv.textContent = num(r.sites); unit.textContent = unitWord('u.sites', r.sites); gap.textContent = t('u.meetings', { n: r.meetings }); }
  else { countTo(pv, r.score); unit.textContent = t('u.pts'); gap.textContent = r.place === 1 ? t('table.gap.lead') : `−${num(lead - r.score)}`; }
}
/** A person's line under their name on Equipo: active sites, the week's accepted hours and earnings (or "monto por
 *  definir"). A tap opens their card; one's own opens "Mis sitios activos". */
function paintMate(btn, r) {
  const entry = (S.me.crew || []).find((c) => c.id === r.id), line = mateLine(entry, t);
  btn.hidden = !line;
  if (!line) return;
  // each figure stays whole and a wrapped line never starts with its separator
  const parts = line.split(' · ');
  btn.replaceChildren(...parts.flatMap((x, i) => [h('span', { class: 'ml-p', text: i < parts.length - 1 ? `${x} ·` : x }), i < parts.length - 1 ? ' ' : null]).filter(Boolean));
  btn.setAttribute('aria-label', `${line}. ${t('mate.open.aria', { name: r.name })}`);
  btn.onclick = (e) => { e.stopPropagation(); if (r.mine || r.id === S.me.me.id) sites.open('table'); else sites.mate(r.id, r.name); };
}
/** The rows a rep may see with a number: the podium and their own. */
function shownRows(table) {
  const rows = [...table.podium];
  if (table.me && !table.me.onPodium) rows.push({ ...table.me, mine: true });
  return rows;
}
/** The team's shared number as a staircase: everybody stands on the same step, and each meeting takes them one up. */
function renderClimb(animate) {
  const { team, table } = S.me, climb = $('#climb'), crew = $('#crew');
  climb.hidden = !team.players;
  giant($('#goalGiant'), `${t('today.of', { a: num(team.meetings), b: num(team.target) })}.`);
  const reached = team.target > 0 && team.meetings >= team.target, sup = $('#goalSupport');
  let n = $('.src', sup);
  if (!n) n = src(h('button', { class: 'src num', type: 'button' }), () => t('c.source'), () => t('src.team', { target: S.me.team.target, per: Math.round(S.me.team.target / Math.max(1, S.me.team.players)) }));
  n.textContent = t('today.of', { a: num(team.meetings), b: num(team.target) });
  const [a, b = ''] = t('team.sup', { n: '\u0001' }).split('\u0001');
  sup.replaceChildren(a, n, `${b} ${t(reached ? 'team.flag' : 'team.climb')}`);
  // everybody on the team, as faces on the same step
  const people = crewOf(table.week);
  const key = people.map((r) => `${r.id}:${r.photo || ''}`).join('|');
  if (crew.dataset.key !== key) { crew.dataset.key = key; crew.replaceChildren(...people.map((r) => face(r))); }
  const at = stepOf(team.meetings, team.target), [x, y] = STEPS[at];
  const was = crew.getBoundingClientRect();
  for (const node of [crew, $('.crewshadow', climb)]) { node.style.left = `${(x * 100).toFixed(2)}%`; node.style.top = `${(y * 100).toFixed(2)}%`; }
  if (animate && !reduce && crew.dataset.at != null && crew.dataset.at !== String(at) && crew.animate && was.width) {
    const now = crew.getBoundingClientRect(), dx = was.left - now.left, dy = was.top - now.top;
    crew.animate([{ translate: `${dx}px ${dy}px` }, { translate: `${dx / 2}px ${dy / 2 - 24}px`, offset: 0.5 }, { translate: '0 0' }], { duration: 620, easing: EASE.out });
  }
  crew.dataset.at = String(at);
  climb.classList.toggle('reached', reached);
}
function renderTable(animate = false) {
  const { table } = S.me, T = table[S.period], mine = T.me, period = S.period;
  renderClimb(animate);
  const day = S.me.today ? S.me.today.day : S.me.serverTime.slice(0, 10), ws = S.me.week ? S.me.week.start : addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
  $('#weekChip').textContent = `${upper(t('time.week', { n: isoWeek(day) }))} · ${upper(t('time.range', { a: dayMonth(ws), b: dayMonth(addDays(ws, 6)) }))}`;
  $('#tableLead').textContent = period === 'day' ? t('table.lead.day', { date: dayMonth(day) }) : period === 'month' ? t('table.lead.month', { month: cap(monthName(day)) }) : t('table.lead.week', { date: dayMonth(ws) });
  for (const b of $$('#tableSeg button')) b.setAttribute('aria-pressed', String(b.dataset.period === period));
  const head = $('#tableGiant'), sup = $('#tableSupport');
  if (mine && mine.place != null) {
    withEm(head, 'table.giant', { ord: ord(mine.place) }, 'ord');
    const gapText = (n) => (period === 'month' ? '' : pts(n)), parts = [];
    if (period === 'month') parts.push(t('table.sup.month'));
    else if (mine.place === 1) parts.push(h('b', { text: t('table.sup.lead') }));
    else if (T.gap) parts.push(h('b', { text: T.gap.aheadOnPodium ? t('table.sup.gap.named', { gap: gapText(T.gap.pts), name: T.gap.aheadName }) : t('table.sup.gap.next', { gap: gapText(T.gap.pts) }) }));
    if (T.behind && period !== 'month') parts.push(` ${t('table.sup.behind', { name: T.behind.name, gap: gapText(T.behind.pts) })}`);
    sup.replaceChildren(...parts);
  } else if (mine && mine.isNew) { giant(head, t('table.giant.new')); sup.textContent = t('table.sup.new', { n: 14 }); }
  else { giant(head, t('table.giant.zero')); sup.textContent = period === 'month' ? t('table.sup.month') : t('table.sup.zero'); }
  // A new rep's first days, as joints: the days gone by, and today.
  const first = firstDays(S.me), days = $('#rsDays');
  days.hidden = !first;
  if (first && days.dataset.key !== `${first.day}:${lang()}`) { days.dataset.key = `${first.day}:${lang()}`; days.replaceChildren(daysBone(first.day, first.of, t('rank.days.aria', { d: first.day, n: first.of }))); }
  const lead = T.podium[0] ? T.podium[0].score : 0;
  flipList($('#tableRows'), shownRows(T), (r) => r.id, newRow('li'), (row, r) => paintRow(row, r, period, lead));
  const why = tableNote(T), emptyNote = $('#tableEmpty');
  emptyNote.hidden = why === 'ranked';
  emptyNote.textContent = why === 'new' ? t('table.empty.new', { n: 14 }) : t('table.empty');
  // Everyone else: alphabetical, with the marks of their hand and no place.
  $('#restLabel').hidden = !T.rest.length;
  $('#restRows').replaceChildren(...T.rest.map((r) => {
    const sc = src(h('button', { class: 'sc', type: 'button' }, h('span', { class: 'pts num' }, h('span', { class: 'pv', text: num(r.marks) }), h('small', { text: `/${num(r.marksMax)}` })), h('span', { class: 'gap', text: t('u.marks') })), () => t('c.source'), () => t('src.marks'));
    const mateBtn = h('button', { class: 'mate-ln', type: 'button' }); paintMate(mateBtn, r);
    return h('li', { class: 'trow open' }, h('span', { class: 'pos num', text: '·', 'aria-hidden': 'true' }), h('span', { class: 'h' }, miniHand(r.hand, rowWrist(r))),
      h('span', { class: 'who' }, h('b', { text: r.name }), h('small', {}, cityName(r.city), r.isNew ? h('span', { class: 'tag', text: t('table.new') }) : null), mateBtn), sc);
  }));
  renderSquad(T, period);
  // the field: the last play and what the team is doing
  renderFeed($('#feed'), $('#feedEmpty'), animate); renderPlay();
  // An empty feed on a day that can still be logged shows who is on the field and where to start.
  const zero = $('#feedZero'), now = S.me.today, none = !S.me.feed.length && !readOnly() && !!now && !now.closed;
  zero.hidden = !none;
  if (none) {
    $('#feedEmpty').hidden = true;
    const W = S.me.table.week, people = [...(W.me ? [W.me] : []), ...W.podium.filter((r) => !r.mine), ...W.rest].slice(0, 6), key = people.map((r) => `${r.id}:${r.photo || ''}`).join('|');
    if (zero.dataset.key !== key) { zero.dataset.key = key; $('#feedFaces').replaceChildren(...people.map((r) => face(r))); }
  }
}

/** The team as lenses over the table: the podium larger, the viewer framed. Every arc is the marks of that person's hand,
 *  which the whole team can see; a place and its points show only where the table shows them. */
function renderSquad(T, period) {
  const share = (r) => (r.marksMax ? r.marks / r.marksMax : 0), people = [];
  for (const r of T.podium) people.push({ ...r, tier: `pod p${r.place}`, share: share(r) });
  if (T.me && !T.me.onPodium) people.push({ ...T.me, mine: true, tier: T.me.place != null ? 'pod' : '', share: share(T.me) });
  for (const r of T.rest.slice(0, 9)) people.push({ ...r, tier: '', share: share(r) });
  const names = shortNames(people);   // two people with the same first name are told apart
  const build = () => {
    const node = h('button', { class: 'fl', type: 'button' }, h('span', { class: 'pt' }, h('span', { class: 'ps' }), h('i', { class: 'vf', 'aria-hidden': 'true' })), h('b'), h('span', { class: 'chip num' }));
    return src(node, () => t('c.source'), () => t(node.dataset.ranked ? 'src.place' : 'src.marks'));
  };
  flipList($('#squad'), people, (r) => r.id, build, (node, r) => {
    const ranked = r.place != null;
    node.className = `fl ${r.tier}${r.mine ? ' mine' : ''}`.replace(/\s+/g, ' ').trim();
    if (ranked) node.dataset.ranked = '1'; else delete node.dataset.ranked;
    putFace($('.ps', node), r, (person) => portrait(person, { share: 0 }));
    setPortrait($('.ps .portrait', node), r.share);
    $('b', node).textContent = r.mine ? t('table.you', { name: names.get(r.id) }) : names.get(r.id);
    const value = !ranked ? `${num(r.marks)}/${num(r.marksMax)}` : period === 'month' ? t('u.sites', { n: r.sites }) : pts(r.score);
    $('.chip', node).textContent = ranked ? `${ord(r.place)} · ${period === 'month' ? value : `${num(r.score)} ${t('u.pts')}`}` : value;
    node.setAttribute('aria-label', ranked ? t('squad.place', { name: r.name, place: ord(r.place), pts: value }) : t('squad.marks', { name: r.name, a: r.marks, b: r.marksMax }));
  });
}

// ---- closing the day ----
function renderCloseCard() {
  const { today, rules } = S.me, btn = $('#closeBtn');
  // A working day closes through the route's last stop. A day off has no route, so its close lives here.
  $('#closeCard').hidden = !closeCard(today) || (!today.closed && readOnly());
  $('#closeCard').classList.toggle('light', !today.closed && !readOnly() && anyLog(today));   // it speaks in porcelain once there is something to close
  if (today.closed) {
    $('#closeH').textContent = t('close.done.title');
    $('#closeP').textContent = t(today.closedOnTime ? 'close.done.p' : 'close.done.late', { time: clock(today.closedAt, tz()), by: hourName(rules.closeBy) });
    btn.textContent = t('close.view');
  } else { $('#closeH').textContent = t('close.title'); $('#closeP').textContent = t('close.p'); btn.textContent = t('close.btn'); }
  btn.hidden = readOnly();
}
let baseReport = '';
function drawReport() {
  const lines = baseReport.split('\n');
  if (lines.length >= 5 && !S.me.today.closed) {
    lines[lines.length - 2] = `Mañana: ${$('#fTomorrow').value.trim() || '…'}`;
    lines[lines.length - 1] = `Bloqueo: ${$('#fBlock').value.trim() || 'ninguno'}`;
  }
  $('#slackText').textContent = lines.join('\n');
}
function paintCloseSheet() {
  const closed = S.me.today.closed;
  $('#closeFields').hidden = closed;
  $('#closeSubmit').textContent = closed ? t('close.copy') : t('close.submit');
  $('#closeNote').textContent = closed ? t('close.note.done') : t('close.note');
  $('#closeErr').hidden = true; $('#closeSubmit').disabled = false;
  drawReport();
}
async function openClose() {
  if (readOnly()) return;
  baseReport = ''; paintCloseSheet(); openSheet($('#closeSheet'));
  try {
    if (myQueue().length) await flush();   // the report counts what the server has, so waiting logs go out first
    const r = await api('POST', 'close', { preview: true, tomorrow: '', blocker: '' }); baseReport = r.report; drawReport();
    // Nothing logged today: say so before the rep writes a plan that cannot be sent.
    if (r.empty && !myQueue().length) { $('#closeErr').textContent = t('err.nothing_to_close'); $('#closeErr').hidden = false; $('#closeSubmit').disabled = true; }
  } catch (e) { $('#closeErr').textContent = errText(e); $('#closeErr').hidden = false; }
}
function submitClose() {
  const btn = $('#closeSubmit'), err = $('#closeErr');
  return once(btn, async () => {
    err.hidden = true;
    if (S.me.today.closed) { toast(t((await copyText($('#slackText').textContent)) ? 'close.copied' : 'close.copy.fail')); return; }
    // A closed day refuses new logs, so the ones still waiting on this phone go out first.
    if (myQueue().length) await flush();
    if (myQueue().length) { showErr(err, t('close.waiting', { n: myQueue().length })); return; }
    try {
      const res = await api('POST', 'close', { tomorrow: $('#fTomorrow').value.trim(), blocker: $('#fBlock').value.trim() });
      const was = S.me.today.points, before = S.me;
      if (before.today && !before.today.closed && res.me.today && res.me.today.closed) { S.hold = 3; S.stop = null; S.owed = { hit: 3, before: before.today, after: res.me.today }; }
      baseReport = res.report; adopt(res.me); paintCloseSheet();
      const earned = Math.max(0, res.me.today.points - was);
      playMoments(moments(before, res.me).map((m) => ({ ...m, gained: earned, streak: 0 })));   // closing can fill the finger: its moment plays when this sheet closes
      if (!reduce) { const line = $('#slackPrev .scan'), height = $('#slackPrev').offsetHeight; line.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${height}px)`, opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
      renderAll(true);
      const gained = res.me.today.points - was;
      toast(t('close.toast'), gained > 0 ? t('pts.plus', { n: gained }) : '');
      $('#fTomorrow').value = ''; $('#fBlock').value = '';
    } catch (e) { showErr(err, errText(e)); }
  });
}

// ---- the feed and the plays ----
function kudosButton(f) {
  const btn = h('button', { class: 'kudos', type: 'button', 'aria-pressed': String(!!f.clapped), 'aria-label': t('kudos.aria', { name: f.name }), disabled: f.mine || !may().kudos }, icon('clap'), h('span', { class: 'num', text: String(f.kudos), hidden: !f.kudos }));
  btn.addEventListener('click', () => clap(f, btn));
  return btn;
}
/** A teammate as the table knows them: the feed carries only their id and first name. */
function mate(id, name) {
  const T = S.me.table.week, row = [...T.podium, ...T.rest, ...(T.me ? [T.me] : [])].find((r) => r.id === id);
  return { id, name: row ? row.name : name, photo: row ? row.photo : null };
}
function feedItem(f, fresh) {
  const clapBtn = kudosButton(f);
  return h('li', { class: fresh ? 'new' : null }, face(mate(f.rep, f.name)), h('span', {}, h('b', { text: f.name }), ` ${t(`feed.${f.code}`)}`, f.play ? h('q', { text: f.play }) : null,
    h('small', { text: `${cityName(f.city)} · ${ago(f.at, S.me.serverTime, tz())}` })),
  h('span', { class: 'side' }, f.pts ? h('span', { class: 'p num', text: `+${num(f.pts)}` }) : null, clapBtn));
}
function renderFeed(list, empty, animate) {
  const items = S.me.feed.slice(0, 10), seen = S.seenFeed;
  list.replaceChildren(...items.map((f) => feedItem(f, animate && !!seen && !seen.has(f.id))));
  S.seenFeed = new Set(S.me.feed.map((f) => f.id));
  empty.hidden = items.length > 0;
}
async function clap(f, btn) {
  const on = btn.getAttribute('aria-pressed') !== 'true', n = $('.num', btn);
  const count = (by) => { const v = Math.max(0, Number(n.textContent) + by); n.textContent = String(v); n.hidden = v === 0; };
  btn.setAttribute('aria-pressed', String(on)); count(on ? 1 : -1);
  if (on) { buzz(8); lock($('svg', btn)); ringAt($('svg', btn)); }
  try { const res = await api('POST', 'kudos', { target: f.id, on }); adopt(res.me); }
  catch (e) { btn.setAttribute('aria-pressed', String(!on)); count(on ? -1 : 1); toast(errText(e)); }
}
function renderPlay() {
  const f = S.me.feed.find((x) => x.play && x.code !== 'badge'), card = $('#playCard');
  card.hidden = !f;
  if (!f) return;
  $('#playQ').textContent = f.play;
  $('#playBy').textContent = `${f.name} · ${cityName(f.city)} · ${t(`feed.${f.code}`)}`;
  put($('#playK'), kudosButton(f));
}
function askPlay(logId) {
  formSheet({ title: t('play.ask.title'), intro: t('play.ask.p'), submit: t('play.ask.send'), skip: t('play.ask.skip'),
    fields: [{ name: 'text', type: 'textarea', label: t('play.ask.label'), placeholder: t('play.ask.ph'), max: 280 }],
    onSubmit: async (v) => { const res = await api('POST', 'play', { logId, text: v.text }); adopt(res.me); renderAll(false); toast(t('play.saved')); } });
}

// ---- weekly goal ----
function openGoal() {
  const pick = S.me.goalPick;
  if (!pick) { toast(t('goal.sheet.locked')); return; }
  $('#goalWhen').textContent = t(pick.which === 'next' ? 'goal.sheet.next' : 'goal.sheet.this');
  const top = pick.options.at(-1);
  $('#goalOpts').replaceChildren(...pick.options.map((k, i) => {
    const tier = pick.options.length - 1 - i;   // the last option is the top one
    return h('button', { class: 'leadopt', type: 'button', 'aria-pressed': String(k === pick.picked), onclick: (e) => once(e.currentTarget, async () => {
      try { const res = await api('POST', 'goal', { k }); adopt(res.me); renderAll(false); closeSheet($('#goalSheet')); toast(t(pick.which === 'next' ? 'goal.next.picked' : 'goal.saved', { goal: goalName(k, top) })); }
      catch (err) { toast(errText(err)); }
    }) }, h('span', {}, h('b', { text: cap(goalName(k, top)) }), h('small', { text: t('goal.opt.s', { n: k }) })),
    h('span', { class: 'k', text: k === pick.picked && pick.isDefault ? t('goal.suggested') : t(`goal.opt.${Math.max(0, 2 - tier)}`) }));
  }));
  openSheet($('#goalSheet'));
}

// ---- profile ----
function renderProfile() {
  const { me, level, badges, ledger, rules, pending } = S.me;
  if (!level) return;
  $('#whoChip').textContent = me.practice ? t('reps.practice.name') : me.name; $('#whoCity').textContent = cityName(me.city);
  putFace($('#portrait'), me, (person) => portrait(person, { share: 0 }));
  setPortrait($('#portrait .portrait'), level.next == null ? 1 : (level.xp - level.floor) / Math.max(1, level.next - level.floor));
  const levelWord = t(`level.${level.name}`);
  giant($('#profileGiant'), `${levelWord}.`);
  $('#profileGiant').classList.toggle('long', levelWord.length >= 10);   // the longest names need a smaller size to stay on one line
  const idx = rules.levels.findIndex((l) => l.name === level.name), steps = rules.levels[idx].steps, after = rules.levels[idx + 1];
  const life = src(h('button', { class: 'src num', type: 'button', text: num(level.xp) }), () => t('c.source'), () => t('src.life'));
  const next = level.next == null ? t('profile.top') : level.step < steps.length ? t('profile.next.step', { n: level.next - level.xp, s: level.step + 1 }) : t('profile.next.level', { n: level.next - level.xp, level: t(`level.${after.name}`) });
  $('#lvl').replaceChildren(levelBone(level, steps, after ? after.steps[0] : null),
    h('div', { class: 'row' }, h('span', {}, h('b', {}, life), ` ${unitWord('u.points', level.xp)} ${t('profile.life')}`), h('span', { text: `${t('profile.step', { a: level.step, b: steps.length })} · ${next}` })));

  $('#badges').replaceChildren(...badges.map((b) => {
    const levels = ONE_LEVEL.has(b.code) ? 1 : 3;
    const state = b.level === 0 ? (b.next > 1 ? t('badge.progress', { have: b.have, next: b.next }) : t('badge.state.todo'))
      : levels === 1 ? t('badge.state.done') : `${t('badge.state.level', { n: b.level })}${b.next ? ` · ${t('badge.progress', { have: b.have, next: b.next })}` : ''}`;
    const aim = b.level === 0 && badges.findIndex((x) => x.level === 0) === badges.indexOf(b);   // the first one still to earn
    return src(h('button', { class: `badge${b.level === 0 ? ' locked' : ''}${aim ? ' aim' : ''}`, type: 'button' }, badgeGlyph(b.code, b.level, levels), h('b', { text: t(`badge.${b.code}`) }), h('small', { text: state }), h('i', { class: 'vf', 'aria-hidden': 'true' })),
      () => t(`badge.${b.code}`), () => t(`badge.info.${b.code}`));
  }));

  const heldSet = new Map(pending.map((p) => [`${p.logId}:${p.code}`, p]));
  const rows = historyRows(ledger, pending), more = $('#ledgerMore'), rest = rows.length - 10;   // what waits for the person comes first
  more.hidden = S.ledgerAll || rest <= 0; more.textContent = rest > 0 ? t('profile.ledger.more', { n: rest }) : '';
  $('#ledger').replaceChildren(...(S.ledgerAll ? rows : rows.slice(0, 10)).map((e) => {
    const waiting = e.status === 'pending', gone = e.status === 'expired', when = stamp(e.at, tz());
    const row = src(h('button', { class: 'rowsrc', type: 'button' }, t(`led.${e.code}`), h('small', {}, e.lead ? t('led.meta.lead', { lead: e.lead.name, when }) : when, waiting || gone ? h('span', { class: 'st', text: ` · ${t(`st.${e.status}`)}` }) : null)),
      () => t('c.source'), () => t(`ledsrc.${e.code}`, { pts: pts(e.pts), cap: rules.caps.messagesPerDay, days: rules.pendingDays, time: hourName(rules.closeBy) }));
    let act = null;
    const p = heldSet.get(`${e.logId}:${e.code}`);
    const confirmed = ['meeting_held', 'contract_sent', 'contract_signed'].includes(e.code) && e.status === 'earned';
    if (readOnly() && e.logId && confirmed) act = h('button', { class: 'mini-btn', type: 'button', text: t('needs.btn.undo'), 'aria-label': t('undo.row'), onclick: (ev) => manager.undoConfirm(ev.currentTarget, e.logId, e.code) });
    else if (readOnly() && e.logId && e.code !== 'day_closed') act = h('button', { class: 'mini-btn', type: 'button', text: t('needs.btn.void'), 'aria-label': t('void.row'), onclick: () => manager.voidLog(e.logId) });
    else if (waiting && e.code === 'meeting_held' && p) {
      act = p.held ? h('small', { text: t('profile.held.done') }) : h('button', { class: 'mini-btn', type: 'button', text: t('profile.held'), onclick: (ev) => once(ev.currentTarget, async () => {
        try { const res = await api('POST', 'held', { logId: e.logId }); adopt(res.me); renderAll(false); toast(t('profile.held.toast')); } catch (err) { toast(errText(err)); }
      }) });
    }
    // a row about a business on its way to a site opens that business's route
    if (!act && e.lead && ROUTE_CODES.has(e.code)) act = h('button', { class: 'mini-btn', type: 'button', text: t('route.row'), 'aria-label': t('route.row.aria', { lead: e.lead.name }), onclick: () => route.open(e.lead.id, 'profile') });
    return h('li', { class: waiting ? 'pend' : gone ? 'gone' : null }, h('span', { class: 'p', text: `+${num(e.pts)}` }), row, act);
  }));
  $('#ledgerEmpty').hidden = ledger.length > 0;

  const box = $('#settings');
  const docsBtn = h('button', { class: 'btn', type: 'button', text: t('docs.chip'), onclick: () => docs.open('profile') });
  if (mode() === 'practice') put(box, ...ladder.profileButtons(), ...route.profileButtons(), docsBtn, h('button', { class: 'btn', type: 'button', text: t('profile.rules'), 'data-open': 'rulesSheet' }));
  else if (may().manage) {
    put(box,
      ...ladder.profileButtons(), ...route.profileButtons(), docsBtn,
      h('button', { class: 'btn', type: 'button', text: t('reps.badge'), onclick: () => manager.giveBadge(me) }),
      S.me.today && S.me.today.closed ? h('button', { class: 'btn', type: 'button', text: t('reps.reopen'), onclick: (ev) => manager.reopenDay(ev.currentTarget, me.id, S.me.today.day) }) : null);
  } else {
    // The account is the Google one the person came in with. A copy with no session (the demonstration) has none to show.
    put(box, S.me.viewer.email ? h('div', { class: 'line' }, h('span', { text: t('profile.account', { email: S.me.viewer.email }) })) : null,
      ...ladder.profileButtons(), ...route.profileButtons(), docsBtn,
      h('button', { class: 'btn', type: 'button', text: t('profile.rules'), 'data-open': 'rulesSheet' }),
      h('button', { class: 'btn signout', type: 'button', text: t('profile.signout'), onclick: signOut }));
  }
}
function renderRules() {
  const r = S.me.rules, by = hourName(r.closeBy);
  $('#rules').replaceChildren(...Object.entries(LEDGER_RULE).map(([code, key]) => h('li', {}, h('b', { class: 'num', text: t('pts.plus', { n: r.points[key] }).slice(1) }),
    h('span', {}, t(`led.${code}`), h('small', { text: t(`rules.note.${code}`, { cap: r.caps.messagesPerDay, time: by }) })))));
  $('#rulesStreak').textContent = t('rules.streak', { n: r.spares });
}

// ---- logging a contact ----
const L = { lead: null, kind: null, channel: null, voicemail: false, tag: null, contact: '', when: '', note: '', more: false, q: '', found: null, searching: 0, from: null };
/** The log sheet. From a business's route it opens with that business and the result already picked, and goes back to
 *  the route once saved; from anywhere else (a click event is passed then) it opens empty. */
function openLog(preset = null) {
  if (readOnly()) return;   // screens that are not the person's own (view-as, or leaving practice mode) log nothing
  if (logLocked(S.me.today, mode())) { toast(t('log.closed')); return; }   // the practice rep logs on after closing, for the demonstration
  const given = preset && preset.lead ? preset : null;
  Object.assign(L, { lead: null, kind: null, channel: null, voicemail: false, tag: null, contact: '', when: '', note: '', more: false, q: '', found: null, from: null });
  if (given) Object.assign(L, { lead: { id: given.lead.id, name: given.lead.name, zone: '', known: true }, kind: given.kind, channel: CHANNELS[given.kind] ? CHANNELS[given.kind][0] : null, from: given.from || null });
  $('#leadQ').value = ''; $('#newName').value = ''; $('#newZone').value = '';
  renderLog(); openSheet($('#logSheet'));
}
// What each result looks like on the route: the frame of a stop that tells it, or the scene of a meeting or a contract.
const OUT_ART = { talk: ['visit', 3], absent: ['visit', 0], call: ['follow', 2], message: ['follow', 1], reply: ['follow', 3], noanswer: ['follow', 0], meeting: ['meeting'], contract: ['contract'] };
function outArt(kind) {
  const art = OUT_ART[kind];
  if (!art) return icon(kind);
  const pic = h('i', { 'data-art': art[0] });
  if (art.length > 1) pic.dataset.f = String(art[1]);
  return h('span', { class: art.length > 1 ? 'sl' : 'sl one', 'aria-hidden': 'true' }, pic);
}
function leadOption(l, pressed) {
  const today = S.me.today.day, mine = l.lastDay ? t('log.last', { date: l.lastDay === today ? t('nav.today').toLocaleLowerCase() : dayMonth(l.lastDay) }) : l.known ? t('log.known') : t('log.unknown');
  return h('button', { class: 'leadopt', type: 'button', 'aria-pressed': String(!!pressed), onclick: () => { L.lead = pressed ? null : l; renderLog(); } },
    h('span', {}, h('b', { text: l.name }), h('small', { text: l.zone || l.id })), h('span', { class: 'k', text: pressed ? t('log.pick.change') : mine }));
}
function renderLog() {
  const picked = $('#leadPicked'), pick = $('#leadPick'), isNew = L.lead && L.lead.isNew;
  // 1. the business
  picked.hidden = !L.lead || isNew; pick.hidden = !!L.lead && !isNew;
  if (L.lead && !isNew) picked.replaceChildren(h('div', { class: 'leads' }, leadOption(L.lead, true)));
  const recents = S.me.recentLeads.slice(0, 4).map((l) => ({ ...l, known: true }));
  const list = L.q.length >= 2 ? (L.found || []) : recents;
  const newOpt = h('button', { class: 'leadopt dashed', type: 'button', 'aria-pressed': String(!!isNew), onclick: () => {
    L.lead = isNew ? null : { isNew: true }; if (!isNew && L.q.length >= 2 && !$('#newName').value) $('#newName').value = L.q; renderLog(); if (!isNew) $('#newName').focus();
  } }, h('span', {}, h('b', { text: t('log.new') }), h('small', { text: t('log.new.s') })), h('span', { class: 'k', text: isNew ? t('log.pick.change') : '' }));
  $('#leadOpts').replaceChildren(...(isNew ? [] : list.map((l) => leadOption(l, false))), newOpt);
  $('.field.search', pick).hidden = !!isNew;
  $('#newLead').hidden = !isNew;
  const note = $('#leadNote');
  note.hidden = isNew || !(L.q.length >= 2 && L.found && !L.found.length);
  if (!note.hidden) note.textContent = t(L.offline ? 'log.search.offline' : 'log.none');

  // 2. the result
  const kinds = L.more ? [...MAIN_KINDS, ...MORE_KINDS] : MAIN_KINDS, P = S.me.rules.points;
  const hint = (k) => {
    if (k === 'talk') return t('pts.plus', { n: P.visit + P.conversation });
    if (k === 'absent') return t('pts.plus', { n: P.visit });
    if (k === 'call') return t('pts.plus', { n: P.conversation });
    if (k === 'message') return t('pts.plus', { n: P.message });
    if (k === 'reply') return t('pts.plus', { n: P.reply });
    if (k === 'meeting') return t('pts.meeting', { a: P.conversation + P.meetingBooked + ((L.kind === 'meeting' ? L.channel : 'visit') === 'visit' ? P.visit : 0), b: P.meetingHeld });
    if (k === 'contract') return t('pts.contract', { a: P.contractSent, b: P.contractSigned });
    return t('pts.none');
  };
  $('#outOpts').replaceChildren(...kinds.map((k) => h('button', { class: 'out', type: 'button', 'aria-pressed': String(L.kind === k), onclick: () => {
    L.kind = L.kind === k ? null : k; L.channel = L.kind && CHANNELS[L.kind] ? CHANNELS[L.kind][0] : null; L.voicemail = false; L.tag = null; renderLog();
  } }, outArt(k), h('b', { text: t(`kind.${k}`) }), h('span', { class: 'pp', text: hint(k) }))));
  const more = $('#moreOuts'); more.textContent = t(L.more ? 'log.less' : 'log.more'); more.setAttribute('aria-expanded', String(L.more));

  // 3. the details this result asks for
  const extra = $('#logExtra'), fields = $('#logFields'), k = L.kind;
  extra.hidden = !k;
  if (k) {
    const nodes = [];
    if (CHANNELS[k]) nodes.push(h('p', { class: 'label', text: t('log.channel') }), h('div', { class: 'chipset', role: 'group', 'aria-label': t('log.channel') },
      CHANNELS[k].map((c) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(L.channel === c), text: t(`ch.${c}`), onclick: () => { L.channel = c; keepFields(); renderLog(); } }))));
    if (k === 'noanswer') { const box = h('input', { type: 'checkbox', checked: L.voicemail, onchange: (e) => { L.voicemail = e.target.checked; } }); nodes.push(h('label', { class: 'switch' }, box, t('log.voicemail'))); }
    if (k === 'meeting' || k === 'contract') {
      const who = h('input', { id: 'lContact', type: 'text', maxlength: 120, autocomplete: 'off', placeholder: t('log.contact.ph') }); who.value = L.contact;
      const when = h('input', { id: 'lWhen', type: 'date' }); when.value = L.when;
      nodes.push(h('label', { class: 'field' }, h('span', { class: 'label', text: t('log.contact') }), who), h('label', { class: 'field' }, h('span', { class: 'label', text: t(`log.when.${k}`) }), when));
    }
    if (TAGGED.has(k)) nodes.push(h('p', { class: 'label', text: t('log.tag') }), h('div', { class: 'chipset', role: 'group', 'aria-label': t('log.tag') },
      TAGS.map((g) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(L.tag === g), text: t(`tag.${g}`), onclick: () => { L.tag = L.tag === g ? null : g; keepFields(); renderLog(); } }))));
    if (k === 'contract') { const box = h('div', { class: 'doc-hooks' }); docs.hooks(box, 'contract'); nodes.push(box); }   // what to send or sign, at hand
    const noteIn = h('input', { id: 'lNote', type: 'text', maxlength: 500, autocomplete: 'off', placeholder: t('log.note.ph') }); noteIn.value = L.note;
    nodes.push(h('label', { class: 'field' }, h('span', { class: 'label', text: t('log.note') }), noteIn));
    fields.replaceChildren(...nodes);
  }
  paintLogFoot();
}
/** What was typed in the detail fields survives a redraw. */
function keepFields() {
  for (const [id, key] of [['#lContact', 'contact'], ['#lWhen', 'when'], ['#lNote', 'note']]) { const n = $(id); if (n) L[key] = n.value; }
}
function logReady() {
  if (!L.kind || !L.lead) return false;
  return L.lead.isNew ? $('#newName').value.trim().length >= 2 : true;
}
function paintLogFoot() {
  const today = S.me.today.day, lead = L.lead, hintNode = $('#logHint');
  $('#saveLog').disabled = !logReady();
  if (!L.kind || !lead) hintNode.textContent = t('log.hint.pick');
  else if (!lead.isNew && lead.known && (!lead.lastDay || lead.lastDay < today)) hintNode.textContent = FOLLOWS.has(L.kind) ? t('log.hint.follow', { n: S.me.rules.points.followup }) : t('log.hint.nofollow');
  else hintNode.textContent = lead.isNew || !lead.known ? t('log.hint.first') : t('log.hint.pick');
}
let searchTimer;
function onSearch() {
  L.q = $('#leadQ').value.trim(); L.found = null; L.offline = false;
  clearTimeout(searchTimer);
  if (L.q.length < 2) { renderLeadList(); return; }
  const ticket = ++L.searching;
  searchTimer = setTimeout(async () => {
    try { const r = await api('GET', `leads?q=${encodeURIComponent(L.q)}`); if (ticket === L.searching) L.found = r.leads.slice(0, 6); }
    catch (e) { if (ticket === L.searching) { L.found = []; L.offline = e.code === 'offline'; } }
    if (ticket === L.searching) renderLeadList();
  }, 220);
}
/** Redraw the list under the search box without touching the box itself, so typing is never interrupted. */
function renderLeadList() {
  const input = $('#leadQ'), had = document.activeElement === input, at = input.selectionStart;
  renderLog();
  if (had) { input.focus(); try { input.setSelectionRange(at, at); } catch { /* not a text field in this browser */ } }
}
function saveLog() {
  if (!logReady() || readOnly()) return undefined;
  keepFields();
  const body = { id: newId(), kind: L.kind, clientAt: new Date().toISOString(), lead: L.lead.isNew ? { name: $('#newName').value.trim(), zone: $('#newZone').value.trim() } : { id: L.lead.id } };
  if (L.channel) body.channel = L.channel;
  if (L.voicemail) body.voicemail = true;
  if (L.tag) body.tag = L.tag;
  for (const k of ['contact', 'when', 'note']) if (L[k]) body[k] = L[k];
  return once($('#saveLog'), async () => {
    closeSheet($('#logSheet')); setTab(L.from || 'today');
    toast(`${t('c.saving')}…`);   // on a slow signal the tap is answered at once; the result replaces this line
    try { const res = await api('POST', 'log', body); setTimeout(() => logged(res, body), reduce ? 0 : 260); }
    catch (e) {
      // No answer, a service that is restarting or a session that ended: the log waits on the phone. Only a plain refusal ends it.
      if (verdict(e) === 'keep') { S.queue.push({ rep: S.me.me.id, body }); store.set(KEY.queue, S.queue); renderTop(); toast(t('toast.queued')); shutOut(e); }
      else if (!shutOut(e)) toast(errText(e));
    }
  });
}
function logged(res, body) {
  const before = S.me, hit = res.repeat || !before.today || !res.me.today ? null : landed(before.today, res.me.today, before.rules);
  if (hit != null) { S.hold = hit; S.stop = null; }   // the stop this landed on keeps its picture while the rest repaints
  adopt(res.me); renderAll(true);
  const label = t(`kind.${body.kind}`);
  if (res.repeat) toast(t(res.updated ? 'toast.repeat.updated' : 'toast.repeat'));
  else {
    const follow = res.me.ledger.some((e) => e.logId === res.logId && e.code === 'followup');
    const bits = [label + (follow ? ` · ${t('toast.followup')}` : '')];
    if (res.pending > 0) bits.push(t('toast.pending', { n: res.pending }));
    let text = bits.join(' · ');
    if (res.streakUp) text += `. ${t('toast.streak', { n: res.me.streak.current })}`;
    if (res.gained > 0 || res.pending > 0) toast(text, res.gained > 0 ? t('pts.plus', { n: res.gained }) : ''); else toast(t('toast.zero'));
  }
  // The stop answers first: its frames play with the tracking ring around it. Then the points travel from the stop
  // (or from the button, when no habit moved) to where they are counted, in the top bar.
  const played = hit != null ? answer(hit, before.today, res.me.today).catch(() => {}) : Promise.resolve();
  if (!res.repeat && res.gained > 0) {
    const tag = $('#ptsChip');
    setTimeout(() => flyDot(hit != null ? $('#dio') : $('#logBtn'), tag, () => { ringAt($('#meLens .portrait'), { whole: true }); lock(tag); floatUp(tag, t('pts.plus', { n: res.gained })); }), hit != null && !reduce ? 520 : 0);
  }
  if (res.streakUp) { lock($('#streakChip')); ringAt($('#streakChip .dot')); }
  const facts = { gained: res.gained, streak: res.streakUp ? res.me.streak.current : 0 };
  const list = res.repeat ? [] : moments(before, res.me, { tookLead: !!res.tookLead }).map((m) => ({ ...m, ...facts }));
  const after = () => { if (body.kind === 'meeting' && !res.repeat) askPlay(res.logId); };
  played.then(() => new Promise((r) => { setTimeout(r, reduce ? 0 : list.length ? 420 : 900); })).then(() => playMoments(list)).then(after);
}

// ---- the moments: taking the lead, a full finger or hand, a new step or level, a badge ----
/** What a moment shows: a title in two parts, one line under it, and a large number or a drawing. When there is a photo
 *  of the person the moment shows them instead, with the arc of their lens closing and that drawing pinned to it. */
function describe(m) {
  const me = S.me, T = me.table.week, who = me.me;
  const face = (from, to) => (who.photo ? { person: who, from, to } : null);
  // What the log itself brought: said under a moment whose own line would only repeat its title.
  const earned = m.gained > 0 ? [`${t('pts.plus', { n: m.gained })}.`, m.streak > 0 ? t('toast.streak', { n: m.streak }) : ''].filter(Boolean).join(' ') : '';
  if (m.kind === 'lead') return { n: ord(1), face: face(0, 1), a: t('lockon.title.a'), b: t('lockon.title.b'), sub: T.behind ? t('lockon.s.behind', { name: T.behind.name, gap: pts(T.behind.pts) }) : t('lockon.s') };
  if (m.kind === 'hand') return { glyph: handGlyph(me.week.days, me.week.anyLog), face: face(0, 1), a: t('cel.hand.a'), b: t('cel.hand.b'), sub: t('cel.hand.s') };
  if (m.kind === 'badge') {
    const levels = ONE_LEVEL.has(m.code) ? 1 : 3;
    return { glyph: badgeGlyph(m.code, m.level, levels), face: face(0, 1), a: t('cel.badge.a'), b: `${t(`badge.${m.code}`).toLocaleLowerCase()}.`,
      sub: levels === 1 && earned ? earned : `${t(`badge.info.${m.code}`)}${levels > 1 ? ` ${t('cel.badge.level', { n: m.level })}` : ''}` };
  }
  const steps = me.rules.levels.find((l) => l.name === m.name).steps;
  if (m.kind === 'level') return { glyph: stepsGlyph(1, steps.length), face: face(0, 1 / steps.length), a: t('cel.level.a'), b: `${t(`level.${m.name}`)}.`, sub: t('cel.level.s', { pts: pts(m.xp) }) };
  return { glyph: stepsGlyph(m.step, steps.length), face: face((m.step - 1) / steps.length, m.step / steps.length), a: t('cel.step.a'), b: t('cel.step.b', { a: m.step }), sub: t('cel.step.s', { level: cap(t(`level.${m.name}`)), a: m.step, b: steps.length, pts: pts(m.xp) }) };
}
const waiting = [];
let playing = false;
/** Moments play one after another, and never over an open form or the entrance: they wait until the screen is free. */
async function playMoments(list = []) {
  waiting.push(...list);
  if (playing) return;
  playing = true;
  try {
    while (waiting.length && S.me && !readOnly() && !$('dialog[open]') && !isGreeting()) {
      const m = waiting.shift();
      if (m.kind === 'finger') { await fullFinger(); continue; }
      const d = describe(m);
      await celebrate({ ...d, label: t('cel.aria', { title: `${cap(d.a)} ${d.b}` }) });
    }
  } finally { playing = false; }
}

/** The four habits of today are done: the screen closes in and today's finger comes on, light by light, on the hand.
 *  A tap takes the person to their week. */
async function fullFinger() {
  const { week, today, streak } = S.me, i = week.days.findIndex((d) => d.day === today.day);
  const hand = buildHand(h('span', { class: 'ahand mini big', 'aria-hidden': 'true' }), { mini: true });
  paintHand(hand, week.days.map((d, k) => (k === i ? { ...d, habits: [false, false, false, false] } : d)), { wrist: week.anyLog });
  setTimeout(() => paintHand(hand, week.days, { wrist: week.anyLog, animate: true, step: 230 }), reduce ? 0 : 760);
  const sub = [t('cel.finger.sub'), streak && streak.current > 1 ? t('toast.streak', { n: streak.current }) : ''].filter(Boolean).join(' ');
  const go = await dayDone({ title: t('cel.finger.title'), sub, glyph: hand, from: $('#nextBtn').hidden ? $('#dio') : $('#nextBtn'), label: `${t('cel.finger.title')} ${sub} ${t('cel.finger.go')}.` });
  if (go && S.me && !S.mgr) setTab('week');
}

// ---- logs that wait for signal ----
/** A phone can be shared: each waiting log remembers whose it is, and only its owner sends it. */
function myQueue() { return S.me && S.me.me ? waitingOf(S.queue, S.me.me.id) : []; }
let flushing = false;
async function flush() {
  if (flushing || !S.me || readOnly() || !myQueue().length) return;
  flushing = true;
  let sent = 0;
  try {
    for (const item of myQueue()) {
      try { await api('POST', 'log', item.body); sent += 1; }
      catch (e) {
        if (verdict(e) === 'keep') { shutOut(e); break; }   // it stays in the queue for the next try
        toast(t('toast.dropped', { why: errText(e) }));   // refused for good: it leaves the queue with the reason shown
      }
      S.queue = S.queue.filter((q) => q !== item); store.set(KEY.queue, S.queue);
    }
  } finally { flushing = false; }
  renderTop();
  if (sent) { await refresh(true); toast(t('toast.sent', { n: sent })); }
}

// ---- session ----
/** What a view says, leaving out the clock: two reads that match have nothing new to draw. */
const signature = (me) => JSON.stringify({ ...me, serverTime: null });
// Only a person's own screens are kept on the phone for a start without signal: never a view-as, never the practice rep.
function adopt(me) { S.me = me; S.sig = signature(me); S.lastLoad = Date.now(); if (!S.as && me.me) store.set(KEY.me, me); }
/** A leader has no board of their own: they land on the leadership view, with no tabs, no log and no entrance. */
function enterLeader(me) {
  S.me = me; S.sig = signature(me); S.lastLoad = Date.now(); S.lastPaint = Date.now();
  S.as = null; S.mgr = false; S.lead = true;
  const own = me.viewer.lang;
  if (own && own !== lang()) { setLang(own); store.set(KEY.lang, own); applyStatic(); }
  document.body.classList.remove('bare'); document.body.classList.add('mgr');
  store.del(KEY.me);   // nothing of a leader's is kept on the phone: the view is read fresh each time
  S.arrived = new Set(['lead']);
  renderTop();
  // The page shows once its numbers are in, so it never draws an empty view first.
  loadDocs();
  leader.load().then(() => { renderAll(false); setTab('lead', { instant: true }); arrive('lead'); })
    .catch((e) => { if (!shutOut(e)) showGate('error', errText(e)); });
}
function enter(me) {
  if (me.viewer && me.viewer.role === 'leader') { enterLeader(me); return; }
  S.lead = false;
  S.me = me; S.sig = signature(me); S.lastLoad = Date.now(); S.lastPaint = Date.now();
  if (!S.as || me.viewer.role === 'rep') S.as = me.viewer.as;   // a rep's `as` is ignored by the server
  const own = S.as ? me.viewer.lang : me.me.lang;
  if (own && own !== lang()) { setLang(own); store.set(KEY.lang, own); applyStatic(); }
  S.mgr = !S.as && me.viewer.role !== 'rep';
  document.body.classList.remove('bare'); document.body.classList.toggle('mgr', S.mgr);
  if (!S.as) store.set(KEY.me, me);
  S.seenFeed = null; waiting.length = 0;
  S.stop = null; S.hold = null; S.owed = null;
  const first = S.mgr ? 'team' : 'today';
  const ready = S.mgr ? manager.load().then(() => { renderAll(false); }).catch((e) => toast(errText(e))) : Promise.resolve();
  renderAll(false); setTab(S.tab && $(`#nav [data-tab="${S.tab}"]`) ? S.tab : first, { instant: true });
  // The full entrance plays on the first open of a day and after signing in again (signing out forgets the last one);
  // after that the screen just puts itself together.
  const tab = S.tab, day = me.today ? me.today.day : dayOf(me.serverTime, me.me.tz), seen = store.get(KEY.greet, null) || {};
  const how = S.as ? 'short' : entrance({ lastDay: seen.day, lastId: seen.id, today: day, id: me.me.id });
  const here = inBands(tab) ? BANDS : [tab];
  S.arrived = new Set(here);
  const arriveAll = (opts) => here.forEach((n, i) => setTimeout(() => arrive(n, opts), reduce ? 0 : i * 160));
  if (how === 'full') { store.set(KEY.greet, { id: me.me.id, day }); welcome(day, ready, arriveAll); }
  else ready.then(() => arriveAll({ fast: true }));
  loadDocs();
  flush();
}
/** The documents are read on their own: a slow or failed read never holds up the screens, which draw them when they come. */
function loadDocs() { docs.load().then(() => { if (S.me) renderAll(false); }).catch(() => { /* the list stays as it was; the documents screen asks again when opened */ }); }
/** The entrance: the lens finds the person, says where they stand, and hands them their screen. */
function welcome(day, ready, arriveAll) {
  const me = S.me, who = me.me, st = stake(me), today = me.today;
  const line = st.kind === 'team' ? [t('greet.team.a', { w: st.working, p: st.players }), t('greet.team.b', { c: st.closed })]
    : st.kind === 'lead' ? [t('greet.lead.a'), st.behind ? t('table.sup.behind', { name: st.behind.name, gap: pts(st.behind.pts) }) : t('greet.lead.b', { pts: pts(st.score) })]
    : st.kind === 'place' ? [t('greet.place.a', { ord: ord(st.place), n: st.ranked }), !st.gap ? '' : st.gap.name ? t('table.sup.gap.named', { gap: pts(st.gap.pts), name: st.gap.name }) : t('table.sup.gap.next', { gap: pts(st.gap.pts) })]
    : st.kind === 'new' ? [t('greet.new.a', { d: st.day, n: st.of }), t('greet.new.b')]
    : [t(`greet.${st.kind}.a`), t(`greet.${st.kind}.b`)];
  const streak = me.streak && me.streak.current > 0 ? ` · ${upper(t('top.streak'))} ${num(me.streak.current)}` : '';
  greet({
    person: who, name: `${who.first}.`, line,
    share: today ? (today.isWork ? today.habits.filter(Boolean).length / 4 : 0) : (me.team.working ? me.team.closedToday / me.team.working : 0),
    chip: `${upper(wdShort(day))} ${upper(dayMonth(day))} · ${upper(t('time.week', { n: isoWeek(day) }))}${streak}`,
    lead: `${t(`greet.${dayPart(localMinutes(me.serverTime, who.tz))}`)},`,
    land: () => (BANDS.includes(S.tab) && !$('#meBtn').hidden ? $('#meLens .portrait') : null),   // the lens lands on the person's own face, in the top bar
    onLeave: () => ready.then(() => arriveAll({ landed: true })),
  }).then(() => playMoments());
}
/** The quiet check while the app is open. The screen is redrawn only when something moved, or every five minutes so
 * the times stay true; redrawing for nothing would swap a button out from under a finger. */
async function poll() {
  try {
    const me = await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me');
    S.lastLoad = Date.now();
    const had = JSON.stringify(S.docs);
    await docs.load().catch(() => { /* kept as it was */ });
    if (signature(me) === S.sig && JSON.stringify(S.docs) === had && Date.now() - S.lastPaint < 5 * 60000) return;
    const before = S.me;
    adopt(me);
    if (S.mgr) await manager.load();
    if (S.lead || S.tab === 'lead') await leader.load();
    renderAll(true);
    if (!S.mgr && !S.lead && !readOnly()) playMoments(moments(before, me));   // something confirmed elsewhere can be a moment here
  } catch (e) { if (staleAs(e, S.as)) viewAs(null); else shutOut(e); }
}
async function refresh(animate = false) {
  try {
    const me = await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me');
    adopt(me);
    if (S.mgr) await manager.load();
    if (S.lead || S.tab === 'lead') await leader.load();
    renderAll(animate);
  } catch (e) { shutOut(e); }
}
/** The board has no sign-in of its own: its door is the portal's, at this same address. This is the little it says
 * itself. kind is 'team' (the account is not on the team; detail is the account), 'session' (the session ended and
 * coming back did not help) or 'error' (it did not load; detail is why). */
function showGate(kind, detail = '') {
  S.me = null; S.gate = { kind, detail };
  document.body.classList.add('bare'); document.body.classList.remove('mgr');
  $('#nav').hidden = true; renderTop(); show('gate');
  $('#gateLead').textContent = kind === 'team' && detail ? t('gate.team.lead', { email: detail }) : t('gate.lead');
  giant($('#gateGiant'), t(`gate.${kind}.title`));
  $('#gateSupport').textContent = kind === 'error' ? detail : t(`gate.${kind}.support`);
  const go = $('#gateGo'), alt = $('#gateAlt');
  go.textContent = t(kind === 'session' ? 'gate.enter' : 'gate.retry'); go.href = HOME;
  alt.hidden = kind !== 'team'; alt.textContent = t('gate.switch'); alt.href = LEAVE;
}
const DOOR = 'cancha.door';   // when this tab last loaded the page again to reach the door
/** True when the error means this person cannot go on, and the screen now says so. What to do is decided in door.js:
 * load the page again (it is the door), or say why not. Whatever the phone kept about the person goes. */
function shutOut(e) {
  let last = null;
  try { last = Number(sessionStorage.getItem(DOOR)) || 0; } catch { /* no storage here: door.js then asks for the screen, not a reload */ }
  let move = sessionMove(e, { lastReload: last, now: Date.now() });
  if (!move) return false;
  store.del(KEY.me);
  if (move === 'reload') { try { sessionStorage.setItem(DOOR, String(Date.now())); location.reload(); return true; } catch { move = 'gate:session'; } }
  showGate(move === 'gate:team' ? 'team' : 'session', (e.data && e.data.email) || '');
  return true;
}
/** Signing out ends the portal's session, which is the board's too. The next entrance plays in full. */
function signOut() { store.del(KEY.me); store.del(KEY.greet); location.href = LEAVE; }
/** `as` is whose screens to open as their manager. Left out, the page's own address says it. */
async function start(as = undefined) {
  const url = new URL(location.href);
  // A sheet left open (the log sheet, say) belongs to the screens being left: it closes before the identity changes,
  // so nothing in it can be saved as someone else. Until the new answer arrives the screens read only (actingMode).
  for (const dlg of document.querySelectorAll('dialog[open]')) closeSheet(dlg);
  S.as = as === undefined ? url.searchParams.get('as') : as;
  if (S.me && !S.lead && !S.mgr) renderNav();   // the log button goes at once while the screens read only
  try { S.gate = null; enter(await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me')); }
  catch (e) {
    const cached = store.get(KEY.me, null);
    // The address names a rep who is gone (the practice rep was removed, then Back or a reload): drop it, start as the person.
    if (staleAs(e, S.as)) { url.searchParams.delete('as'); try { history.replaceState(null, '', url); } catch { /* the view changes all the same */ } S.tab = null; await start(null); return; }
    if (e.code === 'offline' && cached && !S.as) { enter(cached); toast(t('err.offline')); }
    else if (!shutOut(e)) showGate('error', errText(e));
  }
}
/** Open a rep's screens as their manager, or come back to the team, without loading the page again. */
async function viewAs(id = null) {
  const url = new URL(location.href);
  if (id) url.searchParams.set('as', id); else url.searchParams.delete('as');
  try { history.pushState(null, '', url); } catch { /* a page shown inside another one may not change its address: the view changes all the same */ }
  S.tab = null; window.scrollTo(0, 0);
  await start(id);
}
/** The Hoy reminder of the daily site report: from 5 pm local time, the first live site with no report today. */
function reportNudge(node) {
  const site = nudgeOf(S.me, readOnly());
  node.hidden = !site;
  node.dataset.site = site ? site.id : '';
  if (!site) return;
  node.setAttribute('aria-label', t('report.nudge.aria', { name: site.name }));
  put(node, h('span', { class: 'sa-dot', 'aria-hidden': 'true' }), h('span', { class: 'rpt-en' }, h('span', { text: t('report.nudge') }), h('small', { text: site.name })));
}
/** The daily report of a site, from a rep's screens: the answer brings the screens up to date. */
const openReport = (id) => report.open(id, { tz: tz(), after: (res) => { if (res.me) adopt(res.me); renderAll(false); } }).catch((e) => toast(errText(e)));
// ---- wiring ----
const report = createReport({ api });
const manager = createManager({ api, S, errText, refresh, renderAll, renderFeed, signOut, viewAs, openInstall: (id) => install.open(id, 'needs'),
  openReport: (id, zone) => report.open(id, { tz: zone, after: () => refresh(false) }).catch((e) => toast(errText(e))) });
const docs = createDocs({ api, S, errText, setTab });
const install = createInstall({ api, S, errText, refresh, setTab, hooks: docs.hooks });
const ladder = createLadder({ api, S, errText, adopt, renderAll, setTab, openLog, hooks: docs.hooks });
const route = createRoute({ api, S, errText, adopt, renderAll, setTab, openLog, openInstall: (id, from) => install.open(id, from), hooks: docs.hooks });
const leader = createLeader({ api, S, errText, setTab });
const sites = createSites({ api, S, errText, adopt, renderAll, setTab, openInstall: (id, from, to) => install.open(id, from, to), openReport });
function wire() {
  initPop(); initSheets(); install.wire(); ladder.wire(); route.wire(); leader.wire(); docs.wire(); sites.wire();
  // the top bar's height, for what sticks under it (the practice bar) and for scrolling a heading into view below it
  const topBar = $('.top');
  if (topBar && 'ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${topBar.offsetHeight}px`)).observe(topBar);
  $('#sitesCard').addEventListener('click', () => sites.open('today'));
  $('#reportCard').addEventListener('click', (e) => { const id = e.currentTarget.dataset.site; if (id) openReport(id); });
  $('#docsCard').addEventListener('click', () => docs.open('today'));
  $('#docsBtn').addEventListener('click', () => docs.open('team'));
  $('#ldDocs').addEventListener('click', () => docs.open('lead'));
  $('#previewBtn').addEventListener('click', () => ladder.open('team'));
  $('#home').addEventListener('click', (e) => { if (!S.me) return; e.preventDefault(); if (S.as) viewAs(null); else setTab(S.lead ? 'lead' : S.mgr ? 'team' : 'today'); });
  $('#asExit').addEventListener('click', (e) => { e.preventDefault(); viewAs(null); });
  // Back and forward move between the team and a rep's screens, as the address says.
  addEventListener('popstate', () => { S.tab = null; start(); });
  $('#langSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-lang]'); if (b) switchLang(b.dataset.lang); });
  src($('#streakChip'), () => t('top.streak'), () => { const st = S.me.streak; return t('src.streak', { spares: st.spares, max: S.me.rules.spares, best: t('u.days', { n: st.best }) }); });
  $('#queueChip').addEventListener('click', flush);
  document.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) openSheet($(`#${o.dataset.open}`)); });
  $('#hand').addEventListener('click', (e) => { const hit = e.target.closest('.ahit'); if (hit) { e.stopPropagation(); if (stopTeach) stopTeach(); fingerDetail(hit); } });
  $('#teachBtn').addEventListener('click', teach);
  $('#meBtn').addEventListener('click', () => setTab('profile'));
  $('#placeChip').addEventListener('click', () => setTab('table'));
  $('#goalBtn').addEventListener('click', openGoal);
  $('#nextBtn').addEventListener('click', () => {
    const step = $('#nextBtn').dataset.step;
    if (step === 'next') { S.stop = null; paintStage(true); } else if (step === 'close') openClose(); else openLog();
  });
  src($('#ptsChip'), () => t('c.source'), () => t('src.points'));
  src($('#weekPts'), () => t('c.source'), () => t('src.points'));
  stage.lean($('#s-today'));
  $('#feedLog').addEventListener('click', openLog);
  $('#ledgerMore').addEventListener('click', () => { S.ledgerAll = true; quiet(renderProfile); });
  // On a wide screen the tabs live in the top bar, which stays in view; on a phone they are the bar at the thumb.
  const wide = matchMedia('(min-width:980px)'), dock = () => { const nav = $('#nav'); if (wide.matches) $('.top').insertBefore(nav, $('.top-r')); else $('#app').append(nav); };
  wide.addEventListener('change', dock); dock();
  // An answer or a moment that had to wait for a form plays once the form is gone: first the stop, then the moment.
  for (const dlg of $$('dialog.sheet')) dlg.addEventListener('close', () => setTimeout(() => {
    const owed = S.owed; S.owed = null;
    (owed && S.me && S.me.today ? answer(owed.hit, owed.before, owed.after).catch(() => {}) : Promise.resolve()).then(() => playMoments());
  }, 260));
  // Crossing between a narrow and a wide screen changes how many zones show at once.
  WIDE.addEventListener('change', () => { if (S.me && S.tab) { show(S.tab); markTab(); } });
  $('#tableSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-period]'); if (!b) return; S.period = b.dataset.period; quiet(renderTable); });
  $('#closeBtn').addEventListener('click', openClose);
  $('#closeSubmit').addEventListener('click', submitClose);
  for (const id of ['#fTomorrow', '#fBlock']) $(id).addEventListener('input', drawReport);
  $('#leadQ').addEventListener('input', onSearch);
  $('#newName').addEventListener('input', paintLogFoot);
  $('#moreOuts').addEventListener('click', () => { L.more = !L.more; keepFields(); renderLog(); });
  $('#saveLog').addEventListener('click', saveLog);
  addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { flush(); if (Date.now() - S.lastLoad > 45000) poll(); } });
  // The table and the feed stay current while the app is open and nobody is in the middle of a form.
  // Waiting logs go out even while a sheet is open; the quiet check for news waits until no form is in the way.
  setInterval(() => { if (!S.me || document.hidden) return; if (myQueue().length) flush(); else if (!$('dialog[open]') && Date.now() - S.lastLoad > 45000) poll(); }, 15000);
}

setLang(store.get(KEY.lang, null) || ((navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es'));
// The illustrations are named once, on the page itself; the stylesheet picks each one by its name.
for (const [k, v] of Object.entries(ART)) document.documentElement.style.setProperty(`--art-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, `url("${v}")`);
applyStatic(); grain(); wire(); renderTop();
start();
