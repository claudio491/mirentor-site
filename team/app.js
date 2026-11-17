// app.js: the rep's side of the sales team platform, and the shell both sides share.
// The server answers codes and numbers; every sentence comes from i18n.js through t().
import { APP_NAME, LANGS } from './i18n.js';
import { $, $$, h, icon, t, setLang, lang, applyStatic, num, ord, wdShort, wdLong, dayMonth, monthName, upper, cap, isoWeek, addDays, clock, hourName, stamp, ago, cityName, joinList,
  lock, buzz, quiet, countTo, flipList, toast, showPop, hidePop, initPop, src, openSheet, closeSheet, initSheets, once, copyText, grain, reduce, formSheet, setExplain } from './ui.js';
import { buildHand, paintHand, miniHand, rowWrist, lens, setLens, levelBone, badgeGlyph } from './hand.js';
import { createManager } from './manager.js';

const API = '/equipo/api';
const KEY = { lang: 'cancha.lang', queue: 'cancha.queue', me: 'cancha.me' };
const store = {
  get(k, fallback) { try { const v = localStorage.getItem(k); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage full or blocked: the app still works online */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* same */ } },
};

// ---- the API ----
class ApiError extends Error { constructor(code, status) { super(code); this.code = code; this.status = status; } }
async function api(method, path, body) {
  let res;
  // A request that hangs is treated as no signal: a log then waits on the phone and goes out again with the same id.
  const stop = new AbortController(), timer = setTimeout(() => stop.abort(), 15000);
  try {
    res = await fetch(`${API}/${path}`, { method, headers: body === undefined ? {} : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'same-origin', cache: 'no-store', signal: stop.signal });
  } catch { throw new ApiError('offline', 0); } finally { clearTimeout(timer); }
  let data = null;
  try { data = await res.json(); } catch { /* an answer that is not JSON is treated as a failure below */ }
  if (!res.ok || !data || data.ok === false) throw new ApiError((data && data.error) || 'unknown', res.status);
  return data;
}
const errText = (e) => { try { return t(`err.${(e && e.code) || 'unknown'}`); } catch { return t('err.unknown'); } };
setExplain(errText);

// ---- state ----
const S = { me: null, tab: null, period: 'week', as: null, mgr: false, queue: store.get(KEY.queue, []), seenFeed: null, lastLoad: 0 };
const SCREENS = ['boot', 'auth', 'setup', 'today', 'table', 'profile', 'team', 'needs', 'reps'];
const FOLLOWS = new Set(['talk', 'absent', 'call', 'reply', 'meeting']);
const CHANNELS = { message: ['whatsapp', 'linkedin', 'email', 'sms'], meeting: ['visit', 'call', 'whatsapp'], reply: ['whatsapp', 'linkedin', 'email', 'sms', 'call'], baddata: ['call', 'email'] };
const TAGGED = new Set(['talk', 'call', 'reply']);
const TAGS = ['meeting', 'waitlist', 'not_now', 'not_fit', 'not_interested', 'do_not_call'];
const ONE_LEVEL = new Set(['first_log', 'first_meeting', 'first_site_live']);
const MAIN_KINDS = ['talk', 'absent', 'call', 'message', 'meeting', 'contract'], MORE_KINDS = ['noanswer', 'reply', 'baddata'];
const LEDGER_RULE = { visit: 'visit', conversation: 'conversation', followup: 'followup', message: 'message', reply: 'reply', meeting_booked: 'meetingBooked', meeting_held: 'meetingHeld',
  contract_sent: 'contractSent', contract_signed: 'contractSigned', site_signed: 'siteSigned', site_installed: 'siteInstalled', site_first_hour: 'siteFirstHour', day_closed: 'dayClosedOnTime' };
const readOnly = () => !!S.as;
const tz = () => S.me.me.tz;
const pts = (n) => t('u.points', { n });
/** The word of a counted unit without its number: "sitios" from "3 sitios". */
const unitWord = (key, n) => t(key, { n }).replace(num(n), '').trim();

