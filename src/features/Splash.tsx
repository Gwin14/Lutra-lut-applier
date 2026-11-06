import { Canvas, Circle, Group, LinearGradient, Path, RadialGradient, RoundedRect, Skia, usePathInterpolation, vec } from '@shopify/react-native-skia';
import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useMemo, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useDerivedValue,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withTiming,
} from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { grade as g } from '../theme/tokens';

/**
 * Launch animation. The native splash (assets/splash-icon.png) shows the icon in
 * its ungraded "log" state: neutral greys and a flat tone curve. This overlay
 * starts on that exact frame, then "applies the LUT": the curve bends into the
 * S, the colour floods in, the wordmark rises, and the whole thing lifts away.
 *
 * Geometry mirrors scripts/make-icons.py (1024 units, CURVE_R 280, curve 64 wide).
 */

/** Must match `imageWidth` of the expo-splash-screen plugin in app.json. */
export const SPLASH_ICON_SIZE = 128;
const BG = g.bg; // = expo-splash-screen backgroundColor

const U = 1024;
const C = U / 2;
const R = 280;
const RADIUS = 0.2237 * U;
type Pts = [number, number][];
const S_CURVE: Pts = [[-0.9, 0.5], [0.1, 0.85], [-0.1, -0.85], [0.9, -0.5]];
const LOG_CURVE: Pts = [[-0.9, 0.25], [-0.3, 0.25 / 3], [0.3, -0.25 / 3], [0.9, -0.25]];

function curvePath(pts: Pts) {
  const [a, b, c, d] = pts.map(([x, y]) => [C + x * R, C + y * R]);
  const p = Skia.PathBuilder.Make();
  p.moveTo(a[0], a[1]);
  p.cubicTo(b[0], b[1], c[0], c[1], d[0], d[1]);
  return p.build();
}

const EASE = Easing.bezier(0.65, 0, 0.35, 1);
const OUT = Easing.bezier(0.23, 1, 0.32, 1);

export function Splash({ onDone }: { onDone: () => void }) {
  const { width, height } = useWindowDimensions();
  const reduce = useReducedMotion();
  const [ready, setReady] = useState(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });

  const graded = useSharedValue(0); // 0 = log, 1 = graded
  const word = useSharedValue(0);
  const exit = useSharedValue(0);

  const paths = useMemo(() => [curvePath(LOG_CURVE), curvePath(S_CURVE)], []);
  const curve = usePathInterpolation(graded, [0, 1], paths);

  // Hide the native splash only once our identical first frame is on screen.
  useEffect(() => {
    if (!ready) return;
    let raf = requestAnimationFrame(() => {
      raf = requestAnimationFrame(() => SplashScreen.hide());
    });
    return () => cancelAnimationFrame(raf);
  }, [ready]);

  useEffect(() => {
    if (!ready) return;
    const finish = () => done.current();
    if (reduce) {
      graded.set(withTiming(1, { duration: 250 }));
      word.set(withTiming(1, { duration: 250 }));
      exit.set(withDelay(600, withTiming(1, { duration: 250 }, (f) => f && scheduleOnRN(finish))));
      return;
    }
    graded.set(withDelay(180, withTiming(1, { duration: 820, easing: EASE })));
    word.set(withDelay(520, withTiming(1, { duration: 520, easing: OUT })));
    exit.set(withDelay(1350, withTiming(1, { duration: 380, easing: EASE }, (f) => f && scheduleOnRN(finish))));
  }, [ready, reduce, graded, word, exit]);

  const scale = SPLASH_ICON_SIZE / U;
  const x = (width - SPLASH_ICON_SIZE) / 2;
  const y = (height - SPLASH_ICON_SIZE) / 2;

  // A small "settle" while grading, then lift towards the viewer on exit.
  const iconTransform = useDerivedValue(() => [{ scale: (1 + Math.sin(graded.value * Math.PI) * 0.04) * (1 + exit.value * 0.18) }]);
  const glowR = useDerivedValue(() => SPLASH_ICON_SIZE * (0.9 + graded.value * 0.9));
  const glowOpacity = useDerivedValue(() => graded.value * 0.55 * (1 - exit.value));
  const gradedOpacity = useDerivedValue(() => graded.value);

  const overlay = useAnimatedStyle(() => ({ opacity: 1 - exit.value }));
  const wordStyle = useAnimatedStyle(() => ({
    opacity: word.value * (1 - exit.value),
    transform: [{ translateY: (1 - word.value) * 10 }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: BG, zIndex: 1000 }, overlay]} onLayout={() => setReady(true)}>
      <Canvas style={StyleSheet.absoluteFill}>
        <Circle cx={width / 2} cy={height / 2} r={glowR} opacity={glowOpacity}>
          <RadialGradient c={vec(width / 2, height / 2)} r={SPLASH_ICON_SIZE * 1.8} colors={['#6E56F8', 'rgba(110,86,248,0)']} />
        </Circle>
        <Group transform={[{ translateX: x }, { translateY: y }]}>
          <Group origin={vec(SPLASH_ICON_SIZE / 2, SPLASH_ICON_SIZE / 2)} transform={iconTransform}>
            <Group transform={[{ scale }]}>
            {/* Background: log greys, graded violet fades in on top. */}
            <RoundedRect x={0} y={0} width={U} height={U} r={RADIUS}>
              <LinearGradient start={vec(C, 0)} end={vec(C, U)} colors={['#8E8E96', '#3A3A40']} />
            </RoundedRect>
            <RoundedRect x={0} y={0} width={U} height={U} r={RADIUS} opacity={gradedOpacity}>
              <LinearGradient start={vec(C, 0)} end={vec(C, U)} colors={['#A08BFF', '#4A2CD6']} />
            </RoundedRect>
            <Circle cx={C} cy={C} r={360} color="rgba(255,255,255,0.16)" />
            <Circle cx={C} cy={C} r={360} style="stroke" strokeWidth={6} color="rgba(255,255,255,0.35)" />
            <Path path={curve} style="stroke" strokeWidth={64} strokeCap="round" color="#FFFFFF" />
            <Circle cx={C} cy={C} r={62} color="#FFFFFF" />
            <Circle cx={C} cy={C} r={26}>
              <LinearGradient start={vec(C, C - 26)} end={vec(C, C + 26)} colors={['#A4A4AC', '#5C5C64']} />
            </Circle>
            <Circle cx={C} cy={C} r={26} opacity={gradedOpacity}>
              <LinearGradient start={vec(C, C - 26)} end={vec(C, C + 26)} colors={['#8E78FF', '#5A3FE0']} />
            </Circle>
            </Group>
          </Group>
        </Group>
      </Canvas>
      <Animated.Text
        style={[
          { position: 'absolute', left: 0, right: 0, top: y + SPLASH_ICON_SIZE + 28, textAlign: 'center', color: g.label, fontSize: 28, fontWeight: '700', letterSpacing: 0.4 },
          wordStyle,
        ]}
      >
        Lutra
      </Animated.Text>
    </Animated.View>
  );
}

/** Call at module scope, before the first render. */
export function holdNativeSplash() {
  SplashScreen.preventAutoHideAsync().catch(() => {});
}
