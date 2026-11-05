/**
 * Built-in creative looks. Each look is a small recipe of colour operations on
 * display-referred Rec.709 RGB. They are compiled once into functions and
 * evaluated by the grade bake, so they cost nothing extra at render time.
 */
import { hueOffset, type LookFn } from './grade';

export type LookCategory = 'essenciais' | 'cinema' | 'filme' | 'natureza' | 'criativo' | 'pb';

export const LOOK_CATEGORIES: { id: LookCategory; label: string }[] = [
  { id: 'essenciais', label: 'Essenciais' },
  { id: 'cinema', label: 'Cinema' },
  { id: 'filme', label: 'Filme' },
  { id: 'natureza', label: 'Natureza' },
  { id: 'criativo', label: 'Criativo' },
  { id: 'pb', label: 'P&B' },
];

type Pt = [number, number];
type Op =
  | { op: 'curve'; all?: Pt[]; r?: Pt[]; g?: Pt[]; b?: Pt[] }
  | { op: 'sat'; v: number }
  | { op: 'gain'; r: number; g: number; b: number }
  | { op: 'split'; sh: number; sa: number; hh: number; ha: number }
  | { op: 'warp'; targets: { hue: number; pull: number; width: number }[] }
  | { op: 'mono'; r: number; g: number; b: number }
  | { op: 'tint'; hue: number; amount: number }
  | { op: 'bleach'; amount: number }
  | { op: 'fade'; lift: number; crush?: number };

export type BuiltInLook = {
  id: string;
  name: string;
  category: LookCategory;
  description: string;
  ops: Op[];
};

const S_SOFT: Pt[] = [
  [0, 0],
  [0.25, 0.22],
  [0.5, 0.5],
  [0.75, 0.78],
  [1, 1],
];
const S_MED: Pt[] = [
  [0, 0],
  [0.22, 0.17],
  [0.5, 0.5],
  [0.78, 0.83],
  [1, 1],
];
const S_HARD: Pt[] = [
  [0, 0],
  [0.2, 0.12],
  [0.5, 0.5],
  [0.8, 0.89],
  [1, 1],
];

