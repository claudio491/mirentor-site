// report.js: the daily site report ("Reporte del día") of a live site, in the form sheet every short form uses. Phone
// first: numbers are steppers a thumb can hit, the yes or no is two buttons, and what the app already knows comes filled
// in (report-steps.js decides it). Sent once today, it opens on "Enviado hoy" with the way to edit it; a new one
// replaces the old on the server, which keeps both.
import { h, t, toast, formSheet, clock, wdLong, dayMonth, cityName, num, once, showErr } from './ui.js';
import { GEAR, GEAR_COUNTS, SURGE_COUNTS, draftOf, bodyOf, countOf } from './report-steps.js';

let uid = 0;
/** Why a request failed, in words: a code the dictionary knows, or "something failed". The app may pass its own. */
const reason = (e) => { try { return t(`err.${(e && e.code) || 'unknown'}`); } catch { return t('err.unknown'); } };

export function createReport({ api, errText = reason }) {
  /** Open the report of a site. `tz` is the time zone its times are read in; `after(res)` runs once a report is saved. */
  async function open(siteId, { tz, after = () => {}, day = '' } = {}) {
    const got = await api('GET', `site/${encodeURIComponent(siteId)}/report${day ? `?day=${encodeURIComponent(day)}` : ''}`);
    if (got.report) done(got, tz, after); else form(got, draftOf(got.prefill, null), tz, after);
  }

  /** Before noon the report may be for yesterday: two buttons say which day this one is, and switching reopens it. The
   *  switch reads that day's report first: without signal (or with any refusal) it says why right under the buttons,
   *  and the day on screen stays as it was, with what was typed in it. */
  function dayChoice(got, tz, after) {
    if (!got.days || got.days.length < 2) return null;
    const askId = `rpt-${uid += 1}`, err = h('p', { class: 'formerr', role: 'alert', hidden: true });
    const pick = (d, label) => {
      const b = h('button', { type: 'button', text: label, onclick: (e) => {
        if (d === got.day) return;
        err.hidden = true;
        once(e.currentTarget, () => open(got.site.id, { tz, after, day: d }).catch((x) => showErr(err, errText(x))));
      } });
      b.setAttribute('aria-pressed', String(d === got.day));
      return b;
    };
    return h('div', { class: 'rpt-g' }, h('p', { class: 'rpt-ask', id: askId, text: t('report.for') }),
      h('div', { class: 'seg rpt-yn', role: 'group', 'aria-labelledby': askId },
        pick(got.days[0], t('report.for.today')), pick(got.days[1], t('report.for.yesterday', { day: `${wdLong(got.days[1])} ${dayMonth(got.days[1])}` }))), err);
  }

  /** Sent today: when, a short summary, and the way to edit it. */
  function done(got, tz, after) {
    const r = got.report.report, unknown = t('report.unknown');
    const hours = (v) => (v == null ? unknown : num(v));
    const body = h('div', { class: 'rpt-done' },
      h('p', { class: 'rpt-sum', text: t('report.sum', { people: t('report.people.n', { n: r.people }), delivered: hours(r.delivered), accepted: hours(r.accepted) }) }),
      h('p', { class: `rpt-sum ${r.allOk ? 'ok' : 'warn'}`, text: t(r.allOk ? 'report.sum.ok' : 'report.sum.notok') }),
      r.missing ? h('p', { class: 'note', text: r.missing }) : null,
      got.site.practice ? h('p', { class: 'note', text: t('report.practice') }) : null,
      dayChoice(got, tz, after));
    formSheet({ title: t('report.title'), intro: t('report.done.p', { name: got.site.name, time: clock(got.report.t, tz) }), body, submit: t('report.edit'), skip: t('c.close'),
      onSubmit: async () => { form(got, draftOf(got.prefill, got.report), tz, after); return true; } });
  }

  /** The form itself. Every number is a stepper; the box in the middle also takes typing. */
  function form(got, d, tz, after) {
    const reads = [];   // how each stepper's value is read back when the form is sent
    const stepper = (label, get, set) => {
      const id = `rpt-${uid += 1}`;
      const box = h('input', { class: 'rpt-v num', id, type: 'text', inputmode: 'numeric', pattern: '[0-9]*', maxlength: 4, autocomplete: 'off', 'aria-label': label });
      box.value = String(get());
      const bump = (k) => { const v = countOf(box.value); box.value = String(Math.max(0, (Number.isNaN(v) ? 0 : v) + k)); };
      reads.push(() => set(countOf(box.value)));
      return h('div', { class: 'rpt-n' }, h('label', { class: 'rpt-l', for: id, text: label }),
        h('div', { class: 'rpt-ctl' },
          h('button', { class: 'rpt-b', type: 'button', 'aria-label': t('report.less', { label }), text: '−', onclick: () => bump(-1) }),
          box,
          h('button', { class: 'rpt-b', type: 'button', 'aria-label': t('report.more', { label }), text: '+', onclick: () => bump(1) })));
    };
    const group = (title, kids) => h('fieldset', { class: 'rpt-g' }, h('legend', { class: 'label', text: title }), h('div', { class: 'rpt-grid' }, kids));
    const hoursBox = (key, label) => {
      const input = h('input', { type: 'text', inputmode: 'decimal', maxlength: 6, autocomplete: 'off', 'aria-label': `${t('report.hours')}: ${label}` });
      input.value = d[key];
      reads.push(() => { d[key] = input.value; });
      return h('label', { class: 'field rpt-h' }, h('span', { class: 'label', text: label }), input);
    };
    const text = (key, label) => {
      const area = h('textarea', { rows: 2, maxlength: 500, 'aria-label': label });
      area.value = d[key] || '';
      reads.push(() => { d[key] = area.value; });
      return h('label', { class: 'field' }, h('span', { class: 'label', text: label }), area);
    };
    // the yes or no: two buttons, one pressed
    const yes = h('button', { type: 'button', text: t('report.yes') }), no = h('button', { type: 'button', text: t('report.no') });
    const paint = () => { yes.setAttribute('aria-pressed', String(d.allOk === true)); no.setAttribute('aria-pressed', String(d.allOk === false)); };
    yes.onclick = () => { d.allOk = true; paint(); }; no.onclick = () => { d.allOk = false; paint(); };
    paint();
    const askId = `rpt-${uid += 1}`;

    const body = h('div', { class: 'rpt' },
      h('p', { class: 'note rpt-who', text: [got.site.city ? cityName(got.site.city) : null, t('report.lead', { name: got.prefill.lead })].filter(Boolean).join(' · ') }),
      got.site.practice ? h('p', { class: 'note', text: t('report.practice') }) : null,
      dayChoice(got, tz, after),
      h('div', { class: 'rpt-g rpt-top' }, stepper(t('report.people'), () => d.people, (v) => { d.people = v; }), h('p', { class: 'hint rpt-hint', text: t('report.people.hint') })),
      h('fieldset', { class: 'rpt-g' }, h('legend', { class: 'label', text: t('report.hours') }),
        h('div', { class: 'rpt-grid' }, hoursBox('delivered', t('report.delivered')), hoursBox('accepted', t('report.accepted'))), h('p', { class: 'hint rpt-hint', text: t('report.hours.hint') })),
      GEAR.map((g) => group(t(`report.gear.${g}`), GEAR_COUNTS.map((k) => stepper(t(`report.n.${k}`), () => d[g][k], (v) => { d[g][k] = v; })))),
      group(t('report.gear.surge'), SURGE_COUNTS.map((k) => stepper(t(`report.n.surge.${k}`), () => d.surge[k], (v) => { d.surge[k] = v; }))),
      h('div', { class: 'rpt-g rpt-top' }, stepper(t('report.sets'), () => d.sets, (v) => { d.sets = v; })),
      h('div', { class: 'rpt-g' }, h('p', { class: 'rpt-ask', id: askId, text: t('report.allOk') }), h('div', { class: 'seg rpt-yn', role: 'group', 'aria-labelledby': askId }, yes, no)),
      text('missing', t('report.missing')), text('need', t('report.need')), text('notes', t('report.notes')));

    formSheet({ title: t('report.title'), intro: t('report.intro', { name: got.site.name, day: `${wdLong(got.day)} ${dayMonth(got.day)}` }), body, submit: t('report.submit'),
      onSubmit: async () => {
        for (const read of reads) read();
        const made = bodyOf(d);
        if (made.error) throw { code: made.error };
        const res = await api('POST', `site/${encodeURIComponent(got.site.id)}/report`, { ...made.body, day: got.day });
        toast(t('report.done'), clock(res.report.t, tz));
        after(res);
      } });
  }

  return { open };
}
