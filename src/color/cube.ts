/**
 * Adobe/Resolve .cube reader & writer.
 * Supports 3D LUTs, 1D LUTs (expanded to 3D), DOMAIN_MIN/MAX and comments.
 */
import { bakeLut, sampleLut, type Lut3D } from './lut';

export type ParsedCube = { title: string | null; lut: Lut3D; sourceSize: number; kind: '3d' | '1d' };

export type CubeErrorCode = 'badLine' | 'notNumbers' | 'tooFewPoints' | 'tooLarge' | 'incomplete1d' | 'noSize';

/** Parse failure with a stable code; the UI localizes it (message is English, for logs). */
export class CubeParseError extends Error {
  constructor(
    readonly code: CubeErrorCode,
    message: string,
    readonly size?: number,
  ) {
    super(message);
  }
}

export function parseCube(text: string): ParsedCube {
  let title: string | null = null;
  let size3 = 0;
  let size1 = 0;
  let min = [0, 0, 0];
  let max = [1, 1, 1];
  const values: number[] = [];
  const lines = text.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const c = line.charCodeAt(0);
    const isNumeric = (c >= 48 && c <= 57) || c === 45 || c === 46 || c === 43;
    if (isNumeric) {
      const parts = line.split(/\s+/);
      if (parts.length < 3) throw new CubeParseError('badLine', 'Invalid data line in .cube file.');
      values.push(+parts[0], +parts[1], +parts[2]);
      continue;
    }
    const [key, ...rest] = line.split(/\s+/);
    const upper = key.toUpperCase();
    if (upper === 'TITLE') title = rest.join(' ').replace(/^"|"$/g, '') || null;
    else if (upper === 'LUT_3D_SIZE') size3 = parseInt(rest[0], 10);
    else if (upper === 'LUT_1D_SIZE') size1 = parseInt(rest[0], 10);
    else if (upper === 'DOMAIN_MIN') min = rest.slice(0, 3).map(Number);
    else if (upper === 'DOMAIN_MAX') max = rest.slice(0, 3).map(Number);
    // LUT_3D_INPUT_RANGE and vendor keywords are ignored on purpose.
  }
  if (values.some((v) => !Number.isFinite(v))) throw new CubeParseError('notNumbers', 'File contains non-numeric values.');

  if (size3 >= 2) {
    const expected = size3 * size3 * size3 * 3;
    if (values.length < expected) {
      throw new CubeParseError('tooFewPoints', `Expected ${size3}^3 points, file has fewer.`, size3);
    }
    if (size3 > 129) throw new CubeParseError('tooLarge', 'LUTs larger than 129^3 are not supported.');
    const data = new Float32Array(values.slice(0, expected));
    const normalized = normalizeDomain({ size: size3, data }, min, max);
    return { title, lut: normalized, sourceSize: size3, kind: '3d' };
  }
  if (size1 >= 2) {
    const expected = size1 * 3;
    if (values.length < expected) throw new CubeParseError('incomplete1d', 'Incomplete 1D LUT.');
    const curve = values.slice(0, expected);
    const sample = (ch: number, x: number) => {
      const t = ((x - min[ch]) / (max[ch] - min[ch])) * (size1 - 1);
      const i = Math.min(Math.max(Math.floor(t), 0), size1 - 2);
      const f = Math.min(Math.max(t - i, 0), 1);
      return curve[i * 3 + ch] + (curve[(i + 1) * 3 + ch] - curve[i * 3 + ch]) * f;
    };
    const lut = bakeLut(33, (rgb) => {
      rgb[0] = sample(0, rgb[0]);
      rgb[1] = sample(1, rgb[1]);
      rgb[2] = sample(2, rgb[2]);
    });
    return { title, lut, sourceSize: size1, kind: '1d' };
  }
  throw new CubeParseError('noSize', 'Missing LUT_3D_SIZE or LUT_1D_SIZE.');
}

function normalizeDomain(lut: Lut3D, min: number[], max: number[]): Lut3D {
  const identity = min.every((v) => v === 0) && max.every((v) => v === 1);
  if (identity) return lut;
  // Lattice spans [min, max]: re-sample so that it spans the 0..1 input range.
  return bakeLut(lut.size, (rgb) => {
    for (let c = 0; c < 3; c++) rgb[c] = (rgb[c] - min[c]) / (max[c] - min[c]);
    sampleLut(lut, rgb);
  });
}

export function serializeCube(lut: Lut3D, title: string, comments: string[] = []) {
  const n = lut.size;
  const lines: string[] = [];
  for (const c of comments) lines.push(`# ${c}`);
  lines.push(`TITLE "${title.replace(/"/g, "'")}"`);
  lines.push(`LUT_3D_SIZE ${n}`);
  lines.push('DOMAIN_MIN 0.0 0.0 0.0');
  lines.push('DOMAIN_MAX 1.0 1.0 1.0');
  const d = lut.data;
  for (let i = 0; i < d.length; i += 3) {
    lines.push(`${d[i].toFixed(6)} ${d[i + 1].toFixed(6)} ${d[i + 2].toFixed(6)}`);
  }
  return lines.join('\n') + '\n';
}
