
export function counters(elapsedMs, shots, shotMs) {
  const t = Math.max(0, elapsedMs);
  const cycleMs = shots.length * shotMs;
  const countedPerCycle = shots.filter((s) => s.hands).length * shotMs;
  const cycles = Math.floor(t / cycleMs);
  const inCycle = t - cycles * cycleMs;
  const index = Math.min(shots.length - 1, Math.floor(inCycle / shotMs));
  let counted = cycles * countedPerCycle;
  for (let i = 0; i < index; i++) if (shots[i].hands) counted += shotMs;
  if (shots[index].hands) counted += inCycle - index * shotMs;
  return { recordedMs: t, countedMs: counted, index };
}

const pad = (n) => String(n).padStart(2, '0');

export function timecode(date, fps = 30) {
  const ff = Math.floor((date.getMilliseconds() / 1000) * fps);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}:${pad(ff)}`;
}

export function duration(ms) {
  const s = Math.floor(ms / 1000);
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
