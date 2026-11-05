/**
 * 3D LUT storage, sampling, baking and the GPU tile layout.
 *
 * Data order matches .cube: red varies fastest, then green, then blue.
 * On the GPU a LUT is a 2D RGBA8 texture: one N×N tile per blue slice, tiles
 * laid out in a grid of `cols` columns. Both shaders (Skia + WebGL) decode the
 * same layout through `lutLayout`.
 */
export type Lut3D = {
  size: number;
  data: Float32Array; // size^3 * 3
};

export type LutTexture = {
  size: number;
  cols: number;
  width: number;
  height: number;
  bytes: Uint8Array; // RGBA8, width * height * 4
};

export function lutLayout(size: number) {
  const cols = Math.ceil(Math.sqrt(size));
  const rows = Math.ceil(size / cols);
  return { cols, rows, width: cols * size, height: rows * size };
}

export function identityLut(size: number): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  const s = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        data[i++] = r / s;
        data[i++] = g / s;
        data[i++] = b / s;
      }
  return { size, data };
}

/** Trilinear sample, in place on `rgb`. */
export function sampleLut(lut: Lut3D, rgb: Float64Array) {
  const n = lut.size;
  const s = n - 1;
  const d = lut.data;
  const fr = Math.min(Math.max(rgb[0], 0), 1) * s;
  const fg = Math.min(Math.max(rgb[1], 0), 1) * s;
  const fb = Math.min(Math.max(rgb[2], 0), 1) * s;
  const r0 = Math.min(Math.floor(fr), s - 1);
  const g0 = Math.min(Math.floor(fg), s - 1);
  const b0 = Math.min(Math.floor(fb), s - 1);
  const tr = fr - r0;
  const tg = fg - g0;
  const tb = fb - b0;
  const n2 = n * n;
  const i000 = (r0 + g0 * n + b0 * n2) * 3;
  const i100 = i000 + 3;
  const i010 = i000 + n * 3;
  const i110 = i010 + 3;
  const i001 = i000 + n2 * 3;
  const i101 = i001 + 3;
  const i011 = i001 + n * 3;
  const i111 = i011 + 3;
  for (let c = 0; c < 3; c++) {
    const c00 = d[i000 + c] + (d[i100 + c] - d[i000 + c]) * tr;
    const c10 = d[i010 + c] + (d[i110 + c] - d[i010 + c]) * tr;
    const c01 = d[i001 + c] + (d[i101 + c] - d[i001 + c]) * tr;
    const c11 = d[i011 + c] + (d[i111 + c] - d[i011 + c]) * tr;
    const c0 = c00 + (c10 - c00) * tg;
    const c1 = c01 + (c11 - c01) * tg;
    rgb[c] = c0 + (c1 - c0) * tb;
  }
}

export function lutAsLook(lut: Lut3D) {
  return (rgb: Float64Array) => sampleLut(lut, rgb);
}

/** Evaluates `fn` on every lattice point. */
export function bakeLut(size: number, fn: (rgb: Float64Array) => void): Lut3D {
  const data = new Float32Array(size * size * size * 3);
  const rgb = new Float64Array(3);
  const s = size - 1;
  let i = 0;
  for (let b = 0; b < size; b++)
    for (let g = 0; g < size; g++)
      for (let r = 0; r < size; r++) {
        rgb[0] = r / s;
        rgb[1] = g / s;
        rgb[2] = b / s;
        fn(rgb);
        data[i++] = rgb[0];
        data[i++] = rgb[1];
        data[i++] = rgb[2];
      }
  return { size, data };
}

/** Resamples any LUT to another lattice size (used for imported 65³ looks). */
export function resampleLut(lut: Lut3D, size: number): Lut3D {
  if (lut.size === size) return lut;
  return bakeLut(size, (rgb) => sampleLut(lut, rgb));
}

export function lutToTexture(lut: Lut3D): LutTexture {
  const n = lut.size;
  const { cols, width, height } = lutLayout(n);
  const bytes = new Uint8Array(width * height * 4);
  const d = lut.data;
  let i = 0;
  for (let b = 0; b < n; b++) {
    const tx = (b % cols) * n;
    const ty = Math.floor(b / cols) * n;
    for (let g = 0; g < n; g++) {
      let o = ((ty + g) * width + tx) * 4;
      for (let r = 0; r < n; r++) {
        bytes[o] = Math.round(Math.min(Math.max(d[i], 0), 1) * 255);
        bytes[o + 1] = Math.round(Math.min(Math.max(d[i + 1], 0), 1) * 255);
        bytes[o + 2] = Math.round(Math.min(Math.max(d[i + 2], 0), 1) * 255);
        bytes[o + 3] = 255;
        o += 4;
        i += 3;
      }
    }
  }
  return { size: n, cols, width, height, bytes };
}