function show(name) { for (const n of SCREENS) $(`#s-${n}`).hidden = n !== name; }
/** Giant type ends in a signal full stop, like the brand's headlines. */
function giant(node, text) {
  if (text.endsWith('.')) node.replaceChildren(text.slice(0, -1), h('em', { text: '.' })); else node.textContent = text;
}
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
  chip.hidden = !st;
  if (st) { countTo($('#streakN'), st.current); chip.setAttribute('aria-label', t('top.streak.aria', { n: t('u.days', { n: st.current }) })); }
  $('#queueChip').hidden = !S.queue.length;
  $('#queueN').textContent = t('top.queue', { n: S.queue.length });
  $('#queueChip').setAttribute('aria-label', t('top.queue.aria'));
  for (const b of $$('#langSeg button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang()));
  $('#asBar').hidden = !S.as;
  if (S.as && S.me) $('#asText').textContent = t('top.viewAs', { name: S.me.me.name });
}
function renderNav() {
  const nav = $('#nav'), canLog = !S.mgr && !readOnly() && !!S.me.today;
  const tabs = S.mgr ? ['team', 'needs', 'reps'] : ['today', 'table', 'profile'];
  const count = S.mgr ? manager.needsCount() : 0;
  nav.replaceChildren(...tabs.map((id) => h('button', { class: 'tab', type: 'button', 'data-tab': id, 'aria-current': S.tab === id ? 'page' : null, onclick: () => setTab(id) },
    icon(id), h('span', { text: t(`nav.${id}`) }), id === 'needs' && count ? h('span', { class: 'count num', text: String(count) }) : null)),
  canLog ? h('button', { class: 'btn primary log', type: 'button', id: 'logBtn', onclick: openLog }, icon('plus'), t('nav.log')) : null);
  nav.classList.toggle('three', !canLog);
  nav.hidden = false;
}
function setTab(name) {
  S.tab = name; show(name); hidePop();
  for (const b of $$('#nav .tab')) { if (b.dataset.tab === name) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); }
  scrollTo({ top: 0 });
}
function renderAll(animate = false) {
  const run = () => {
    renderTop(); renderNav();
    if (S.mgr) manager.render(animate); else { renderToday(animate); renderTable(); renderProfile(); renderRules(); }
  };
  if (animate) run(); else quiet(run);
}
async function switchLang(next) {
  if (!LANGS.includes(next) || next === lang()) return;
  setLang(next); store.set(KEY.lang, next); applyStatic();
  if (S.me) { renderAll(false); if (!readOnly()) api('POST', 'lang', { lang: next }).catch(() => { /* the choice is kept on this phone; it follows the person once the signal is back */ }); }
  else for (const b of $$('#langSeg button')) b.setAttribute('aria-pressed', String(b.dataset.lang === lang()));
  toast(t('toast.lang'));
}

