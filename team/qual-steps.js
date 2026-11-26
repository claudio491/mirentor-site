// qual-steps.js: a business's qualification on the phone. Which rows a log asks (how many work with their hands, Wi-Fi,
// who coordinates), which show folded because the card already knows them, what the log sends, what the business says
// about itself, the contract's warning and the offer to close it as not a fit. No page and no imports: the log sheet and
// the card draw what these decide. The server keeps the answers (lib/team/rules.mjs) and stays the judge.

/** The results that are a conversation with the business: the only logs that carry a qualification. */
export const QUAL_KINDS = ['talk', 'call', 'meeting', 'contract'];
/** The three rows and the answers each takes, in the order the sheet asks them. */
export const QUAL_ROWS = [
  { key: 'workers', options: ['lt10', '10_29', '30_49', '50plus'] },
  { key: 'wifi', options: ['yes', 'no', 'unknown'] },
  { key: 'lead', options: ['yes', 'no', 'unknown'] },
];
const OPTIONS = Object.fromEntries(QUAL_ROWS.map((r) => [r.key, r.options]));
const valid = (k, v) => !!OPTIONS[k] && OPTIONS[k].includes(v);
/** Only the listed rows with a listed answer. */
function clean(q) {
  const out = {};
  if (!q || typeof q !== 'object' || Array.isArray(q)) return out;
  for (const k of Object.keys(OPTIONS)) if (valid(k, q[k])) out[k] = q[k];
  return out;
}

/** The answers a business keeps: per row, the latest wins, except that "unknown" never replaces a yes or a no. */
export function mergeQ(had, got) {
  const out = { ...(had || {}) };
  for (const [k, v] of Object.entries(got || {})) {
    if (v === 'unknown' && (out[k] === 'yes' || out[k] === 'no')) continue;
    out[k] = v;
  }
  return out;
}
/** Whether a business qualifies: Wi-Fi and someone who coordinates, both yes. A no on either does not; otherwise it is
 *  missing the rows that are not yes. */
export function qualOf(q) {
  const wifi = q ? q.wifi : undefined, lead = q ? q.lead : undefined;
  if (wifi === 'yes' && lead === 'yes') return { state: 'yes', missing: [] };
  if (wifi === 'no' || lead === 'no') return { state: 'no', missing: [] };
  return { state: 'missing', missing: [['wifi', wifi], ['lead', lead]].filter(([, v]) => v !== 'yes').map(([k]) => k) };
}

/** The business's line: "Califica", "No califica" or "Falta: wifi, quién coordina" (`what` holds the keys of the rows
 *  missing, qf.miss.*, for the page to join). */
export function qualLine(q) {
  const s = qualOf(q);
  if (s.state === 'yes') return { key: 'qf.state.yes' };
  if (s.state === 'no') return { key: 'qf.state.no' };
  return { key: 'qf.state.missing', what: s.missing.map((k) => `qf.miss.${k}`) };
}

/** The three rows of the sheet. `known` is what the card says (GET biz/<id>'s q), `picked` what the rep tapped in this
 *  sheet, `open` the rows "Cambiar" opened. A row the card knows shows folded (its answer and "Cambiar") until it is
 *  opened or tapped; `value` is the answer shown pressed: the tap, else the card's, else null. */
export function qualRows(known, picked, open) {
  const k = clean(known), p = picked || {}, o = open instanceof Set ? open : new Set();
  return QUAL_ROWS.map((r) => {
    const tapped = valid(r.key, p[r.key]) ? p[r.key] : null;
    return { key: r.key, options: r.options, value: tapped || k[r.key] || null, folded: !tapped && !!k[r.key] && !o.has(r.key) };
  });
}

/** What the log sends as `q`: only the rows tapped, with a listed answer; undefined when none. */
export function qualBody(picked) {
  const q = clean(picked);
  return Object.keys(q).length ? q : undefined;
}

/** The contract's warning: on "Contrato enviado", when the card and the taps together do not say Wi-Fi yes and someone
 *  who coordinates yes. It never stops the save. */
export function contractWarn(kind, known, picked) {
  if (kind !== 'contract') return false;
  return qualOf(mergeQ(clean(known), clean(picked))).state !== 'yes';
}

/** A "No" tapped on Wi-Fi or on who coordinates offers to close the business as not a fit, with its reason. */
export function notFitOffer(picked) {
  const p = clean(picked);
  return p.wifi === 'no' || p.lead === 'no' ? { tag: 'not_fit', lost: 'no_wifi_lead' } : null;
}

/** Whether the sheet holds the close "Cerrar como No califica" armed: the tag and the reason that button sets. */
export const notFitArmed = ({ tag, reason } = {}) => tag === 'not_fit' && reason === 'no_wifi_lead';

/** What picking another business keeps of the sheet's qualification: the taps and the rows opened go, and so does the
 *  not-fit close the button "Cerrar como No califica" armed (`armed`, set only by that button: it was about the business
 *  before); a tag the rep picked under "Cómo quedó" stays, the same "No califica" and reason picked by hand included. */
export function bizSwitch({ tag = null, reason = null, armed = false } = {}) {
  const off = !!armed && notFitArmed({ tag, reason });
  return { tag: off ? null : tag, reason: off ? null : reason, armed: false, qual: {}, qOpen: new Set() };
}