export const BUILT_IN_LOOKS: BuiltInLook[] = [
  {
    id: 'clean-punch',
    name: 'Punch Limpo',
    category: 'essenciais',
    description: 'Contraste e cor na medida, sem mudar o tom.',
    ops: [
      { op: 'curve', all: S_MED },
      { op: 'sat', v: 1.12 },
    ],
  },
  {
    id: 'soft-natural',
    name: 'Natural Suave',
    category: 'essenciais',
    description: 'Pele bonita, contraste gentil, levemente quente.',
    ops: [
      { op: 'curve', all: S_SOFT },
      { op: 'gain', r: 1.02, g: 1.0, b: 0.97 },
      { op: 'sat', v: 1.04 },
    ],
  },
  {
    id: 'high-key',
    name: 'High-Key',
    category: 'essenciais',
    description: 'Claro e arejado, ótimo para produto e lifestyle.',
    ops: [
      { op: 'curve', all: [[0, 0.06], [0.3, 0.42], [0.7, 0.85], [1, 1]] },
      { op: 'sat', v: 0.9 },
    ],
  },
  {
    id: 'teal-orange',
    name: 'Teal & Laranja',
    category: 'cinema',
    description: 'O clássico de blockbuster: pele quente, sombras ciano.',
    ops: [
      { op: 'warp', targets: [{ hue: 30, pull: 0.45, width: 50 }, { hue: 188, pull: 0.5, width: 70 }] },
      { op: 'split', sh: 192, sa: 0.32, hh: 34, ha: 0.22 },
      { op: 'curve', all: S_MED },
      { op: 'sat', v: 1.08 },
    ],
  },
  {
    id: 'blockbuster',
    name: 'Épico',
    category: 'cinema',
    description: 'Teal & laranja intenso com pretos profundos.',
    ops: [
      { op: 'warp', targets: [{ hue: 28, pull: 0.6, width: 55 }, { hue: 190, pull: 0.65, width: 80 }] },
      { op: 'split', sh: 195, sa: 0.45, hh: 32, ha: 0.3 },
      { op: 'curve', all: S_HARD },
      { op: 'sat', v: 1.12 },
    ],
  },
  {
    id: 'neon-noir',
    name: 'Neon Noturno',
    category: 'cinema',
    description: 'Magenta e ciano para noites urbanas.',
    ops: [
      { op: 'split', sh: 262, sa: 0.5, hh: 182, ha: 0.28 },
      { op: 'warp', targets: [{ hue: 300, pull: 0.3, width: 60 }, { hue: 185, pull: 0.3, width: 60 }] },
      { op: 'curve', all: S_HARD },
      { op: 'sat', v: 1.25 },
    ],
  },
  {
    id: 'night-city',
    name: 'Cidade à Noite',
    category: 'cinema',
    description: 'Sombras frias, luzes práticas âmbar.',
    ops: [
      { op: 'split', sh: 215, sa: 0.42, hh: 38, ha: 0.32 },
      { op: 'curve', all: S_MED },
      { op: 'sat', v: 0.95 },
    ],
  },
  {
    id: 'faded-film',
    name: 'Filme Desbotado',
    category: 'filme',
    description: 'Pretos lavados, verde nas sombras, altas quentes.',
    ops: [
      { op: 'curve', r: [[0, 0.06], [0.5, 0.52], [1, 0.97]], g: [[0, 0.07], [0.5, 0.5], [1, 0.95]], b: [[0, 0.1], [0.5, 0.46], [1, 0.88]] },
      { op: 'split', sh: 150, sa: 0.18, hh: 40, ha: 0.16 },
      { op: 'sat', v: 0.86 },
    ],
  },
  {
    id: 'seventies',
    name: 'Anos 70',
    category: 'filme',
    description: 'Calor amarelado e contraste baixo de época.',
    ops: [
      { op: 'gain', r: 1.05, g: 1.02, b: 0.88 },
      { op: 'curve', all: [[0, 0.07], [0.5, 0.52], [1, 0.94]] },
      { op: 'split', sh: 70, sa: 0.2, hh: 40, ha: 0.2 },
      { op: 'sat', v: 0.9 },
    ],
  },
  {
    id: 'bleach-bypass',
    name: 'Bleach Bypass',
    category: 'filme',
    description: 'Prata sobre a cor: duro, metálico, dessaturado.',
    ops: [
      { op: 'bleach', amount: 0.65 },
      { op: 'curve', all: S_HARD },
      { op: 'sat', v: 0.7 },
    ],
  },
  {
    id: 'cross-process',
    name: 'Cross Process',
    category: 'filme',
    description: 'Revelação trocada: amarelos ácidos, sombras azuis.',
    ops: [
      {
        op: 'curve',
        r: [[0, 0], [0.25, 0.18], [0.75, 0.86], [1, 1]],
        g: [[0, 0], [0.25, 0.23], [0.75, 0.82], [1, 1]],
        b: [[0, 0.12], [0.5, 0.45], [1, 0.78]],
      },
      { op: 'sat', v: 1.1 },
    ],
  },
  {
    id: 'golden-hour',
    name: 'Hora Dourada',
    category: 'natureza',
    description: 'Sol de fim de tarde em qualquer horário.',
    ops: [
      { op: 'gain', r: 1.07, g: 1.01, b: 0.88 },
      { op: 'split', sh: 20, sa: 0.12, hh: 42, ha: 0.3 },
      { op: 'curve', all: S_SOFT },
      { op: 'sat', v: 1.08 },
    ],
  },
  {
    id: 'moss',
    name: 'Musgo',
    category: 'natureza',
    description: 'Verdes profundos puxados para o oliva.',
    ops: [
      { op: 'warp', targets: [{ hue: 80, pull: 0.5, width: 60 }] },
      { op: 'split', sh: 120, sa: 0.18, hh: 50, ha: 0.12 },
      { op: 'curve', all: S_MED },
      { op: 'sat', v: 0.92 },
    ],
  },
  {
    id: 'arctic',
    name: 'Ártico',
    category: 'natureza',
    description: 'Frio, limpo e luminoso.',
    ops: [
      { op: 'gain', r: 0.93, g: 0.99, b: 1.08 },
      { op: 'split', sh: 210, sa: 0.2, hh: 190, ha: 0.12 },
      { op: 'curve', all: [[0, 0.03], [0.5, 0.55], [1, 1]] },
      { op: 'sat', v: 0.88 },
    ],
  },
  {
    id: 'tropical',
    name: 'Tropical',
    category: 'natureza',
    description: 'Céu turquesa e cores vibrantes de verão.',
    ops: [
      { op: 'warp', targets: [{ hue: 180, pull: 0.45, width: 60 }, { hue: 35, pull: 0.25, width: 40 }] },
      { op: 'curve', all: S_MED },
      { op: 'sat', v: 1.22 },
    ],
  },
  {
    id: 'nordic',
    name: 'Nórdico',
    category: 'criativo',
    description: 'Dessaturado, frio e com pretos suaves.',
    ops: [
      { op: 'sat', v: 0.72 },
      { op: 'split', sh: 215, sa: 0.25, hh: 200, ha: 0.06 },
      { op: 'fade', lift: 0.06 },
      { op: 'curve', all: S_SOFT },
    ],
  },
  {
    id: 'matte-pastel',
    name: 'Pastel Fosco',
    category: 'criativo',
    description: 'Fosco e delicado, com altas rosadas.',
    ops: [
      { op: 'fade', lift: 0.1, crush: 0.06 },
      { op: 'split', sh: 200, sa: 0.12, hh: 340, ha: 0.16 },
      { op: 'sat', v: 0.85 },
    ],
  },
  {
    id: 'ember',
    name: 'Brasa',
    category: 'criativo',
    description: 'Vermelho-alaranjado intenso, pretos esmagados.',
    ops: [
      { op: 'gain', r: 1.12, g: 0.96, b: 0.82 },
      { op: 'curve', all: S_HARD },
      { op: 'split', sh: 10, sa: 0.28, hh: 30, ha: 0.24 },
      { op: 'sat', v: 1.05 },
    ],
  },
  {
    id: 'desert',
    name: 'Deserto',
    category: 'criativo',
    description: 'Areia quente, azuis contidos.',
    ops: [
      { op: 'warp', targets: [{ hue: 32, pull: 0.4, width: 70 }] },
      { op: 'gain', r: 1.05, g: 1.0, b: 0.9 },
      { op: 'curve', all: S_SOFT },
      { op: 'sat', v: 0.95 },
    ],
  },
  {
    id: 'classic-bw',
    name: 'Clássico P&B',
    category: 'pb',
    description: 'Preto e branco neutro com contraste de laboratório.',
    ops: [
      { op: 'mono', r: 0.3, g: 0.59, b: 0.11 },
      { op: 'curve', all: S_MED },
    ],
  },
  {
    id: 'silver-bw',
    name: 'Prata',
    category: 'pb',
    description: 'P&B com filtro vermelho: céus dramáticos.',
    ops: [
      { op: 'mono', r: 0.55, g: 0.4, b: 0.05 },
      { op: 'curve', all: S_HARD },
      { op: 'tint', hue: 210, amount: 0.04 },
    ],
  },
  {
    id: 'sepia',
    name: 'Sépia',
    category: 'pb',
    description: 'Tom de fotografia antiga.',
    ops: [
      { op: 'mono', r: 0.3, g: 0.59, b: 0.11 },
      { op: 'curve', all: [[0, 0.05], [0.5, 0.5], [1, 0.95]] },
      { op: 'tint', hue: 32, amount: 0.22 },
    ],
  },
];