// ---- today ----
function renderToday(animate) {
  const { me, today, week, goal, goalPick, rules } = S.me;
  if (!today) return;
  $('#dateChip').textContent = `${upper(wdShort(today.day))} ${upper(dayMonth(today.day))} · ${upper(t('time.week', { n: isoWeek(today.day) }))}`;
  $('#sampleChip').hidden = !S.me.sample;
  const done = today.habits.filter(Boolean).length, head = $('#todayGiant'), by = hourName(rules.closeBy);
  if (!today.isWork) {
    $('#todayLead').textContent = t('today.lead.rest', { name: me.first });
    giant(head, t('today.rest.giant')); head.classList.remove('full');
    $('#todaySupport').replaceChildren(t('today.rest.support'));
  } else {
    $('#todayLead').textContent = t('today.lead', { name: me.first });
    const was = head.dataset.n;
    giant(head, `${t('today.of', { a: done, b: 4 })}.`); head.classList.toggle('full', done === 4); head.dataset.n = done;
    if (animate && was !== undefined && Number(was) !== done) lock(head);
    const miss = [];
    if (!today.habits[0]) miss.push(t('miss.0'));
    if (!today.habits[1]) miss.push(t(today.conversations >= 1 ? 'miss.1.one' : 'miss.1.two'));
    if (!today.habits[2]) miss.push(t('miss.2'));
    if (!today.habits[3]) miss.push(t('miss.3'));
    $('#todaySupport').replaceChildren(...(miss.length ? bold(t('today.missing', { n: miss.length }), `${joinList(miss)}.`) : bold(t('today.full'), t('today.full.s'))));
  }
  const hand = $('#hand');
  if (!hand.childElementCount) buildHand(hand);
  paintHand(hand, week.days, { wrist: week.anyLog, today: today.day, animate });
  $('#handCap').textContent = t('hand.caption', { a: week.marks, b: week.marksMax });

  // the weekly goal
  const box = $('#goalBox');
  box.hidden = !goal || !goal.options.length;
  if (!box.hidden) {
    $('#goalText').replaceChildren(...bold(t('goal.line', { goal: goalName(goal.picked, week.workFingers) }), goal.reached ? t('goal.reached') : t('goal.progress', { a: goal.fullFingers, b: goal.picked })),
      goalPick && goalPick.which === 'next' && !goalPick.isDefault ? ` ${t('goal.next.picked', { goal: goalName(goalPick.picked, goalPick.options.at(-1)) })}` : '');
    $('#goalBtn').hidden = readOnly() || !goalPick;
  }

  // the four habits
  const list = $('#habits');
  if (!list.childElementCount) for (let i = 0; i < 4; i += 1) list.append(h('li', {}, h('i', { class: 'j' }), h('span', { class: 't' }, h('span', { class: 'tt' }), h('small')), h('span', { class: 'n num' })));
  const counts = [[Math.min(today.visits, rules.habits.visits), rules.habits.visits], [Math.min(today.conversations, rules.habits.conversations), rules.habits.conversations],
    [Math.min(today.followups, rules.habits.followups), rules.habits.followups], [today.closed ? 1 : 0, 1]];
  [...list.children].forEach((li, i) => {
    const was = li.classList.contains('done');
    li.classList.toggle('done', !!today.habits[i]);
    $('.tt', li).textContent = t(`habit.${i}`);
    $('small', li).textContent = i === 3 ? t('habit.3.s', { time: by }) : t(`habit.${i}.s`);
    $('.n', li).textContent = `${counts[i][0]}/${counts[i][1]}`;
    if (animate && today.habits[i] && !was) lock($('.j', li));
  });

  // the week's outcomes
  const lenses = $('#lenses');
  if (!lenses.childElementCount) {
    lenses.append(
      src(lens('meetings', ''), () => t('c.source'), () => t('src.meetings', { goal: S.me.rules.goals.meetings })),
      src(lens('contract', ''), () => t('c.source'), () => t('src.contract', { goal: S.me.rules.goals.contracts })),
      src(lens('points', ''), () => t('c.source'), () => t('src.points')));
  }
  for (const id of ['meetings', 'contract', 'points']) $(`[data-lens="${id}"] .l`, lenses).textContent = t(`lens.${id}`);
  setLens($('[data-lens="meetings"]', lenses), week.counts.meetings, rules.goals.meetings);
  setLens($('[data-lens="contract"]', lenses), week.counts.contracts, rules.goals.contracts);
  setLens($('[data-lens="points"]', lenses), week.points, 0, t('u.pts'));

  renderRank(); renderCloseCard(); renderFeed($('#feed'), $('#feedEmpty'), animate); renderPlay();
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
  return () => h(tag, { class: 'trow' }, h('span', { class: 'pos num' }), h('span', { class: 'h' }), h('span', { class: 'who' }, h('b'), h('small')),
    h('span', { class: 'sc' }, h('span', { class: 'pts num' }, h('span', { class: 'pv' }), h('small')), h('span', { class: 'gap num' })), h('i', { class: 'vf', 'aria-hidden': 'true' }));
}
function paintRow(row, r, period, lead) {
  const ranked = r.place != null;
  row.classList.toggle('me', !!r.mine); row.classList.toggle('p1', r.place === 1); row.classList.toggle('open', !ranked);
  $('.pos', row).textContent = ranked ? String(r.place) : '·';
  $('.h', row).replaceChildren(miniHand(r.hand, rowWrist(r)));
  $('.who b', row).textContent = r.mine ? t('table.you', { name: r.first }) : r.name;
  $('.who small', row).replaceChildren(cityName(r.city), r.isNew ? h('span', { class: 'tag', text: t('table.new') }) : null);
  const pv = $('.pv', row), unit = $('.pts small', row), gap = $('.gap', row);
  if (!ranked) { delete pv.dataset.v; pv.textContent = num(r.marks); unit.textContent = `/${num(r.marksMax)}`; gap.textContent = t('u.marks'); }
  else if (period === 'month') { delete pv.dataset.v; pv.textContent = num(r.sites); unit.textContent = unitWord('u.sites', r.sites); gap.textContent = t('u.meetings', { n: r.meetings }); }
  else { countTo(pv, r.score); unit.textContent = t('u.pts'); gap.textContent = r.place === 1 ? t('table.gap.lead') : `−${num(lead - r.score)}`; }
}
/** The rows a rep may see with a number: the podium and their own. */
function shownRows(table) {
  const rows = [...table.podium];
  if (table.me && !table.me.onPodium) rows.push({ ...table.me, mine: true });
  return rows;
}
function renderRank() {
  const table = S.me.table.week, mine = table.me, title = $('#rsTitle');
  if (mine && mine.place != null) withEm(title, 'rank.place', { ord: ord(mine.place), n: table.ranked }, 'ord');
  else title.textContent = mine && mine.isNew ? t('rank.new', { n: 14 }) : t('rank.none');
  const lead = table.podium[0] ? table.podium[0].score : 0;
  flipList($('#rsRows'), shownRows(table), (r) => r.id, newRow('span'), (row, r) => paintRow(row, r, 'week', lead));
}
function renderTable() {
  const { table, team } = S.me, T = table[S.period], mine = T.me, period = S.period;
  const day = S.me.today ? S.me.today.day : S.me.serverTime.slice(0, 10), ws = S.me.week ? S.me.week.start : addDays(day, -((new Date(`${day}T12:00:00Z`).getUTCDay() + 6) % 7));
  $('#weekChip').textContent = `${upper(t('time.week', { n: isoWeek(day) }))} · ${upper(dayMonth(ws))} · ${upper(dayMonth(addDays(ws, 6)))}`;
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
  const lead = T.podium[0] ? T.podium[0].score : 0;
  flipList($('#tableRows'), shownRows(T), (r) => r.id, newRow('li'), (row, r) => paintRow(row, r, period, lead));
  $('#tableEmpty').hidden = T.ranked > 0;
  // Everyone else: alphabetical, with the marks of their hand and no place.
  $('#restLabel').hidden = !T.rest.length;
  $('#restRows').replaceChildren(...T.rest.map((r) => {
    const sc = src(h('button', { class: 'sc', type: 'button' }, h('span', { class: 'pts num' }, h('span', { class: 'pv', text: num(r.marks) }), h('small', { text: `/${num(r.marksMax)}` })), h('span', { class: 'gap', text: t('u.marks') })), () => t('c.source'), () => t('src.marks'));
    return h('li', { class: 'trow open' }, h('span', { class: 'pos num', text: '·', 'aria-hidden': 'true' }), h('span', { class: 'h' }, miniHand(r.hand, rowWrist(r))),
      h('span', { class: 'who' }, h('b', { text: r.name }), h('small', {}, cityName(r.city), r.isNew ? h('span', { class: 'tag', text: t('table.new') }) : null)), sc);
  }));
  // the team's shared number
  const tg = $('#teamgoal');
  if (!tg.childElementCount) tg.append(src(lens('team', ''), () => t('c.source'), () => t('src.team', { target: S.me.team.target, per: Math.round(S.me.team.target / Math.max(1, S.me.team.players)) })), h('p', {}, h('b'), h('span')));
  $('[data-lens="team"] .l', tg).textContent = t('lens.team');
  setLens($('[data-lens="team"]', tg), team.meetings, team.target);
  $('p b', tg).textContent = t('team.title');
  $('p span', tg).textContent = team.meetings >= team.target ? t('team.done') : t('team.p', { n: team.target - team.meetings });
  tg.hidden = !team.players;
}

