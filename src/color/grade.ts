/**
 * Grade model and the CPU colour pipeline.
 *
 * The whole colour transform (input transform -> balance -> tone -> look ->
 * finish) is evaluated here and baked into a 3D LUT. The GPU only samples that
 * LUT plus a few spatial effects, so preview, export and the exported .cube
 * share one implementation and can never drift apart.
 */
import { makeInputTransform, getProfile, type ProfileId } from './profiles';

export type Adjustments = {
  exposure: number; // EV, -3..3
  temperature: number; // -100..100
  tint: number; // -100..100
  contrast: number; // -100..100
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  saturation: number;
  vibrance: number;
  shadowHue: number; // 0..360
  shadowAmount: number; // 0..100
  highlightHue: number;
  highlightAmount: number;
  fade: number; // 0..100
};

export type Effects = {
  vignette: number; // -100..100
  grain: number; // 0..100
  grainSize: number; // 1..3
  sharpen: number; // 0..100
};

export type Grade = {
  lookId: string | null;
  lookStrength: number; // 0..100
  adjust: Adjustments;
  effects: Effects;
};

export const DEFAULT_ADJUSTMENTS: Adjustments = {
  exposure: 0,
  temperature: 0,
  tint: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  saturation: 0,
  vibrance: 0,
  shadowHue: 200,
  shadowAmount: 0,
  highlightHue: 40,
  highlightAmount: 0,
  fade: 0,
};

export const DEFAULT_EFFECTS: Effects = { vignette: 0, grain: 0, grainSize: 1.5, sharpen: 0 };

export const DEFAULT_GRADE: Grade = {
  lookId: null,
  lookStrength: 100,
  adjust: DEFAULT_ADJUSTMENTS,
  effects: DEFAULT_EFFECTS,
};

/** A look maps display-referred Rec.709 RGB to display RGB (in place, 0..1). */
export type LookFn = (rgb: Float64Array) => void;

const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

export function srgbToLinear(v: number) {
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

export function linearToSrgb(v: number) {
  if (v <= 0) return 0;
  return v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
}

/** ACES-fitted filmic curve (Narkowicz) with exposure pre-scale. */
function filmic(x: number) {
  const v = Math.max(x, 0) * 0.6;
  return (v * (2.51 * v + 0.03)) / (v * (2.43 * v + 0.59) + 0.14);
}

function smoothstep(e0: number, e1: number, x: number) {
  const t = Math.min(Math.max((x - e0) / (e1 - e0), 0), 1);
  return t * t * (3 - 2 * t);
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Fully saturated hue (degrees) as an RGB offset around its own luma. */
export function hueOffset(h: number): [number, number, number] {
  const k = (n: number) => (n + h / 60) % 6;
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1));
  const r = f(5);
  const g = f(3);
  const b = f(1);
  const l = r * LR + g * LG + b * LB;
  return [r - l, g - l, b - l];
}

function sigmoidContrast(x: number, a: number) {
  if (a === 1) return x;
  const c = clamp01(x);
  const p = Math.pow(c, a);
  const q = Math.pow(1 - c, a);
  return p / (p + q);
}

