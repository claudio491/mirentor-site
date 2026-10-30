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