// ---- closing the day ----
function renderCloseCard() {
  const { today, rules } = S.me, btn = $('#closeBtn');
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
  $('#closeErr').hidden = true;
  drawReport();
}
async function openClose() {
  if (readOnly()) return;
  baseReport = ''; paintCloseSheet(); openSheet($('#closeSheet'));
  try { const r = await api('POST', 'close', { preview: true, tomorrow: '', blocker: '' }); baseReport = r.report; drawReport(); }
  catch (e) { $('#closeErr').textContent = errText(e); $('#closeErr').hidden = false; }
}
function submitClose() {
  const btn = $('#closeSubmit'), err = $('#closeErr');
  return once(btn, async () => {
    err.hidden = true;
    if (S.me.today.closed) { toast(t((await copyText($('#slackText').textContent)) ? 'close.copied' : 'close.copy.fail')); return; }
    try {
      const res = await api('POST', 'close', { tomorrow: $('#fTomorrow').value.trim(), blocker: $('#fBlock').value.trim() });
      const was = S.me.today.points;
      baseReport = res.report; adopt(res.me); paintCloseSheet();
      if (!reduce) { const line = $('#slackPrev .scan'), height = $('#slackPrev').offsetHeight; line.animate([{ transform: 'translateY(0)', opacity: 1 }, { transform: `translateY(${height}px)`, opacity: 0 }], { duration: 620, easing: 'cubic-bezier(.2,.8,.2,1)' }); }
      renderAll(true);
      const gained = res.me.today.points - was;
      toast(t('close.toast'), gained > 0 ? t('pts.plus', { n: gained }) : '');
      $('#fTomorrow').value = ''; $('#fBlock').value = '';
    } catch (e) { err.textContent = errText(e); err.hidden = false; }
  });
}

