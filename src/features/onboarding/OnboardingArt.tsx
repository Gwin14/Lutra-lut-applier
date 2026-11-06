import {
  BlurMask,
  Canvas,
  Circle,
  ColorMatrix,
  Group,
  Line,
  LinearGradient,
  Paint,
  Path,
  Rect,
  RoundedRect,
  Skia,
  usePathInterpolation,
  vec,
} from '@shopify/react-native-skia';
import { useEffect, useMemo } from 'react';
import { View } from 'react-native';
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';

import { radius, space } from '../../theme/tokens';
import { usePalette } from '../../theme/useTheme';
import { Text } from '../../ui/Text';

/**
 * Onboarding heroes, drawn (not bitmaps) so they stay crisp at any size and in
 * the same language as the icon: a tone curve, and log footage being graded.
 * One style family: a procedural dusk landscape, shown flat ("log") or graded.
 */

export type ArtKind = 'compare' | 'batch' | 'curve';

const EASE = Easing.bezier(0.65, 0, 0.35, 1);

// Log look: desaturate 60%, contrast 0.62, lifted blacks. Offsets are 0..1.
const LOG_MATRIX = (() => {
  const s = 0.4;
  const c = 0.62;
  const lr = 0.2126 * (1 - s);
  const lg = 0.7152 * (1 - s);
  const lb = 0.0722 * (1 - s);
  const o = (1 - c) * 0.5 + 0.05;
  return [
    c * (lr + s), c * lg, c * lb, 0, o,
    c * lr, c * (lg + s), c * lb, 0, o,
    c * lr, c * lg, c * (lb + s), 0, o,
    0, 0, 0, 1, 0,
  ];
})();

type Palette = { sky: [string, string, string]; sun: string; far: string; near: string; ground: [string, string] };
const SCENES: Palette[] = [
  { sky: ['#1F2A5A', '#C8607A', '#FFB070'], sun: '#FFE2B0', far: '#5B4A86', near: '#231E3A', ground: ['#2A2140', '#120F1E'] },
  { sky: ['#0F3A5C', '#3F8FA8', '#F2C27A'], sun: '#FFF0C8', far: '#2F6670', near: '#123036', ground: ['#173A3E', '#0A1A1C'] },
  { sky: ['#3A1E4A', '#E0704A', '#FFD08A'], sun: '#FFE9C0', far: '#7A3E52', near: '#2C1626', ground: ['#3A1E2C', '#170C12'] },
];

function mountains(x: number, y: number, w: number, h: number, seed: number, base: number, amp: number) {
  const b = Skia.PathBuilder.Make();
  b.moveTo(x, y + h);
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const px = x + (w * i) / steps;
    const wave = Math.sin(i * 1.7 + seed) * 0.5 + Math.sin(i * 0.9 + seed * 2.3) * 0.5;
    const py = y + h * (base - amp * wave);
    if (i === 0) b.lineTo(px, py);
    else {
      const cx = x + (w * (i - 0.5)) / steps;
      b.quadTo(cx, py - h * amp * 0.35, px, py);
    }
  }
  b.lineTo(x + w, y + h);
  b.close();
  return b.build();
}

/** A dusk landscape filling (x, y, w, h). */
function Scene({ x, y, w, h, p, seed }: { x: number; y: number; w: number; h: number; p: Palette; seed: number }) {
  const far = useMemo(() => mountains(x, y, w, h, seed, 0.6, 0.12), [x, y, w, h, seed]);
  const near = useMemo(() => mountains(x, y, w, h, seed + 2, 0.74, 0.08), [x, y, w, h, seed]);
  return (
    <Group>
      <Rect x={x} y={y} width={w} height={h * 0.8}>
        <LinearGradient start={vec(x, y)} end={vec(x, y + h * 0.8)} colors={p.sky} />
      </Rect>
      <Circle cx={x + w * (0.3 + 0.2 * Math.sin(seed))} cy={y + h * 0.56} r={h * 0.11} color={p.sun} />
      <Path path={far} color={p.far} />
      <Path path={near} color={p.near} />
      <Rect x={x} y={y + h * 0.8} width={w} height={h * 0.2}>
        <LinearGradient start={vec(x, y + h * 0.8)} end={vec(x, y + h)} colors={p.ground} />
      </Rect>
    </Group>
  );
}

function LogLayer({ children, opacity }: { children: React.ReactNode; opacity?: SharedValue<number> | number }) {
  return (
    <Group
      layer={
        <Paint opacity={opacity}>
          <ColorMatrix matrix={LOG_MATRIX} />
        </Paint>
      }
    >
      {children}
    </Group>
  );
}

