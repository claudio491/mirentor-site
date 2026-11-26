// app.js: the rep's side of the sales team platform, and the shell both sides share.
// The server answers codes and numbers; every sentence comes from i18n.js through t().
import { APP_NAME, LANGS } from './i18n.js';
import { $, $$, h, put, icon, t, setLang, lang, applyStatic, giant, num, ord, wdShort, wdLong, dayMonth, monthName, upper, cap, isoWeek, addDays, clock, hourName, stamp, ago, cityName, joinList,
  lock, buzz, quiet, EASE, countTo, recount, ringAt, flipList, toast, toastErr, dropToast, leaveToast, toasts, showPop, hidePop, initPop, src, openSheet, closeSheet, initSheets, onSheetOpen, enterMoves, once, copyText, grain, reduce, formSheet, setExplain, newId, putFace, face, dayOf, showErr } from './ui.js';
import { buildHand, paintHand, miniHand, rowWrist, levelBone, badgeGlyph, portrait, setPortrait, replayHand, drawIn, handGlyph, stepsGlyph, teachHand, daysBone } from './hand.js';
import { swap, roll, floatUp, flyDot, reveal, stagger, lockIn, greet, isGreeting, celebrate, dayDone, closeDayDone } from './fx.js';
import { entrance, dayPart, localMinutes, nextStep, moments, stake, raceShare, tableNote, firstDays, untouched, anyLog, shortNames, closeCard, crewOf, historyRows, gapLine, behindLine, reportAction, reportOutcome, DONE_HOLD, stopCta, afterClose } from './moments.js';
import { STOPS, stopsOf, standOn, loopOf, rewardOf, landed, stepOf, climbFrames, stageFit } from './stops.js';
import { createStage } from './stage.js';
import { ART, STEPS } from './art.js';
import { createManager } from './manager.js';
import { createInstall } from './install.js';
import { createLadder } from './ladder.js';
import { createLeader } from './leader.js';
import { createDocs } from './docs.js';
import { createRoute } from './route.js';
import { createSites } from './sites.js';
import { createBiz } from './biz.js';
import { createBook } from './book.js';
import { createScorecard } from './scorecard.js';
import { settingsKeys, inWorkOrder } from './craft-steps.js';
import { fitArt, arriveArt } from './art-lead.js';
import { followStop, stopPreset, dueLine } from './biz-steps.js';
import { createReport } from './report.js';
import { nudgeOf } from './report-steps.js';
import { mateLine } from './sites-steps.js';
import { shellFor } from './leader-steps.js';
import { verdict, mine as waitingOf, requestTimeout, langWaiting, langOwner, langDone, madeEarlier, landedNew, sentNotes } from './queue.js';
import { sessionMove, HOME, LEAVE, toDoor, offDoor, tabOf } from './door.js';
import { actingMode, readOnlyIn, repControls, withAs, logLocked, staleAs, practiceBarName, asMove } from './practice-steps.js';
import { shortfall } from './paid.js';
import { askTwice, arrives } from './taps.js';
import { quickDays, checkNext, bizFields, contactAsked, LOG_TAGS, LOST_TAGS, LOST_REASONS, holdsIt, proposeNext, footHint, logBody, otherTagLine } from './next-steps.js';
import { createReads } from './reads.js';
import { backStep, tabMove, momentClose, restartAway, reloadSkip, keepDraft, takeDraft, DRAFT_KEY } from './back-steps.js';
import { QUAL_KINDS, qualRows, qualBody, contractWarn, notFitOffer, notFitArmed, bizSwitch } from './qual-steps.js';
import { similarAsk, zoneOptions, zoneOf, newReady, dupNote, zonePickFor, zonesOnOpen, sureFor, restoredNew } from './newlead-steps.js';

const API = 'api';   // every address is relative to the page, so the app works wherever it is mounted
const KEY = { lang: 'cancha.lang', queue: 'cancha.queue', me: 'cancha.me', greet: 'cancha.greet', langPending: 'cancha.langPending' };
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
/** The order of what the screens show (reads.js): a read that went out before something the screen already adopted (a
 *  log saved meanwhile, a newer read) came back with older news, so it is dropped instead of drawn. */
const reads = createReads();
const S = { me: null, sig: '', tab: null, docs: [], period: 'week', as: null, mgr: false, lead: false, queue: store.get(KEY.queue, []), seenFeed: null, lastLoad: 0, lastPaint: 0, arrived: new Set(), ledgerAll: false,
  stop: null,     // the stop the person tapped on the route; null follows the day
  hold: null,     // the stop a log landed on, kept on the stage until its answer has played
  owed: null,     // an answer that waits for a sheet to close
  taught: false };
const SCREENS = ['boot', 'gate', 'today', 'week', 'table', 'profile', 'team', 'needs', 'score', 'reps', 'install', 'worker', 'iclose', 'ladder', 'zones', 'learn', 'lead', 'docs', 'route', 'ways', 'sites', 'biz', 'book'];
// A rep's three zones. On a wide screen they are one page, a band under the other; anywhere else one shows at a time.
const BANDS = ['today', 'week', 'table'], WIDE = matchMedia('(min-width:1080px)');
const banded = () => WIDE.matches && !S.mgr && !S.lead && !!S.me;
const inBands = (name) => banded() && BANDS.includes(name);
const REST_LOOP = [[0, 1500], [1, 1500], [2, 1900], [3, 1500]];   // a day off: the hammock swings
const FOLLOWS = new Set(['talk', 'absent', 'call', 'reply', 'meeting']);
const CHANNELS = { message: ['whatsapp', 'linkedin', 'email', 'sms'], meeting: ['visit', 'call', 'whatsapp'], reply: ['whatsapp', 'linkedin', 'email', 'sms', 'call'], baddata: ['call', 'email'] };
const TAGGED = new Set(['talk', 'call', 'reply']);
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
/** The practice rep is named by the server in Spanish: the screens show it in the reader's language (and its initials). */
const shown = (p) => (p && p.practice ? { ...p, name: t('reps.practice.name'), first: t('reps.practice.first') } : p);

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
    countTo($('#ptsN'), S.ptsHeld != null ? S.ptsHeld : S.me.week.points);   // while points fly to the chip it keeps its old number
    putFace($('#meLens'), shown(S.me.me), (person) => portrait(person, { share: 0 }));
    setPortrait($('#meLens .portrait'), now.isWork ? now.habits.filter(Boolean).length / 4 : 0);
    if (S.tab === 'profile') meBtn.setAttribute('aria-current', 'page'); else meBtn.removeAttribute('aria-current');
  }
  const waiting = myQueue().length;
  $('#queueChip').hidden = !waiting;
  $('#queueN').textContent = t('top.queue', { n: waiting });
  $('#queueChip').setAttribute('aria-label', t('top.queue.aria', { n: waiting }));
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
  const had = nav.contains(document.activeElement) ? (document.activeElement.dataset.tab || document.activeElement.id) : null;   // redrawn, the bar keeps the focus where it was
  put(nav, h('div', { class: 'tabs' }, tabs.map((id) => h('button', { class: 'tab', type: 'button', 'data-tab': id, 'aria-label': id === 'needs' && count ? `${t('nav.needs')}: ${count}` : t(`nav.${id}`), 'aria-current': S.tab === id ? 'page' : null, onclick: () => setTab(id) },
    icon(id), h('span', { text: t(`nav.${id}`) }), id === 'needs' && count ? h('span', { class: 'count num', text: String(count), 'aria-hidden': 'true' }) : null))),
  canLog ? h('button', { class: 'btn log', type: 'button', id: 'logBtn', onclick: openLog }, icon('plus'), t('nav.log')) : null);
  nav.classList.toggle('three', !canLog);
  $('.tabs', nav).classList.toggle('four', tabs.length === 4);
  markTab();
  // Pendientes' number rolls to its new value when a row leaves or comes (after this quiet repaint, so it can move)
  const countNode = $('.tab[data-tab="needs"] .count', nav), was = renderNav.count;
  renderNav.count = count;
  if (countNode && was && was !== count && !reduce) { countNode.textContent = String(was); countNode.dataset.roll = String(was); setTimeout(() => { if (countNode.isConnected) roll(countNode, String(count)); }, 0); }
  nav.hidden = false;
  if (had) { const again = $$('#nav button').find((b) => (b.dataset.tab || b.id) === had); if (again) again.focus({ preventScroll: true }); }
}
/** The marker over the tabs sits on the open one; a screen that has no tab (the profile) leaves none marked. */
function markTab() {
  const box = $('#nav .tabs');
  if (!box) return;
  const i = [...box.children].findIndex((b) => b.dataset.tab === S.tab);
  box.classList.toggle('none', i < 0);
  if (i >= 0) box.style.setProperty('--i', String(i));
}
// ---- the phone's Back button ----
// A screen inside a zone (the profile, an install, a route, the documents...) leaves one step in the browser's history:
// the phone's Back then comes back inside the app instead of leaving it, one screen at a time. A zone's tab is kept in
// the address instead, so loading the page again lands on it. Nothing here changes what a screen shows.
const DEEP = new Set(['profile', 'install', 'worker', 'iclose', 'ladder', 'zones', 'learn', 'route', 'ways', 'sites', 'docs', 'biz', 'book']);
// asDepth: how many steps this visit put above the team's own in the history for a rep's screens (view-as)
// away: the entry of a tab other than home (leaving home adds it, moving between other tabs replaces it); skip: how
// many traversals the app made itself, whose Back events are only bookkeeping (back-steps.js)
const backNav = { trail: [], from: null, guarded: false, skip: 0, asDepth: 0, away: false, moment: false };
/** Nothing of a zone's trail is carried into other screens: a change of identity starts the history steps again. */
function resetBack() { backNav.trail.length = 0; backNav.from = null; backNav.guarded = false; backNav.asDepth = 0; backNav.away = false; }
/** The sheets open now that own an entry of the history, the top one last: Back closes the top one and stays where the
 *  rep was; a sheet closed by its own controls gives its entry back without moving the screen under it. */
const sheetStack = [];
function sheetOpened(dlg) {
  if (!S.me || sheetStack.includes(dlg)) return;   // opened again while open or leaving: it keeps its entry
  try { history.pushState({ cancha: 'sheet' }, '', location.href); sheetStack.push(dlg); } catch { /* a page shown inside another may not change its history */ }
}
function sheetClosed(dlg) {
  const i = sheetStack.indexOf(dlg);
  if (i < 0) return;   // closed by Back: its entry is already gone
  sheetStack.splice(i, 1);
  backNav.skip += 1; history.back();
}
/** Undo the entries the app holds above where it should be: `n` of them, in one traversal. */
function popEntries(n) { if (n > 0) { backNav.skip += 1; history.go(-n); } }
const homeTab = () => (S.lead ? 'lead' : S.mgr ? 'team' : 'today');
const isDeep = (name) => DEEP.has(name) || (name === 'lead' && !S.lead);   // the leadership view is a step in for a manager
/** The tab in the address (none for the first one), so a reload lands on it. */
function remember(name) {
  if (isDeep(name)) return;
  try { const u = new URL(location.href); u.hash = name === homeTab() ? '' : name; history.replaceState(history.state, '', u); } catch { /* a page shown inside another may not change its address */ }
}
function track(name, from) {
  if (isDeep(name)) {
    const at = backNav.trail.indexOf(name);
    if (at >= 0) backNav.trail.length = at + 1;   // back to an earlier screen by the screen's own button
    else { if (!backNav.trail.length) backNav.from = from; backNav.trail.push(name); }
    if (!backNav.guarded) { try { history.pushState({ cancha: 'step' }, '', location.href); backNav.guarded = true; } catch { /* as above */ } }
    return;
  }
  backNav.trail.length = 0; backNav.from = null;
  // the entries this tab needs (one when it is not home) against the ones held (a deep screen's, a tab's): the step of a
  // screen left by its own button goes, leaving home adds one, moving between other tabs replaces it (back-steps.js)
  const held = (backNav.guarded ? 1 : 0) + (backNav.away ? 1 : 0), move = tabMove({ to: name, home: homeTab(), away: backNav.away });
  const need = move.away ? 1 : 0;
  backNav.guarded = false; backNav.away = move.away;
  if (need < held) { popEntries(held - need); return; }   // the address is set once the step is back (onBack)
  if (need > held) { try { history.pushState({ cancha: 'tab' }, '', location.href); } catch { /* as above */ } }
  remember(name);
}
/** The phone's Back. On a screen inside a zone: one screen back, inside the app. Otherwise the address changed (a rep's
 *  screens through view-as, or back from them), and the screens start again from it. */