// ---- the feed and the plays ----
function feedItem(f, fresh) {
  const clapBtn = h('button', { class: 'kudos', type: 'button', 'aria-pressed': String(!!f.clapped), 'aria-label': t('kudos.aria', { name: f.name }), disabled: f.mine || readOnly() }, icon('clap'), h('span', { class: 'num', text: String(f.kudos) }));
  clapBtn.addEventListener('click', () => clap(f, clapBtn));
  return h('li', { class: fresh ? 'new' : null }, h('span', {}, h('b', { text: f.name }), ` ${t(`feed.${f.code}`)}`, f.play ? h('q', { text: f.play }) : null,
    h('small', { text: `${cityName(f.city)} · ${ago(f.at, S.me.serverTime, tz())}` })),
  h('span', { class: 'side' }, f.pts ? h('span', { class: 'p', text: t('pts.plus', { n: f.pts }).replace(` ${t('u.pts')}`, '') }) : null, clapBtn));
}
function renderFeed(list, empty, animate) {
  const items = S.me.feed.slice(0, 12), seen = S.seenFeed;
  list.replaceChildren(...items.map((f) => feedItem(f, animate && !!seen && !seen.has(f.id))));
  S.seenFeed = new Set(S.me.feed.map((f) => f.id));
  empty.hidden = items.length > 0;
}
async function clap(f, btn) {
  const on = btn.getAttribute('aria-pressed') !== 'true', n = $('.num', btn);
  btn.setAttribute('aria-pressed', String(on)); n.textContent = String(Math.max(0, Number(n.textContent) + (on ? 1 : -1)));
  if (on) { buzz(8); lock($('svg', btn)); }
  try { const res = await api('POST', 'kudos', { target: f.id, on }); adopt(res.me); }
  catch (e) { btn.setAttribute('aria-pressed', String(!on)); n.textContent = String(Math.max(0, Number(n.textContent) + (on ? -1 : 1))); toast(errText(e)); }
}
function renderPlay() {
  const f = S.me.feed.find((x) => x.play && x.code !== 'badge'), card = $('#playCard');
  card.hidden = !f;
  if (!f) return;
  $('#playQ').textContent = f.play;
  $('#playBy').textContent = `${f.name} · ${cityName(f.city)} · ${t(`feed.${f.code}`)}`;
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
  $('#whoChip').textContent = `${me.name} · ${cityName(me.city)}`;
  giant($('#profileGiant'), `${t(`level.${level.name}`)}.`);
  const idx = rules.levels.findIndex((l) => l.name === level.name), steps = rules.levels[idx].steps, after = rules.levels[idx + 1];
  const life = src(h('button', { class: 'src num', type: 'button', text: num(level.xp) }), () => t('c.source'), () => t('src.life'));
  const next = level.next == null ? t('profile.top') : level.step < steps.length ? t('profile.next.step', { n: level.next - level.xp, s: level.step + 1 }) : t('profile.next.level', { n: level.next - level.xp, level: t(`level.${after.name}`) });
  $('#lvl').replaceChildren(levelBone(level, steps, after ? after.steps[0] : null),
    h('div', { class: 'row' }, h('span', {}, h('b', {}, life), ` ${unitWord('u.points', level.xp)} ${t('profile.life')}`), h('span', { text: `${t('profile.step', { a: level.step, b: steps.length })} · ${next}` })));

  $('#badges').replaceChildren(...badges.map((b) => {
    const levels = ONE_LEVEL.has(b.code) ? 1 : 3;
    const state = b.level === 0 ? (b.next > 1 ? t('badge.progress', { have: b.have, next: b.next }) : t('badge.state.todo'))
      : levels === 1 ? t('badge.state.done') : `${t('badge.state.level', { n: b.level })}${b.next ? ` · ${t('badge.progress', { have: b.have, next: b.next })}` : ''}`;
    return src(h('button', { class: `badge${b.level === 0 ? ' locked' : ''}`, type: 'button' }, badgeGlyph(b.code, b.level, levels), h('b', { text: t(`badge.${b.code}`) }), h('small', { text: state })),
      () => t(`badge.${b.code}`), () => t(`badge.info.${b.code}`));
  }));

  const heldSet = new Map(pending.map((p) => [`${p.logId}:${p.code}`, p]));
  $('#ledger').replaceChildren(...ledger.map((e) => {
    const waiting = e.status === 'pending', gone = e.status === 'expired', when = stamp(e.at, tz());
    const row = src(h('button', { class: 'rowsrc', type: 'button' }, t(`led.${e.code}`), h('small', {}, e.lead ? t('led.meta.lead', { lead: e.lead.name, when }) : when, waiting || gone ? h('span', { class: 'st', text: ` · ${t(`st.${e.status}`)}` }) : null)),
      () => t('c.source'), () => t(`ledsrc.${e.code}`, { pts: pts(e.pts), cap: rules.caps.messagesPerDay, days: rules.pendingDays, time: hourName(rules.closeBy) }));
    let act = null;
    const p = heldSet.get(`${e.logId}:${e.code}`);
    if (readOnly() && e.logId && e.code !== 'day_closed') act = h('button', { class: 'mini-btn', type: 'button', text: t('needs.btn.void'), 'aria-label': t('void.row'), onclick: () => manager.voidLog(e.logId) });
    else if (waiting && e.code === 'meeting_held' && p) {
      act = p.held ? h('small', { text: t('profile.held.done') }) : h('button', { class: 'mini-btn', type: 'button', text: t('profile.held'), onclick: (ev) => once(ev.currentTarget, async () => {
        try { const res = await api('POST', 'held', { logId: e.logId }); adopt(res.me); renderAll(false); toast(t('profile.held.toast')); } catch (err) { toast(errText(err)); }
      }) });
    }
    return h('li', { class: waiting ? 'pend' : gone ? 'gone' : null }, h('span', { class: 'p', text: `+${num(e.pts)}` }), row, act);
  }));
  $('#ledgerEmpty').hidden = ledger.length > 0;

  const box = $('#settings');
  if (readOnly()) {
    box.replaceChildren(h('div', { class: 'line' }, h('span', { text: t('profile.user', { handle: me.handle }) })),
      h('button', { class: 'btn', type: 'button', text: t('reps.badge'), onclick: () => manager.giveBadge(me) }));
  } else {
    box.replaceChildren(h('div', { class: 'line' }, h('span', { text: t('profile.user', { handle: me.handle }) })),
      h('button', { class: 'btn', type: 'button', text: t('profile.rules'), 'data-open': 'rulesSheet' }),
      h('button', { class: 'btn', type: 'button', text: t('profile.signout'), onclick: signOut }));
  }
}
function renderRules() {
  const r = S.me.rules, by = hourName(r.closeBy);
  $('#rules').replaceChildren(...Object.entries(LEDGER_RULE).map(([code, key]) => h('li', {}, h('b', { class: 'num', text: t('pts.plus', { n: r.points[key] }).slice(1) }),
    h('span', {}, t(`led.${code}`), h('small', { text: t(`rules.note.${code}`, { cap: r.caps.messagesPerDay, time: by }) })))));
  $('#rulesStreak').textContent = t('rules.streak', { n: r.spares });
}

