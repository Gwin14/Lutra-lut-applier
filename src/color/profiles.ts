/**
 * Camera input transforms: log curve decoding + camera gamut -> Rec.709.
 *
 * Every decoder receives the value a video decoder hands us (Y'CbCr limited
 * range already expanded to 0..1 "video level"). Curves that the manufacturer
 * specifies on 10-bit code values (CV/1023) get `legal: true` and are re-mapped
 * with cv = (x * 876 + 64) / 1023 first.
 *
 * Output of `decode` is scene-linear with 18% grey at ~0.18.
 * Pure TS: shared by the app, the export engine (WebView) and Node tests.
 */
import { GAMUT_TO_709, type GamutId } from './gamuts';

export type ProfileId =
  | 'rec709'
  | 'slog3'
  | 'slog2'
  | 'vlog'
  | 'clog3'
  | 'clog2'
  | 'logc3'
  | 'logc4'
  | 'flog'
  | 'flog2'
  | 'nlog'
  | 'dlog'
  | 'applelog'
  | 'hlg'
  | 'protune'
  | 'bmdfilm5';

export type CameraProfile = {
  id: ProfileId;
  name: string;
  brand: string;
  /** Short line shown under the name. */
  gamutLabel: string;
  kind: 'display' | 'log' | 'hdr';
  gamut: GamutId;
  legal: boolean;
  /** Multiplier applied after decoding so 18% grey lands at 0.18. */
  norm: number;
  decode: (x: number) => number;
};

const LN10 = Math.LN10;
const pow10 = (v: number) => Math.exp(v * LN10);

function slog3(x: number) {
  const cv = x * 1023;
  if (cv >= 171.2102946929) return pow10((cv - 420) / 261.5) * 0.19 - 0.01;
  return ((cv - 95) * 0.01125) / (171.2102946929 - 95);
}

function slog2(x: number) {
  // x is (CV - 64) / 876, exactly what a limited-range decoder returns.
  const k = 0.9 * (219 / 155);
  if (x >= 0.0296803652968) return (pow10((x - 0.616596 - 0.03) / 0.432699) - 0.037584) * k;
  return ((x - 0.030001222851889303) / 5) * k;
}

function vlog(x: number) {
  if (x < 0.181) return (x - 0.125) / 5.6;
  return pow10((x - 0.598206) / 0.241514) - 0.00873;
}

function clog3(x: number) {
  if (x < 0.097465473) return -(pow10((0.12783901 - x) / 0.36726845) - 1) / 14.98325;
  if (x <= 0.15277891) return (x - 0.12512219) / 1.9754798;
  return (pow10((x - 0.12240537) / 0.36726845) - 1) / 14.98325;
}

function clog2(x: number) {
  if (x < 0.092864125) return -(pow10((0.092864125 - x) / 0.24136077) - 1) / 87.099375;
  return (pow10((x - 0.092864125) / 0.24136077) - 1) / 87.099375;
}

function logc3(x: number) {
  if (x > 0.149658) return (pow10((x - 0.385537) / 0.24719) - 0.052272) / 5.555556;
  return (x - 0.092809) / 5.367655;
}

const LC4_A = (Math.pow(2, 18) - 16) / 117.45;
const LC4_B = (1023 - 95) / 1023;
const LC4_C = 95 / 1023;
const LC4_S = (7 * Math.LN2 * Math.pow(2, 7 - (14 * LC4_C) / LC4_B)) / (LC4_A * LC4_B);
const LC4_T = (Math.pow(2, 14 * (-LC4_C / LC4_B) + 6) - 64) / LC4_A;
function logc4(x: number) {
  if (x >= 0) return (Math.pow(2, (14 * (x - LC4_C)) / LC4_B + 6) - 64) / LC4_A;
  return x * LC4_S + LC4_T;
}

function flog(x: number) {
  if (x >= 0.100537775223865) return (pow10((x - 0.790453) / 0.344676) - 0.009468) / 0.555556;
  return (x - 0.092864) / 8.735631;
}

