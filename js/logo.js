
export function introLogo(root, { reduced }) {
  if (reduced || !root) return Promise.resolve();
  const anims = root.getAnimations({ subtree: true });
  return Promise.all(anims.map((a) => a.finished.catch(() => {}))).then(() => {});
}
