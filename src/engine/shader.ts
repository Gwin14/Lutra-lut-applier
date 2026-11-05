/**
 * One fragment program, two backends.
 *
 * The body is written once in SkSL-compatible syntax (float2/float3/half4).
 * - Skia (live preview): `frame` and `lut` are child shaders.
 * - WebGL (export engine): a GLSL prelude maps the types and supplies
 *   `sampleFrame` (RGB texture or raw YUV planes) and `lutTexel`.
 *
 * Uniform contract (identical on both sides):
 *   uOut  float2  output size in px            uRaw  float2  raw (unrotated) frame size in px
 *   uRot  float   quarter turns clockwise      uCrop float4  crop rect in display space (0..1)
 *   uLut  float4  size, cols, texW, texH       uFx   float4  vignette, grain, grainSize, sharpen
 *   uView float4  split, falseColor, zebra, barsAspect      uMisc float2 time(s), brightness mul
 */

const BODY = /* glsl */ `
float lumaOf(float3 c) { return dot(c, float3(0.2126, 0.7152, 0.0722)); }

float hash12(float2 p) {
  float3 p3 = fract(float3(p.x, p.y, p.x) * 0.1031);
  p3 += dot(p3, float3(p3.y, p3.z, p3.x) + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float3 lutSample(float3 c) {
  float n = uLut.x;
  float cols = uLut.y;
  c = clamp(c, 0.0, 1.0);
  float bz = c.b * (n - 1.0);
  float b0 = floor(bz);
  float b1 = min(b0 + 1.0, n - 1.0);
  float f = bz - b0;
  float2 rg = float2(c.r, c.g) * (n - 1.0) + 0.5;
  float row0 = floor((b0 + 0.5) / cols);
  float row1 = floor((b1 + 0.5) / cols);
  float2 t0 = float2(b0 - row0 * cols, row0) * n;
  float2 t1 = float2(b1 - row1 * cols, row1) * n;
  return mix(lutTexel(t0 + rg), lutTexel(t1 + rg), f);
}

float2 displayToRaw(float2 s) {
  float2 t = s;
  if (uRot > 0.5 && uRot < 1.5) { t = float2(s.y, 1.0 - s.x); }
  else if (uRot > 1.5 && uRot < 2.5) { t = float2(1.0 - s.x, 1.0 - s.y); }
  else if (uRot > 2.5) { t = float2(1.0 - s.y, s.x); }
  return t * uRaw;
}

float3 falseColor(float l) {
  if (l < 0.02) { return float3(0.45, 0.1, 0.75); }
  if (l < 0.1) { return float3(0.12, 0.32, 0.95); }
  if (l >= 0.38 && l <= 0.45) { return float3(0.2, 0.8, 0.3); }
  if (l >= 0.56 && l <= 0.65) { return float3(1.0, 0.55, 0.72); }
  if (l >= 0.93 && l < 0.99) { return float3(1.0, 0.86, 0.1); }
  if (l >= 0.99) { return float3(0.95, 0.15, 0.1); }
  return float3(l * 0.6 + 0.12);
}

float3 renderPixel(float2 p) {
  float2 q = p / uOut;
  if (uView.w > 0.0) {
    float vis = (uOut.x / uOut.y) / uView.w;
    if (vis < 1.0) {
      float m = (1.0 - vis) * 0.5;
      if (q.y < m || q.y > 1.0 - m) { return float3(0.0); }
    }
  }
  float2 s = float2(uCrop.x, uCrop.y) + q * float2(uCrop.z, uCrop.w);
  float2 rp = displayToRaw(s);
  float3 src = sampleFrame(rp);
  float3 col = src;
  bool original = uView.x >= 0.0 && q.x < uView.x;
  if (!original) {
    float3 base = src;
    if (uFx.w > 0.0) {
      float2 dx = displayToRaw(s + float2(uCrop.z / uOut.x, 0.0)) - rp;
      float2 dy = displayToRaw(s + float2(0.0, uCrop.w / uOut.y)) - rp;
      float3 blur = (sampleFrame(rp + dx) + sampleFrame(rp - dx) + sampleFrame(rp + dy) + sampleFrame(rp - dy)) * 0.25;
      base = clamp(src + (src - blur) * uFx.w * 1.6, 0.0, 1.0);
    }
    col = lutSample(base);
    if (uFx.x != 0.0) {
      float aspect = uOut.x / uOut.y;
      float2 d = (q - 0.5) * float2(aspect, 1.0);
      float r = length(d) / length(float2(aspect, 1.0) * 0.5);
      float v = smoothstep(0.35, 1.05, r);
      if (uFx.x > 0.0) { col = col * (1.0 - uFx.x * v * 0.85); }
      else { col = mix(col, float3(1.0), -uFx.x * v * 0.6); }
    }
    if (uFx.y > 0.0) {
      float cells = 540.0 / uFx.z;
      float2 g = floor(q * float2(cells * uOut.x / uOut.y, cells));
      float nz = hash12(g + floor(uMisc.x * 24.0) * 17.0) - 0.5;
      float l = lumaOf(col);
      col = clamp(col + nz * uFx.y * 0.16 * (0.35 + 4.0 * l * (1.0 - l)), 0.0, 1.0);
    }
  }
  col = col * uMisc.y;
  if (uView.y > 0.5) { col = falseColor(lumaOf(col)); }
  if (uView.z > 0.0) {
    if (lumaOf(col) >= uView.z) {
      float st = mod(floor((p.x + p.y) / 6.0), 2.0);
      col = mix(col, float3(st), 0.75);
    }
  }
  if (uView.x >= 0.0 && abs(q.x - uView.x) * uOut.x < 1.0) { col = float3(1.0); }
  return col;
}
`;