function flog2(x: number) {
  if (x >= 0.100686685370811) return (pow10((x - 0.384316) / 0.245281) - 0.064829) / 5.555556;
  return (x - 0.092864) / 8.799461;
}

function nlog(x: number) {
  if (x < 452 / 1023) return Math.pow(Math.max(x, 0) / (650 / 1023), 3) - 0.0075;
  return Math.exp((x - 619 / 1023) / (150 / 1023));
}

function dlog(x: number) {
  if (x <= 0.14) return (x - 0.0929) / 6.025;
  return (pow10(3.89616 * x - 2.27752) - 0.0108) / 0.9892;
}

const AL_R0 = -0.05641088;
const AL_C = 47.28711236;
const AL_B = 0.00964052;
const AL_G = 0.08550479;
const AL_D = 0.69336945;
const AL_PT = AL_C * (0.01 - AL_R0) * (0.01 - AL_R0);
function applelog(x: number) {
  if (x >= AL_PT) return Math.pow(2, (x - AL_D) / AL_G) - AL_B;
  if (x >= 0) return Math.sqrt(x / AL_C) + AL_R0;
  return AL_R0;
}

const HLG_A = 0.17883277;
const HLG_B = 1 - 4 * HLG_A;
const HLG_C = 0.5 - HLG_A * Math.log(4 * HLG_A);
function hlg(x: number) {
  if (x <= 0.5) return (Math.max(x, 0) * x) / 3;
  return (Math.exp((x - HLG_C) / HLG_A) + HLG_B) / 12;
}

function protune(x: number) {
  return (Math.pow(113, x) - 1) / 112;
}

const BM_A = 0.08692876065491224;
const BM_B = 0.005494072432257808;
const BM_C = 0.5300133392291939;
const BM_D = 8.283605932402494;
const BM_E = 0.09246575342465753;
const BM_LOG_CUT = BM_D * 0.005 + BM_E;
function bmdfilm5(x: number) {
  if (x < BM_LOG_CUT) return (x - BM_E) / BM_D;
  return Math.exp((x - BM_C) / BM_A) - BM_B;
}