function Tag({ label, side }: { label: string; side: 'left' | 'right' }) {
  return (
    <View
      style={{
        position: 'absolute',
        top: space.m,
        [side]: space.m,
        paddingHorizontal: space.s,
        height: 22,
        borderRadius: radius.pill,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'center',
      }}
    >
      <Text variant="caption2" weight="600" color="#FFFFFF" style={{ letterSpacing: 0.6 }}>
        {label}
      </Text>
    </View>
  );
}

/** Page 1: a split sweeping across one frame, graded | log. */
function CompareArt({ w, h, active, reduce }: { w: number; h: number; active: boolean; reduce: boolean }) {
  const split = useSharedValue(0.5);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(split);
      split.set(withTiming(0.5, { duration: 200 }));
      return;
    }
    split.set(0.5);
    split.set(
      withDelay(
        250,
        withRepeat(withSequence(withTiming(0.78, { duration: 1300, easing: EASE }), withTiming(0.22, { duration: 1900, easing: EASE }), withTiming(0.5, { duration: 1300, easing: EASE })), -1),
      ),
    );
  }, [active, reduce, split]);

  const clip = useDerivedValue(() => Skia.XYWHRect(split.value * w, 0, w - split.value * w, h));
  const p1 = useDerivedValue(() => vec(split.value * w, 0));
  const p2 = useDerivedValue(() => vec(split.value * w, h));
  const knob = useAnimatedStyle(() => ({ transform: [{ translateX: split.value * w - 14 }] }));

  return (
    <View style={{ width: w, height: h, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' }}>
      <Canvas style={{ width: w, height: h }}>
        <Scene x={0} y={0} w={w} h={h} p={SCENES[0]} seed={0.6} />
        <Group clip={clip}>
          <LogLayer>
            <Scene x={0} y={0} w={w} h={h} p={SCENES[0]} seed={0.6} />
          </LogLayer>
        </Group>
        <Line p1={p1} p2={p2} color="#FFFFFF" strokeWidth={2} />
      </Canvas>
      <Animated.View
        pointerEvents="none"
        style={[{ position: 'absolute', top: h / 2 - 14, left: 0, width: 28, height: 28, borderRadius: 14, backgroundColor: '#FFFFFF', boxShadow: '0 2px 8px rgba(0,0,0,0.35)' }, knob]}
      />
      <Tag label="LOOK" side="left" />
      <Tag label="LOG" side="right" />
    </View>
  );
}

/** One card of the batch: its own log → graded fade. */
function BatchCard({ i, x, y, w, h, angle, progress }: { i: number; x: number; y: number; w: number; h: number; angle: number; progress: SharedValue<number> }) {
  // Stagger: card i grades over its own slice of the shared progress.
  const logOpacity = useDerivedValue(() => {
    const t = Math.min(1, Math.max(0, (progress.value - i * 0.18) / 0.34));
    return 1 - t;
  });
  const r = useMemo(() => Skia.RRectXY(Skia.XYWHRect(x, y, w, h), radius.media, radius.media), [x, y, w, h]);
  return (
    <Group origin={vec(x + w / 2, y + h / 2)} transform={[{ rotate: angle }]}>
      <RoundedRect rect={r} color="rgba(0,0,0,0.32)" transform={[{ translateY: 8 }]}>
        <BlurMask blur={12} style="normal" />
      </RoundedRect>
      <Group clip={r}>
        <Scene x={x} y={y} w={w} h={h} p={SCENES[i]} seed={i * 1.9 + 0.4} />
        <LogLayer opacity={logOpacity}>
          <Scene x={x} y={y} w={w} h={h} p={SCENES[i]} seed={i * 1.9 + 0.4} />
        </LogLayer>
      </Group>
      <RoundedRect rect={r} style="stroke" strokeWidth={1.5} color="rgba(255,255,255,0.18)" />
    </Group>
  );
}

/** Page 2: three clips fanned out, graded one after another. */
function BatchArt({ w, h, active, reduce }: { w: number; h: number; active: boolean; reduce: boolean }) {
  const progress = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(progress);
      progress.set(withTiming(1, { duration: 200 }));
      return;
    }
    progress.set(0);
    progress.set(
      withRepeat(withSequence(withDelay(400, withTiming(1, { duration: 1500, easing: EASE })), withDelay(1600, withTiming(0, { duration: 500, easing: EASE }))), -1),
    );
  }, [active, reduce, progress]);

  const cw = w * 0.56;
  const ch = cw * 0.62;
  const cy = (h - ch) / 2;
  const cards = [
    { x: w * 0.06, y: cy + h * 0.04, angle: -0.14 },
    { x: w * 0.38, y: cy + h * 0.06, angle: 0.13 },
    { x: (w - cw) / 2, y: cy - h * 0.06, angle: 0 },
  ];
  return (
    <Canvas style={{ width: w, height: h }}>
      {cards.map((c, i) => (
        <BatchCard key={i} i={i} x={c.x} y={c.y} w={cw} h={ch} angle={c.angle} progress={progress} />
      ))}
    </Canvas>
  );
}

