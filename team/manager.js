// manager.js: what a manager sees. Every rep in one view, the things that wait for a decision, and the people who have access.
// The headline of the team view is a live number (days closed today), and the rows that need attention are framed.
import { $, h, put, t, num, ord, wdShort, dayMonth, upper, isoWeek, addDays, dayOf, clock, stamp, ago, cityName, countTo, flipList, toast, src, once, copyText, formSheet, quiet } from './ui.js';
import { miniHand, lens, setLens } from './hand.js';

const MONDAY = '2026-11-16';   // any Monday: only used to name the days of the week
const dayName = (n) => wdShort(addDays(MONDAY, n - 1));

export function createManager({ api, S, errText, refresh, renderAll, renderFeed, signOut }) {
  let team = null, city = 'all';
  const tzOf = (rep) => (rep && rep.tz) || S.me.me.tz;
  const repById = (id) => team.reps.find((r) => r.id === id) || team.others.find((r) => r.id === id);
  const isAdmin = () => S.me.viewer.role === 'admin';

  async function load() { team = await api('GET', 'team'); }
  const needsCount = () => (team ? team.needs.confirm.length + team.needs.silent.length + team.needs.late.length + team.needs.pace.length : 0);
  /** Run a manager action: the answer is the new team view. The feed and the tables follow from a fresh read. */
  const act = (btn, call, okKey) => once(btn, async () => {
    try { const res = await call(); if (res && res.reps) team = res; renderAll(false); if (okKey) toast(t(okKey)); refresh(false); } catch (e) { toast(errText(e)); }
  });

  // ---- the team ----
  function flagsOf(rep) {
    const out = [], n = team.needs, c = n.confirm.filter((x) => x.rep === rep.id).length;
    if (n.silent.some((x) => x.rep === rep.id)) out.push(t('mgr.flag.silent'));
    if (n.pace.some((x) => x.rep === rep.id)) out.push(t('mgr.flag.pace'));
    if (c) out.push(t('mgr.flag.confirm', { n: c }));
    if (n.late.some((x) => x.rep === rep.id)) out.push(t('mgr.flag.late'));
    return out;
  }
  const COLS = ['visits', 'convs', 'meetings', 'contracts', 'points', 'streak', 'report', 'last'];
  function newRow() {
    return h('li', { class: 'brow' }, h('span', { class: 'pos num' }),
      h('span', { class: 'who' }, h('b'), h('small'), h('span', { class: 'flags' })), h('span', { class: 'h' }),
      h('span', { class: 'cells' }, COLS.map((c) => h('span', { class: `m r c-${c}` }, h('span', { class: 'cell-l' }), h('span', { class: 'cv num' })))),
      h('span', { class: 'act' }, h('a', { class: 'mini-btn' })), h('i', { class: 'vf', 'aria-hidden': 'true' }));
  }
  function paintRow(row, r) {
    const zone = tzOf(r), g = team.goals, flags = flagsOf(r), w = r.week.counts;
    row.classList.toggle('p1', r.place === 1); row.classList.toggle('flagged', flags.length > 0);
    const pos = $('.pos', row); pos.textContent = r.place ? ord(r.place) : t('mgr.noplace'); pos.classList.toggle('none', !r.place);
    $('.who b', row).textContent = r.name;
    $('.who small', row).replaceChildren(cityName(r.city), r.isNew ? ` · ${t('table.new')}` : '');
    $('.flags', row).replaceChildren(...flags.map((f) => h('span', { class: 'chip', text: f })));
    $('.h', row).replaceChildren(miniHand(r.week.days, r.week.marks > r.week.days.reduce((a, d) => a + d.marks, 0)));
    const set = (col, label, nodes) => { const cell = $(`.c-${col}`, row); $('.cell-l', cell).textContent = label; $('.cv', cell).replaceChildren(...[nodes].flat()); };
    const frac = (a, b) => [num(a), h('small', { text: `/${num(b)}` })];
    set('visits', t('col.visits'), frac(w.visits, g.visits));
    set('convs', t('col.convs'), frac(w.conversations, g.conversations));
    set('meetings', t('col.meetings'), frac(w.meetings, g.meetings));
    set('contracts', t('col.contracts'), frac(w.contracts, g.contracts));
    const pcell = $('.c-points', row); $('.cell-l', pcell).textContent = t('col.points'); $('.cv', pcell).classList.add('pts'); countTo($('.cv', pcell), r.week.points);
    set('streak', t('col.streak'), t('u.days', { n: r.streak.current }));
    const rep = r.today.isWork ? (r.today.closed ? t('mgr.report.closed', { time: clock(r.today.closedAt, zone) }) : t('mgr.report.open')) : t('mgr.report.rest');
    set('report', t('col.report'), rep); $('.c-report .cv', row).classList.toggle('ok', !!r.today.closed);
    set('last', t('col.last'), r.today.lastLogAt ? ago(r.today.lastLogAt, team.serverTime, zone) : t('mgr.last.none'));
    const link = $('.act a', row); link.href = `/equipo?as=${encodeURIComponent(r.id)}`; link.textContent = t('mgr.viewas.row'); link.setAttribute('aria-label', t('mgr.viewas', { name: r.first }));
  }
  function renderTeam(animate) {
    const tn = team.team, day = dayOf(team.serverTime, S.me.me.tz);
    $('#teamDateChip').textContent = `${upper(wdShort(day))} ${upper(dayMonth(day))} · ${upper(t('time.week', { n: isoWeek(day) }))}`;
    $('#teamSampleChip').hidden = !S.me.sample;
    $('#teamGiant').replaceChildren(src(h('button', { class: 'src', type: 'button', text: t('mgr.of', { a: tn.closedToday, b: tn.working }) }), () => t('c.source'), () => t('src.mgr.closed')), h('em', { text: '.' }));
    $('#teamSupport').textContent = t('mgr.support', { w: tn.working, p: tn.players, m: tn.meetings, t: tn.target });
    const box = $('#teamLenses');
    if (!box.childElementCount) box.append(src(lens('meetings', ''), () => t('c.source'), () => t('src.team', { target: team.team.target, per: Math.round(team.team.target / Math.max(1, team.team.players)) })), lens('contracts', ''), src(lens('closed', ''), () => t('c.source'), () => t('src.mgr.closed')));
    const contracts = team.reps.reduce((a, r) => a + r.week.counts.contracts, 0);
    $('[data-lens="meetings"] .l', box).textContent = t('col.meetings'); $('[data-lens="contracts"] .l', box).textContent = t('col.contracts'); $('[data-lens="closed"] .l', box).textContent = t('col.report');
    setLens($('[data-lens="meetings"]', box), tn.meetings, tn.target);
    setLens($('[data-lens="contracts"]', box), contracts, team.goals.contracts * tn.players);
    setLens($('[data-lens="closed"]', box), tn.closedToday, tn.working);

    const cities = [...new Set(team.reps.map((r) => r.city).filter(Boolean))].sort();
    if (city !== 'all' && !cities.includes(city)) city = 'all';
    const seg = $('#citySeg'); seg.parentElement.hidden = cities.length < 2;
    seg.replaceChildren(...[['all', t('mgr.filter.all')], ...cities.map((c) => [c, cityName(c)])].map(([id, label]) => h('button', { type: 'button', 'aria-pressed': String(city === id), text: label, onclick: () => { city = id; quiet(() => renderTeam(false)); } })));

    const table = $('#teamTable');
    if (!table.childElementCount) table.append(h('div', { class: 'bt-h', 'aria-hidden': 'true' }), h('ol', { class: 'tower', id: 'teamRows' }));
    $('.bt-h', table).replaceChildren(h('span', { text: t('col.place') }), h('span', { text: t('col.rep') }), h('span', { text: t('col.hand') }), ...COLS.map((c) => h('span', { class: 'r', text: t(`col.${c}`) })), h('span'));
    $('#teamRows').setAttribute('aria-label', t('mgr.table.aria'));
    const rows = team.reps.filter((r) => city === 'all' || r.city === city).sort((a, b) => (a.place ?? 1e9) - (b.place ?? 1e9));
    const draw = () => flipList($('#teamRows'), rows, (r) => r.id, newRow, paintRow);
    if (animate) draw(); else quiet(draw);
    $('#teamEmpty').hidden = team.reps.length > 0; table.hidden = !team.reps.length;
    renderFeed($('#teamFeed'), $('#teamFeedEmpty'), animate);
  }

  // ---- needs me ----
  /** A date typed in a date field, as a person reads it: jue 19 nov. Anything else is shown as typed. */
  const niceDay = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(v) ? `${wdShort(v)} ${dayMonth(v)}` : v);
  const group = (titleKey, items, emptyKey, extra = null, counted = true) => h('section', { class: 'group' },
    h('h2', {}, t(titleKey), counted && items.length ? [' ', h('span', { class: 'count num', text: String(items.length) })] : null),
    items.length ? h('ul', { class: 'items' }, items) : h('p', { class: 'note', text: t(emptyKey) }), extra);
  const copyBtn = (text) => h('button', { class: 'mini-btn', type: 'button', text: t('needs.msg.copy'), onclick: async () => toast(t((await copyText(text)) ? 'c.copied' : 'close.copy.fail')) });
  function voidLog(logId) {
    formSheet({ title: t('needs.void.title'), intro: t('needs.void.p'), submit: t('needs.void.submit'),
      fields: [{ name: 'reason', label: t('needs.void.reason'), placeholder: t('needs.void.reason.ph'), max: 200 }],
      onSubmit: async (v) => { const res = await api('POST', 'void', { logId, reason: v.reason }); team = res; toast(t('needs.voided')); await refresh(false); } });
  }
  function giveBadge(rep) {
    formSheet({ title: t('reps.badge.title'), intro: t('reps.badge.p'), submit: t('reps.badge.submit'),
      fields: [{ name: 'text', type: 'textarea', label: t('reps.badge.text'), placeholder: t('reps.badge.ph'), max: 140 }],
      onSubmit: async (v) => { const res = await api('POST', 'badge', { rep: rep.id, text: v.text }); team = res; toast(t('reps.badge.done')); await refresh(false); } });
  }
  function renderNeeds() {
    const n = team.needs, total = needsCount(), head = $('#needsGiant');
    if (total) head.replaceChildren(num(total), h('em', { text: '.' })); else head.replaceChildren(t('needs.zero').slice(0, -1), h('em', { text: '.' }));
    head.classList.toggle('word', !total);
    const confirm = n.confirm.map((x) => h('li', {},
      h('span', {}, h('b', { text: t(`needs.what.${x.what}`, { lead: x.lead.name }) }), h('small', { text: `${x.name} · ${stamp(x.at, tzOf(repById(x.rep)))}` }),
        x.held ? h('small', { text: t('needs.held') }) : null, x.when ? h('small', { text: t('needs.when', { when: niceDay(x.when) }) }) : null, x.contact ? h('small', { text: t('needs.contact', { contact: x.contact }) }) : null),
      h('span', { class: 'acts' },
        h('button', { class: 'mini-btn primary', type: 'button', text: t(`needs.btn.${x.what}`), onclick: (e) => act(e.currentTarget, () => api('POST', 'confirm', { logId: x.logId, what: x.what }), 'needs.confirmed') }),
        h('button', { class: 'mini-btn', type: 'button', text: t('needs.btn.void'), onclick: () => voidLog(x.logId) }))));
    const silent = n.silent.map((x) => { const msg = t('needs.msg.silent', { name: x.name.split(' ')[0] }); return h('li', {},
      h('span', {}, h('b', { text: x.name }), h('small', { text: x.lastLogAt ? t('needs.silent.last', { when: ago(x.lastLogAt, team.serverTime, tzOf(repById(x.rep))) }) : t('needs.silent.never') })),
      h('span', { class: 'acts' }, copyBtn(msg)), h('p', { class: 'msg', lang: 'es', text: msg })); });
    const late = n.late.map((x) => { const zone = tzOf(repById(x.rep)); return h('li', {},
      h('span', {}, h('b', { text: `${x.name} · ${t(`kind.${x.kind}`)}` }), h('small', { text: x.lead.name }), h('small', { text: t('needs.late.meta', { server: stamp(x.at, zone), client: x.clientAt ? stamp(x.clientAt, zone) : '?' }) })),
      h('span', { class: 'acts' }, h('button', { class: 'mini-btn', type: 'button', text: t('needs.btn.void'), onclick: () => voidLog(x.logId) }))); });
    const pace = n.pace.map((x) => { const msg = t('needs.msg.pace', { name: x.name.split(' ')[0], a: x.marks, b: x.possible }); return h('li', {},
      h('span', {}, h('b', { text: x.name }), h('small', { text: t('needs.pace.item', { a: x.marks, b: x.possible }) })),
      h('span', { class: 'acts' }, copyBtn(msg)), h('p', { class: 'msg', lang: 'es', text: msg })); });
    const sites = team.sites.map((s) => { const rep = repById(s.rep), zone = tzOf(rep); return h('li', {},
      h('span', {}, h('b', { text: s.lead.name }), h('small', { text: `${rep ? rep.name : ''} · ${stamp(s.at, zone)}` }),
        ['installed', 'first_hour'].filter((k) => s.steps[k]).map((k) => h('small', { text: `${t(`needs.sites.${k}`)}: ${stamp(s.steps[k], zone)}` }))),
      h('span', { class: 'acts' }, ['installed', 'first_hour'].filter((k) => !s.steps[k]).map((k) =>
        h('button', { class: 'mini-btn', type: 'button', text: t(`needs.sites.mark.${k}`), onclick: (e) => act(e.currentTarget, () => api('POST', `site/${encodeURIComponent(s.id)}`, { what: k }), 'needs.sites.done') })))); });
    const addSite = h('button', { class: 'btn', type: 'button', text: t('needs.sites.add'), disabled: !team.reps.length, onclick: () => formSheet({ title: t('needs.sites.title'), submit: t('needs.sites.submit'),
      fields: [{ name: 'rep', type: 'select', label: t('needs.sites.rep'), options: team.reps.map((r) => ({ value: r.id, label: r.name })) }, { name: 'name', label: t('needs.sites.name') }],
      onSubmit: async (v) => { team = await api('POST', 'site', { rep: v.rep, lead: { name: v.name } }); toast(t('needs.sites.added')); await refresh(false); } }) });
    $('#needsBody').replaceChildren(
      h('div', {}, group('needs.confirm.title', confirm, 'needs.confirm.empty'), group('needs.late.title', late, 'needs.late.empty'), group('needs.sites.title', sites, 'needs.sites.empty', h('p', { class: 'note' }, addSite), false)),
      h('div', {}, group('needs.silent.title', silent, 'needs.silent.empty'), group('needs.pace.title', pace, 'needs.pace.empty'), (silent.length || pace.length) ? h('p', { class: 'note', text: t('needs.msg.note') }) : null));
  }

  // ---- reps ----
  function showLink(name, url) {
    formSheet({ title: t('reps.link.title'), intro: t('reps.link.p', { name }), body: h('div', { class: 'linkbox', text: url }), submit: t('reps.link.copy'), note: t('reps.link.once'),
      onSubmit: async () => { toast(t((await copyText(url)) ? 'reps.link.copied' : 'close.copy.fail')); return true; } });
  }
  function repForm(rep = null) {
    const today = dayOf(team.serverTime, S.me.me.tz);
    const fields = [{ name: 'name', label: t('reps.form.name'), value: rep ? rep.name : '', max: 80 }];
    if (!rep) fields.push({ name: 'handle', label: t('reps.form.handle'), hint: t('reps.form.handle.hint'), lower: true, max: 40 });
    fields.push({ name: 'city', label: t('reps.form.city'), hint: t('reps.form.city.hint'), value: rep ? rep.city : 'Panama City', max: 60 },
      { name: 'country', type: 'select', label: t('reps.form.country'), value: rep ? rep.country : 'PA', options: ['PA', 'CO'].map((c) => ({ value: c, label: t(`country.${c}`) })) },
      { name: 'startDate', type: 'date', label: t('reps.form.start'), value: rep ? rep.startDate : today },
      { name: 'workdays', type: 'days', label: t('reps.form.workdays'), value: rep ? rep.workdays : [1, 2, 3, 4, 5], options: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ value: n, label: dayName(n) })) });
    if (!rep && isAdmin()) fields.push({ name: 'role', type: 'select', label: t('reps.form.role'), value: 'rep', options: ['rep', 'manager', 'admin'].map((r) => ({ value: r, label: t(`role.${r}`) })) });
    formSheet({ title: t(rep ? 'reps.edit.title' : 'reps.add.title'), submit: t(rep ? 'reps.form.save' : 'reps.form.submit'), fields,
      onSubmit: async (v) => {
        if (rep) { team = await api('POST', `reps/${encodeURIComponent(rep.id)}`, { patch: { name: v.name, city: v.city, country: v.country, startDate: v.startDate, workdays: v.workdays } }); toast(t('reps.saved')); renderAll(false); return false; }
        const res = await api('POST', 'reps', { handle: v.handle.toLowerCase(), name: v.name, city: v.city, country: v.country, startDate: v.startDate, workdays: v.workdays, role: v.role });
        showLink(v.name.split(' ')[0], res.setupUrl); refresh(false);
        return true;
      } });
  }
  function newLink(btn, rep) {
    if (!btn.classList.contains('armed')) { btn.classList.add('armed'); toast(t('reps.newlink.confirm')); setTimeout(() => btn.classList.remove('armed'), 6000); return; }
    btn.classList.remove('armed');
    once(btn, async () => { try { const res = await api('POST', `reps/${encodeURIComponent(rep.id)}/link`, {}); showLink(rep.first, res.setupUrl); refresh(false); } catch (e) { toast(errText(e)); } });
  }
  function dayOff() {
    const today = dayOf(team.serverTime, S.me.me.tz), countries = [...new Set(team.reps.map((r) => r.country))];
    formSheet({ title: t('reps.dayoff.title'), intro: t('reps.dayoff.p'), submit: t('reps.dayoff.submit'),
      fields: [{ name: 'date', type: 'date', label: t('reps.dayoff.date'), value: today },
        { name: 'scope', type: 'select', label: t('reps.dayoff.scope'), value: 'all', options: [{ value: 'all', label: t('reps.dayoff.all') }, ...countries.map((c) => ({ value: c, label: t('reps.dayoff.country', { country: t(`country.${c}`) }) })), ...team.reps.map((r) => ({ value: r.id, label: r.name }))] }],
      onSubmit: async (v) => { team = await api('POST', 'dayoff', { scope: v.scope, date: v.date }); toast(t('reps.dayoff.done')); await refresh(false); } });
  }
  function repItem(r, isPlayer) {
    const status = !r.active ? t('reps.inactive') : r.hasPin ? t('reps.pin.ok') : r.setupPending ? t('reps.pin.pending') : t('reps.pin.none');
    const days = r.workdays.map(dayName).join(' ');
    const canTouch = isPlayer || isAdmin(), self = r.id === S.me.viewer.id;
    return h('li', {},
      h('span', {}, h('b', { text: r.name }), h('small', { text: `${r.handle} · ${isPlayer ? '' : `${t(`role.${r.role}`)} · `}${cityName(r.city)} · ${t('reps.start', { date: dayMonth(r.startDate) })} · ${days}` }), h('small', { text: status })),
      h('span', { class: 'acts' },
        isPlayer ? h('a', { class: 'mini-btn', href: `/equipo?as=${encodeURIComponent(r.id)}`, text: t('mgr.viewas', { name: r.first }) }) : null,
        canTouch && r.role === 'rep' ? h('button', { class: 'mini-btn', type: 'button', text: t('reps.edit'), onclick: () => repForm(r) }) : null,
        canTouch && !self && r.active ? h('button', { class: 'mini-btn', type: 'button', text: t('reps.newlink'), onclick: (e) => newLink(e.currentTarget, r) }) : null,
        canTouch && !self ? h('button', { class: 'mini-btn', type: 'button', text: t(r.active ? 'reps.deactivate' : 'reps.activate'), onclick: (e) => act(e.currentTarget, () => api('POST', `reps/${encodeURIComponent(r.id)}`, { patch: { active: !r.active } }), 'reps.saved') }) : null));
  }
  function renderReps() {
    $('#repsGiant').replaceChildren(num(team.reps.length), h('em', { text: '.' }));
    put($('#repsBody'),
      team.reps.length ? h('ul', { class: 'items' }, team.reps.map((r) => repItem(r, true))) : h('p', { class: 'note', text: t('mgr.none') }),
      team.others.length ? h('section', { class: 'group' }, h('h2', { text: t('reps.others') }), h('ul', { class: 'items' }, team.others.map((r) => repItem(r, false)))) : null,
      h('section', { class: 'group' }, h('h2', { text: t('profile.settings') }), h('div', { class: 'settings' },
        h('div', { class: 'line' }, h('span', { text: t('profile.user', { handle: S.me.me.handle }) }), h('button', { class: 'mini-btn', type: 'button', text: t('profile.signout'), onclick: signOut })))));
  }

  function render(animate = false) {
    if (!team) return;
    renderTeam(animate); renderNeeds(); renderReps();
    $('#dayoffBtn').onclick = dayOff; $('#addRepBtn').onclick = () => repForm();
  }
  return { load, render, needsCount, voidLog, giveBadge };
}
