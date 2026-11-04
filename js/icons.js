const PLAY_MS = 2800;

export function initIcons(hosts) {
  if (!('IntersectionObserver' in window)) { hosts.forEach((h) => h.classList.add('ji-on')); return; }
  const play = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      play.unobserve(e.target);
      e.target.classList.add('ji-play');
      setTimeout(() => e.target.classList.remove('ji-play'), PLAY_MS);
    }
  }, { rootMargin: '0px 0px -18% 0px' });
  const on = new IntersectionObserver((entries) => {
    for (const e of entries) e.target.classList.toggle('ji-on', e.isIntersecting);
  });
  hosts.forEach((h) => { play.observe(h); on.observe(h); });
}
