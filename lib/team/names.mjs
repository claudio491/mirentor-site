// names.mjs: how a person is named on every screen. view.mjs and biz.mjs both read it, so neither imports the other.

const first = (name) => String(name || '').trim().split(/\s+/)[0] || '';
/** A person's name as the reader's language says it. An example rep is named by a letter, "Vendedor A" or "Rep A"; and
 *  since all four would share a first name, their whole name is their first. Everyone else is named as written. */
export const nameOf = (rep, lang) => (rep.example ? (lang === 'en' ? `Rep ${rep.example}` : `Vendedor ${rep.example}`) : rep.name);
export const firstOf = (rep, lang) => (rep.example ? nameOf(rep, lang) : first(rep.name));