// ---- logging a contact ----
const L = { lead: null, kind: null, channel: null, voicemail: false, tag: null, contact: '', when: '', note: '', more: false, q: '', found: null, searching: 0 };
function openLog() {
  if (S.me.today.closed) { toast(t('log.closed')); return; }
  Object.assign(L, { lead: null, kind: null, channel: null, voicemail: false, tag: null, contact: '', when: '', note: '', more: false, q: '', found: null });
  $('#leadQ').value = ''; $('#newName').value = ''; $('#newZone').value = '';
  renderLog(); openSheet($('#logSheet'));
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
  } }, icon(k), h('b', { text: t(`kind.${k}`) }), h('span', { class: 'pp', text: hint(k) }))));
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
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''));
function saveLog() {
  if (!logReady()) return undefined;
  keepFields();
  const body = { id: newId(), kind: L.kind, clientAt: new Date().toISOString(), lead: L.lead.isNew ? { name: $('#newName').value.trim(), zone: $('#newZone').value.trim() } : { id: L.lead.id } };
  if (L.channel) body.channel = L.channel;
  if (L.voicemail) body.voicemail = true;
  if (L.tag) body.tag = L.tag;
  for (const k of ['contact', 'when', 'note']) if (L[k]) body[k] = L[k];
  return once($('#saveLog'), async () => {
    closeSheet($('#logSheet')); setTab('today');
    try { const res = await api('POST', 'log', body); setTimeout(() => logged(res, body), reduce ? 0 : 260); }
    catch (e) {
      if (e.code === 'offline') { S.queue.push(body); store.set(KEY.queue, S.queue); renderTop(); toast(t('toast.queued')); }
      else if (e.status === 401) lostSession();
      else toast(errText(e));
    }
  });
}
function logged(res, body) {
  adopt(res.me); renderAll(true);
  const label = t(`kind.${body.kind}`);
  if (res.repeat) toast(t('toast.repeat'));
  else {
    const follow = res.me.ledger.some((e) => e.logId === res.logId && e.code === 'followup');
    const bits = [label + (follow ? ` · ${t('toast.followup')}` : '')];
    if (res.pending > 0) bits.push(t('toast.pending', { n: res.pending }));
    let text = bits.join(' · ');
    if (res.streakUp) text += `. ${t('toast.streak', { n: res.me.streak.current })}`;
    if (res.gained > 0 || res.pending > 0) toast(text, res.gained > 0 ? t('pts.plus', { n: res.gained }) : ''); else toast(t('toast.zero'));
  }
  const after = () => { if (body.kind === 'meeting' && !res.repeat) askPlay(res.logId); };
  if (res.tookLead) setTimeout(() => lockOn(after), reduce ? 0 : 760); else setTimeout(after, 1400);
}