// ---- compilation ---------------------------------------------------------

function monotoneCurve(points: Pt[]) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const d: number[] = [];
  const m: number[] = new Array(n).fill(0);
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) {
      m[i] = 0;
      m[i + 1] = 0;
      continue;
    }
    const a = m[i] / d[i];
    const b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) {
      const t = 3 / Math.sqrt(s);
      m[i] = t * a * d[i];
      m[i + 1] = t * b * d[i];
    }
  }
  const table = new Float64Array(1025);
  for (let k = 0; k <= 1024; k++) {
    const x = k / 1024;
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = Math.min(Math.max((x - xs[i]) / h, 0), 1);
    const t2 = t * t;
    const t3 = t2 * t;
    table[k] =
      (2 * t3 - 3 * t2 + 1) * ys[i] +
      (t3 - 2 * t2 + t) * h * m[i] +
      (-2 * t3 + 3 * t2) * ys[i + 1] +
      (t3 - t2) * h * m[i + 1];
  }
  return (v: number) => {
    const f = Math.min(Math.max(v, 0), 1) * 1024;
    const i = Math.min(f | 0, 1023);
    return table[i] + (table[i + 1] - table[i]) * (f - i);
  };
}

const LR = 0.2126;
const LG = 0.7152;
const LB = 0.0722;

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 1e-6) {
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0;
  let g = 0;
  let b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [r + m, g + m, b + m];
}

function hueDist(a: number, b: number) {
  const d = Math.abs(a - b) % 360;
  return d > 180 ? 360 - d : d;
}

function signedHueDelta(from: number, to: number) {
  let d = (to - from) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return d;
}