function onBack() {
  const step = backStep({ skip: backNav.skip, moment: backNav.moment, sheets: sheetStack.length, deep: backNav.guarded && backNav.trail.length > 0, away: backNav.away });
  if (step === 'skip') { backNav.skip -= 1; if (!backNav.skip && S.tab) remember(S.tab); return; }   // no tab yet: the page is still starting
  if (step === 'moment') { backNav.moment = false; closeDayDone(); return; }   // the day's completion closes; the rep stays on Hoy
  if (step === 'sheet') { closeSheet(sheetStack.pop()); return; }   // the top sheet closes; the screen under it stays
  if (step === 'home') { backNav.away = false; setTab(homeTab(), { replay: true }); remember(homeTab()); return; }
  if (step === 'deep') {
    backNav.guarded = false;
    backNav.trail.pop();
    const to = backNav.trail.length ? backNav.trail[backNav.trail.length - 1] : (backNav.from || homeTab());
    if (backNav.trail.length) { try { history.pushState({ cancha: 'step' }, '', location.href); backNav.guarded = true; } catch { /* as above */ } }
    else backNav.from = null;
    for (const dlg of document.querySelectorAll('dialog[open]')) closeSheet(dlg);
    setTab(to, { replay: true });
    if (!backNav.trail.length) remember(to);
    return;
  }
  resetBack();
  // landed on a tab's entry (view-as started from a tab other than home): the screens start there, away from home, so
  // the next Back comes home instead of starting the same screen again (back-steps.js restartAway)
  backNav.away = restartAway(history.state);
  S.tab = null; start();
}
/** Each call of setTab is numbered: only the last one asked for runs its screen's own arrival. */
let tabAsk = 0;
/** onArrive: the screen's own arrival (a deep screen's headline and rows). It runs inside the change, with the screen
 *  shown, so the screen wipes in already assembling instead of showing whole, going blank and assembling again. */
function setTab(name, { instant = false, replay = false, onArrive = null } = {}) {
  const from = S.tab, changed = from !== name, ask = ++tabAsk;
  if (changed) leaveToast();   // a toast never follows the person to another tab or screen
  if (changed && !replay && S.me) track(name, from);
  // coming back to "Mis sitios activos" from a site's screens: it shows what those screens just changed
  if (name === 'sites' && S.me && !S.mgr && !S.lead) quiet(() => sites.render());
  if (name === 'score' && S.me && S.mgr) scorecard.show({ fromCard: from === 'biz' });   // the week shown is read again each time the tab opens
  else if (changed && name !== 'biz' && S.me && S.mgr) scorecard.leave();   // left another way: the list a card came from is forgotten
  S.tab = name;
  // A screen puts itself together the first time it is opened in a visit; after that it is simply there. It does so
  // inside the change, so the screen that wipes in is already assembling (started after it, the screen showed whole,
  // went blank and assembled again).
  const fresh = (inBands(name) ? BANDS : [name]).filter((n) => !S.arrived.has(n));
  // The screen shown is always the last one asked for: two quick taps may run this twice, in either order.
  const go = (arriving = []) => {
    const open = S.tab;
    show(open); hidePop();
    if (open === 'today') fitStage();   // shown, it can be measured
    else { fitArt($(`#s-${open}`)); if (changed) arriveArt($(`#s-${open}`)); }   // a later screen's picture takes only the room its first action leaves
    for (const n of arriving) if (!S.arrived.has(n)) { S.arrived.add(n); arrive(n); }
    if (onArrive && arrives(ask, tabAsk, open, name)) onArrive();   // only the last change asked for arrives (taps.js)
    for (const b of $$('#nav .tab')) { if (b.dataset.tab === open) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
    markTab();
    if ($('#meBtn')) { if (open === 'profile') $('#meBtn').setAttribute('aria-current', 'page'); else $('#meBtn').removeAttribute('aria-current'); }
    // On a wide screen a zone is already there: the page only moves to it.
    if (inBands(open) && open !== BANDS[0]) $(`#s-${open}`).scrollIntoView({ block: 'start', behavior: reduce || instant ? 'auto' : 'smooth' });
    else scrollTo({ top: 0, behavior: inBands(open) && !reduce && !instant ? 'smooth' : 'auto' });
  };
  const sameSheet = inBands(name) && BANDS.includes(from);
  if (instant || !changed || sameSheet) { go(); return; }
  // Which side the new screen comes from: the tabs' order, or back from a screen that is not a tab.
  const order = $$('#nav .tab').map((b) => b.dataset.tab), a = order.indexOf(from), b = order.indexOf(name);
  document.documentElement.dataset.vt = a >= 0 && b >= 0 ? (b > a ? 'fwd' : 'back') : b >= 0 ? 'back' : 'fwd';
  swap(() => go(fresh));
  const mark = $(`#nav [data-tab="${name}"] svg`);
  if (mark) lock(mark);
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
    // opened many times a day: it settles in without a bounce (the bounce is kept for the reward, .dio.bump)
    if (dio.animate) dio.animate([{ opacity: 0, transform: 'translateY(-12px) scale(.97)' }, { opacity: 1, transform: 'none' }], { duration: 420, delay: 160, easing: EASE.out, fill: 'backwards' });
    stagger(there([$('#hoyLine'), $('#stopChip'), $('#stopCopy'), $('#nextBtn'), ...$$('#route .stop'), $('#closeCard'), $('#bookCard'), $('#installCard'), $('#routeCard'), $('#ladderCard')]), { delay: 380, step: 60 });
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
    // The team climbs to its step, a hop per step (at most 1.2 s): what each meeting does, said by the staircase itself.
    const box = $('#climb'), crew = $('#crew'), at = S.me.team ? stepOf(S.me.team.meetings, S.me.team.target) : 0;
    if (at > 0 && box && !box.hidden && crew && crew.animate) {
      const r = box.getBoundingClientRect(), timing = { duration: Math.min(1200, 150 * at), delay: 280, easing: 'linear', fill: 'backwards' };
      crew.animate(climbFrames(at, STEPS, r.width, r.height), timing);
      const shadow = $('.crewshadow', box);
      if (shadow) shadow.animate(climbFrames(at, STEPS, r.width, r.height, 0), timing);
    }
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
  else if (name === 'score') { reveal($('#scGiant')); stagger($$('#scTable .sc-card, #scTable .sc-wrap'), { delay: 140, step: 40 }); }
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
    if (S.tab === 'biz') biz.render();
    if (S.tab === 'book') book.render();
    if (S.mgr && S.tab === 'score') scorecard.render();
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
  if (S.me) {
    renderAll(false);
    // kept on this phone, with whose it is, and sent at that person's next start
    const who = langOwner(S.me);   // the viewer's: the server changes the viewer's own language (queue.js)
    if (!readOnly()) api('POST', 'lang', { lang: next }).then(() => { if (langDone(store.get(KEY.langPending, null), who)) store.del(KEY.langPending); }).catch(() => { if (who) store.set(KEY.langPending, { rep: who, lang: next }); });
  }
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
    $('#todayLead').textContent = t('today.lead.rest', { name: shown(me).first });
    giant(head, t('today.rest.giant'));
    sup.textContent = t('today.rest.support');
  } else if (untouched(today)) {
    // A working day with nothing logged leads with the start, not with a zero.
    $('#todayLead').textContent = t('today.lead.zero', { name: shown(me).first });
    giant(head, t('today.zero.giant'));
  } else {
    $('#todayLead').textContent = t('today.lead', { name: shown(me).first });
    // The count keeps its own node, so only the number that changed moves.
    const first = !$('.gl', head);
    if (first) head.replaceChildren(h('span', { class: 'gl' }), h('em', { text: '.' }));
    roll($('.gl', head), t('today.of', { a: done, b: 4 }));
    if (first && animate) reveal(head);   // the count takes the headline over from the invitation
  }
  book.line($('#hoyLine'));         // Para hoy in one line, above the stage, when something is due
  paintStage(animate);
  renderCloseCard();
  book.card($('#bookCard'));         // Para hoy: who to see today, oldest first
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
  const follow = sel === 2 ? followStop(S.me.agenda) : null;   // the follow-up stop names the oldest business due
  $('#stopSub').textContent = sel === 3 ? t('habit.3.s', { time: hourName(rules.closeBy) }) : follow ? t('bk.stop.follow', follow) : t(`habit.${sel}.s`);
  if (animate && copy.dataset.sel != null && copy.dataset.sel !== String(sel)) stagger([$('#stopTitle'), $('#stopSub'), $('#nextBtn')].filter((n) => !n.hidden), { step: 60, y: 8 });   // the button's label moves with its stop
  copy.dataset.sel = String(sel);
  // One button: log this stop, or go on to the next one when this one is done. A closed day has none, and neither
  // does a manager who is only looking.
  const step = readOnly() ? null : nextStep(today, rules, localMinutes(nowIso(), tz()));
  const button = stopCta({ today, step, sel, done: stop.done });   // a closed day has none (moments.js)
  cta.hidden = !button;
  cta.dataset.sel = String(sel);
  if (!cta.hidden) {
    const onward = button.step === 'next';
    cta.classList.toggle('onward', onward);
    if (onward) { $('#nextText').textContent = t('stop.next'); $('#nextPts').textContent = ''; cta.dataset.step = 'next'; cta.removeAttribute('aria-label'); }
    else {
      const P = rules.points, [hh, mm] = String(rules.closeBy).split(':').map(Number), left = hh * 60 + mm - localMinutes(nowIso(), tz()), onTime = left > 0;
      // The points for closing on time go at the hour: the button is painted again then, not up to five minutes later.
      clearTimeout(paintStage.tick);
      if (onTime && left < 24 * 60) paintStage.tick = setTimeout(() => { if (S.me && S.me.today && !S.me.today.closed && S.hold == null) paintStage(false); }, left * 60000 + 1000);
      const worth = [P.visit, P.conversation, P.followup, onTime ? P.dayClosedOnTime : 0][sel], pays = worth > 0 ? t('pts.plus', { n: worth }) : '';
      $('#nextText').textContent = t(`stop.cta.${sel}`); $('#nextPts').textContent = pays;
      cta.dataset.step = sel === 3 ? 'close' : 'log';
      cta.removeAttribute('aria-label');   // its name is what it shows, words and points: a voice command for the words finds it
    }
    $('#nextPts').hidden = !$('#nextPts').textContent;
  }
  stage.paintRoute(stops, { sel, at: today.closed ? null : at });
  fitStage();
}
/** Hoy on a phone: the stage gives up height until the four stops (their names and counts) clear the tab bar with 6 px
 *  of air, never under 112 px (stops.js stageFit; the page scrolls by what is still missing). The illustration scales with the stage,
 *  square, so it is never cropped. A wide screen lays Hoy out in two columns and keeps the stylesheet's size. */
