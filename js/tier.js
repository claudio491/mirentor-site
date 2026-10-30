// tier.js: pick the motion tier. "full" on capable desktops, "lite" on constrained devices, "still" under reduced motion.

/** Pure: decides from a description of the environment. */
export function pickTier({ reducedMotion, saveData, effectiveType, deviceMemory, cores, width, webgl2 }) {
  if (reducedMotion) return 'still';
  if (saveData) return 'lite';
  if (effectiveType && /(^|-)(2g|3g)$/.test(effectiveType)) return 'lite';
  if (deviceMemory && deviceMemory <= 4) return 'lite';
  if (cores && cores <= 4) return 'lite';
  if (width < 768) return 'lite';
  if (!webgl2) return 'lite';
  return 'full';
}

/** Reads the real environment. */
export function readEnv() {
  const c = navigator.connection || {};
  let webgl2 = false;
  try { webgl2 = !!document.createElement('canvas').getContext('webgl2'); } catch { webgl2 = false; }
  return {
    reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
    saveData: !!c.saveData,
    effectiveType: c.effectiveType || '',
    deviceMemory: navigator.deviceMemory || 0,
    cores: navigator.hardwareConcurrency || 0,
    width: innerWidth,
    webgl2,
  };
}