// ---- the one rare moment: taking the lead ----
function lockOn(done) {
  const box = $('#lockon'), T = S.me.table.week, back = document.activeElement;
  $('#loN').textContent = ord(1);
  $('#loS').textContent = T.behind ? t('lockon.s.behind', { name: T.behind.name, gap: pts(T.behind.pts) }) : t('lockon.s');
  box.classList.add('on'); box.setAttribute('aria-hidden', 'false'); box.tabIndex = 0; box.focus({ preventScroll: true });
  buzz([14, 60, 22]);
  let timer;
  const off = () => {
    clearTimeout(timer); box.classList.remove('on'); box.setAttribute('aria-hidden', 'true'); box.tabIndex = -1;
    box.removeEventListener('click', off); document.removeEventListener('keydown', onKey);
    if (back && back.focus) back.focus({ preventScroll: true });
    if (done) setTimeout(done, 300);
  };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); off(); } };
  box.addEventListener('click', off); document.addEventListener('keydown', onKey);
  timer = setTimeout(off, 3600);
}

// ---- logs that wait for signal ----
let flushing = false;
async function flush() {
  if (flushing || !S.queue.length || !S.me || readOnly()) return;
  flushing = true;
  let sent = 0;
  try {
    while (S.queue.length) {
      try { await api('POST', 'log', S.queue[0]); sent += 1; }
      catch (e) {
        if (e.code === 'offline') break;
        if (e.status === 401) { lostSession(); break; }
        toast(t('toast.dropped', { why: errText(e) }));   // refused for good: it leaves the queue with the reason shown
      }
      S.queue.shift(); store.set(KEY.queue, S.queue);
    }
  } finally { flushing = false; }
  renderTop();
  if (sent) { await refresh(true); toast(t('toast.sent', { n: sent })); }
}

// ---- session ----
function adopt(me) { S.me = me; S.lastLoad = Date.now(); if (!readOnly()) store.set(KEY.me, me); }
function enter(me) {
  S.me = me; S.lastLoad = Date.now();
  if (!S.as || me.viewer.role === 'rep') S.as = me.viewer.as;   // a rep's `as` is ignored by the server
  const own = S.as ? me.viewer.lang : me.me.lang;
  if (own && own !== lang()) { setLang(own); store.set(KEY.lang, own); applyStatic(); }
  S.mgr = !S.as && me.viewer.role !== 'rep';
  document.body.classList.remove('bare'); document.body.classList.toggle('mgr', S.mgr);
  if (!readOnly()) store.set(KEY.me, me);
  S.seenFeed = null;
  const first = S.mgr ? 'team' : 'today';
  if (S.mgr) { manager.load().then(() => { renderAll(false); }).catch((e) => toast(errText(e))); }
  renderAll(false); setTab(S.tab && $(`#nav [data-tab="${S.tab}"]`) ? S.tab : first);
  flush();
}
async function refresh(animate = false) {
  try {
    const me = await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me');
    adopt(me);
    if (S.mgr) await manager.load();
    renderAll(animate);
  } catch (e) { if (e.status === 401) lostSession(); }
}
function showAuth(message = '') {
  S.me = null; document.body.classList.add('bare'); document.body.classList.remove('mgr');
  $('#nav').hidden = true; renderTop(); show('auth');
  const err = $('#authErr'); err.textContent = message; err.hidden = !message;
}
function lostSession() { store.del(KEY.me); showAuth(t('err.session')); }
async function signOut() {
  try { await api('POST', 'logout', {}); } catch { /* signing out of this phone works even without signal: the next call will ask for the PIN */ }
  store.del(KEY.me); S.tab = null; showAuth();
}
async function start() {
  const url = new URL(location.href);
  if (url.pathname.replace(/\/$/, '').endsWith('/alta')) return showSetup(url.searchParams.get('t') || '');
  S.as = url.searchParams.get('as');
  try { enter(await api('GET', S.as ? `me?as=${encodeURIComponent(S.as)}` : 'me')); }
  catch (e) {
    const cached = store.get(KEY.me, null);
    if (e.code === 'offline' && cached && !S.as) { enter(cached); toast(t('err.offline')); }
    else if (e.status === 401) showAuth();
    else showAuth(errText(e));
  }
  return undefined;
}
function signIn(e) {
  e.preventDefault();
  const err = $('#authErr');
  return once($('#authBtn'), async () => {
    err.hidden = true;
    try { await api('POST', 'login', { handle: $('#aHandle').value, pin: $('#aPin').value }); $('#aPin').value = ''; await start(); }
    catch (ex) { err.textContent = errText(ex); err.hidden = false; $('#aPin').value = ''; $('#aPin').focus(); }
  });
}
async function showSetup(token) {
  document.body.classList.add('bare'); show('setup');
  const form = $('#setupForm'), err = $('#setupErr');
  const expired = () => { giant($('#setupGiant'), t('setup.expired.title')); $('#setupLead').textContent = ''; $('#setupSupport').textContent = t('err.link_expired'); form.hidden = true; $('#setupToLogin').hidden = false; };
  try {
    const who = await api('GET', `setup?t=${encodeURIComponent(token)}`);
    if (!store.get(KEY.lang, null) && who.lang !== lang()) { setLang(who.lang); applyStatic(); renderTop(); }
    $('#setupLead').textContent = t('setup.lead', { name: who.first });
    giant($('#setupGiant'), t('setup.title'));
    $('#setupSupport').textContent = t('setup.support', { handle: who.handle });
  } catch (e) { if (e.status === 410) expired(); else { giant($('#setupGiant'), t('setup.title')); err.textContent = errText(e); err.hidden = false; } }
  form.onsubmit = (e) => {
    e.preventDefault();
    once($('#setupBtn'), async () => {
      err.hidden = true;
      const pin = $('#sPin').value, again = $('#sPin2').value;
      if (pin !== again) { err.textContent = t('setup.mismatch'); err.hidden = false; return; }
      try { await api('POST', 'setup', { token, pin }); history.replaceState(null, '', '/equipo'); $('#sPin').value = ''; $('#sPin2').value = ''; await start(); }
      catch (ex) { if (ex.status === 410) expired(); else { err.textContent = errText(ex); err.hidden = false; } }
    });
  };
}