export const PROFILES: CameraProfile[] = [
  {
    id: 'rec709',
    name: 'Rec.709 / Padrão',
    brand: 'Sem conversão',
    gamutLabel: 'Vídeo comum, já corrigido',
    kind: 'display',
    gamut: 'rec709',
    legal: false,
    norm: 1,
    decode: (x) => x,
  },
  {
    id: 'applelog',
    name: 'Apple Log',
    brand: 'iPhone',
    gamutLabel: 'Rec.2020',
    kind: 'log',
    gamut: 'rec2020',
    legal: false,
    norm: 1,
    decode: applelog,
  },
  {
    id: 'slog3',
    name: 'S-Log3',
    brand: 'Sony',
    gamutLabel: 'S-Gamut3.Cine',
    kind: 'log',
    gamut: 'sGamut3Cine',
    legal: true,
    norm: 1,
    decode: slog3,
  },
  {
    id: 'slog2',
    name: 'S-Log2',
    brand: 'Sony',
    gamutLabel: 'S-Gamut',
    kind: 'log',
    gamut: 'sGamut3',
    legal: false,
    norm: 1,
    decode: slog2,
  },
  {
    id: 'vlog',
    name: 'V-Log',
    brand: 'Panasonic',
    gamutLabel: 'V-Gamut',
    kind: 'log',
    gamut: 'vGamut',
    legal: true,
    norm: 1,
    decode: vlog,
  },
  {
    id: 'clog3',
    name: 'C-Log3',
    brand: 'Canon',
    gamutLabel: 'Cinema Gamut',
    kind: 'log',
    gamut: 'cinemaGamut',
    legal: false,
    norm: 1,
    decode: clog3,
  },
  {
    id: 'clog2',
    name: 'C-Log2',
    brand: 'Canon',
    gamutLabel: 'Cinema Gamut',
    kind: 'log',
    gamut: 'cinemaGamut',
    legal: false,
    norm: 1,
    decode: clog2,
  },
  {
    id: 'logc4',
    name: 'LogC4',
    brand: 'ARRI',
    gamutLabel: 'ARRI Wide Gamut 4',
    kind: 'log',
    gamut: 'awg4',
    legal: true,
    norm: 1,
    decode: logc4,
  },
  {
    id: 'logc3',
    name: 'LogC3',
    brand: 'ARRI',
    gamutLabel: 'ARRI Wide Gamut 3',
    kind: 'log',
    gamut: 'awg3',
    legal: true,
    norm: 1,
    decode: logc3,
  },
  {
    id: 'flog2',
    name: 'F-Log2',
    brand: 'Fujifilm',
    gamutLabel: 'F-Gamut',
    kind: 'log',
    gamut: 'rec2020',
    legal: true,
    norm: 1,
    decode: flog2,
  },
  {
    id: 'flog',
    name: 'F-Log',
    brand: 'Fujifilm',
    gamutLabel: 'F-Gamut',
    kind: 'log',
    gamut: 'rec2020',
    legal: true,
    norm: 1,
    decode: flog,
  },
  {
    id: 'nlog',
    name: 'N-Log',
    brand: 'Nikon',
    gamutLabel: 'Rec.2020',
    kind: 'log',
    gamut: 'rec2020',
    legal: true,
    norm: 1,
    decode: nlog,
  },
  {
    id: 'dlog',
    name: 'D-Log',
    brand: 'DJI',
    gamutLabel: 'D-Gamut',
    kind: 'log',
    gamut: 'dGamut',
    legal: true,
    norm: 1,
    decode: dlog,
  },
  {
    id: 'bmdfilm5',
    name: 'Film Gen 5',
    brand: 'Blackmagic',
    gamutLabel: 'Wide Gamut Gen 5',
    kind: 'log',
    gamut: 'bmdWideGamut',
    legal: false,
    norm: 1,
    decode: bmdfilm5,
  },
  {
    id: 'protune',
    name: 'Protune Log',
    brand: 'GoPro',
    gamutLabel: 'Protune Native',
    kind: 'log',
    gamut: 'protuneNative',
    legal: false,
    norm: 1,
    decode: protune,
  },
  {
    id: 'hlg',
    name: 'HLG / HDR',
    brand: 'iPhone, Android, câmeras',
    gamutLabel: 'Rec.2020',
    kind: 'hdr',
    gamut: 'rec2020',
    legal: false,
    // HLG 18% grey sits near 38% signal -> E ≈ 0.048 scene light.
    norm: 3.74,
    decode: hlg,
  },
];

const BY_ID = new Map(PROFILES.map((p) => [p.id, p]));

export function getProfile(id: ProfileId): CameraProfile {
  return BY_ID.get(id) ?? PROFILES[0];
}

export function isLogProfile(id: ProfileId) {
  return getProfile(id).kind !== 'display';
}

/** Returns a function mapping decoded video RGB -> scene linear Rec.709 (in place). */
export function makeInputTransform(id: ProfileId) {
  const p = getProfile(id);
  const m = GAMUT_TO_709[p.gamut];
  const legal = p.legal;
  const norm = p.norm;
  const dec = p.decode;
  return (rgb: Float64Array | number[]) => {
    let r = rgb[0];
    let g = rgb[1];
    let b = rgb[2];
    if (legal) {
      r = (r * 876 + 64) / 1023;
      g = (g * 876 + 64) / 1023;
      b = (b * 876 + 64) / 1023;
    }
    r = dec(r) * norm;
    g = dec(g) * norm;
    b = dec(b) * norm;
    rgb[0] = m[0] * r + m[1] * g + m[2] * b;
    rgb[1] = m[3] * r + m[4] * g + m[5] * b;
    rgb[2] = m[6] * r + m[7] * g + m[8] * b;
  };
}
