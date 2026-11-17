// boot.js: starts the copy of the app that runs with no server (tools/team-demo.mjs builds it into one page).
// It starts the team's server code inside the page, answers the app's requests from it, signs someone in, and only then
// lets the app load. The bar it adds on top says what this copy is and lets the viewer be any person of the team.
import { startServer } from './server.js';
import { PEOPLE, PHOTOS } from './demo-data.js';
import { setPhotoAddress } from '../../team/ui.js';

const EVENTS = 'mirentor.team.demo.events.v1', WHO = 'mirentor.team.demo.who.v1';
// The browser's storage may be off (a private window, an embedded page): the copy then lives until the page closes.
const read = (key) => { try { return localStorage.getItem(key); } catch { return null; } };
const write = (key, value) => { try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value); } catch { /* see above */ } };

const TEXT = {
  es: { tag: 'Copia de demostración', as: 'Entrar como', reset: 'Empezar de cero', note: 'Lo que registres se guarda solo en este navegador. No es la app en línea.',
    rep: 'vendedor', manager: 'líder', admin: 'administrador', sure: 'Toca otra vez para borrar lo registrado aquí.',
    link: 'En esta copia el enlace no se abre: esa persona ya puede entrar desde "Entrar como".' },
  en: { tag: 'Demonstration copy', as: 'Sign in as', reset: 'Start over', note: 'What you log is kept in this browser only. This is not the live app.',
    rep: 'rep', manager: 'manager', admin: 'admin', sure: 'Tap again to erase what was logged here.',
    link: 'In this copy the link does not open: that person can already sign in from "Sign in as".' },
};
const words = () => TEXT[document.documentElement.lang === 'en' ? 'en' : 'es'];
const leader = () => (PEOPLE.find((p) => p.role === 'admin') || PEOPLE.find((p) => p.role === 'manager') || PEOPLE[0] || {}).handle;
const el = (tag, attrs = {}, ...kids) => { const node = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v); node.append(...kids); return node; };

async function main() {
  const fresh = () => startServer({ people: PEOPLE, saved: '', onSave: (text) => write(EVENTS, text) });
  const saved = read(EVENTS) || '';
  let server;
  try { server = startServer({ people: PEOPLE, saved, onSave: (text) => write(EVENTS, text) }); if (!server.people().length) throw new Error('nobody can sign in'); }
  catch { server = fresh(); }   // a log this copy cannot read any more: start again from the team

  // The app asks its server with fetch. Here the answer comes from the page itself.
  let linked = () => {};   // told when someone was created or given a new link: set once the bar exists
  const pageFetch = window.fetch.bind(window);
  window.fetch = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url, location.href), at = url.pathname.indexOf('/equipo/api/');
    if (at < 0) return pageFetch(input, init);
    const method = init.method || 'GET', route = url.pathname.slice(at + 12) + url.search;
    const answer = await server.call(method, route, init.body ? JSON.parse(init.body) : undefined);
    if (method === 'POST' && answer.status === 200 && /^reps(\/[^/]+\/link)?$/.test(route.split('?')[0])) linked();
    return new Response(answer.body, { status: answer.status, headers: { 'content-type': answer.type } });
  };
  setPhotoAddress((person) => PHOTOS[person.id] || '');

  // Whoever was signed in last time, or the team's leader.
  const enterAs = async (handle) => { const answer = await server.signIn(handle); if (answer.status === 200) write(WHO, handle); return answer.status === 200; };
  if (!(await enterAs(read(WHO) || leader()))) await enterAs(leader());

  // ---- the bar ----
  const tag = el('span', { class: 'demo-tag' }, el('i'), el('span')), label = el('span'), select = el('select', { id: 'demoWho' });
  const reset = el('button', { type: 'button', class: 'mini-btn', id: 'demoReset' }), note = el('span', { class: 'demo-note' });
  const bar = el('div', { class: 'demo', id: 'demoBar' }, tag, el('label', { class: 'demo-who', for: 'demoWho' }, label, select), reset, note);
  let saidLink = 0;
  const paint = () => {
    const w = words(), current = read(WHO) || leader();
    tag.lastChild.textContent = w.tag; label.textContent = w.as; reset.textContent = w.reset;
    note.textContent = reset.classList.contains('armed') ? w.sure : Date.now() - saidLink < 15000 ? w.link : w.note;
    select.setAttribute('aria-label', w.as);
    select.replaceChildren(...server.people().map((p) => { const o = el('option', { value: p.handle }, `${p.name} · ${w[p.role] || p.role}`); o.selected = p.handle === current; return o; }));
  };
  /** The app reads who is signed in again, the way it does when the address changes. */
  const reenter = () => {
    try { history.replaceState(null, '', location.pathname + location.hash); } catch { /* an embedded page may not rewrite its address */ }
    window.dispatchEvent(new PopStateEvent('popstate'));
  };
  select.addEventListener('change', async () => { await enterAs(select.value); paint(); reenter(); });
  select.addEventListener('pointerdown', paint);   // people created since the last look are in the list
  reset.addEventListener('click', async () => {
    if (!reset.classList.contains('armed')) { reset.classList.add('armed'); paint(); setTimeout(() => { reset.classList.remove('armed'); paint(); }, 6000); return; }
    reset.classList.remove('armed'); write(EVENTS, null); write(WHO, null);
    server = fresh(); await enterAs(leader()); paint(); reenter();
  });
  linked = () => { saidLink = Date.now(); paint(); setTimeout(paint, 15200); };
  new MutationObserver(paint).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  document.body.classList.add('bare');
  document.body.prepend(bar);
  paint();

  await import('../../team/app.js');   // from here on it is the app as it is
  paint();
}
main();
