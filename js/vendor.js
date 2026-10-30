// vendor.js: loads GSAP 3.13.0 with ScrollTrigger and CustomEase, the plugins a module asks for (SplitText,
// DrawSVGPlugin, Flip, MotionPathPlugin) and Lenis 1.1.18, each once and only on demand. Self-hosted in /vendor.
// The brand's motion curves (brand/mirentor/web-motion) are registered as GSAP eases: "lock", "track", "reveal".
const SELF_HOSTED = true; // the claude.ai preview build sets this to false: its CSP takes scripts from cdnjs and jsDelivr
const url = (file) => (SELF_HOSTED ? new URL(`../vendor/${file}`, import.meta.url).href
  : file.startsWith('lenis') ? `https://cdn.jsdelivr.net/npm/lenis@1.1.18/dist/${file}`
    : `https://cdnjs.cloudflare.com/ajax/libs/gsap/3.13.0/${file}`);

const scripts = new Map();
const load = (file) => {
  if (!scripts.has(file)) {
    scripts.set(file, new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = url(file); s.async = true; s.onload = resolve; s.onerror = () => reject(new Error(`vendor: ${file}`));
      document.head.appendChild(s);
    }));
  }
  return scripts.get(file);
};

let core = null;
const PLUGINS = ['SplitText', 'DrawSVGPlugin', 'Flip', 'MotionPathPlugin'];

/** Resolves with { gsap, ScrollTrigger, CustomEase, ...requested plugins }, all registered. */
export async function loadGsap(...plugins) {
  core ??= (async () => {
    await load('gsap.min.js');
    await Promise.all([load('ScrollTrigger.min.js'), load('CustomEase.min.js')]);
    const { gsap, ScrollTrigger, CustomEase } = window;
    gsap.registerPlugin(ScrollTrigger, CustomEase);
    CustomEase.create('lock', '0.34, 1.56, 0.64, 1');
    CustomEase.create('track', '0.2, 0.8, 0.2, 1');
    CustomEase.create('reveal', '0.16, 1, 0.3, 1');
    return { gsap, ScrollTrigger, CustomEase };
  })();
  const base = await core;
  const wanted = plugins.filter((p) => PLUGINS.includes(p));
  await Promise.all(wanted.map((p) => load(`${p}.min.js`)));
  wanted.forEach((p) => base.gsap.registerPlugin(window[p]));
  return { ...base, ...Object.fromEntries(wanted.map((p) => [p, window[p]])) };
}

/** Resolves with the Lenis constructor. */
export async function loadLenis() {
  await load('lenis.min.js');
  return window.Lenis;
}
