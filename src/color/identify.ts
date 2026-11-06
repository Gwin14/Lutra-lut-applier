/**
 * Decides a clip's camera profile from what the file says about itself.
 *
 * Order of trust:
 *  1. `metadata` — the file states its curve: Sony NRT XML (CaptureGammaEquation),
 *     Fujifilm VideoRecordingMode, Panasonic PhotoStyle, gamma/transfer tags,
 *     the decoder's transfer function (Apple Log, HLG) or CICP colour tags.
 *  2. `camera`   — the file names the camera but not the curve; the frame
 *     analysis only answers "log or not", the brand picks which log.
 *  3. `image`    — nothing identifiable; frame analysis + the user's default log.
 * The file name is never used.
 * Pure TS: shared with Node tests.
 */
import type { ContainerInfo } from './container';
import type { LogVerdict } from './detect';
import type { ProfileId } from './profiles';

/** What the OS decoder reports (AVFoundation / MediaExtractor), already normalised. */
export type DecoderColor = {
  transfer: 'applelog' | 'hlg' | 'pq' | '709' | 'other' | null;
  primaries: '2020' | '709' | 'p3' | 'other' | null;
  bitDepth: number | null;
};

export type DetectionSource = 'metadata' | 'camera' | 'image' | 'none';

export type Detection = {
  isLog: boolean;
  confidence: number;
  /** Missing on clips imported before metadata detection existed (frame analysis). */
  source?: DetectionSource;
  /** Which field decided it, e.g. "CaptureGammaEquation = s-log3-cine". */
  evidence?: string;
  /** "Sony ILCE-7SM3", when the file names the camera. */
  camera?: string;
  /** The profile detection picked (the user may change the clip's profile later). */
  profile?: ProfileId;
};

export type Identified = { input: ProfileId; detection: Detection };

const norm = (s: string) => s.toLowerCase().replace(/[\s_.\-()]/g, '');

/** Curve names as cameras and apps write them (normalised: no spaces, dots or dashes). */
const CURVES: [RegExp, ProfileId][] = [
  [/slog3/, 'slog3'],
  [/slog2/, 'slog2'],
  [/vlog/, 'vlog'],
  [/(clog|canonlog)3/, 'clog3'],
  [/(clog|canonlog)2/, 'clog2'],
  [/logc4/, 'logc4'],
  [/logc3?/, 'logc3'],
  [/flog2/, 'flog2'],
  [/flog/, 'flog'],
  [/nlog/, 'nlog'],
  [/dlog/, 'dlog'],
  [/applelog/, 'applelog'],
  [/(blackmagic|bmd)?(designfilm|filmgen5|widegamutgen5)/, 'bmdfilm5'],
  [/protunelog|goprolog/, 'protune'],
  [/hlg|aribstdb67|hybridloggamma|bt2100hlg/, 'hlg'],
];

/** Display-referred values: the clip is already "normal" video. */
const DISPLAY = /^(rec709|bt709|itur709|itu709|709|rec709800|rec709xvycc|scinetone|cine[1-4]|still|movie|standard|normal|sdr|gamma22|gamma24|srgb|like709|cinelike[dv]2?)$/;

const GAMMA_KEY = /(gamma|transfer|tonecurve|tonemap|curve|colorprofile|pictureprofile|logmode)/;
const IGNORE_KEY = /(title|comment|description|name$|album|artist|author|copyright|keywords|location|serial)/;

function curveOf(value: string): ProfileId | null {
  const v = norm(value);
  if (!v || v.length > 40) return null;
  if (DISPLAY.test(v)) return 'rec709';
  for (const [re, id] of CURVES) if (re.test(v)) return id;
  return null;
}

const FUJI_MODE: Record<string, ProfileId> = { '0': 'rec709', '16': 'flog', '32': 'hlg', '48': 'flog2' };
const FUJI_LABEL: Record<string, string> = { '0': 'Normal', '16': 'F-Log', '32': 'HLG', '48': 'F-Log2' };

const BRANDS: [RegExp, ProfileId, string][] = [
  [/\bsony\b/i, 'slog3', 'Sony'],
  [/panasonic|lumix/i, 'vlog', 'Panasonic'],
  [/\bcanon\b/i, 'clog3', 'Canon'],
  [/fujifilm|\bfuji\b/i, 'flog2', 'Fujifilm'],
  [/\bnikon\b/i, 'nlog', 'Nikon'],
  [/\bdji\b/i, 'dlog', 'DJI'],
  [/gopro/i, 'protune', 'GoPro'],
  [/blackmagic/i, 'bmdfilm5', 'Blackmagic'],
  [/\barri\b|alexa/i, 'logc3', 'ARRI'],
  [/\bapple\b|iphone/i, 'applelog', 'Apple'],
];