/** Bakes straight into the texture layout without the intermediate Float32Array. */
export function bakeTexture(size: number, fn: (rgb: Float64Array) => void): LutTexture {
  const { cols, width, height } = lutLayout(size);
  const bytes = new Uint8Array(width * height * 4);
  const rgb = new Float64Array(3);
  const s = size - 1;
  for (let b = 0; b < size; b++) {
    const tx = (b % cols) * size;
    const ty = Math.floor(b / cols) * size;
    for (let g = 0; g < size; g++) {
      let o = ((ty + g) * width + tx) * 4;
      for (let r = 0; r < size; r++) {
        rgb[0] = r / s;
        rgb[1] = g / s;
        rgb[2] = b / s;
        fn(rgb);
        bytes[o] = (Math.min(Math.max(rgb[0], 0), 1) * 255 + 0.5) | 0;
        bytes[o + 1] = (Math.min(Math.max(rgb[1], 0), 1) * 255 + 0.5) | 0;
        bytes[o + 2] = (Math.min(Math.max(rgb[2], 0), 1) * 255 + 0.5) | 0;
        bytes[o + 3] = 255;
        o += 4;
      }
    }
  }
  return { size, cols, width, height, bytes };
}

/** Samples a baked texture on the CPU exactly like the shaders do. */
export function sampleTexture(tex: LutTexture, rgb: Float64Array) {
  const n = tex.size;
  const s = n - 1;
  const { cols, width, bytes } = tex;
  const bf = Math.min(Math.max(rgb[2], 0), 1) * s;
  const b0 = Math.floor(bf);
  const b1 = Math.min(b0 + 1, s);
  const f = bf - b0;
  const rf = Math.min(Math.max(rgb[0], 0), 1) * s;
  const gf = Math.min(Math.max(rgb[1], 0), 1) * s;
  const r0 = Math.min(Math.floor(rf), s - 1);
  const g0 = Math.min(Math.floor(gf), s - 1);
  const tr = rf - r0;
  const tg = gf - g0;
  const out = [0, 0, 0];
  for (const [slice, w] of [
    [b0, 1 - f],
    [b1, f],
  ] as const) {
    if (w === 0) continue;
    const tx = (slice % cols) * n + r0;
    const ty = Math.floor(slice / cols) * n + g0;
    const p00 = (ty * width + tx) * 4;
    const p10 = p00 + 4;
    const p01 = p00 + width * 4;
    const p11 = p01 + 4;
    for (let c = 0; c < 3; c++) {
      const top = bytes[p00 + c] + (bytes[p10 + c] - bytes[p00 + c]) * tr;
      const bot = bytes[p01 + c] + (bytes[p11 + c] - bytes[p01 + c]) * tr;
      out[c] += ((top + (bot - top) * tg) / 255) * w;
    }
  }
  rgb[0] = out[0];
  rgb[1] = out[1];
  rgb[2] = out[2];
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

export function bytesToBase64(bytes: Uint8Array) {
  let out = '';
  const len = bytes.length;
  const chunk: string[] = [];
  for (let i = 0; i < len; i += 3) {
    const a = bytes[i];
    const b = i + 1 < len ? bytes[i + 1] : 0;
    const c = i + 2 < len ? bytes[i + 2] : 0;
    const n = (a << 16) | (b << 8) | c;
    chunk.push(
      B64[(n >> 18) & 63] +
        B64[(n >> 12) & 63] +
        (i + 1 < len ? B64[(n >> 6) & 63] : '=') +
        (i + 2 < len ? B64[n & 63] : '='),
    );
    if (chunk.length >= 4096) {
      out += chunk.join('');
      chunk.length = 0;
    }
  }
  return out + chunk.join('');
}

const B64_LOOKUP = (() => {
  const t = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  t['-'.charCodeAt(0)] = 62;
  t['_'.charCodeAt(0)] = 63;
  return t;
})();

export function base64ToBytes(b64: string) {
  let len = b64.length;
  while (len > 0 && b64[len - 1] === '=') len--;
  const out = new Uint8Array(Math.floor((len * 3) / 4));
  let o = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[b64.charCodeAt(i)];
    const b = B64_LOOKUP[b64.charCodeAt(i + 1)];
    const c = i + 2 < len ? B64_LOOKUP[b64.charCodeAt(i + 2)] : 0;
    const d = i + 3 < len ? B64_LOOKUP[b64.charCodeAt(i + 3)] : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    if (o < out.length) out[o++] = (n >> 16) & 255;
    if (o < out.length) out[o++] = (n >> 8) & 255;
    if (o < out.length) out[o++] = n & 255;
  }
  return out;
}