/** Compiles a grade + input profile into a fast per-colour function. */
export function compileGrade(input: ProfileId, grade: Grade, look: LookFn | null) {
  const toLinear = makeInputTransform(input);
  const profile = getProfile(input);
  const isDisplay = profile.kind === 'display';
  const a = grade.adjust;

  const ev = Math.pow(2, a.exposure);
  const t = a.temperature / 100;
  const m = a.tint / 100;
  let wr = Math.pow(2, 0.32 * t);
  let wg = Math.pow(2, -0.22 * m);
  let wb = Math.pow(2, -0.32 * t);
  const wl = wr * LR + wg * LG + wb * LB;
  wr = (wr / wl) * ev;
  wg = (wg / wl) * ev;
  wb = (wb / wl) * ev;

  const c = a.contrast / 100;
  const contrastA = c >= 0 ? 1 + 1.25 * c : Math.max(0.35, 1 + 0.65 * c);
  const hl = a.highlights / 100;
  const sh = a.shadows / 100;
  const bp = -(a.blacks / 100) * 0.12;
  const wp = 1 - (a.whites / 100) * 0.18;
  const levelScale = 1 / (wp - bp);
  const sat = 1 + a.saturation / 100;
  const vib = a.vibrance / 100;
  const sOff = hueOffset(a.shadowHue);
  const hOff = hueOffset(a.highlightHue);
  const sAmt = (a.shadowAmount / 100) * 0.28;
  const hAmt = (a.highlightAmount / 100) * 0.28;
  const fade = a.fade / 100;
  const strength = grade.lookStrength / 100;
  const useLook = look !== null && strength > 0;
  const tmp = new Float64Array(3);
  const needsLevels = a.whites !== 0 || a.blacks !== 0;
  const needsTone = hl !== 0 || sh !== 0;

  return (rgb: Float64Array) => {
    // 1 · input transform -> scene linear, balance and exposure in linear light.
    let r: number;
    let g: number;
    let b: number;
    if (isDisplay) {
      r = srgbToLinear(clamp01(rgb[0])) * wr;
      g = srgbToLinear(clamp01(rgb[1])) * wg;
      b = srgbToLinear(clamp01(rgb[2])) * wb;
      r = linearToSrgb(Math.min(r, 1));
      g = linearToSrgb(Math.min(g, 1));
      b = linearToSrgb(Math.min(b, 1));
    } else {
      toLinear(rgb);
      r = rgb[0] * wr;
      g = rgb[1] * wg;
      b = rgb[2] * wb;
      // Out-of-gamut camera colours come out negative: desaturate toward luma
      // until they fit instead of clipping channels independently.
      const y = r * LR + g * LG + b * LB;
      const mn = Math.min(r, g, b);
      if (mn < 0) {
        if (y <= 0) {
          r = g = b = 0;
        } else {
          const k = y / (y - mn);
          r = y + (r - y) * k;
          g = y + (g - y) * k;
          b = y + (b - y) * k;
        }
      }
      r = linearToSrgb(filmic(r));
      g = linearToSrgb(filmic(g));
      b = linearToSrgb(filmic(b));
    }

    // 2 · tone in display space.
    if (contrastA !== 1) {
      r = sigmoidContrast(r, contrastA);
      g = sigmoidContrast(g, contrastA);
      b = sigmoidContrast(b, contrastA);
    }
    let l = r * LR + g * LG + b * LB;
    if (needsTone) {
      const hm = smoothstep(0.4, 1.0, l);
      const sm = 1 - smoothstep(0.0, 0.6, l);
      const d = hl * 0.3 * hm * (hl < 0 ? l : 1) + sh * 0.3 * sm * (sh > 0 ? 1 - l : 1);
      r += d;
      g += d;
      b += d;
    }
    if (needsLevels) {
      r = (r - bp) * levelScale;
      g = (g - bp) * levelScale;
      b = (b - bp) * levelScale;
    }
    r = clamp01(r);
    g = clamp01(g);
    b = clamp01(b);

    // 3 · colour.
    l = r * LR + g * LG + b * LB;
    let k = sat;
    if (vib !== 0) {
      const s = Math.max(r, g, b) - Math.min(r, g, b);
      k *= 1 + vib * (1 - s) * 1.1;
    }
    if (k !== 1) {
      r = l + (r - l) * k;
      g = l + (g - l) * k;
      b = l + (b - l) * k;
    }
    if (sAmt > 0 || hAmt > 0) {
      const sm = 1 - smoothstep(0.0, 0.55, l);
      const hm = smoothstep(0.45, 1.0, l);
      r += sOff[0] * sAmt * sm + hOff[0] * hAmt * hm;
      g += sOff[1] * sAmt * sm + hOff[1] * hAmt * hm;
      b += sOff[2] * sAmt * sm + hOff[2] * hAmt * hm;
    }
    r = clamp01(r);
    g = clamp01(g);
    b = clamp01(b);

    // 4 · creative look.
    if (useLook) {
      tmp[0] = r;
      tmp[1] = g;
      tmp[2] = b;
      look!(tmp);
      r += (clamp01(tmp[0]) - r) * strength;
      g += (clamp01(tmp[1]) - g) * strength;
      b += (clamp01(tmp[2]) - b) * strength;
    }

    // 5 · finish.
    if (fade > 0) {
      const lift = fade * 0.11;
      const span = 1 - lift - fade * 0.05;
      r = lift + r * span;
      g = lift + g * span;
      b = lift + b * span;
    }
    rgb[0] = clamp01(r);
    rgb[1] = clamp01(g);
    rgb[2] = clamp01(b);
  };
}

export function isNeutralGrade(input: ProfileId, grade: Grade) {
  if (getProfile(input).kind !== 'display') return false;
  if (grade.lookId && grade.lookStrength > 0) return false;
  const a = grade.adjust;
  return (Object.keys(DEFAULT_ADJUSTMENTS) as (keyof Adjustments)[]).every(
    (k) => k === 'shadowHue' || k === 'highlightHue' || a[k] === DEFAULT_ADJUSTMENTS[k],
  );
}
