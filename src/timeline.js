// Scene timing with crossfades: each scene after the first starts `xfade`
// seconds before the previous one ends, so the clips overlap during the fade.
export const XFADE = 0.3;

export function sceneStarts(durs, xfade = XFADE) {
  const out = [];
  let t = 0;
  durs.forEach((d, i) => {
    out.push(i === 0 ? 0 : t - xfade * i);
    t += d;
  });
  return out;
}

export function totalDuration(durs, xfade = XFADE) {
  const sum = durs.reduce((a, b) => a + b, 0);
  return durs.length ? sum - xfade * (durs.length - 1) : 0;
}
