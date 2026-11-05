/**
 * Video scopes computed from a small graded frame (RGBA8).
 * Output is normalized so the UI can draw it at any size.
 */
export type ScopeMode = 'histogram' | 'waveform' | 'parade';

export type Histogram = { r: Float32Array; g: Float32Array; b: Float32Array; l: Float32Array };

export function computeHistogram(rgba: Uint8Array, bins = 64): Histogram {
  const r = new Float32Array(bins);
  const g = new Float32Array(bins);
  const b = new Float32Array(bins);
  const l = new Float32Array(bins);
  const k = bins / 256;
  for (let i = 0; i < rgba.length; i += 4) {
    const R = rgba[i];
    const G = rgba[i + 1];
    const B = rgba[i + 2];
    r[(R * k) | 0]++;
    g[(G * k) | 0]++;
    b[(B * k) | 0]++;
    l[((R * 0.2126 + G * 0.7152 + B * 0.0722) * k) | 0]++;
  }
  let max = 1;
  for (let i = 1; i < bins - 1; i++) max = Math.max(max, r[i], g[i], b[i], l[i]);
  for (const arr of [r, g, b, l]) for (let i = 0; i < bins; i++) arr[i] = Math.min(arr[i] / max, 1);
  return { r, g, b, l };
}

/**
 * Waveform density: columns × levels grid per channel (or luma).
 * Returned values are 0..1 intensities.
 */
export function computeWaveform(rgba: Uint8Array, width: number, height: number, levels = 48, channel: 'l' | 'r' | 'g' | 'b' = 'l') {
  const cols = width;
  const grid = new Float32Array(cols * levels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const v =
        channel === 'l'
          ? rgba[i] * 0.2126 + rgba[i + 1] * 0.7152 + rgba[i + 2] * 0.0722
          : rgba[i + (channel === 'r' ? 0 : channel === 'g' ? 1 : 2)];
      const level = Math.min(levels - 1, ((v / 256) * levels) | 0);
      grid[x * levels + level]++;
    }
  }
  const norm = 1 / Math.max(1, height * 0.25);
  for (let i = 0; i < grid.length; i++) grid[i] = Math.min(1, Math.sqrt(grid[i] * norm));
  return { cols, levels, grid };
}