const UNIFORMS = /* glsl */ `
uniform float2 uOut;
uniform float2 uRaw;
uniform float uRot;
uniform float4 uCrop;
uniform float4 uLut;
uniform float4 uFx;
uniform float4 uView;
uniform float2 uMisc;
`;

/** Skia runtime effect source. Children: frame (image shader), lut (image shader). */
export const SKSL_SOURCE = `
uniform shader frame;
uniform shader lut;
${UNIFORMS}
float3 sampleFrame(float2 px) { return frame.eval(px).rgb; }
float3 lutTexel(float2 px) { return lut.eval(px).rgb; }
${BODY}
half4 main(float2 p) { return half4(renderPixel(p), 1.0); }
`;

const GLSL_TYPES = `
precision highp float;
#define float2 vec2
#define float3 vec3
#define float4 vec4
`;

export const GLSL_VERTEX = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const GLSL_LUT = `
uniform sampler2D uLutTex;
float3 lutTexel(float2 px) { return texture2D(uLutTex, px / float2(uLut.z, uLut.w)).rgb; }
`;

const GLSL_MAIN = `
void main() {
  float2 p = float2(gl_FragCoord.x, uOut.y - gl_FragCoord.y);
  gl_FragColor = vec4(renderPixel(p), 1.0);
}
`;

/** Frame arrives as an RGB(A) texture (texImage2D of a VideoFrame/bitmap). */
export const GLSL_FRAGMENT_RGB = `${GLSL_TYPES}${UNIFORMS}
uniform sampler2D uFrameTex;
float3 sampleFrame(float2 px) { return texture2D(uFrameTex, px / uRaw).rgb; }
${GLSL_LUT}${BODY}${GLSL_MAIN}`;

/**
 * Frame arrives as raw Y'CbCr planes, so the browser never colour-manages HDR
 * or wide-gamut log footage behind our back.
 * uPlaneFmt: 0 = I420 8-bit, 1 = I420 10-bit (LE bytes in L/A), 2 = NV12.
 * uYuvRange: scaleY, offY, scaleC, offC applied to code values.
 * uYuvMat: Cr->R, Cb->G, Cr->G, Cb->B.
 */
export const GLSL_FRAGMENT_YUV = `${GLSL_TYPES}${UNIFORMS}
uniform sampler2D uPlaneY;
uniform sampler2D uPlaneU;
uniform sampler2D uPlaneV;
uniform float uPlaneFmt;
uniform float4 uYuvRange;
uniform float4 uYuvMat;
uniform float2 uChromaSize;

float code10(sampler2D s, float2 px, float2 size) {
  float2 c = px - 0.5;
  float2 i = floor(c);
  float2 f = c - i;
  float2 inv = 1.0 / size;
  float2 a = (clamp(i, float2(0.0), size - 1.0) + 0.5) * inv;
  float2 b = (clamp(i + 1.0, float2(0.0), size - 1.0) + 0.5) * inv;
  float4 t00 = texture2D(s, a);
  float4 t10 = texture2D(s, float2(b.x, a.y));
  float4 t01 = texture2D(s, float2(a.x, b.y));
  float4 t11 = texture2D(s, b);
  float v00 = t00.r * 255.0 + t00.a * 65280.0;
  float v10 = t10.r * 255.0 + t10.a * 65280.0;
  float v01 = t01.r * 255.0 + t01.a * 65280.0;
  float v11 = t11.r * 255.0 + t11.a * 65280.0;
  return mix(mix(v00, v10, f.x), mix(v01, v11, f.x), f.y);
}

float3 sampleFrame(float2 px) {
  float y;
  float u;
  float v;
  float2 cpx = px * (uChromaSize / uRaw);
  if (uPlaneFmt > 0.5 && uPlaneFmt < 1.5) {
    y = code10(uPlaneY, px, uRaw);
    u = code10(uPlaneU, cpx, uChromaSize);
    v = code10(uPlaneV, cpx, uChromaSize);
  } else if (uPlaneFmt > 1.5) {
    y = texture2D(uPlaneY, px / uRaw).r * 255.0;
    float4 uv = texture2D(uPlaneU, cpx / uChromaSize);
    u = uv.r * 255.0;
    v = uv.a * 255.0;
  } else {
    y = texture2D(uPlaneY, px / uRaw).r * 255.0;
    u = texture2D(uPlaneU, cpx / uChromaSize).r * 255.0;
    v = texture2D(uPlaneV, cpx / uChromaSize).r * 255.0;
  }
  float yy = y * uYuvRange.x + uYuvRange.y;
  float cb = u * uYuvRange.z + uYuvRange.w;
  float cr = v * uYuvRange.z + uYuvRange.w;
  return clamp(float3(yy + uYuvMat.x * cr, yy - uYuvMat.y * cb - uYuvMat.z * cr, yy + uYuvMat.w * cb), 0.0, 1.0);
}
${GLSL_LUT}${BODY}${GLSL_MAIN}`;

export type ShaderUniforms = {
  uOut: [number, number];
  uRaw: [number, number];
  uRot: number;
  uCrop: [number, number, number, number];
  uLut: [number, number, number, number];
  uFx: [number, number, number, number];
  uView: [number, number, number, number];
  uMisc: [number, number];
};