function compileOp(op: Op): LookFn {
  switch (op.op) {
    case 'curve': {
      const all = op.all ? monotoneCurve(op.all) : null;
      const cr = op.r ? monotoneCurve(op.r) : null;
      const cg = op.g ? monotoneCurve(op.g) : null;
      const cb = op.b ? monotoneCurve(op.b) : null;
      return (c) => {
        if (all) {
          c[0] = all(c[0]);
          c[1] = all(c[1]);
          c[2] = all(c[2]);
        }
        if (cr) c[0] = cr(c[0]);
        if (cg) c[1] = cg(c[1]);
        if (cb) c[2] = cb(c[2]);
      };
    }
    case 'sat':
      return (c) => {
        const l = c[0] * LR + c[1] * LG + c[2] * LB;
        c[0] = l + (c[0] - l) * op.v;
        c[1] = l + (c[1] - l) * op.v;
        c[2] = l + (c[2] - l) * op.v;
      };
    case 'gain':
      return (c) => {
        c[0] *= op.r;
        c[1] *= op.g;
        c[2] *= op.b;
      };
    case 'split': {
      const so = hueOffset(op.sh);
      const ho = hueOffset(op.hh);
      return (c) => {
        const l = c[0] * LR + c[1] * LG + c[2] * LB;
        const sm = Math.max(0, 1 - l / 0.55);
        const hm = Math.max(0, (l - 0.45) / 0.55);
        for (let i = 0; i < 3; i++) c[i] += so[i] * op.sa * 0.3 * sm + ho[i] * op.ha * 0.3 * hm;
      };
    }
    case 'warp':
      return (c) => {
        const [h, s, v] = rgbToHsv(Math.max(c[0], 0), Math.max(c[1], 0), Math.max(c[2], 0));
        if (s < 0.02) return;
        let nh = h;
        for (const t of op.targets) {
          const dist = hueDist(h, t.hue);
          if (dist < t.width) {
            const w = (1 - dist / t.width) * t.pull * Math.min(1, s * 3);
            nh += signedHueDelta(h, t.hue) * w;
          }
        }
        nh = ((nh % 360) + 360) % 360;
        const out = hsvToRgb(nh, s, v);
        c[0] = out[0];
        c[1] = out[1];
        c[2] = out[2];
      };
    case 'mono':
      return (c) => {
        const l = c[0] * op.r + c[1] * op.g + c[2] * op.b;
        c[0] = l;
        c[1] = l;
        c[2] = l;
      };
    case 'tint': {
      const o = hueOffset(op.hue);
      return (c) => {
        const l = c[0] * LR + c[1] * LG + c[2] * LB;
        const w = op.amount * 4 * l * (1 - l);
        for (let i = 0; i < 3; i++) c[i] += o[i] * w;
      };
    }
    case 'bleach':
      return (c) => {
        const l = c[0] * LR + c[1] * LG + c[2] * LB;
        for (let i = 0; i < 3; i++) {
          const v = c[i];
          const ov = l < 0.5 ? 2 * v * l : 1 - 2 * (1 - v) * (1 - l);
          c[i] = v + (ov - v) * op.amount;
        }
      };
    case 'fade': {
      const crush = op.crush ?? 0;
      return (c) => {
        for (let i = 0; i < 3; i++) c[i] = op.lift + c[i] * (1 - op.lift - crush);
      };
    }
  }
}

const cache = new Map<string, LookFn>();

export function getBuiltInLook(id: string) {
  return BUILT_IN_LOOKS.find((l) => l.id === id) ?? null;
}

export function compileBuiltInLook(id: string): LookFn | null {
  const hit = cache.get(id);
  if (hit) return hit;
  const look = getBuiltInLook(id);
  if (!look) return null;
  const fns = look.ops.map(compileOp);
  const fn: LookFn = (c) => {
    for (const f of fns) f(c);
    for (let i = 0; i < 3; i++) c[i] = c[i] < 0 ? 0 : c[i] > 1 ? 1 : c[i];
  };
  cache.set(id, fn);
  return fn;
}

/** Reference patches (skin, sky, foliage, warm light, shadow) for swatch chips. */
export const SWATCH_PATCHES: [number, number, number][] = [
  [0.76, 0.55, 0.45],
  [0.42, 0.6, 0.82],
  [0.32, 0.5, 0.25],
  [0.92, 0.75, 0.45],
  [0.18, 0.18, 0.2],
];

export function lookSwatches(fn: LookFn | null): string[] {
  return SWATCH_PATCHES.map((p) => {
    const c = new Float64Array(p);
    fn?.(c);
    const hex = (v: number) =>
      Math.round(Math.min(Math.max(v, 0), 1) * 255)
        .toString(16)
        .padStart(2, '0');
    return `#${hex(c[0])}${hex(c[1])}${hex(c[2])}`;
  });
}
