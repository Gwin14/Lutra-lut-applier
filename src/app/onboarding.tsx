import { router } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from 'react-native';
import Animated, { Extrapolation, interpolate, interpolateColor, useAnimatedRef, useAnimatedScrollHandler, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { OnboardingArt, type ArtKind } from '../features/onboarding/OnboardingArt';
import { useT } from '../i18n';
import { haptic } from '../lib/haptics';
import { useSettings } from '../store/settings';
import { space } from '../theme/tokens';
import { usePalette } from '../theme/useTheme';
import { Button } from '../ui/Button';
import { PressableScale } from '../ui/Pressable';
import { Text } from '../ui/Text';

const ARTS: ArtKind[] = ['compare', 'batch', 'curve'];

/**
 * First-run introduction. A one-way door: finishing or skipping flips
 * `onboarded`, and the root Stack.Protected guard swaps this route out for the
 * tabs, so back can never return here.
 */
export default function Onboarding() {
  const t = useT();
  const c = usePalette();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const pages = t.onboarding.pages;
  const [index, setIndex] = useState(0);
  const finished = useRef(false);
  const [done, setDone] = useState(false);
  const onboarded = useSettings((s) => s.onboarded);

  // Leave once the guard has opened the app: back to Settings when replayed,
  // otherwise replace so the introduction is gone from the stack for good.
  useEffect(() => {
    if (!done || !onboarded) return;
    if (router.canGoBack()) router.back();
    else router.replace('/');
  }, [done, onboarded]);

  const x = useSharedValue(0);
  const ref = useAnimatedRef<Animated.ScrollView>();
  const onScroll = useAnimatedScrollHandler((e) => {
    x.set(e.contentOffset.x);
  });
  const onSettle = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const i = Math.round(e.nativeEvent.contentOffset.x / Math.max(1, width));
    if (i !== index) {
      setIndex(i);
      haptic.selection();
    }
  };

  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    haptic.success();
    useSettings.getState().set('onboarded', true);
    setDone(true);
  };
  const next = () => {
    if (index >= pages.length - 1) return finish();
    const i = index + 1;
    setIndex(i);
    haptic.light();
    ref.current?.scrollTo({ x: i * width, animated: true });
  };

  const landscape = width > height;
  const bottomBar = 52 + space.xl + space.l + 8; // button + dots + gaps
  const pageH = height - insets.top - insets.bottom - bottomBar - 44;
  const textBlock = 150;
  const artW = landscape ? (width - insets.left - insets.right) * 0.5 - space.xxl * 2 : width - space.xxl * 2;
  const artH = landscape ? pageH - space.l * 2 : Math.max(160, Math.min(artW * 0.92, pageH - textBlock - space.xxl * 2));
  const last = index === pages.length - 1;

  return (
    <View style={{ flex: 1, backgroundColor: c.bgGrouped, paddingTop: insets.top, paddingBottom: insets.bottom + space.l }}>
      <View style={{ height: 44, flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: space.s + insets.right }}>
        {last ? null : (
          <PressableScale feedback="opacity" onPress={finish} accessibilityRole="button" accessibilityLabel={t.onboarding.skip} style={{ minWidth: 44, height: 44, paddingHorizontal: space.m, justifyContent: 'center' }}>
            <Text variant="body" tone="secondary">
              {t.onboarding.skip}
            </Text>
          </PressableScale>
        )}
      </View>

      <Animated.ScrollView
        ref={ref}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        onScroll={onScroll}
        scrollEventThrottle={16}
        onMomentumScrollEnd={onSettle}
        style={{ flex: 1 }}
      >
        {pages.map((p, i) => (
          <View
            key={i}
            accessibilityLabel={t.onboarding.pageA11y(i + 1, pages.length)}
            style={{
              width,
              flexDirection: landscape ? 'row' : 'column',
              alignItems: 'center',
              justifyContent: 'center',
              paddingHorizontal: space.xxl + (landscape ? insets.left : 0),
              gap: landscape ? space.xxxl : space.xxl,
            }}
          >
            <OnboardingArt kind={ARTS[i]} width={artW} height={artH} active={i === index} label={p.art} />
            <View style={{ flex: landscape ? 1 : undefined, gap: space.s, maxWidth: 440, minHeight: landscape ? undefined : textBlock - space.xxl }}>
              <Text variant="title1" weight="700" center={!landscape} accessibilityRole="header">
                {p.title}
              </Text>
              <Text variant="body" tone="secondary" center={!landscape}>
                {p.body}
              </Text>
            </View>
          </View>
        ))}
      </Animated.ScrollView>

      <View style={{ gap: space.xl, paddingHorizontal: space.xxl + Math.max(insets.left, insets.right), alignItems: 'center' }}>
        <View style={{ flexDirection: 'row', gap: space.s, height: 8, alignItems: 'center' }} importantForAccessibility="no-hide-descendants">
          {pages.map((_, i) => (
            <Dot key={i} i={i} x={x} width={width} on={c.accent} off={c.fillStrong} />
          ))}
        </View>
        <Button label={last ? t.onboarding.start : t.onboarding.next} size="large" onPress={next} style={{ alignSelf: 'stretch', maxWidth: 440, width: '100%' }} />
      </View>
    </View>
  );
}

/** Page indicator: the active dot stretches into a pill, tracking the scroll. */
function Dot({ i, x, width, on, off }: { i: number; x: SharedValue<number>; width: number; on: string; off: string }) {
  const style = useAnimatedStyle(() => {
    const d = Math.abs(x.value / Math.max(1, width) - i);
    const k = interpolate(d, [0, 1], [1, 0], Extrapolation.CLAMP);
    return { width: 8 + 14 * k, backgroundColor: interpolateColor(k, [0, 1], [off, on]) };
  });
  return <Animated.View style={[{ height: 8, borderRadius: 4 }, style]} />;
}
