/**
 * "Does this frame look like log?" heuristic, used only when the file's
 * metadata doesn't state its curve (see identify.ts).
 * Log footage is flat: compressed tonal range around a high mid-point and low
 * saturation. We look at a small downsampled frame (RGBA8).
 */

export type FrameStats = {
  p02: number;
  p50: number;
  p98: number;
  meanSaturation: number;
};

export type LogVerdict = {
  isLog: boolean;
  confidence: number; // 0..1
  stats: FrameStats;
};

export function frameStats(rgba: Uint8Array | Uint8ClampedArray, stepPixels = 1): FrameStats {
  const hist = new Uint32Array(256);
  let satSum = 0;
  let count = 0;
  for (let i = 0; i < rgba.length; i += 4 * stepPixels) {
    const r = rgba[i];
    const g = rgba[i + 1];
    const b = rgba[i + 2];
    const l = Math.round(r * 0.2126 + g * 0.7152 + b * 0.0722);
    hist[l]++;
    const mx = Math.max(r, g, b);
    const mn = Math.min(r, g, b);
    satSum += mx === 0 ? 0 : (mx - mn) / mx;
    count++;
  }
  const pct = (q: number) => {
    const target = q * count;
    let acc = 0;
    for (let i = 0; i < 256; i++) {
      acc += hist[i];
      if (acc >= target) return i / 255;
    }
    return 1;
  };
  return { p02: pct(0.02), p50: pct(0.5), p98: pct(0.98), meanSaturation: count ? satSum / count : 0 };
}

export function judgeLog(stats: FrameStats): LogVerdict {
  // Each cue scores 0..1; log footage usually hits all three.
  const liftedBlacks = clamp((stats.p02 - 0.04) / 0.08);
  const tamedWhites = clamp((0.92 - stats.p98) / 0.15);
  const lowSat = clamp((0.32 - stats.meanSaturation) / 0.18);
  const range = stats.p98 - stats.p02;
  const compressed = clamp((0.8 - range) / 0.3);
  const confidence = liftedBlacks * 0.35 + tamedWhites * 0.2 + lowSat * 0.25 + compressed * 0.2;
  return { isLog: confidence >= 0.55, confidence, stats };
}

function clamp(v: number) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
