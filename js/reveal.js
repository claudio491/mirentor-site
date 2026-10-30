// reveal.js: chapter boot (spec 7). Sections with class "boot" get "is-in" once their top is 15% into the viewport;
// children marked [data-boot] (with --i for order) fade and rise in. The trigger is a margin, not a share of the
// section's area: a pinned chapter is several screens tall and would never reach 15% of its own height on screen.
export function initReveal() {
  const sections = [...document.querySelectorAll('.boot')];
  if (!sections.length) return;
  if (!('IntersectionObserver' in window) || document.documentElement.classList.contains('still')) {
    sections.forEach((s) => s.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); }
  }, { rootMargin: '0px 0px -15% 0px' });
  sections.forEach((s) => io.observe(s));
}
