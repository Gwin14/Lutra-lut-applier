import assert from 'node:assert/strict';
import { PROFILES, makeInputTransform } from '../src/color/profiles';
import { DEFAULT_GRADE, compileGrade, linearToSrgb } from '../src/color/grade';
import { bakeGradeLut, bakeGradeTexture } from '../src/color/bake';
import { sampleTexture, sampleLut, lutToTexture, identityLut, bytesToBase64, base64ToBytes } from '../src/color/lut';
import { parseCube, serializeCube } from '../src/color/cube';
import { BUILT_IN_LOOKS, compileBuiltInLook } from '../src/color/looks';
import { frameStats, judgeLog } from '../src/color/detect';

const none = () => null;
let failures = 0;
const test = (name: string, fn: () => void) => {
  try { fn(); console.log('ok  ', name); } catch (e) { failures++; console.log('FAIL', name, '\n    ', (e as Error).message); }
};

// Encoded 18% grey code value for each profile (manufacturer docs), as video-level x.
const GREY: Record<string, number> = {
  slog3: (420 - 64) / 876, slog2: 0.323, vlog: (433 - 64) / 876, clog3: 0.33096, clog2: 0.3879,
  logc3: (400 - 64) / 876, logc4: (0.2784 * 1023 - 64) / 876, flog: (470 - 64) / 876, flog2: (400 - 64) / 876,
  nlog: (372 - 64) / 876, dlog: (0.3988 * 1023 - 64) / 876, applelog: 0.4883, bmdfilm5: 0.3836, protune: 0.6457,
};

test('every log profile decodes its documented 18% grey to ~0.18 linear', () => {
  for (const p of PROFILES) {
    if (!(p.id in GREY)) continue;
    const g = GREY[p.id];
    const rgb = new Float64Array([g, g, g]);
    makeInputTransform(p.id)(rgb);
    // Neutral input stays neutral through the gamut matrix (rows sum to 1).
    assert.ok(Math.abs(rgb[0] - rgb[1]) < 2e-3 && Math.abs(rgb[1] - rgb[2]) < 2e-3, `${p.id} not neutral: ${rgb}`);
    assert.ok(Math.abs(rgb[1] - 0.18) < 0.006, `${p.id} grey -> ${rgb[1].toFixed(4)}`);
  }
});

test('log grey lands near 41% display after the filmic transform', () => {
  for (const id of Object.keys(GREY)) {
    const g = GREY[id];
    const rgb = new Float64Array([g, g, g]);
    compileGrade(id as any, DEFAULT_GRADE, null)(rgb);
    assert.ok(rgb[1] > 0.38 && rgb[1] < 0.45, `${id} display grey ${rgb[1].toFixed(3)}`);
  }
});

test('Rec.709 with neutral grade is identity', () => {
  const fn = compileGrade('rec709', DEFAULT_GRADE, null);
  for (const v of [0, 0.02, 0.18, 0.5, 0.77, 1]) {
    const rgb = new Float64Array([v, v * 0.5, 1 - v]);
    const ref = [...rgb];
    fn(rgb);
    for (let i = 0; i < 3; i++) assert.ok(Math.abs(rgb[i] - ref[i]) < 1e-6, `${ref} -> ${[...rgb]}`);
  }
});

test('GPU texture sampling matches the CPU pipeline within 8-bit tolerance', () => {
  const grade = { ...DEFAULT_GRADE, lookId: 'teal-orange', adjust: { ...DEFAULT_GRADE.adjust, contrast: 20, saturation: 15 } };
  const tex = bakeGradeTexture('slog3', grade, 33, none);
  const fn = compileGrade('slog3', grade, compileBuiltInLook('teal-orange'));
  let maxErr = 0;
  const errs: number[] = [];
  for (let i = 0; i < 4000; i++) {
    // Plausible scene colours in log space: near-neutral, moderate chroma.
    const v = 0.08 + Math.random() * 0.75;
    const j = () => v + (Math.random() - 0.5) * 0.1;
    const c = new Float64Array([j(), j(), j()]);
    const ref = new Float64Array(c);
    fn(ref);
    sampleTexture(tex, c);
    let e = 0;
    for (let k = 0; k < 3; k++) e = Math.max(e, Math.abs(c[k] - ref[k]));
    errs.push(e);
    maxErr = Math.max(maxErr, e);
  }
  errs.sort((a, b) => a - b);
  const p99 = errs[Math.floor(errs.length * 0.99)];
  console.log(`      33³ vs exact: p50 ${errs[errs.length >> 1].toFixed(4)} p99 ${p99.toFixed(4)} max ${maxErr.toFixed(4)}`);
  assert.ok(p99 < 0.05, `p99 error ${p99}`);
});

