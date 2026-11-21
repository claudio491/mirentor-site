// leader-steps.js: what the leadership view decides before it draws, away from the page so it can be tested.
// How minutes read as hours, what a site's card says, how the practice site is mentioned, what the shell offers each
// role, and the shape of the hours graphic. The server stays the judge: these only shape the screen.

/** Minutes as a person reads them: 4144 is "69 h 4 min". Whole hours drop the minutes, under an hour drops the hours.
 *  `show` writes the hours the way the reader's language writes a number. Nothing on file is an empty string. */
export function hm(minutes, show = String) {
  if (minutes == null || !Number.isFinite(Number(minutes))) return '';
  const total = Math.max(0, Math.round(Number(minutes))), h = Math.floor(total / 60), m = total % 60;
  if (!h) return `${m} min`;
  return m ? `${show(h)} h ${m} min` : `${show(h)} h`;
}

/** What a site's card says. A site installed before the app has no consents in it, so its card says that instead of
 *  showing a zero that would read as "nobody signed". An eligible count the site never had stays null: the card says so. */
/** The state a site is shown in. A site marked installed with nobody on it in the app (an old event, the old way of
 *  marking) is not a finished install with the app, and says so. */
export const siteStateKey = (site) => (site.state === 'installed' && !site.workers ? 'installed_bare' : site.state);
/** How a state's tag looks: `ok` only for an install made with the app, `old` for what happened before or outside it. */
const toneOf = (key) => (key === 'installed' ? 'ok' : key === 'legacy' || key === 'installed_bare' ? 'old' : 'miss');
export function siteCard(site, t) {
  const legacy = site.state === 'legacy', key = siteStateKey(site);
  const figures = [{ key: 'eligible', value: site.eligible ?? null, label: t('lead.site.eligible') }];
  if (!legacy) figures.push({ key: 'consents', value: site.consents, label: t('lead.site.consents') }, { key: 'phones', value: site.phones, label: t('lead.site.phones') });
  return { id: site.id, name: site.name, state: t(`lead.state.${key}`), stateKey: key, tone: toneOf(key), legacy, record: !legacy && site.workers > 0, line: legacy ? t('lead.site.legacy') : null, figures };
}

/** The practice site is never listed. When there is one or more, the page says how many, once, and names none. */
export function practiceNote(view, t) {
  const n = Number(view && view.practiceHidden) || 0;
  return n > 0 ? t('lead.practice', { n }) : null;
}

/** What the shell offers: the tabs, whether there is a log button, and the screen the home mark opens. A leader reads
 *  one page: no tabs, nothing to log. */
export function shellFor(role) {
  if (role === 'leader') return { tabs: [], log: false, home: 'lead' };
  if (role === 'manager' || role === 'admin') return { tabs: ['team', 'needs', 'reps'], log: false, home: 'team' };
  return { tabs: ['today', 'week', 'table'], log: true, home: 'today' };
}

/** The hours graphic: the newest week first, its accepted hours as a share of the Scorecard's goal, and the last weeks
 *  on one scale (the largest delivered week fills its track), so two weeks compare at a glance. */
export function hoursModel(hours, goal, keep = 6) {
  const weeks = (hours || []).slice(0, keep), latest = weeks[0] || null;
  const top = Math.max(1, ...weeks.map((w) => Math.max(w.delivered, w.accepted)));
  return { latest, goal, ofGoal: latest && goal ? latest.accepted / goal : null,
    weeks: weeks.map((w) => ({ ...w, d: w.delivered / top, a: w.accepted / top })) };
}
