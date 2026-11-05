import type { AspectId, QualityId, ResolutionId } from './protocol';

export const ASPECT_VALUES: Record<Exclude<AspectId, 'original'>, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '1:1': 1,
  '4:5': 4 / 5,
  '4:3': 4 / 3,
  '2.39:1': 2.39,
};

export function aspectValue(aspect: AspectId, displayW: number, displayH: number) {
  return aspect === 'original' ? displayW / displayH : ASPECT_VALUES[aspect];
}

/** Center "cover" crop of a display-space frame to the target aspect, normalized 0..1. */
export function coverCrop(displayW: number, displayH: number, targetAspect: number): [number, number, number, number] {
  const a = displayW / displayH;
  if (Math.abs(a - targetAspect) < 1e-3) return [0, 0, 1, 1];
  if (a > targetAspect) {
    const w = targetAspect / a;
    return [(1 - w) / 2, 0, w, 1];
  }
  const h = a / targetAspect;
  return [0, (1 - h) / 2, 1, h];
}

const even = (v: number) => Math.max(2, Math.round(v / 2) * 2);

/** Output pixel size for a display-space source, aspect and resolution choice. */
export function outputSize(displayW: number, displayH: number, aspect: AspectId, resolution: ResolutionId) {
  const target = aspectValue(aspect, displayW, displayH);
  const [, , cw, ch] = coverCrop(displayW, displayH, target);
  const srcW = displayW * cw;
  const srcH = displayH * ch;
  const srcShort = Math.min(srcW, srcH);
  // Never upscale: a 720p clip asked for 1080 stays 720.
  const short = resolution === 'source' ? srcShort : Math.min(Number(resolution), srcShort);
  const scale = short / srcShort;
  return { width: even(srcW * scale), height: even(srcH * scale) };
}

const BITS_PER_PIXEL: Record<QualityId, number> = { low: 0.05, medium: 0.08, high: 0.12, max: 0.2 };

/** H.264-equivalent bitrate; efficient codecs get a discount. */
export function estimateBitrate(width: number, height: number, fps: number, quality: QualityId, codec: string) {
  const efficiency = codec === 'avc' ? 1 : codec === 'hevc' || codec === 'vp9' ? 0.65 : 0.55;
  const raw = width * height * fps * BITS_PER_PIXEL[quality] * efficiency;
  return Math.round(Math.min(Math.max(raw, 1.5e6), 120e6));
}

export const STANDARD_RATES = [23.976, 24, 25, 29.97, 30, 48, 50, 59.94, 60, 120];

export function snapFrameRate(rate: number) {
  if (!Number.isFinite(rate) || rate <= 0) return 30;
  let best = STANDARD_RATES[0];
  for (const r of STANDARD_RATES) if (Math.abs(r - rate) < Math.abs(best - rate)) best = r;
  return Math.abs(best - rate) < 1.5 ? best : Math.round(rate);
}