function cameraName(c: ContainerInfo | null): { label: string | null; brand: (typeof BRANDS)[number] | null } {
  if (!c) return { label: null, brand: null };
  const hay = [c.make, c.model, c.compressor, c.software, c.tags['firm'], c.tags['device.manufacturer']].filter(Boolean).join(' ');
  const brand = BRANDS.find(([re]) => re.test(hay)) ?? null;
  const make = c.make?.trim();
  const model = c.model?.trim();
  let label = model && make && !model.toLowerCase().startsWith(make.toLowerCase().split(' ')[0]) ? `${make} ${model}` : model || make || null;
  if (!label && brand) label = brand[2];
  return { label, brand };
}

function metadataCurve(c: ContainerInfo | null, dec: DecoderColor | null, camera: ReturnType<typeof cameraName>): { id: ProfileId; evidence: string } | null {
  const t = c?.tags ?? {};

  // Sony XAVC: NonRealTimeMeta XML.
  const sony = t['capturegammaequation'];
  if (sony) {
    const id = curveOf(sony);
    if (id) return { id, evidence: `CaptureGammaEquation = ${sony}` };
  }

  // Fujifilm: maker note VideoRecordingMode (MVTG).
  const fuji = t['fuji.0x3803'] ?? (camera.brand?.[2] === 'Fujifilm' ? t['0x3803'] : undefined);
  if (fuji && FUJI_MODE[fuji]) return { id: FUJI_MODE[fuji], evidence: `VideoRecordingMode = ${FUJI_LABEL[fuji]}` };

  // Panasonic/Leica: maker note PhotoStyle (17 = V-Log) and HybridLogGamma.
  const style = t['panasonic.0x0089'];
  if (style) {
    if (style === '17') return { id: 'vlog', evidence: 'PhotoStyle = V-Log' };
    if (t['panasonic.0x00d4'] === '1') return { id: 'hlg', evidence: 'HybridLogGamma = On' };
    return { id: 'rec709', evidence: `PhotoStyle = ${style}` };
  }

  // The decoder's own reading of the stream (VUI / format description).
  if (dec?.transfer === 'applelog') return { id: 'applelog', evidence: 'Transfer function = Apple Log' };
  if (dec?.transfer === 'hlg') return { id: 'hlg', evidence: 'Transfer function = HLG (ARIB STD-B67)' };

  // Any gamma/transfer-like tag (Blackmagic, ARRI, Canon XML, camera apps…).
  for (const [k, v] of Object.entries(t)) {
    const key = norm(k);
    if (IGNORE_KEY.test(key)) continue;
    const gammaKey = GAMMA_KEY.test(key);
    const id = curveOf(v);
    if (!id) continue;
    // Outside gamma-named keys only a short, curve-only value counts (and never "709").
    if (gammaKey || (id !== 'rec709' && norm(v).length <= 16)) return { id, evidence: `${k} = ${v}` };
  }

  // CICP tags in the container.
  if (c?.cicp?.transfer === 18) return { id: 'hlg', evidence: 'colr transfer = 18 (HLG)' };

  // iPhone: always tags its streams; BT.2020 without HLG/PQ/709 transfer is Apple Log.
  if (camera.brand?.[2] === 'Apple') {
    const tr = c?.cicp?.transfer;
    const prim2020 = c?.cicp?.primaries === 9 || dec?.primaries === '2020';
    if (dec?.transfer === '709' || (tr != null && [1, 6, 14, 15].includes(tr))) return { id: 'rec709', evidence: 'Transfer = Rec.709' };
    if (prim2020 && dec?.transfer !== 'pq' && tr !== 16) return { id: 'applelog', evidence: 'BT.2020, non-HDR transfer (Apple Log)' };
  }
  return null;
}

export function identifyProfile(opts: Parameters<typeof identify>[0]): Identified {
  const r = identify(opts);
  return { input: r.input, detection: { ...r.detection, profile: r.input } };
}

function identify(opts: {
  container: ContainerInfo | null;
  decoder: DecoderColor | null;
  verdict: LogVerdict | null;
  preferredLog: ProfileId;
}): Identified {
  const { container, decoder, verdict, preferredLog } = opts;
  const camera = cameraName(container);
  const cam = camera.label ?? undefined;

  const meta = metadataCurve(container, decoder, camera);
  if (meta) {
    const isLog = meta.id !== 'rec709';
    return { input: meta.id, detection: { isLog, confidence: 1, source: 'metadata', evidence: meta.evidence, camera: cam } };
  }

  if (camera.brand && verdict) {
    // ARRI: the ALEXA 35 records LogC4, everything older LogC3.
    let brandLog = camera.brand[1];
    if (brandLog === 'logc3' && /alexa\s*35/i.test(container?.model ?? '')) brandLog = 'logc4';
    return {
      input: verdict.isLog ? brandLog : 'rec709',
      detection: { isLog: verdict.isLog, confidence: verdict.confidence, source: 'camera', camera: cam },
    };
  }

  if (verdict) {
    return { input: verdict.isLog ? preferredLog : 'rec709', detection: { isLog: verdict.isLog, confidence: verdict.confidence, source: 'image', camera: cam } };
  }
  return { input: 'rec709', detection: { isLog: false, confidence: 0, source: 'none', camera: cam } };
}
