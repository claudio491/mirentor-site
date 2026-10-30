// shots.js: the four shots of the hero loop, in order. Every shot shows hands at work (no break shot:
// breaks are not paid, so the hero only shows time that counts). Labels live in the page strings (shot1..shot4).
// fy: vertical focus of the landscape plate (object-position), measured so no text covers the hands at
// 1024x768 through 1920x1080, including short laptop viewports (tests/hero-static.test.mjs).
export const SHOT_MS = 3000;

export const SHOTS = [
  { id: 'almacen', hands: true, key: 'shot1', fy: 0.25 },
  { id: 'construccion', hands: true, key: 'shot2', fy: 0.65 },
  { id: 'taller', hands: true, key: 'shot3', fy: 0.35 },
  { id: 'logistica', hands: true, key: 'shot4', fy: 0.35 },
];
