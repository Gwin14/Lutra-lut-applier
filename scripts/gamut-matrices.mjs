// Derives linear RGB -> Rec.709 matrices from published primaries (all D65).
// Output is pasted into src/color/gamuts.ts. Run: node scripts/gamut-matrices.mjs
const D65 = [0.3127, 0.329];
const GAMUTS = {
  rec709: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]],
  rec2020: [[0.708, 0.292], [0.17, 0.797], [0.131, 0.046]],
  p3d65: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]],
  sGamut3Cine: [[0.766, 0.275], [0.225, 0.8], [0.089, -0.087]],
  sGamut3: [[0.73, 0.28], [0.14, 0.855], [0.1, -0.05]],
  vGamut: [[0.73, 0.28], [0.165, 0.84], [0.1, -0.03]],
  cinemaGamut: [[0.74, 0.27], [0.17, 1.14], [0.08, -0.1]],
  awg3: [[0.684, 0.313], [0.221, 0.848], [0.0861, -0.102]],
  awg4: [[0.7347, 0.2653], [0.1424, 0.8576], [0.0991, -0.0308]],
  dGamut: [[0.71, 0.31], [0.21, 0.88], [0.09, -0.08]],
  bmdWideGamut: [[0.7177215, 0.3171181], [0.228041, 0.861569], [0.1005841, -0.0820452]],
  protuneNative: [[0.698448, 0.193026], [0.329555, 1.024597], [0.108443, -0.034679]],
};
const xyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];
const inv = (m) => {
  const [a, b, c, d, e, f, g, h, i] = m.flat();
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
};
const mul = (A, B) => A.map((r) => B[0].map((_, j) => r.reduce((s, v, k) => s + v * B[k][j], 0)));
const rgbToXyz = (prim) => {
  const P = [0, 1, 2].map((row) => prim.map((p) => xyz(p)[row]));
  const W = xyz(D65);
  const S = mul(inv(P), W.map((v) => [v])).map((r) => r[0]);
  return P.map((r) => r.map((v, j) => v * S[j]));
};
const to709 = inv(rgbToXyz(GAMUTS.rec709));
for (const [k, prim] of Object.entries(GAMUTS)) {
  const m = mul(to709, rgbToXyz(prim));
  console.log(`  ${k}: [${m.flat().map((v) => v.toFixed(6)).join(', ')}],`);
}