const STAGE_GAP = 6;   // px of air between the lowest thing of the four stops and the tab bar
function fitStage() {
  const box = $('#stopStage'), route = $('#route');
  if (!box) return;
  box.style.removeProperty('--stage-h');
  // the place in the table takes its short words when the long ones would start a line of their own beside the date;
  // the short words leave first, so a wide screen, a hidden Hoy or a rest day gets the full words back
  const hud = $('.hoy-head .hud-row'), place = $('#placeChip'), date = $('#dateChip').closest('.chip');
  if (hud) hud.classList.remove('tight');
  if (WIDE.matches || $('#s-today').hidden || route.hidden || !route.childElementCount) return;
  if (!place.hidden && place.offsetTop > date.offsetTop) hud.classList.add('tight');
  const nav = $('#nav'), bar = !nav.hidden && getComputedStyle(nav).position === 'fixed' ? nav.offsetHeight : 0;
  // where the stops end (their names and counts), in the page, from the layout (an arrival's transforms do not count)
  let low = 0;
  for (const stop of $$('.stop', route)) low = Math.max(low, stop.offsetTop + stop.offsetHeight);
  const natural = box.getBoundingClientRect().height;
  const over = route.getBoundingClientRect().top + scrollY + low + STAGE_GAP - (innerHeight - bar);
  const fit = stageFit({ natural, over });
  if (fit.height < natural) box.style.setProperty('--stage-h', `${fit.height}px`);
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
  const day = S.me.today ? S.me.today.day : dayOf(S.me.serverTime, (S.me.me && S.me.me.tz) || 'America/Panama'), ws = S.me.week ? S.me.week.start : addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
  $('#weekChip').textContent = `${upper(t('time.week', { n: isoWeek(day) }))} · ${upper(t('time.range', { a: dayMonth(ws), b: dayMonth(addDays(ws, 6)) }))}`;
  $('#tableLead').textContent = period === 'day' ? t('table.lead.day', { date: dayMonth(day) }) : period === 'month' ? t('table.lead.month', { month: cap(monthName(day)) }) : t('table.lead.week', { date: dayMonth(ws) });
  for (const b of $$('#tableSeg button')) b.setAttribute('aria-pressed', String(b.dataset.period === period));
  const head = $('#tableGiant'), sup = $('#tableSupport');
  if (mine && mine.place != null) {
    withEm(head, 'table.giant', { ord: ord(mine.place) }, 'ord');
    const gapText = (n) => (period === 'month' ? '' : pts(n)), parts = [];
    if (period === 'month') parts.push(t('table.sup.month'));
    else if (mine.place === 1) parts.push(h('b', { text: t('table.sup.lead') }));
    // a gap of nothing is a tie, and says so
    else if (T.gap) { const g = gapLine({ pts: T.gap.pts, name: T.gap.aheadOnPodium ? T.gap.aheadName : null }); parts.push(h('b', { text: t(g.key, { ...g, gap: g.pts ? gapText(g.pts) : '' }) })); }
    const b = period === 'month' ? null : behindLine(T.behind);   // a tie for first says so
    if (b) parts.push(` ${t(b.key, { ...b, gap: b.pts ? gapText(b.pts) : '' })}`);
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
  if (S.stale) { toastErr(t('err.offline.stale', { date: dayMonth(S.stale) })); return; }   // a day kept from before cannot be closed from here
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
    if (S.me.today.closed) { const text = $('#slackText').textContent.trim(); toast(t(text && (await copyText(text)) ? 'close.copied' : 'close.copy.fail')); return; }
    // A closed day refuses new logs, so the ones still waiting on this phone go out first.
    if (myQueue().length) await flush();
    if (myQueue().length) { showErr(err, t('close.waiting', { n: myQueue().length })); return; }
    try {
      const res = await api('POST', 'close', { tomorrow: $('#fTomorrow').value.trim(), blocker: $('#fBlock').value.trim() });
      const was = S.me.today.points, before = S.me;
      const earned = Math.max(0, res.me.today.points - was);
      const due = moments(before, res.me).map((m) => ({ ...m, gained: earned, streak: 0 }));
      // closing can fill the finger (moments.js afterClose): then the day's moment is the stop's answer, so the stop
      // owes none and Hoy under the moment already reads closed; any other close answers on the stop first, as before
      const next = afterClose(due);
      if (before.today && !before.today.closed && res.me.today && res.me.today.closed) {
        S.stop = null;
        if (next.owed) { S.hold = 3; S.owed = { hit: 3, before: before.today, after: res.me.today }; } else { answers += 1; S.hold = null; S.owed = null; }
      }
      baseReport = res.report; adopt(res.me); paintCloseSheet();
      playMoments(due);   // it plays once this sheet is gone
      // the day's completion comes before its paperwork: the sheet closes itself and the moment plays as it goes; the
      // report is in the moment, and stays reachable from Hoy (the close card's "Ver y copiar el reporte")
      // as soon as the sheet's entry is given back (its own Back event), not after the wait an owed answer needs: the
      // moment's entry is pushed only once that traversal is done
      if (next.now) {
        $('#closeSheet').addEventListener('close', () => addEventListener('popstate', () => playMoments(), { once: true }), { once: true });
        closeSheet($('#closeSheet'));
      }
      if (!reduce) { const line = $('#slackPrev .scan'), height = $('#slackPrev').offsetHeight; line.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${height}px)`, opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
      renderAll(true);
      const gained = res.me.today.points - was;
      toast(t('close.toast'), gained > 0 ? t('pts.plus', { n: gained }) : '');
      $('#fTomorrow').value = ''; $('#fBlock').value = '';
    } catch (e) {
      if (e.code !== 'day_closed') { showErr(err, errText(e)); return; }
      // The first try reached the server and the answer was lost: the day is closed. Show it closed, with its report.
      await refresh(false); paintCloseSheet();
      try { const r = await api('POST', 'close', { preview: true, tomorrow: '', blocker: '' }); baseReport = r.report; drawReport(); } catch { /* the report shows when the sheet opens again */ }
      toast(t('close.toast'));
    }
  });
}

// ---- the feed and the plays ----
function kudosButton(f) {
  const btn = h('button', { class: 'kudos', type: 'button', 'data-kid': f.id, 'aria-pressed': String(!!f.clapped), 'aria-label': t('kudos.aria.n', { name: f.name, n: f.kudos }), disabled: f.mine || !may().kudos }, icon('clap'), h('span', { class: 'num', text: String(f.kudos), hidden: !f.kudos, 'aria-hidden': 'true' }));
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
  const on = btn.getAttribute('aria-pressed') !== 'true', all = $$('.kudos').filter((b) => b.dataset.kid === f.id);
  const count = (by) => { for (const b of all) { const n = $('.num', b), v = Math.max(0, Number(n.textContent) + by); n.textContent = String(v); n.hidden = v === 0; b.setAttribute('aria-label', t('kudos.aria.n', { name: f.name, n: v })); } };
  const press = (v) => { for (const b of all) b.setAttribute('aria-pressed', String(v)); };
  press(on); count(on ? 1 : -1);
  if (on) { buzz(8); lock($('svg', btn)); ringAt($('svg', btn)); }
  try { const res = await api('POST', 'kudos', { target: f.id, on }); adopt(res.me); }
  catch (e) { press(!on); count(on ? -1 : 1); toastErr(errText(e)); }
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
      catch (err) { toastErr(errText(err)); }
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
  putFace($('#portrait'), shown(me), (person) => portrait(person, { share: 0 }));
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
        try { const res = await api('POST', 'held', { logId: e.logId }); adopt(res.me); renderAll(false); toast(t('profile.held.toast')); } catch (err) { toastErr(errText(err)); }
      }) });
    }
    // a row about a business on its way to a site opens that business's route
    if (!act && e.lead && ROUTE_CODES.has(e.code)) act = h('button', { class: 'mini-btn', type: 'button', text: t('route.row'), 'aria-label': t('route.row.aria', { lead: e.lead.name }), onclick: () => route.open(e.lead.id, 'profile') });
    return h('li', { class: waiting ? 'pend' : gone ? 'gone' : null }, h('span', { class: 'p', text: `+${num(e.pts)}` }), row, act);
  }));
  $('#ledgerEmpty').hidden = ledger.length > 0;

  // the rep's work first (craft-steps.js WORK_ORDER); "ajustes" keeps the account, how points are earned and the way out
  const docsBtn = h('button', { class: 'btn', type: 'button', text: t('docs.chip'), onclick: () => docs.open('profile') });
  const [ladderBtn, learnBtn] = ladder.profileButtons();
  put($('#work'), ...inWorkOrder({ book: book.profileButtons(), ladder: ladderBtn ? [ladderBtn] : [], learn: learnBtn ? [learnBtn] : [], ways: route.profileButtons(), sites: sites.profileButtons(), docs: [docsBtn] }));
  const practice = mode() === 'practice', manage = !practice && may().manage, closed = !!(S.me.today && S.me.today.closed);
  // The account is the Google one the person came in with. A copy with no session (the demonstration) has none to show.
  const setting = {
    account: () => h('div', { class: 'line' }, h('span', { text: t('profile.account', { email: S.me.viewer.email }) })),
    rules: () => h('button', { class: 'btn', type: 'button', text: t('profile.rules'), 'data-open': 'rulesSheet' }),
    signout: () => h('button', { class: 'btn signout', type: 'button', text: t('profile.signout'), onclick: (ev) => signOutAsked(ev.currentTarget, ev) }),
    badge: () => h('button', { class: 'btn', type: 'button', text: t('reps.badge'), onclick: () => manager.giveBadge(me) }),
    reopen: () => h('button', { class: 'btn', type: 'button', text: t('reps.reopen'), onclick: (ev) => manager.reopenDay(ev.currentTarget, me.id, S.me.today.day) }),
  };
  put($('#settings'), ...settingsKeys({ practice, manage, email: S.me.viewer.email, closed }).map((k) => setting[k]()));
}
function renderRules() {
  const r = S.me.rules, by = hourName(r.closeBy);
  $('#rules').replaceChildren(...Object.entries(LEDGER_RULE).map(([code, key]) => h('li', {}, h('b', { class: 'num', text: t('pts.plus', { n: r.points[key] }).slice(1) }),
    h('span', {}, t(`led.${code}`), h('small', { text: t(`rules.note.${code}`, { cap: r.caps.messagesPerDay, time: by }) })))));
  $('#rulesStreak').textContent = t('rules.streak', { n: r.spares });
}

// ---- logging a contact ----
// next: the next step the log sends (undefined: nothing, null: none, or { day, step }), proposed by the result until the
// rep changes it (nextTouched); reason: why a business is Lost; biz: its card once read (null with no signal).
const L = { lead: null, kind: null, channel: null, voicemail: false, tag: null, contact: '', phone: '', when: '', time: '', note: '', more: false, q: '', found: null, searching: 0, from: null,
  next: undefined, nextTouched: false, nextOpen: false, reason: null, biz: null, bizFor: null, bizOff: false, bizTicket: 0,
  qual: {}, qOpen: new Set(), armed: false, demo: false,   // qual: the qualification rows tapped in this sheet (q is the search's text)
  // a business typed as new: its near twins (null: none asked), "Es nuevo" tapped, no signal to ask, an answer awaited;
  // zones: the city's, read once (null: not yet)
  similar: null, sure: false, dupOff: false, dupWait: false, dupTicket: 0, zones: null, zonesFailed: false };
/** The log sheet. From a business's route it opens with that business and the result already picked, and goes back to
 *  the route once saved; from anywhere else (a click event is passed then) it opens empty. */
function openLog(preset = null) {
  if (readOnly()) return;   // screens that are not the person's own (view-as, or leaving practice mode) log nothing
  if (!S.stale && logLocked(S.me.today, mode())) { toast(t('log.closed')); return; }   // the practice rep logs on after closing, for the demonstration
  const given = preset && preset.lead ? preset : null, plain = !preset || (typeof Event === 'function' && preset instanceof Event);
  Object.assign(L, { lead: null, kind: null, channel: null, voicemail: false, tag: null, contact: '', phone: '', when: '', time: '', note: '', more: false, q: '', found: null, from: null,
    next: undefined, nextTouched: false, nextOpen: false, reason: null, biz: null, bizFor: null, bizOff: false, first: null, qual: {}, qOpen: new Set(), armed: false, demo: false,
    similar: null, sure: false, dupOff: false, dupWait: false });
  L.dupTicket += 1; clearTimeout(similarTimer);
  L.zones = zonesOnOpen({ zones: L.zones, failed: L.zonesFailed }); L.zonesFailed = false;   // a failed read of the zones is tried again
  logInert(false);
  if (preset && Array.isArray(preset.first)) L.first = preset.first;   // a stop's button: its results first, marked
  // a preset kind of null picks only the business (the card's "Hecho" and "Registrar")
  if (given) Object.assign(L, { lead: { id: given.lead.id, name: given.lead.name, zone: given.lead.zone || '', known: true }, kind: given.kind || null, channel: given.kind && CHANNELS[given.kind] ? CHANNELS[given.kind][0] : null, from: given.from || null });
  $('#leadQ').value = ''; $('#newName').value = ''; $('#newZone').value = ''; $('#newZonePick').value = '';
  // a log left half done comes back: on "+ Registrar", or for that same business (back-steps.js takeDraft); a stop's
  // button for no business in particular starts clean
  L.resumed = false; L.saved = false;
  const draft = plain || given ? takeDraft(readDraft(), { rep: S.me.me.id, day: logToday(), now: Date.now(), lead: given ? given.lead.id : null }) : null;
  if (draft) {
    const kind = given && given.kind ? given.kind : draft.kind;
    // where a save lands is this sheet's: a plain "+ Registrar" lands where a plain one does (takeDraft keeps no `from`)
    Object.assign(L, draftOut(draft), given && given.kind ? { kind, channel: CHANNELS[kind] ? CHANNELS[kind][0] : null } : {}, { from: given ? given.from || null : null });
    $('#newName').value = draft.newName || ''; $('#newZone').value = draft.newZone || ''; $('#newZonePick').value = draft.newZonePick || '';
    L.resumed = true;
  }
  if (!draft || !L.nextTouched) propose();
  renderLog(); openSheet($('#logSheet'));
  if (L.lead && !L.lead.isNew && L.lead.id) readBiz(L.lead.id);
  // a new business back from a draft asks about its near twins again, as when its name is typed, and Guardar waits for
  // the answer; "Es nuevo" stands only for the name it was said for (newlead-steps restoredNew)
  if (draft && L.lead && L.lead.isNew) {
    const back = restoredNew({ isNew: true, name: $('#newName').value, sureFor: draft.sureFor });
    if (back.wait) { onSimilar(); L.sure = back.sure; paintNewLead(); paintLogFoot(); }
  }
}
// ---- a log left half done (back-steps.js) ----
// Kept when the sheet closes without saving: in memory and in the tab's session storage, for the same rep, the same day,
// 30 minutes. A save clears it; view-as and a leader keep none.
let draftMem = null;
function readDraft() {
  if (draftMem) return draftMem;
  try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}
function storeDraft(d) {
  draftMem = d;
  try { if (d) sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d)); else sessionStorage.removeItem(DRAFT_KEY); } catch { /* the memory copy is enough for this visit */ }
}
const DRAFT_FIELDS = ['lead', 'kind', 'channel', 'voicemail', 'tag', 'reason', 'next', 'nextTouched', 'nextOpen', 'note', 'contact', 'phone', 'when', 'time', 'qual', 'armed', 'more', 'demo', 'from'];
/** What the sheet holds, as the draft keeps it (the rows opened as a list, the new business's name and zone typed). */
function draftIn() {
  const f = Object.fromEntries(DRAFT_FIELDS.filter((k) => L[k] !== undefined).map((k) => [k, L[k]]));
  f.qOpen = [...L.qOpen];
  f.newName = $('#newName').value; f.newZone = $('#newZone').value; f.newZonePick = $('#newZonePick').value;
  f.sureFor = L.lead && L.lead.isNew ? sureFor({ sure: L.sure, name: f.newName }) : null;   // "Es nuevo", for that name only
  return f;
}
/** The draft back into the sheet. A next step never proposed stays unproposed (undefined). */
function draftOut(f) {
  const out = Object.fromEntries(DRAFT_FIELDS.filter((k) => k in f).map((k) => [k, f[k]]));
  if (!('next' in f)) out.next = undefined;
  out.qual = f.qual && typeof f.qual === 'object' ? { ...f.qual } : {};
  out.qOpen = new Set(Array.isArray(f.qOpen) ? f.qOpen : []);
  return out;
}
/** The sheet closed: unless it was saved, what it holds is kept; a sheet with nothing in it forgets the old draft. */
function keepLogDraft() {
  const saved = L.saved; L.saved = false;
  if (!S.me || !S.me.me) return;
  if (!saved) keepFields();
  storeDraft(keepDraft({ rep: S.me.me.id, day: logToday(), now: Date.now(), own: !readOnly() && !S.lead, saved, fields: draftIn() }));   // a save keeps none
}
/** "Guion" in the log sheet's head: only when "Para vender" has a document. The script opens over the sheet, which
 *  keeps all it holds. */
function paintGuion() { $('#logGuion').hidden = !docs.hasGuion(); }
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
  // The business's name gets the whole width: when it was last logged goes on the small line, under it, after its zone.
  const zone = l.zone || t('log.nozone');   // never the business's id
  return h('button', { class: 'leadopt', type: 'button', 'aria-pressed': String(!!pressed), onclick: () => { keepFields(); L.lead = pressed ? null : l; L.biz = null; L.bizOff = false; L.nextTouched = false; Object.assign(L, bizSwitch(L)); propose(); renderLog(); if (!pressed) readBiz(l.id); } },
    h('span', {}, h('b', { text: l.name }), h('small', { text: pressed ? zone : `${zone} · ${mine}` })), pressed ? h('span', { class: 'k', text: t('log.pick.change') }) : null);
}
function renderLog() {
  paintGuion();
  $('#logDraft').hidden = !L.resumed;
  const picked = $('#leadPicked'), pick = $('#leadPick'), isNew = L.lead && L.lead.isNew;
  // 1. the business
  picked.hidden = !L.lead || isNew; pick.hidden = !!L.lead && !isNew;
  if (L.lead && !isNew) picked.replaceChildren(h('div', { class: 'leads' }, leadOption(L.lead, true)));
  // whose it is, who to ask for and the phone, under the picked line
  biz.strip($('#bizStrip'), L.lead && !isNew ? (L.biz || L.lead) : null, { offline: L.bizOff, card: !!L.biz, from: L.from || 'today', kind: L.kind });
  const recents = S.me.recentLeads.slice(0, 4).map((l) => ({ ...l, known: true }));
  const list = L.q.length >= 2 ? (L.found || []) : recents;
  const newOpt = h('button', { class: 'leadopt dashed', type: 'button', 'aria-pressed': String(!!isNew), onclick: () => {
    keepFields(); L.lead = isNew ? null : { isNew: true }; if (!isNew && L.q.length >= 2 && !$('#newName').value) $('#newName').value = L.q; renderLog();
    if (!isNew) { $('#newName').focus(); readZones(); onSimilar(); }
  } }, h('span', {}, h('b', { text: t('log.new') }), h('small', { text: t('log.new.s') })), h('span', { class: 'k', text: isNew ? t('log.pick.change') : '' }));
  $('#leadOpts').replaceChildren(...(isNew ? [] : list.map((l) => leadOption(l, false))), newOpt);
  $('.field.search', pick).hidden = !!isNew;
  $('#newLead').hidden = !isNew;
  if (isNew) paintNewLead();
  const note = $('#leadNote');
  note.hidden = isNew || !(L.q.length >= 2 && L.found && !L.found.length);
  if (!note.hidden) note.textContent = t(L.offline ? 'log.search.offline' : 'log.none');

  // 2. the result
  const base = L.more ? [...MAIN_KINDS, ...MORE_KINDS] : MAIN_KINDS, P = S.me.rules.points;
  const kinds = L.first ? [...L.first, ...base.filter((x) => !L.first.includes(x))] : base;
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
  // The result buttons are built once for a set of kinds and a language, then only their state changes: a tap answers
  // with a transition on the same button instead of a new one, and the picked one's picture locks on.
  const outs = $('#outOpts'), outKey = `${lang()}|${kinds.join(',')}`;
  if (outs.dataset.key !== outKey) {
    outs.dataset.key = outKey;
    outs.replaceChildren(...kinds.map((k) => h('button', { class: 'out', type: 'button', 'data-k': k, onclick: () => {
      keepFields(); L.kind = L.kind === k ? null : k; L.channel = L.kind && CHANNELS[L.kind] ? CHANNELS[L.kind][0] : null; L.voicemail = false; L.tag = null; L.reason = null; L.armed = false; propose(); renderLog();
    } }, outArt(k), h('b', { text: t(`kind.${k}`) }), h('span', { class: 'pp' }))));
  }
  for (const b of outs.children) { b.setAttribute('aria-pressed', String(L.kind === b.dataset.k)); b.classList.toggle('bz-first', !!L.first && L.first.includes(b.dataset.k)); $('.pp', b).textContent = hint(b.dataset.k); }
  const more = $('#moreOuts'); more.textContent = t(L.more ? 'log.less' : 'log.more'); more.setAttribute('aria-expanded', String(L.more));

  // 3. the details this result asks for
  const extra = $('#logExtra'), fields = $('#logFields'), k = L.kind;
  extra.hidden = !k;
  if (k) {
    const nodes = [];
    if (CHANNELS[k]) nodes.push(h('p', { class: 'label', text: t('log.channel') }), h('div', { class: 'chipset', role: 'group', 'aria-label': t('log.channel') },
      CHANNELS[k].map((c) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(L.channel === c), text: t(`ch.${c}`), onclick: () => { L.channel = c; keepFields(); renderLog(); } }))));
    if (k === 'noanswer') { const box = h('input', { type: 'checkbox', checked: L.voicemail, onchange: (e) => { L.voicemail = e.target.checked; } }); nodes.push(h('label', { class: 'switch' }, box, t('log.voicemail'))); }
    if (QUAL_KINDS.includes(k)) nodes.push(...qualNodes(k));
    if (k === 'meeting') { const box = h('input', { id: 'lDemo', type: 'checkbox', checked: L.demo, onchange: (e) => { L.demo = e.target.checked; } }); nodes.push(h('label', { class: 'switch' }, box, t('log.demo'))); }
    if (k === 'meeting' || k === 'contract') {
      const when = h('input', { id: 'lWhen', type: 'date', onchange: () => { keepFields(); if (k === 'meeting' && !L.nextTouched) { propose(); renderLog(); } } }); when.value = L.when;
      const whenField = h('label', { class: 'field' }, h('span', { class: 'label', text: t(`log.when.${k}`) }), when);
      if (k === 'meeting') {   // a meeting has a time, beside its date
        const time = h('input', { id: 'lTime', type: 'time' }); time.value = L.time;
        nodes.push(h('div', { class: 'bz-time' }, whenField, h('label', { class: 'field' }, h('span', { class: 'label', text: t('log.time') }), time)));
      } else nodes.push(whenField);
    }
    if (contactAsked(k, L.biz)) {
      const who = h('input', { id: 'lContact', type: 'text', maxlength: 120, autocomplete: 'off', placeholder: t('log.contact.ph') }); who.value = L.contact;
      const phone = h('input', { id: 'lPhone', type: 'tel', maxlength: 40, autocomplete: 'off', inputmode: 'tel' }); phone.value = L.phone;
      nodes.push(h('label', { class: 'field' }, h('span', { class: 'label', text: t('log.contact') }), who), h('label', { class: 'field' }, h('span', { class: 'label', text: t('biz.f.phone') }), phone));
    }
    if (TAGGED.has(k)) nodes.push(h('p', { class: 'label', text: t('log.tag') }), h('div', { class: 'chipset', role: 'group', 'aria-label': t('log.tag') },
      LOG_TAGS.map((g) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(L.tag === g), text: t(`tag.${g}`), onclick: () => { keepFields(); L.tag = L.tag === g ? null : g; L.reason = null; L.armed = false; propose(); renderLog(); } }))));
    nodes.push(...nextNodes(k));
    if (k === 'contract') { const box = h('div', { class: 'doc-hooks' }); docs.hooks(box, 'contract'); nodes.push(box); }   // what to send or sign, at hand
    const noteIn = h('input', { id: 'lNote', type: 'text', maxlength: 500, autocomplete: 'off', placeholder: t('log.note.ph') }); noteIn.value = L.note;
    nodes.push(h('label', { class: 'field' }, h('span', { class: 'label', text: t('log.note') }), noteIn));
    fields.replaceChildren(...nodes);
    enterMoves([$('#lContact'), $('#lPhone'), $('#nxStep'), $('#lNote')]);
  }
  paintLogFoot();
}
/** The three qualification rows on a conversation: how many work with their hands, Wi-Fi, who coordinates. A row the
 *  card already knows is folded (its answer and "Cambiar"); nothing is preselected and saving never waits for them.
 *  On a contract a line says what is still unconfirmed; a "No" on Wi-Fi or who coordinates offers to close it as not a fit. */
function qualNodes(k) {
  const known = L.biz ? L.biz.q : null;
  const word = (row, v) => t(row === 'workers' ? `qf.workers.${v}` : `qf.${v}`);
  const nodes = qualRows(known, L.qual, L.qOpen).map((r) => {
    if (r.folded) return h('div', { class: 'qf-row' }, h('div', { class: 'qf-folded' }, h('span', {}, h('span', { class: 'label', text: t(`qf.${r.key}`) }), ' ', h('b', { text: word(r.key, r.value) })),
      h('button', { class: 'mini-btn', type: 'button', text: t('qf.change'), 'aria-label': `${t('qf.change')}: ${t(`qf.${r.key}`)}`, onclick: () => { keepFields(); L.qOpen.add(r.key); renderLog(); } })));
    return h('div', { class: 'qf-row', role: 'group', 'aria-labelledby': `qf-${r.key}` }, h('p', { class: 'label', id: `qf-${r.key}`, text: t(`qf.${r.key}`) }),
      h('div', { class: r.options.length > 3 ? 'chipset qf-span' : 'chipset' }, r.options.map((o) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(r.value === o), text: word(r.key, o),
        onclick: () => { keepFields(); L.qual = { ...L.qual, [r.key]: L.qual[r.key] === o ? undefined : o }; renderLog(); } }))));
  });
  if (contractWarn(k, known, L.qual)) nodes.push(h('p', { class: 'qf-warn', text: t('qf.contract') }));
  const fit = notFitOffer(L.qual);
  if ((fit || L.tag === 'not_fit') && logHolds()) {
    const on = L.tag === 'not_fit';
    nodes.push(h('div', { class: 'bz-acts' }, h('button', { class: on ? 'mini-btn armed' : 'mini-btn', type: 'button', 'aria-pressed': String(on), text: t('qf.notfit'), onclick: () => {
      keepFields(); L.tag = on ? null : fit.tag; L.reason = on ? null : fit.lost; L.armed = !on; propose(); renderLog();
    } })));
  }
  return nodes;
}
/** What was typed in the detail fields survives a redraw. */
function keepFields() {
  for (const [id, key] of [['#lContact', 'contact'], ['#lPhone', 'phone'], ['#lWhen', 'when'], ['#lTime', 'time'], ['#lNote', 'note']]) { const n = $(id); if (n) L[key] = n.value; }
}
/** The day the log is made on, where the rep is. */
const logToday = () => (S.me.today ? S.me.today.day : dayOf(nowIso(), tz()));
/** Whether this log moves the business: it is the rep's, or free. */
const logHolds = () => !L.lead || L.lead.isNew || holdsIt(L.biz || L.lead);
/** The result proposes the next step, until the rep changes it. */
function propose() {
  if (L.nextTouched) return;
  L.next = L.kind ? proposeNext(L.kind, L.tag, { today: logToday(), workdays: S.me.me.workdays, when: L.when }, (key) => t(key)) : undefined;
}
/** What the log sends about the business, or why it cannot be saved yet. */
function logBiz() {
  const f = bizFields({ kind: L.kind, tag: L.tag, next: L.next, reason: L.reason, holds: logHolds() });
  if (f.error) return f;
  if (f.next) { const c = checkNext(f.next, logToday()); if (c.error) return c; f.next = c.next; }
  return f;
}
/** The next step's row in step 3: the words and the day, the quick days, or the reason of a Lost result. When another
 *  rep holds the business, a note instead: their next step stays. */
function nextNodes(k) {
  if (k === 'baddata') return [];
  if (!logHolds()) {   // another rep's: their next step stays, and a closing tag says what it does there
    const other = otherTagLine(L.biz || L.lead, L.tag);
    return [h('p', { class: 'note', text: other ? t(other.key, other) : t('nx.other', { name: (L.biz || L.lead).owner.name }) })];
  }
  if (LOST_TAGS.includes(L.tag)) return [h('p', { class: 'label', text: t('biz.reason.ask') }), h('p', { class: 'note', text: t('nx.lost') }),
    h('div', { class: 'chipset bz-reason', role: 'group', 'aria-label': t('biz.reason.ask') },
      LOST_REASONS.map((r) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(L.reason === r), text: t(`biz.reason.${r}`), onclick: () => { keepFields(); L.reason = L.reason === r ? null : r; L.armed = false; renderLog(); } })))];
  if (L.tag === 'waitlist') return [h('p', { class: 'note', text: t('nx.waitlist') })];
  // One sentence: the step in full, then its day in words and "Cambiar", which opens the two fields under it (they
  // stay open until the sheet closes). The chips move the day and the sentence follows. "Sin próximo paso" reads so,
  // and "Cambiar" then brings the proposal back. The business's own next step, when overdue, is said once, here.
  const none = L.next === null, nx = L.next || { day: '', step: '' };
  const was = L.biz && L.biz.next ? dueLine(L.biz.next, logToday()) : null;
  const head = h('div', { class: 'nxs-h' }, h('p', { class: 'label', text: t('nx.title') }), was && was.key === 'biz.due.late' ? h('span', { class: 'nxs-late', text: t(was.key, { n: was.n }) }) : null);
  const dayWords = (d) => (/^\d{4}-\d{2}-\d{2}$/.test(d || '') ? `${wdShort(d)} ${dayMonth(d)}` : '');
  const change = h('button', { class: 'mini-btn', type: 'button', text: t('c.change'), onclick: () => {
    keepFields();
    if (none) { L.nextTouched = false; L.next = undefined; propose(); renderLog(); return; }
    L.nextOpen = true; renderLog(); const box = $('#nxStep'); if (box) box.focus();
  } });
  const say = h('div', { class: 'nxs-say' }, h('p', { class: `nxs-step${none || !nx.step.trim() ? ' quiet' : ''}`, id: 'nxSay', text: none ? t('nx.none') : nx.step.trim() || t('nx.step.ph') }),
    h('p', { class: 'nxs-when' }, none ? null : h('span', { class: 'nxs-day', text: dayWords(nx.day) }), change));
  let fields = null;
  if (L.nextOpen && !none) {
    const step = h('input', { id: 'nxStep', type: 'text', maxlength: 140, autocomplete: 'off', placeholder: t('nx.step.ph'),
      oninput: (e) => { L.nextTouched = true; L.next = { day: (L.next && L.next.day) || '', step: e.target.value }; const s = $('#nxSay'); s.textContent = e.target.value.trim() || t('nx.step.ph'); s.classList.toggle('quiet', !e.target.value.trim()); paintLogFoot(); } });
    const day = h('input', { id: 'nxDay', type: 'date', min: logToday(),
      onchange: (e) => { L.nextTouched = true; L.next = { day: e.target.value, step: (L.next && L.next.step) || '' }; keepFields(); renderLog(); } });
    step.value = nx.step; day.value = nx.day;
    fields = h('div', { class: 'nxs-fields' }, h('label', { class: 'field' }, h('span', { class: 'label', text: t('nx.step.ph') }), step), h('label', { class: 'field' }, h('span', { class: 'label', text: t('nx.f.day') }), day));
  }
  const quick = quickDays(logToday()).map((q) => h('button', { class: 'pick', type: 'button', 'aria-pressed': String(!!L.next && L.next.day === q.day), text: t(q.key),
    onclick: () => { keepFields(); L.nextTouched = true; L.next = { day: q.day, step: L.next ? L.next.step : '' }; renderLog(); } }));
  const noneChip = h('button', { class: 'pick', type: 'button', 'aria-pressed': String(L.next === null), text: t('nx.none'), onclick: () => { keepFields(); L.nextTouched = true; L.next = L.next === null ? undefined : null; if (L.next === undefined) { L.nextTouched = false; propose(); } renderLog(); } });
  return [head, say, fields, h('div', { class: 'chipset', role: 'group', 'aria-label': t('nx.title') }, quick, noneChip)].filter(Boolean);
}
/** The business's card, read once per business picked; an answer for a business picked before is dropped. */
async function readBiz(id) {
  if (!id || L.bizFor === id) return;
  const ticket = ++L.bizTicket;
  L.bizFor = id;
  try {
    const res = await api('GET', `biz/${encodeURIComponent(id)}`);
    if (ticket !== L.bizTicket || !L.lead || L.lead.id !== id) return;
    L.biz = res.biz; L.bizOff = false;
  } catch (e) {
    if (ticket !== L.bizTicket || !L.lead || L.lead.id !== id) return;
    L.biz = null; L.bizOff = e.code === 'offline'; L.bizFor = null;
  }
  keepFields(); propose(); renderLog();
}
function logReady() {
  if (!L.kind || !L.lead) return false;
  if (logBiz().error) return false;
  // a new business waits for its near twins: one of them picked, or "Es nuevo" (newlead-steps newReady)
  return L.lead.isNew ? !L.dupWait && newReady({ name: $('#newName').value, similar: L.similar, sure: L.sure, offline: L.dupOff }) : true;
}
/** The new business's block: the zone picked from the city's (with "Otra", which opens a field under it), and its near
 *  twins under the name, at most five, each the row the search shows; one that may be picked becomes the business, as a
 *  search pick does, and one that may not says why. "Es nuevo" says it is none of them. */
function paintNewLead() {
  const pick = $('#newZonePick'), zones = L.zones || [], opts = zoneOptions(zones), had = pick.value;
  const key = `${lang()}|${opts.join('|')}`;
  if (pick.dataset.key !== key) {
    pick.dataset.key = key;
    pick.replaceChildren(h('option', { value: '', text: t('log.new.zone') }), ...opts.map((z) => h('option', { value: z, text: z === '__other' ? t('log.zone.other') : z })));
    pick.value = zonePickFor({ zones, had, typed: $('#newZone').value });   // a zone typed before the list came stays, as "Otra"
  }
  // with no zones to offer (none in the city, or no signal), the zone is typed
  $('#newZonePickBox').hidden = !zones.length;
  $('#newZoneBox').hidden = zones.length > 0 && pick.value !== '__other';
  const twins = Array.isArray(L.similar) ? L.similar : [];
  $('#dupBox').hidden = !twins.length;
  put($('#dupList'), twins.map((r) => {
    const why = dupNote(r);
    if (!why) return h('li', {}, leadOption({ ...r, known: true }, false));
    return h('li', {}, h('button', { class: 'leadopt', type: 'button', disabled: true, 'aria-pressed': 'false' }, h('span', {}, h('b', { text: r.name }), h('small', { text: `${r.zone || t('log.nozone')} · ${t(why.key)}` }))));
  }));
  const sure = $('#dupNew');
  sure.setAttribute('aria-pressed', String(L.sure));
  sure.classList.toggle('armed', L.sure);
}
/** The city's zones, read once per sheet's first new business; no signal leaves the zone typed. */
async function readZones() {
  if (L.zones) return;
  try { const res = await api('GET', 'zones'); L.zones = Array.isArray(res.zones) ? res.zones : []; L.zonesFailed = false; }
  catch { L.zones = []; L.zonesFailed = true; }
  if (L.lead && L.lead.isNew) { paintNewLead(); paintLogFoot(); }
}
let similarTimer;
/** "¿Es alguno de estos?": the typed name's near twins, asked a moment after the typing stops; an older answer is dropped.
 *  Saving waits for the answer, then for a pick or "Es nuevo". No signal: the sheet saves, and the server still finds an
 *  exact twin. */
function onSimilar() {
  const ask = similarAsk($('#newName').value), ticket = ++L.dupTicket;
  L.sure = false; L.similar = null; L.dupOff = false; L.dupWait = !!ask;
  clearTimeout(similarTimer);
  if (!ask) { if (L.lead && L.lead.isNew) { paintNewLead(); paintLogFoot(); } return; }
  paintLogFoot();
  similarTimer = setTimeout(async () => {
    try { const r = await api('GET', `leads?similar=${encodeURIComponent(ask)}`); if (ticket === L.dupTicket) L.similar = (r.leads || []).slice(0, 5); }
    catch (e) { if (ticket === L.dupTicket) { L.similar = null; L.dupOff = true; } }
    if (ticket !== L.dupTicket) return;
    L.dupWait = false;
    if (L.lead && L.lead.isNew) { paintNewLead(); paintLogFoot(); }
  }, 260);
}
function paintLogFoot() {
  // Guardar never waits in silence: why it waits comes before what the log is worth (next-steps footHint)
  $('#saveLog').disabled = !logReady();
  const problem = L.kind && L.lead ? logBiz().error || null : null;
  const f = footHint({ kind: L.kind, lead: L.lead, today: S.me.today ? S.me.today.day : logToday(), problem, follows: FOLLOWS.has(L.kind), points: S.me.rules.points.followup, closing: notFitArmed(L) && logHolds(), checking: !!(L.lead && L.lead.isNew && L.dupWait) });
  $('#logHint').textContent = t(f.key, f);
  // a new business with near twins waits for one of them, or "Es nuevo": the foot says so
  if (L.kind && L.lead && L.lead.isNew && !L.sure && Array.isArray(L.similar) && L.similar.length) $('#logHint').textContent = t('log.dup.title');
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
  // only what is on screen now is sent: a contact typed for a meeting, then another result picked, stays here
  // (next-steps logBody); the next step and Lost are what the holder's log says about the business
  const zonePick = L.zones && L.zones.length ? $('#newZonePick').value : '__other';   // with no zones offered, the zone is typed
  const body = logBody({ id: newId(), kind: L.kind, clientAt: new Date().toISOString(), lead: L.lead, newLead: L.lead.isNew ? { name: $('#newName').value.trim(), zone: zoneOf(zonePick, $('#newZone').value) } : null,
    channel: L.channel, voicemail: L.voicemail, tag: L.tag, contact: L.contact, phone: L.phone, when: L.when, time: L.time, note: L.note, about: logBiz(), card: L.biz });
  // the qualification: only the rows tapped, only on a conversation; a meeting may ask for a demo
  const q = QUAL_KINDS.includes(L.kind) ? qualBody(L.qual) : undefined;
  if (q) body.q = q;
  if (L.kind === 'meeting' && L.demo) body.demo = true;
  // The save button says it is saving (no toast of its own). The sheet stays for the answer, at most 1.2 s: on a slow
  // signal it closes anyway and the answer arrives on the screen behind it.
  const btn = $('#saveLog'), to = L.from || 'today';
  let gone = false;
  const leave = () => { if (gone) return; gone = true; L.saved = true; storeDraft(null); closeSheet($('#logSheet')); setTab(to); };   // a save leaves no draft
  return once(btn, async () => {
    btn.textContent = `${t('c.saving')}…`;
    logInert(true);   // nothing typed while it saves is lost in silence: the fields take no input until the answer
    if (!reduce && btn.animate) btn.animate([{ filter: 'blur(2px)', opacity: 0.4 }, { filter: 'blur(0)', opacity: 1 }], { duration: 200, easing: 'ease' });
    const wait = setTimeout(leave, 1200);
    try { const res = await api('POST', 'log', { ...body, sentAt: new Date().toISOString() }); clearTimeout(wait); leave(); setTimeout(() => logged(res, body), reduce ? 0 : 260); }
    catch (e) {
      clearTimeout(wait);
      // No answer, a service that is restarting or a session that ended: the log waits on the phone. Only a plain refusal ends it.
      if (verdict(e) === 'keep') { leave(); S.queue.push({ rep: S.me.me.id, body }); store.set(KEY.queue, S.queue); renderTop(); toast(t('toast.queued')); shutOut(e); }
      else if (!shutOut(e)) { logInert(false); toastErr(errText(e)); renderLog(); if (gone) openSheet($('#logSheet')); }   // refused: the sheet stays, or comes back, with what was typed
    } finally { btn.textContent = t('log.save'); }
  });
}
/** The log sheet's fields and chips take no input while a save is out (inert), and take it again on a refusal. */
function logInert(on) { for (const sel of ['#leadPicked', '#bizStrip', '#leadPick', '#outOpts', '#moreOuts', '#logExtra']) { const n = $(sel); if (n) n.inert = on; } }
function logged(res, body) {
  const before = S.me, hit = res.repeat || !before.today || !res.me.today ? null : landed(before.today, res.me.today, before.rules);
  if (hit != null) { S.hold = hit; S.stop = null; }   // the stop this landed on keeps its picture while the rest repaints
  // the points chip keeps its old number until the dot that carries the points lands on it
  const flies = !res.repeat && res.gained > 0;
  if (flies && before.week) S.ptsHeld = before.week.points;
  book.forget(); adopt(res.me); renderAll(true);   // a log can take a business: the free list is read again
  if (body.lead.id && biz.current() && biz.current().id === body.lead.id) biz.refresh();   // the card it was logged from shows the contact
  const label = t(`kind.${body.kind}`);
  if (res.repeat) toast(t(res.updated ? 'toast.repeat.updated' : 'toast.repeat'));
  else {
    const follow = res.me.ledger.some((e) => e.logId === res.logId && e.code === 'followup');
    // A log can pay less than its result promised: the toast says which part did not pay, and why (paid.js).
    const short = shortfall(body.kind, body.channel, res.me.ledger.filter((e) => e.logId === res.logId).map((e) => e.code));
    const why = short.length ? t(`toast.why.${short[0]}`, { n: res.me.rules.caps.messagesPerDay }) : '';
    const bits = [label + (follow ? ` · ${t('toast.followup')}` : '')];
    if (why) bits.push(why);
    if (res.pending > 0) bits.push(t('toast.pending', { n: res.pending }));
    if (res.took) bits.push(t('log.took'));
    else if (res.owned && res.owned.name) bits.push(t('log.owned', { name: res.owned.name }));
    let text = bits.join(' · ');
    if (res.streakUp) text += `. ${t('toast.streak', { n: res.me.streak.current })}`;
    if (res.gained > 0 || res.pending > 0) toast(text, res.gained > 0 ? t('pts.plus', { n: res.gained }) : ''); else toast(why ? t('toast.zero.why', { why }) : t('toast.zero'));
  }
  // The stop answers first: its frames play with the tracking ring around it. Then the points travel from the stop
  // (or from the button, when no habit moved) to where they are counted, in the top bar.
  const played = hit != null ? answer(hit, before.today, res.me.today).catch(() => {}) : Promise.resolve();
  if (!res.repeat && res.gained > 0) {
    const tag = $('#ptsChip');
    setTimeout(() => flyDot(hit != null ? $('#dio') : $('#logBtn'), tag, () => {
      S.ptsHeld = null; countTo($('#ptsN'), S.me && S.me.week ? S.me.week.points : res.me.week.points);   // it lands: now the chip counts
      ringAt($('#meLens .portrait'), { whole: true }); lock(tag); floatUp(tag, t('pts.plus', { n: res.gained }));
    }), hit != null && !reduce ? 520 : 0);
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
  // the report, from the moment: shared where the browser can share text, else copied (moments.js reportAction)
  const text = today.closed ? ($('#slackText').textContent || '').trim() : '';
  const canShare = !!text && typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare({ text }));
  const how = reportAction(canShare);
  const run = async (kind = how.kind) => {
    let result;
    if (kind === 'share') { try { await navigator.share({ text }); result = 'ok'; } catch (e) { result = e && e.name === 'AbortError' ? 'cancel' : 'fail'; } }
    else result = (await copyText(text)) ? 'ok' : 'fail';
    const o = reportOutcome(kind, result);
    if (o.then) return run(o.then);
    if (o.say && !o.close) toast(t(o.say));
    return o.close;
  };
  // the moment owns one entry of the history while it is up: Back closes it and leaves the rep on Hoy
  let pushed = false;
  try { history.pushState({ cancha: 'moment' }, '', location.href); pushed = true; backNav.moment = true; } catch { /* a page shown inside another */ }
  const go = await dayDone({ title: t('cel.finger.title'), sub, glyph: hand, from: $('#nextBtn').hidden ? $('#dio') : $('#nextBtn'), label: `${t('cel.finger.title')} ${sub}`,
    report: text ? { label: t(how.key), hint: t(how.hint), run: () => run() } : null, done: t('dd.done'), hold: DONE_HOLD });
  const toWeek = !!(go && S.me && !S.mgr);
  if (!pushed || !backNav.moment) { if (toWeek) setTab('week'); return; }   // closed by Back (its entry is gone), or it had none
  // closed by its own controls (back-steps.js momentClose): in place, its entry goes; toward the week, the moment's
  // entry becomes the week's, so Back from Semana comes home and the app is never left early
  backNav.moment = false;
  const move = momentClose({ go: toWeek, held: (backNav.guarded ? 1 : 0) + (backNav.away ? 1 : 0) });
  popEntries(move.pop);
  if (!move.away) return;
  backNav.trail.length = 0; backNav.from = null; backNav.guarded = false; backNav.away = true;
  try { history.replaceState({ cancha: 'tab' }, '', location.href); } catch { /* as above */ }
  setTab('week', { replay: true }); remember('week');
}

// ---- logs that wait for signal ----
/** A phone can be shared: each waiting log remembers whose it is, and only its owner sends it. */
function myQueue() { return S.me && S.me.me ? waitingOf(S.queue, S.me.me.id) : []; }
let flushing = false;
async function flush() {
  if (flushing || !S.me || readOnly() || !myQueue().length) return;
  flushing = true;
  let sent = 0;
  const went = [];   // the logs that reached the server and added something, to say when one of them was made on an earlier day
  const arrived = [];   // each sent log with the server's answer and its business's name, for what the toast adds (queue.js sentNotes)
  const nameOf = (b, answer) => (b.lead && b.lead.name) || [...((answer && answer.me && answer.me.recentLeads) || []), ...((S.me && S.me.recentLeads) || [])].find((l) => l && l.id === b.lead.id)?.name || null;
  try {
    for (const item of myQueue()) {
      try { const answer = await api('POST', 'log', { ...item.body, sentAt: new Date().toISOString() }); sent += 1; if (landedNew(answer)) went.push(item); arrived.push({ body: item.body, answer, name: nameOf(item.body, answer) }); }   // clientAt stays the moment of the contact
      catch (e) {
        if (verdict(e) === 'keep') { shutOut(e); break; }   // it stays in the queue for the next try
        toastErr(t('toast.dropped', { why: errText(e) }));   // refused for good: it leaves the queue with the reason shown
      }
      S.queue = S.queue.filter((q) => q !== item); store.set(KEY.queue, S.queue);
    }
  } finally { flushing = false; }
  renderTop();
  if (sent) {
    book.forget();
    await refresh(true);
    // made yesterday with no signal, it counts today: the day it reached the server (the phone's clock carried to the server's)
    const tz = S.me && S.me.me ? S.me.me.tz : null, today = tz ? dayOf(nowIso(), tz) : null;
    const earlier = today ? madeEarlier(went, today, (iso) => dayOf(new Date(Date.parse(iso) + skew).toISOString(), tz)) : 0;
    // the count first, with whose the businesses are now; then a next step that was already past and was not kept,
    // by the business's name (two at most, the rest counted)
    const notes = today ? sentNotes(arrived, today) : { words: [], late: [], more: 0 };
    const stop = (x) => (/[.!?]$/.test(x) ? x : `${x}.`);
    const first = [t(earlier ? 'toast.sent.today' : 'toast.sent', { n: sent }), ...notes.words.map((w) => t(w.key, w))].map(stop).join(' ');
    toasts([first, ...notes.late.map((name) => t('toast.sent.late', { name })), notes.more ? t('toast.sent.late.more', { n: notes.more }) : null]);
  }
}

// ---- session ----
/** The server's clock, carried to this moment: what is on time is judged now, not when the last answer came. */
let skew = 0;
function skewFrom(me) { const at = Date.parse(me && me.serverTime); if (Number.isFinite(at)) skew = at - ((me && me.keptAt) || Date.now()); }   // a view from the copy: measured when it was kept
const nowIso = () => new Date(Date.now() + skew).toISOString();
/** What a view says, leaving out the clock: two reads that match have nothing new to draw. */
const signature = (me) => JSON.stringify({ ...me, serverTime: null });
// Only a person's own screens are kept on the phone for a start without signal: never a view-as, never the practice rep.
function adopt(me, read = null) { if (read == null) reads.adopted(); else reads.take(read); S.stale = null; skewFrom(me); S.me = me; S.sig = signature(me); S.lastLoad = Date.now(); if (!S.as && me.me) store.set(KEY.me, { ...me, keptAt: Date.now() }); }
/** A leader has no board of their own: they land on the leadership view, with no tabs, no log and no entrance. */
function enterLeader(me) {
  reads.adopted();
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
    .catch((e) => { if (!shutOut(e)) showGate('error', e); });
}
function enter(me) {
  if (me.viewer && me.viewer.role === 'leader') { enterLeader(me); return; }
  S.lead = false; reads.adopted(); S.stale = null; skewFrom(me);
  S.me = me; S.sig = signature(me); S.lastLoad = Date.now(); S.lastPaint = Date.now();
  if (!S.as || me.viewer.role === 'rep') S.as = me.viewer.as;   // a rep's `as` is ignored by the server
  let own = S.as ? me.viewer.lang : me.me.lang;
  // A language picked with no signal is the person's choice: it wins over the server's and is sent again.
  const pend = S.as ? null : langWaiting(store.get(KEY.langPending, null), langOwner(me), LANGS);   // only this person's (queue.js)
  if (pend) {
    own = pend;
    if (pend === me.me.lang) store.del(KEY.langPending);
    else api('POST', 'lang', { lang: pend }).then(() => store.del(KEY.langPending)).catch(() => { /* still no signal: kept for the next start */ });
  }
  if (own && own !== lang()) { setLang(own); store.set(KEY.lang, own); applyStatic(); }
  S.mgr = !S.as && me.viewer.role !== 'rep';
  document.body.classList.remove('bare'); document.body.classList.toggle('mgr', S.mgr);
  if (!S.as) store.set(KEY.me, me.keptAt ? me : { ...me, keptAt: Date.now() });   // a view opened from the copy keeps the day it was kept
  S.seenFeed = null; waiting.length = 0; book.forget();
  S.stop = null; S.hold = null; S.owed = null;
  const first = S.mgr ? 'team' : 'today';
  const ready = S.mgr ? manager.load().then(() => { renderAll(false); }).catch((e) => toastErr(errText(e))) : Promise.resolve();
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
  docs.restore();   // the copy kept on the phone first: a card opens with no signal
  loadDocs();
  flush();
}
/** The documents are read on their own: a slow or failed read never holds up the screens, which draw them when they come. */
function loadDocs() { docs.load().then(() => { if (S.me) renderAll(false); }).catch(() => { /* the list stays as it was; the documents screen asks again when opened */ }); }
/** The entrance: the lens finds the person, says where they stand, and hands them their screen. */
function welcome(day, ready, arriveAll) {
  const me = S.me, who = me.me, st = stake(me), today = me.today;
  const line = st.kind === 'team' ? [t('greet.team.a', { w: st.working, p: st.players }), t('greet.team.b', { c: st.closed })]
    : st.kind === 'lead' ? [t('greet.lead.a'), ((b) => (b ? t(b.key, { ...b, gap: b.pts ? pts(b.pts) : '' }) : t('greet.lead.b', { pts: pts(st.score) })))(behindLine(st.behind))]
    : st.kind === 'place' ? [t('greet.place.a', { ord: ord(st.place), n: st.ranked }), ((g) => (g ? t(g.key, { ...g, gap: g.pts ? pts(g.pts) : '' }) : ''))(gapLine(st.gap))]   // a tie reads as a tie
    : st.kind === 'new' ? [t('greet.new.a', { d: st.day, n: st.of }), t('greet.new.b')]
    : [t(`greet.${st.kind}.a`), t(`greet.${st.kind}.b`)];
  const streak = me.streak && me.streak.current > 0 ? ` · ${upper(t('top.streak'))} ${num(me.streak.current)}` : '';
  greet({
    person: shown(who), name: `${shown(who).first}.`, line,
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
  const read = reads.send();
  try {
    const me = await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me');
    if (!reads.fresh(read)) return;   // something newer was adopted while this read was out
    S.lastLoad = Date.now();
    const had = JSON.stringify(S.docs);
    await docs.load().catch(() => { /* kept as it was */ });
    if (!reads.fresh(read)) return;   // ... or while the documents were read (a log answered meanwhile, say)
    if (signature(me) === S.sig && JSON.stringify(S.docs) === had && Date.now() - S.lastPaint < 5 * 60000) return;
    const before = S.me;
    adopt(me, read);
    if (S.mgr) await manager.load();
    if (S.lead || S.tab === 'lead') await leader.load();
    renderAll(true);
    if (!S.mgr && !S.lead && !readOnly()) playMoments(moments(before, me));   // something confirmed elsewhere can be a moment here
  } catch (e) { if (staleAs(e, S.as)) viewAs(null); else shutOut(e); }
}
async function refresh(animate = false) {
  const read = reads.send();
  try {
    const me = await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me');
    if (!reads.fresh(read)) return;   // something newer was adopted while this read was out
    adopt(me, read);
    if (S.mgr) await manager.load();
    if (S.lead || S.tab === 'lead') await leader.load();
    renderAll(animate);
  } catch (e) { shutOut(e); }
}
/** The board has no sign-in of its own: its door is the portal's, at this same address. This is the little it says
 * itself. kind is 'team' (the account is not on the team; detail is the account), 'session' (the session ended and
 * coming back did not help) or 'error' (it did not load; detail is why). */
function showGate(kind, detail = '') {
  for (const dlg of document.querySelectorAll('dialog[open]')) dlg.close();   // a sheet of the screens being left goes with them
  S.me = null; S.gate = { kind, detail };
  document.body.classList.add('bare'); document.body.classList.remove('mgr');
  $('#nav').hidden = true; renderTop(); show('gate');
  $('#gateLead').textContent = kind === 'team' && detail ? t('gate.team.lead', { email: detail }) : t('gate.lead');
  giant($('#gateGiant'), t(`gate.${kind}.title`));
  $('#gateSupport').textContent = kind === 'error' ? errText(detail) : t(`gate.${kind}.support`);
  const go = $('#gateGo'), alt = $('#gateAlt');
  go.textContent = t(kind === 'session' ? 'gate.enter' : 'gate.retry'); go.href = kind === 'session' ? toDoor(new URL(HOME, location.href).href) : HOME;
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
  // the page loaded again, marked as a trip to the door, so a kept copy of the board never stands in for the sign-in
  if (move === 'reload') { try { sessionStorage.setItem(DOOR, String(Date.now())); const to = toDoor(location.href); if (to === location.href) location.reload(); else location.replace(to); return true; } catch { move = 'gate:session'; } }
  showGate(move === 'gate:team' ? 'team' : 'session', (e.data && e.data.email) || '');
  return true;
}
/** Signing out ends the portal's session, which is the board's too. The next entrance plays in full. */
function signOut() { store.del(KEY.me); store.del(KEY.greet); docs.forget(); storeDraft(null); location.href = LEAVE; }   // a log left half done leaves with the person
/** With logs still waiting on this phone, signing out says so and asks for a second tap (they stay on the phone and go
 *  out at the next sign-in, but the person should know). */
function signOutAsked(btn, e) {
  const n = myQueue().length;
  if (!n) { signOut(); return; }
  const step = askTwice(btn, e, { onDisarm: () => { if (btn.isConnected) btn.textContent = t('profile.signout'); } });   // taps.js: one double tap never passes both
  if (step === 'arm') btn.textContent = t('profile.signout.waiting', { n });
  else if (step === 'run') signOut();
}
/** `as` is whose screens to open as their manager. Left out, the page's own address says it. */
let starts = 0;   // a start that a newer one replaced (two quick taps on two faces) drops its answer
async function start(as = undefined) {
  const ticket = ++starts;
  const url = new URL(location.href);
  // Back from a trip to the door: its mark comes off the address, so it is not carried into the next one
  const clean = offDoor(url.href);
  if (clean) { try { history.replaceState(history.state, '', clean); } catch { /* the address keeps it; nothing else changes */ } url.searchParams.delete('door'); }
  // A sheet left open (the log sheet, say) belongs to the screens being left: it closes before the identity changes,
  // so nothing in it can be saved as someone else. Until the new answer arrives the screens read only (actingMode).
  for (const dlg of document.querySelectorAll('dialog[open]')) closeSheet(dlg);
  reads.adopted();   // nothing read for the screens being left is adopted from now on (a quiet check still out, say)
  S.as = as === undefined ? url.searchParams.get('as') : as;
  if (!S.tab) S.tab = tabOf(url.hash, SCREENS);   // a reload lands on the tab in the address, when it names a screen (enter() checks this person has it)
  if (S.me && !S.lead && !S.mgr) renderNav();   // the log button goes at once while the screens read only
  try { S.gate = null; const me = await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me'); if (ticket === starts) enter(me); }
  catch (e) {
    if (ticket !== starts) return;   // the screens asked for since then answer for themselves
    const cached = store.get(KEY.me, null);
    // The address names a rep who is gone (the practice rep was removed, then Back or a reload): drop it, start as the person.
    if (staleAs(e, S.as)) { url.searchParams.delete('as'); try { history.replaceState(null, '', url); } catch { /* the view changes all the same */ } S.tab = null; await start(null); return; }
    if (e.code === 'offline' && cached && !S.as) {
      enter(cached);
      // What the phone kept is from an earlier day: it is shown, said to be old, and it locks nothing (a log waits for
      // the signal and the server dates it), so the queue works exactly when it is needed.
      // its day against today on the server's clock, carried from when the view was kept (a phone's own clock can be off)
      const drift = cached.keptAt && Date.parse(cached.serverTime) ? Date.parse(cached.serverTime) - cached.keptAt : 0;
      const kept = cached.today && cached.today.day, now = cached.me && cached.me.tz ? dayOf(new Date(Date.now() + drift).toISOString(), cached.me.tz) : kept;
      if (kept && now && kept !== now) { S.stale = kept; renderAll(false); toastErr(t('err.offline.stale', { date: dayMonth(kept) })); }
      else toastErr(t('err.offline'));
    }
    else if (!shutOut(e)) showGate('error', e);
  }
}
/** Open a rep's screens as their manager, or come back to the team, without loading the page again. What it does to the
 *  history is decided in practice-steps.js (asMove): one step above the team per visit, a second tap replaces it, and
 *  the way back steps down to the team's own place, so the phone's Back afterwards never opens a rep's screens again. */
async function viewAs(id = null) {
  const step = asMove({ id, as: S.as, depth: backNav.asDepth, guarded: backNav.guarded });
  if (step.move === 'none') return;   // those screens are the ones already open (a second tap on the same face)
  if (step.move === 'back') {
    resetBack();
    try { history.go(-step.steps); return; } catch { /* the address changes in place, below */ }   // the popstate starts the team (onBack)
  }
  const url = new URL(location.href);
  if (id) url.searchParams.set('as', id); else url.searchParams.delete('as');
  url.hash = '';   // the other screens open on their first tab
  resetBack();   // nothing of a zone is carried into the other screens: track() would step back onto the old address
  try { if (step.move === 'replace') history.replaceState(null, '', url); else history.pushState(null, '', url); backNav.asDepth = step.depth || 0; } catch { /* a page shown inside another one may not change its address: the view changes all the same */ }
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
const openReport = (id) => report.open(id, { tz: tz(), after: (res) => { if (res.me) adopt(res.me); renderAll(false); } }).catch((e) => toastErr(errText(e)));
// ---- wiring ----
const report = createReport({ api });
const manager = createManager({ api, S, errText, refresh, renderAll, renderFeed, signOut, viewAs, openInstall: (id) => install.open(id, 'needs'), openBiz: (id, from, hit) => biz.open(id, from, hit),
  openReport: (id, zone) => report.open(id, { tz: zone, after: () => refresh(false) }).catch((e) => toastErr(errText(e))),
  docForm: (preset) => docs.form(null, preset, () => renderAll(false)) });
const docs = createDocs({ api, S, errText, setTab });
const install = createInstall({ api, S, errText, refresh, setTab, hooks: docs.hooks });
const ladder = createLadder({ api, S, errText, adopt, renderAll, setTab, openLog, hooks: docs.hooks, openDocs: (from) => docs.open(from) });
const route = createRoute({ api, S, errText, adopt, renderAll, setTab, openLog, openInstall: (id, from) => install.open(id, from), hooks: docs.hooks });
const scorecard = createScorecard({ api, S, errText, openBiz: (id, from, hit) => biz.open(id, from, hit) });
const leader = createLeader({ api, S, errText, setTab, scorecard });
const sites = createSites({ api, S, errText, adopt, renderAll, setTab, openInstall: (id, from, to) => install.open(id, from, to), openReport });
const book = createBook({ api, S, errText, adopt, renderAll, setTab, openBiz: (id, from, hit) => biz.open(id, from, hit), openLog, today: logToday });
const biz = createBiz({ api, S, errText, adopt, renderAll, setTab, openLog, openRoute: (id, from) => route.open(id, from), reps: () => manager.reps(), today: logToday, changed: () => book.forget(),
  guion: { has: () => docs.hasGuion(), open: () => docs.openGuion() } });
function wire() {
  initPop(); initSheets(); enterMoves([$('#newName'), $('#newZone')]); enterMoves([$('#fTomorrow'), $('#fBlock')]); install.wire(); ladder.wire(); route.wire(); leader.wire(); docs.wire(); sites.wire(); biz.wire(); book.wire();
  // the top bar's height, for what sticks under it (the practice bar) and for scrolling a heading into view below it
  const topBar = $('.top');
  if (topBar && 'ResizeObserver' in window) new ResizeObserver(() => document.documentElement.style.setProperty('--top-h', `${topBar.offsetHeight}px`)).observe(topBar);
  $('#hoyLine').addEventListener('click', (e) => book.open('today', e.currentTarget));
  addEventListener('resize', () => { if (S.me && S.tab === 'today') fitStage(); else if (S.me && S.tab) fitArt($(`#s-${S.tab}`)); });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (S.me && S.tab === 'today') fitStage(); });
  $('#sitesCard').addEventListener('click', () => sites.open('today'));
  $('#reportCard').addEventListener('click', (e) => { const id = e.currentTarget.dataset.site; if (id) openReport(id); });
  $('#docsCard').addEventListener('click', () => docs.open('today'));
  $('#docsBtn').addEventListener('click', () => docs.open('team'));
  $('#ldDocs').addEventListener('click', () => docs.open('lead'));
  $('#previewBtn').addEventListener('click', () => ladder.open('team'));
  $('#toast').addEventListener('click', dropToast);   // an error waits for a tap (or 6 s)
  $('#home').addEventListener('click', (e) => { if (!S.me) return; e.preventDefault(); if (S.as) viewAs(null); else setTab(S.lead ? 'lead' : S.mgr ? 'team' : 'today'); });
  $('#asExit').addEventListener('click', (e) => { e.preventDefault(); viewAs(null); });
  // Back and forward move between the team and a rep's screens, as the address says.
  addEventListener('popstate', onBack);
  $('#langSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-lang]'); if (b) switchLang(b.dataset.lang); });
  src($('#streakChip'), () => t('top.streak'), () => { const st = S.me.streak; return t('src.streak', { spares: st.spares, max: S.me.rules.spares, best: t('u.days', { n: st.best }) }); });
  // a tap tries again at once; while a log still waits, it says what happens to it
  $('#queueChip').addEventListener('click', async () => { if (flushing) return; await flush(); const n = myQueue().length; if (n && S.me) toast(t('top.queue.wait', { n })); });
  document.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) openSheet($(`#${o.dataset.open}`)); });
  $('#hand').addEventListener('click', (e) => { const hit = e.target.closest('.ahit'); if (hit) { e.stopPropagation(); if (stopTeach) stopTeach(); fingerDetail(hit); } });
  $('#teachBtn').addEventListener('click', teach);
  $('#meBtn').addEventListener('click', () => setTab('profile'));
  $('#placeChip').addEventListener('click', () => setTab('table'));
  $('#goalBtn').addEventListener('click', openGoal);
  $('#nextBtn').addEventListener('click', () => {
    const step = $('#nextBtn').dataset.step;
    const sel = Number($('#nextBtn').dataset.sel);
    if (step === 'next') { S.stop = null; paintStage(true); } else if (step === 'close') openClose();
    else if (sel === 2 && S.me.agenda && S.me.agenda.due.length) book.open('today', $('#nextBtn'));   // the follow-up stop: who is due, in Mis negocios
    else openLog(stopPreset(sel));
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
  onSheetOpen(sheetOpened);
  for (const dlg of $$('dialog.sheet')) dlg.addEventListener('close', () => sheetClosed(dlg));
  $('#logSheet').addEventListener('close', keepLogDraft);
  // the draft line leaves as soon as the rep changes anything
  for (const type of ['input', 'click']) $('#logSheet').addEventListener(type, (e) => {
    if (!L.resumed || !e.target.closest || e.target.closest('#logDraft,[data-close],#logGuion')) return;
    if (type === 'click' && !e.target.closest('button,input,select,textarea,a')) return;
    L.resumed = false; $('#logDraft').hidden = true;
  }, true);
  $('#logDraftClear').addEventListener('click', () => { storeDraft(null); openLog(); });
  for (const dlg of $$('dialog.sheet')) dlg.addEventListener('close', () => setTimeout(() => {
    const owed = S.owed; S.owed = null;
    (owed && S.me && S.me.today ? answer(owed.hit, owed.before, owed.after).catch(() => {}) : Promise.resolve()).then(() => playMoments());
  }, 260));
  // Loops run only where the eye is: a screen out of view (a band scrolled away, a tab not shown) pauses its own.
  if ('IntersectionObserver' in window) {
    const seen = new IntersectionObserver((list) => { for (const e of list) e.target.classList.toggle('idle', !e.isIntersecting); });
    for (const screen of $$('section.screen')) seen.observe(screen);
  }
  // Crossing between a narrow and a wide screen changes how many zones show at once.
  WIDE.addEventListener('change', () => { if (S.me && S.tab) { show(S.tab); markTab(); } });
  $('#tableSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-period]'); if (!b) return; S.period = b.dataset.period; quiet(renderTable); });
  $('#closeBtn').addEventListener('click', openClose);
  $('#closeSubmit').addEventListener('click', submitClose);
  for (const id of ['#fTomorrow', '#fBlock']) $(id).addEventListener('input', drawReport);
  $('#leadQ').addEventListener('input', onSearch);
  $('#newName').addEventListener('input', () => { onSimilar(); paintLogFoot(); });
  $('#newZonePick').addEventListener('change', () => { paintNewLead(); if (!$('#newZoneBox').hidden) $('#newZone').focus(); });
  $('#dupNew').addEventListener('click', () => { L.sure = !L.sure; paintNewLead(); paintLogFoot(); });
  $('#moreOuts').addEventListener('click', () => { L.more = !L.more; keepFields(); renderLog(); });
  $('#saveLog').addEventListener('click', saveLog);
  $('#logGuion').addEventListener('click', () => { keepFields(); docs.openGuion(); });
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
// loaded again with a sheet's or the moment's entry on top: neither is open now, so that entry is stepped off and the
// rep's first Back does something (back-steps.js reloadSkip)
try { if (reloadSkip(history.state)) { backNav.skip += 1; history.back(); } } catch { /* a page shown inside another */ }
start();
// The worker that opens the board with no signal (sw.js). It is handed the files this page already loaded, so the next
// start without signal works too. Where it cannot run (a copy shown inside another page, an old browser), nothing changes.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').then(() => navigator.serviceWorker.ready).then((reg) => {
    const here = new URL('.', location.href).href;
    const loaded = performance.getEntriesByType('resource').map((e) => e.name), art = Object.values(ART).map((u) => new URL(u, location.href).href);
    const api = new URL('api/', location.href).href, files = [...new Set([...loaded, ...art])].filter((u) => u.startsWith(here) && !u.startsWith(api));
    if (reg.active) reg.active.postMessage({ warm: files });
  }).catch(() => { /* the board works without it */ });
}
