// logo.js: the logo intro itself is CSS (header.css, keyed on html.intro). This resolves when it has finished,
// so the hero can start its lock-on right after the M has locked on.

/** Resolves when every animation inside the logo has finished (immediately under reduced motion). */
export function introLogo(root, { reduced }) {
  if (reduced || !root) return Promise.resolve();
  const anims = root.getAnimations({ subtree: true });
  return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {});
}