// ---- wiring ----
const manager = createManager({ api, S, t, errText, refresh, renderAll, feedItem, renderFeed, adopt, readOnly });
function wire() {
  initPop(); initSheets();
  $('#home').addEventListener('click', (e) => { if (!S.me || S.as) return; e.preventDefault(); setTab(S.mgr ? 'team' : 'today'); });
  $('#langSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-lang]'); if (b) switchLang(b.dataset.lang); });
  src($('#streakChip'), () => t('top.streak'), () => { const st = S.me.streak; return t('src.streak', { spares: st.spares, max: S.me.rules.spares, best: t('u.days', { n: st.best }) }); });
  $('#queueChip').addEventListener('click', flush);
  $('#authForm').addEventListener('submit', signIn);
  document.addEventListener('click', (e) => { const o = e.target.closest('[data-open]'); if (o) openSheet($(`#${o.dataset.open}`)); });
  $('#hand').addEventListener('click', (e) => { const hit = e.target.closest('.hit'); if (hit) { e.stopPropagation(); fingerDetail(hit); } });
  $('#hand').addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('hit')) { e.preventDefault(); fingerDetail(e.target); } });
  $('#goalBtn').addEventListener('click', openGoal);
  $('#rankstrip').addEventListener('click', () => setTab('table'));
  $('#tableSeg').addEventListener('click', (e) => { const b = e.target.closest('button[data-period]'); if (!b) return; S.period = b.dataset.period; quiet(renderTable); });
  $('#closeBtn').addEventListener('click', openClose);
  $('#closeSubmit').addEventListener('click', submitClose);
  for (const id of ['#fTomorrow', '#fBlock']) $(id).addEventListener('input', drawReport);
  $('#leadQ').addEventListener('input', onSearch);
  $('#newName').addEventListener('input', paintLogFoot);
  $('#moreOuts').addEventListener('click', () => { L.more = !L.more; keepFields(); renderLog(); });
  $('#saveLog').addEventListener('click', saveLog);
  addEventListener('online', flush);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && S.me) { flush(); if (Date.now() - S.lastLoad > 45000) refresh(true); } });
  // The table and the feed stay current while the app is open and nobody is in the middle of a form.
  setInterval(() => { if (S.me && !document.hidden && !$('dialog[open]')) { if (S.queue.length) flush(); else if (Date.now() - S.lastLoad > 45000) refresh(true); } }, 15000);
}

setLang(store.get(KEY.lang, null) || ((navigator.language || 'es').toLowerCase().startsWith('en') ? 'en' : 'es'));
applyStatic(); grain(); wire(); renderTop();
start();