// Same tone-curve geometry as the icon / splash (scripts/make-icons.py).
const S_CURVE: [number, number][] = [[-0.9, 0.5], [0.1, 0.85], [-0.1, -0.85], [0.9, -0.5]];
const LOG_CURVE: [number, number][] = [[-0.9, 0.25], [-0.3, 0.25 / 3], [0.3, -0.25 / 3], [0.9, -0.25]];

function curvePath(pts: [number, number][], cx: number, cy: number, r: number) {
  const [a, b, c, d] = pts.map(([x, y]) => [cx + x * r, cy + y * r]);
  const p = Skia.PathBuilder.Make();
  p.moveTo(a[0], a[1]);
  p.cubicTo(b[0], b[1], c[0], c[1], d[0], d[1]);
  return p.build();
}

/** Page 3: histogram + grid, the tone curve bending from log to S. */
function CurveArt({ w, h, active, reduce }: { w: number; h: number; active: boolean; reduce: boolean }) {
  const c = usePalette();
  const t = useSharedValue(reduce ? 1 : 0);
  useEffect(() => {
    if (!active || reduce) {
      cancelAnimation(t);
      t.set(withTiming(1, { duration: 200 }));
      return;
    }
    t.set(0);
    t.set(withRepeat(withSequence(withDelay(300, withTiming(1, { duration: 1100, easing: EASE })), withDelay(1800, withTiming(0, { duration: 900, easing: EASE }))), -1));
  }, [active, reduce, t]);

  const size = Math.min(w, h);
  const ox = (w - size) / 2;
  const oy = (h - size) / 2;
  const r = size * 0.42;
  const cx = ox + size / 2;
  const cy = oy + size / 2;
  const paths = useMemo(() => [curvePath(LOG_CURVE, cx, cy, r), curvePath(S_CURVE, cx, cy, r)], [cx, cy, r]);
  const curve = usePathInterpolation(t, [0, 1], paths);

  const bars = useMemo(() => {
    const n = 28;
    const bw = (size * 0.9) / n;
    return Array.from({ length: n }, (_, i) => {
      const u = i / (n - 1);
      const v = 0.18 + 0.55 * Math.exp(-((u - 0.42) ** 2) / 0.03) + 0.25 * Math.exp(-((u - 0.75) ** 2) / 0.01);
      const bh = size * 0.62 * v;
      return { x: ox + size * 0.05 + i * bw, y: oy + size * 0.95 - bh, w: bw - 2, h: bh };
    });
  }, [size, ox, oy]);

  const grid = [0.25, 0.5, 0.75];
  return (
    <View style={{ width: w, height: h }}>
      <Canvas style={{ width: w, height: h }}>
        <RoundedRect x={ox} y={oy} width={size} height={size} r={radius.card} color={c.surface} />
        {grid.map((g) => (
          <Group key={g}>
            <Line p1={vec(ox + size * g, oy + 8)} p2={vec(ox + size * g, oy + size - 8)} color={c.separator} strokeWidth={1} />
            <Line p1={vec(ox + 8, oy + size * g)} p2={vec(ox + size - 8, oy + size * g)} color={c.separator} strokeWidth={1} />
          </Group>
        ))}
        {bars.map((b, i) => (
          <RoundedRect key={i} x={b.x} y={b.y} width={b.w} height={b.h} r={2} color={c.fillStrong} />
        ))}
        <Path path={curve} style="stroke" strokeWidth={size * 0.032} strokeCap="round" color={c.label} />
        <Circle cx={cx} cy={cy} r={size * 0.042} color={c.label} />
        <Circle cx={cx} cy={cy} r={size * 0.018} color={c.accent} />
      </Canvas>
    </View>
  );
}

export function OnboardingArt({ kind, width, height, active, label }: { kind: ArtKind; width: number; height: number; active: boolean; label: string }) {
  const reduce = useReducedMotion();
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));
  return (
    <View accessible accessibilityRole="image" accessibilityLabel={label} style={{ width: w, height: h, alignItems: 'center', justifyContent: 'center' }}>
      {kind === 'compare' ? <CompareArt w={w} h={h} active={active} reduce={reduce} /> : null}
      {kind === 'batch' ? <BatchArt w={w} h={h} active={active} reduce={reduce} /> : null}
      {kind === 'curve' ? <CurveArt w={w} h={h} active={active} reduce={reduce} /> : null}
    </View>
  );
}