test('.cube round-trip keeps values', () => {
  const lut = bakeGradeLut('vlog', DEFAULT_GRADE, 17, none);
  const text = serializeCube(lut, 'Teste', ['comentário']);
  const parsed = parseCube(text);
  assert.equal(parsed.lut.size, 17);
  assert.equal(parsed.title, 'Teste');
  for (let i = 0; i < lut.data.length; i++) assert.ok(Math.abs(lut.data[i] - parsed.lut.data[i]) < 1e-5);
});

test('.cube with DOMAIN_MAX 2 is renormalized', () => {
  const n = 2;
  const rows = [];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) rows.push(`${r * 2} ${g * 2} ${b * 2}`);
  const parsed = parseCube(`LUT_3D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MAX 2 2 2\n${rows.join('\n')}`);
  const c = new Float64Array([0.5, 0.25, 1]);
  sampleLut(parsed.lut, c);
  assert.ok(Math.abs(c[0] - 0.5) < 1e-6 && Math.abs(c[1] - 0.25) < 1e-6 && Math.abs(c[2] - 1) < 1e-6, `${[...c]}`);
});

test('1D cube expands to 3D', () => {
  const parsed = parseCube('LUT_1D_SIZE 2\n0 0 0\n0.5 0.5 0.5\n');
  const c = new Float64Array([1, 0.5, 0]);
  sampleLut(parsed.lut, c);
  assert.ok(Math.abs(c[0] - 0.5) < 1e-3 && Math.abs(c[1] - 0.25) < 1e-3, `${[...c]}`);
});

test('every built-in look compiles and keeps output in range', () => {
  for (const look of BUILT_IN_LOOKS) {
    const fn = compileBuiltInLook(look.id)!;
    for (let i = 0; i < 300; i++) {
      const c = new Float64Array([Math.random(), Math.random(), Math.random()]);
      fn(c);
      for (const v of c) assert.ok(v >= 0 && v <= 1 && Number.isFinite(v), `${look.id}: ${v}`);
    }
  }
});

test('texture layout equals lutToTexture(identity)', () => {
  const tex = lutToTexture(identityLut(5));
  const c = new Float64Array([0.25, 0.75, 0.5]);
  sampleTexture(tex, c);
  assert.ok(Math.abs(c[0] - 0.25) < 0.01 && Math.abs(c[1] - 0.75) < 0.01 && Math.abs(c[2] - 0.5) < 0.01);
});

test('base64 round trip', () => {
  const bytes = new Uint8Array(1000).map((_, i) => (i * 37) & 255);
  assert.deepEqual(base64ToBytes(bytesToBase64(bytes)), bytes);
  assert.equal(bytesToBase64(new Uint8Array([1, 2])), Buffer.from([1, 2]).toString('base64'));
});

test('log detector: flat frame = log, punchy frame = not', () => {
  const make = (f: (i: number) => [number, number, number]) => {
    const a = new Uint8Array(4 * 4000);
    for (let i = 0; i < 4000; i++) { const [r, g, b] = f(i); a.set([r, g, b, 255], i * 4); }
    return a;
  };
  const flat = make((i) => { const v = 70 + (i % 120); return [v + 6, v, v - 4]; });
  const punchy = make((i) => { const v = (i * 7) % 256; return [v, (v * 3) % 256, 255 - v]; });
  assert.equal(judgeLog(frameStats(flat)).isLog, true);
  assert.equal(judgeLog(frameStats(punchy)).isLog, false);
});

test('bake performance', () => {
  for (const n of [17, 33]) {
    const t0 = performance.now();
    bakeGradeTexture('slog3', { ...DEFAULT_GRADE, lookId: 'teal-orange' }, n, none);
    console.log(`      bake ${n}³: ${(performance.now() - t0).toFixed(1)} ms (V8)`);
  }
});

console.log(linearToSrgb(0.18).toFixed(3), '= sRGB of 18% grey');
if (failures) { console.log(`${failures} failing`); process.exit(1); }
