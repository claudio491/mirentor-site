// manager.js: what a manager sees. Every rep in one view, the things that wait for a decision, and the people who have access.
// The headline of the team view is a live number (days closed today), and the rows that need attention are framed.
import { $, h, put, t, num, ord, wdShort, dayMonth, upper, isoWeek, addDays, dayOf, clock, stamp, ago, cityName, countTo, flipList, toast, src, once, copyText, formSheet, quiet, newId, sameText, face, putFace } from './ui.js';
import { miniHand, lens, setLens, portrait, setPortrait } from './hand.js';
import { STOPS } from './stops.js';
import { shortNames } from './moments.js';
import { siteBody, siteActions, roleOptions, recordUrl, siteReps, siteLeadId } from './manager-steps.js';
import { siteStateKey } from './leader-steps.js';
import { practiceActions } from './practice-steps.js';

const MONDAY = '2026-11-16';   // any Monday: only used to name the days of the week
const dayName = (n) => wdShort(addDays(MONDAY, n - 1));

export function createManager({ api, S, errText, refresh, renderAll, renderFeed, signOut, viewAs, openInstall }) {
  let team = null, city = 'all';
  const tzOf = (rep) => (rep && rep.tz) || S.me.me.tz;
  const repById = (id) => team.reps.find((r) => r.id === id) || team.others.find((r) => r.id === id) || (team.practice && team.practice.id === id ? { ...team.practice, name: t('reps.practice.name') } : null);
  const isAdmin = () => S.me.viewer.role === 'admin';
  /** A link to a rep's screens opens them in place. With a modifier key it stays a plain link, for a new tab. */
  const openAs = (e) => { if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return; e.preventDefault(); viewAs(e.currentTarget.dataset.as); };

  async function load() { team = await api('GET', 'team'); }
  const needsCount = () => (team ? team.needs.confirm.length + team.needs.silent.length + team.needs.late.length + team.needs.pace.length : 0);
  /** Run a manager action: the answer is the new team view. The feed and the tables follow from a fresh read. */
  const act = (btn, call, okKey) => once(btn, async () => {
    try { const res = await call(); if (res && res.reps) team = res; renderAll(false); if (okKey) toast(t(okKey)); refresh(false); } catch (e) { toast(errText(e)); }
  });

  /** A step that is hard to take back asks twice: the first tap arms the button and says what will happen. */
  function twice(btn, warnKey, run) {
    if (!btn.classList.contains('armed')) { btn.classList.add('armed'); toast(t(warnKey)); setTimeout(() => btn.classList.remove('armed'), 6000); return; }
    btn.classList.remove('armed'); run();
  }
  /** Take back a confirmation made by mistake: that part goes back to waiting. */
  const undoConfirm = (btn, logId, what) => act(btn, () => api('POST', 'confirm', { logId, what, undo: true }), 'needs.undone');
  /** Open a day that a rep closed too early, so they can log again. */
  const reopenDay = (btn, repId, day) => act(btn, () => api('POST', 'reopen', { rep: repId, day }), 'reps.reopen.done');

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
      h('span', { class: 'who' }, h('span', { class: 'fc' }), h('span', { class: 'wt' }, h('b'), h('small'), h('span', { class: 'flags' }))), h('span', { class: 'h' }),
      h('span', { class: 'cells' }, COLS.map((c) => h('span', { class: `m r c-${c}` }, h('span', { class: 'cell-l' }), h('span', { class: 'cv num' })))),
      h('span', { class: 'act' }, h('a', { class: 'mini-btn', onclick: openAs })), h('i', { class: 'vf', 'aria-hidden': 'true' }));
  }
  function paintRow(row, r) {
    const zone = tzOf(r), g = team.goals, flags = flagsOf(r), w = r.week.counts;
    row.classList.toggle('p1', r.place === 1); row.classList.toggle('flagged', flags.length > 0);
    row.classList.toggle('blank', !r.week.points && !r.week.marks && !r.today.logs);   // nothing this week: the cells would be ten zeros
    const pos = $('.pos', row); pos.textContent = r.place ? ord(r.place) : t('mgr.noplace'); pos.classList.toggle('none', !r.place);
    $('.who b', row).textContent = r.name;
    putFace($('.fc', row), r);
    $('.who small', row).replaceChildren(cityName(r.city));
    // "new" is a fact about the rep, not something to attend to: it is a plain tag before the flags.
    $('.flags', row).replaceChildren(...(r.isNew ? [h('span', { class: 'tag', text: t('table.new') })] : []), ...flags.map((f) => h('span', { class: 'chip', text: f })));
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
    const link = $('.act a', row); link.href = `?as=${encodeURIComponent(r.id)}`; link.dataset.as = r.id; link.textContent = t('mgr.viewas.row'); link.setAttribute('aria-label', t('mgr.viewas', { name: r.first }));
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
    // The wall: every rep's day as the scene it stands on (the stop that is next, the close once the day is done,
    // the hammock on a day off), with their face and the arc of today's four habits. A tap opens their screens.
    const shown = team.reps.filter((r) => city === 'all' || r.city === city), names = shortNames(shown);
    const drawWall = () => flipList($('#wall'), shown, (r) => r.id,
      () => h('a', { class: 'wl', onclick: openAs }, h('span', { class: 'ws', 'aria-hidden': 'true' }, h('i')), h('span', { class: 'pt' }), h('b'), h('span', { class: 'st' })),
      (node, r) => {
        const done = r.today.habits.filter(Boolean).length, flagged = flagsOf(r).length > 0;
        const state = !r.today.isWork ? t('mgr.report.rest') : r.today.closed ? t('mgr.report.closed', { time: clock(r.today.closedAt, tzOf(r)) }) : r.today.logs ? t('wall.today', { a: done }) : t('mgr.last.none');
        node.href = `?as=${encodeURIComponent(r.id)}`; node.dataset.as = r.id; node.classList.toggle('flag', flagged);
        node.setAttribute('aria-label', t('wall.open.aria', { name: r.name, state }));
        const over = r.today.closed || done === 4, at = r.today.habits.slice(0, 3).findIndex((x) => !x);
        $('.ws', node).dataset.art = !r.today.isWork ? 'rest' : over ? 'close' : STOPS[at >= 0 ? at : 3];
        $('.ws i', node).dataset.f = r.today.isWork && over ? '3' : '0';
        node.classList.toggle('wait', r.today.isWork && !over);
        putFace($('.pt', node), r, (person) => portrait(person, { share: 0 }));
        setPortrait($('.pt .portrait', node), r.today.isWork ? done / 4 : 0);
        $('b', node).textContent = names.get(r.id); $('.st', node).textContent = state;
      });
    if (animate) drawWall(); else quiet(drawWall);
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
    const sites = team.sites.map(siteItem);
    // every business of every rep on its way to a site, what waits on a manager first (the server orders it)
    const ways = (team.routes || []).map((r) => {
      const rep = repById(r.rep), st = r.complete ? null : r.stops[r.at], stop = st ? t(`route.stop.${st.key}`) : '';
      const line = !st ? t('needs.ways.done') : st.status === 'wait' ? t('needs.ways.you', { stop }) : t('needs.ways.rep', { name: rep ? rep.first : '', stop });
      return h('li', {}, h('span', {}, h('b', { text: r.lead.name }), h('small', { text: st ? `${rep ? rep.name : ''} · ${t('ways.stop', { n: r.at + 1, b: r.stops.length, stop })}` : (rep ? rep.name : '') }), h('small', { text: line })));
    });
    const addSite = h('button', { class: 'btn', type: 'button', id: 'addSiteBtn', text: t('needs.sites.add'), disabled: !siteReps(team, S.me.viewer.id).options.length, onclick: siteForm });
    $('#needsBody').replaceChildren(
      h('div', {}, group('needs.confirm.title', confirm, 'needs.confirm.empty'), group('needs.late.title', late, 'needs.late.empty'), group('needs.sites.title', sites, 'needs.sites.empty', h('p', { class: 'note' }, addSite), false), group('needs.ways.title', ways, 'needs.ways.empty')),
      h('div', {}, group('needs.silent.title', silent, 'needs.silent.empty'), group('needs.pace.title', pace, 'needs.pace.empty'), (silent.length || pace.length) ? h('p', { class: 'note', text: t('needs.msg.note') }) : null));
  }

  // ---- sites: each one with the controls its state allows (manager-steps.js decides which) ----
  const siteCall = (id, body) => api('POST', `site/${encodeURIComponent(id)}`, body);
  function phonesArrived(s) {
    formSheet({ title: t('site.phones.title'), intro: t('site.phones.intro', { name: s.lead.name }), submit: t('site.phones.submit'),
      fields: [{ name: 'count', type: 'number', label: t('site.phones.count'), value: s.phones ? String(s.phones) : '' }],
      onSubmit: async (v) => {
        const count = Number(v.count);
        if (!/^\d+$/.test(v.count) || count < 1 || count > 500) throw { code: 'fields' };
        team = await siteCall(s.id, { what: 'phones', count }); toast(t('site.phones.done')); await refresh(false);
      } });
  }
  function siteButton(kind, s) {
    const btn = (key, cls, run) => h('button', { class: cls ? `mini-btn ${cls}` : 'mini-btn', type: 'button', 'data-act': kind, text: t(key), onclick: run });
    if (kind === 'install') return btn('site.act.install', '', () => openInstall(s.id));
    if (kind === 'phones') return btn('site.act.phones', '', () => phonesArrived(s));
    if (kind === 'confirm') return btn('site.act.confirm', 'primary', (e) => act(e.currentTarget, () => siteCall(s.id, { what: 'installed' }), s.practice ? 'route.prac.saved' : 'site.confirmed'));   // a practice site counts in no total
    if (kind === 'installed' || kind === 'first_hour') return btn(`needs.sites.mark.${kind}`, '', (e) => act(e.currentTarget, () => siteCall(s.id, { what: kind }), 'needs.sites.done'));
    if (kind === 'record') return h('a', { class: 'mini-btn', 'data-act': kind, href: recordUrl(s.id), download: `record-${s.id}.csv`, text: t('site.act.record') });
    if (kind === 'remove') return btn('site.act.remove', '', (e) => { const b = e.currentTarget; twice(b, 'site.act.remove.confirm', () => act(b, () => siteCall(s.id, { what: 'remove' }), 'site.removed')); });
    return btn('needs.sites.void', '', (e) => { const b = e.currentTarget; twice(b, 'needs.sites.void.confirm', () => act(b, () => siteCall(s.id, { what: 'void' }), 'needs.sites.voided')); });
  }
  function siteItem(s) {
    const rep = repById(s.rep), zone = tzOf(rep), key = s.practice ? null : siteStateKey(s);
    const facts = [key ? t(`lead.state.${key}`) : null, s.city ? cityName(s.city) : null, s.eligible != null ? t('site.meta.eligible', { n: s.eligible }) : null,
      s.workers ? t('site.meta.workers', { n: s.workers }) : null, s.phones != null ? t('site.meta.phones', { n: s.phones }) : null].filter(Boolean).join(' · ');
    return h('li', { class: 'site-li', 'data-site': s.id },
      h('span', {}, h('b', {}, s.lead.name, s.practice ? [' ', h('span', { class: 'chip inst-prac', text: t('install.practice') })] : null), h('small', { text: `${rep ? rep.name : ''} · ${stamp(s.at, zone)}` }),
        facts ? h('small', { text: facts }) : null,
        ['installed', 'first_hour'].filter((k) => s.steps[k]).map((k) => h('small', { text: `${t(`needs.sites.${k}`)}: ${stamp(s.steps[k], zone)}` }))),
      h('span', { class: 'acts' }, siteActions(s).map((k) => siteButton(k, s))));
  }
  /** A new site. The id is made when the form opens: sending the form twice records one site. */
  function siteForm() {
    const siteId = `s_${newId()}`, known = team.cities || [], who = siteReps(team, S.me.viewer.id), first = repById(who.value);
    const city = (first && (known.find((k) => sameText(k, first.city)) || first.city)) || known[0] || '';
    formSheet({ title: t('needs.sites.title'), submit: t('needs.sites.submit'),
      fields: [{ name: 'rep', type: 'select', label: t('needs.sites.rep'), value: who.value, options: who.options.map((o) => (o.practice ? { value: o.value, label: `${t('reps.practice.name')} · ${t('install.practice')}` } : o)) }, { name: 'name', label: t('needs.sites.name') },
        known.length ? { name: 'city', type: 'pick', label: t('site.form.city'), value: city, max: 60, other: t('reps.form.city.other'), otherLabel: t('reps.form.city.other.label'),
          options: [...known, ...(city && !known.includes(city) ? [city] : [])].map((c) => ({ value: c, label: cityName(c) })) } : { name: 'city', label: t('site.form.city'), value: city, max: 60 },
        { name: 'eligible', type: 'number', label: t('site.form.eligible'), hint: t('site.form.eligible.hint') },
        { name: 'coordName', label: t('site.form.coord.name'), max: 80 }, { name: 'coordPhone', type: 'tel', label: t('site.form.coord.phone'), max: 30 },
        { name: 'kind', type: 'select', label: t('site.form.kind'), value: 'normal', options: ['normal', 'practice', 'legacy'].map((k) => ({ value: k, label: t(`site.kind.${k}`) })) }],
      onSubmit: async (v) => { team = await api('POST', 'site', siteBody(v, siteId, siteLeadId(team, v.rep, v.name))); toast(t('needs.sites.added')); await refresh(false); } });
  }

  // ---- reps ----
  function repForm(rep = null) {
    const today = dayOf(team.serverTime, S.me.me.tz);
    const fields = [{ name: 'name', label: t('reps.form.name'), value: rep ? rep.name : '', max: 80 }];
    // The address is the person's way in. Nobody edits their own: a slip would lock them out.
    const own = !!rep && rep.id === S.me.viewer.id;
    if (!own) fields.push({ name: 'email', type: 'email', label: t('reps.form.email'), hint: t('reps.form.email.hint'), value: rep ? rep.email : '', lower: true, max: 120 });
    // The city decides which businesses a rep can pick, so it comes from the business list. Another one can still be written.
    const known = team.cities || [], listed = (c) => known.find((k) => sameText(k, c));
    const city = rep ? (listed(rep.city) || rep.city) : (listed('Panama City') || known[0] || 'Panama City');
    fields.push(known.length
      ? { name: 'city', type: 'pick', label: t('reps.form.city'), hint: t('reps.form.city.pick'), value: city, max: 60, other: t('reps.form.city.other'), otherLabel: t('reps.form.city.other.label'), otherHint: t('reps.form.city.hint'),
        options: [...known, ...(city && !listed(city) ? [city] : [])].map((c) => ({ value: c, label: cityName(c) })) }
      : { name: 'city', label: t('reps.form.city'), hint: t('reps.form.city.hint'), value: city, max: 60 },
      { name: 'country', type: 'select', label: t('reps.form.country'), value: rep ? rep.country : 'PA', options: ['PA', 'CO'].map((c) => ({ value: c, label: t(`country.${c}`) })) },
      { name: 'startDate', type: 'date', label: t('reps.form.start'), value: rep ? rep.startDate : today },
      { name: 'workdays', type: 'days', label: t('reps.form.workdays'), value: rep ? rep.workdays : [1, 2, 3, 4, 5], options: [1, 2, 3, 4, 5].map((n) => ({ value: n, label: dayName(n) })) });
    const roles = rep ? [] : roleOptions(S.me.viewer.role);   // only an admin picks a role, Liderazgo among them
    if (roles.length) fields.push({ name: 'role', type: 'select', label: t('reps.form.role'), value: 'rep', options: roles.map((r) => ({ value: r, label: t(`role.${r}`) })) });
    formSheet({ title: t(rep ? 'reps.edit.title' : 'reps.add.title'), submit: t(rep ? 'reps.form.save' : 'reps.form.submit'), fields,
      onSubmit: async (v) => {
        if (!v.city) throw { code: 'fields' };
        v.city = listed(v.city) || v.city;   // the list's own spelling when it is the same city
        if (rep) { team = await api('POST', `reps/${encodeURIComponent(rep.id)}`, { patch: { name: v.name, city: v.city, country: v.country, startDate: v.startDate, workdays: v.workdays, ...(own || v.email.toLowerCase() === (rep.email || '') ? {} : { email: v.email }) } }); toast(t('reps.saved')); renderAll(false); return false; }
        // Nothing to hand over: from now on that Google account opens the board.
        team = await api('POST', 'reps', { email: v.email, name: v.name, city: v.city, country: v.country, startDate: v.startDate, workdays: v.workdays, role: v.role });
        toast(t('reps.added', { name: v.name.trim().split(/\s+/)[0] })); renderAll(false);
        return false;
      } });
  }
  function dayOff() {
    const today = dayOf(team.serverTime, S.me.me.tz), countries = [...new Set(team.reps.map((r) => r.country))];
    formSheet({ title: t('reps.dayoff.title'), intro: t('reps.dayoff.p'), submit: t('reps.dayoff.submit'),
      fields: [{ name: 'date', type: 'date', label: t('reps.dayoff.date'), value: today },
        { name: 'scope', type: 'select', label: t('reps.dayoff.scope'), value: 'all', options: [{ value: 'all', label: t('reps.dayoff.all') }, ...countries.map((c) => ({ value: c, label: t('reps.dayoff.country', { country: t(`country.${c}`) }) })), ...team.reps.map((r) => ({ value: r.id, label: r.name }))] }],
      onSubmit: async (v) => { team = await api('POST', 'dayoff', { scope: v.scope, date: v.date }); toast(t('reps.dayoff.done')); await refresh(false); } });
  }
  function repItem(r, isPlayer) {
    // Without an address nobody can come in as this person: the list says so until a manager adds it.
    const status = !r.active ? h('small', { text: t('reps.inactive') }) : r.email ? null : h('small', { class: 'warn', text: t('reps.noemail') });
    const days = r.workdays.map(dayName).join(' ');
    const canTouch = isPlayer || isAdmin(), self = r.id === S.me.viewer.id;
    // How many businesses of the list this rep can pick. None means the city is written another way than in the list.
    const leads = !isPlayer || !team.leadCount || !r.active ? null : r.leadsInCity ? h('small', { text: t('reps.leads', { n: r.leadsInCity }) }) : h('small', { class: 'warn', text: t('reps.leads.none') });
    return h('li', {},
      h('span', { class: 'pers' }, face(r), h('span', { class: 'pt' }, h('b', { text: r.name }), r.email ? h('small', { class: 'mail', text: r.email }) : null, h('small', { text: `${isPlayer ? '' : `${t(`role.${r.role}`)} · `}${cityName(r.city)} · ${t('reps.start', { date: dayMonth(r.startDate) })} · ${days}` }), status, leads)),
      h('span', { class: 'acts' },
        isPlayer ? h('a', { class: 'mini-btn', href: `?as=${encodeURIComponent(r.id)}`, 'data-as': r.id, onclick: openAs, text: t('mgr.viewas', { name: r.first }) }) : null,
        // A rep is edited by any manager; a manager or an admin, by an admin, and never by themselves.
        canTouch && (r.role === 'rep' || !self) ? h('button', { class: 'mini-btn', type: 'button', text: t('reps.edit'), onclick: () => repForm(r) }) : null,
        canTouch && !self ? h('button', { class: 'mini-btn', type: 'button', text: t(r.active ? 'reps.deactivate' : 'reps.activate'), onclick: (e) => act(e.currentTarget, () => api('POST', `reps/${encodeURIComponent(r.id)}`, { patch: { active: !r.active } }), 'reps.saved') }) : null));
  }
  /** The practice rep: one control to create it, then a way into its screens (writes allowed) and a remove in two taps. */
  function practiceGroup() {
    const acts = practiceActions(team, S.me.viewer.role);
    if (!acts.length) return null;
    const p = team.practice;
    const btn = (key, cls, run) => h('button', { class: cls ? `mini-btn ${cls}` : 'mini-btn', type: 'button', 'data-act': `practice-${key}`, text: t(`reps.practice.${key}`), onclick: run });
    const controls = acts.map((k) => (k === 'create' ? btn('create', 'primary', (e) => act(e.currentTarget, () => api('POST', 'practice', {}), 'reps.practice.created'))
      : k === 'view' ? h('a', { class: 'mini-btn primary', 'data-act': 'practice-view', href: `?as=${encodeURIComponent(p.id)}`, 'data-as': p.id, onclick: openAs, text: t('reps.practice.view') })
        : btn('remove', '', (e) => { const b = e.currentTarget; twice(b, 'reps.practice.remove.confirm', () => act(b, () => api('POST', 'practice/remove', {}), 'reps.practice.removed')); })));
    const who = p ? h('span', { class: 'pers' }, face({ ...p, name: t('reps.practice.name') }), h('span', { class: 'pt' }, h('b', {}, t('reps.practice.name'), ' ', h('span', { class: 'chip inst-prac', text: t('install.practice') })), h('small', { text: t('reps.practice.p') })))
      : h('span', { class: 'pers' }, h('span', { class: 'pt' }, h('small', { text: t('reps.practice.p') })));
    return h('section', { class: 'group', id: 'practiceGroup' }, h('h2', { text: t('reps.practice.h') }), h('ul', { class: 'items' }, h('li', {}, who, h('span', { class: 'acts' }, controls))));
  }
  function renderReps() {
    $('#repsGiant').replaceChildren(num(team.reps.length), h('em', { text: '.' }));
    put($('#repsBody'),
      team.reps.length ? h('ul', { class: 'items' }, team.reps.map((r) => repItem(r, true))) : h('p', { class: 'note', text: t('mgr.none') }),
      practiceGroup(),
      team.others.length ? h('section', { class: 'group' }, h('h2', { text: t('reps.others') }), h('ul', { class: 'items' }, team.others.map((r) => repItem(r, false)))) : null,
      h('section', { class: 'group' }, h('h2', { text: t('profile.settings') }), h('div', { class: 'settings' },
        h('div', { class: 'line' }, h('span', { text: S.me.viewer.email ? t('profile.account', { email: S.me.viewer.email }) : '' }), h('button', { class: 'mini-btn signout', type: 'button', text: t('profile.signout'), onclick: signOut })))));
  }

  function render(animate = false) {
    if (!team) return;
    renderTeam(animate); renderNeeds(); renderReps();
    $('#dayoffBtn').onclick = dayOff; $('#addRepBtn').onclick = () => repForm();
  }
  return { load, render, needsCount, voidLog, giveBadge, undoConfirm, reopenDay };
}
