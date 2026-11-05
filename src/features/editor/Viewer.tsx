import { useCallback, useState } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import Animated, { FadeIn, FadeOut, useAnimatedStyle, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import type { Effects } from '../../color/grade';
import type { ScopeMode } from '../../color/scopes';
import { GradedVideo, type VideoInfo } from '../../preview/GradedVideo';
import type { BakedLut } from '../../preview/lutImage';
import { grade as g, radius, space } from '../../theme/tokens';
import { Icon } from '../../ui/Icon';
import { Text } from '../../ui/Text';
import { Scopes } from './Scopes';

type Props = {
  uri: string;
  aspect: number;
  lut: BakedLut | null;
  effects: Effects;
  paused: SharedValue<boolean>;
  seek: SharedValue<number | null>;
  volume: SharedValue<number>;
  time: SharedValue<number>;
  split: SharedValue<number>;
  compare: boolean;
  falseColor: boolean;
  zebra: boolean;
  scopes: ScopeMode | null;
  scopesTick: number;
  trimStart: number;
  trimEnd: number;
  isPaused: boolean;
  onTogglePlay: () => void;
  onInfo: (i: VideoInfo) => void;
  badge?: string | null;
};

export function Viewer(p: Props) {
  const [box, setBox] = useState({ w: 0, h: 0 });
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox((b) => (Math.abs(b.w - width) > 0.5 || Math.abs(b.h - height) > 0.5 ? { w: width, h: height } : b));
  }, []);

  let w = box.w;
  let h = w / p.aspect;
  if (h > box.h) {
    h = box.h;
    w = h * p.aspect;
  }
  w = Math.floor(w);
  h = Math.floor(h);

  const split = p.split;
  const toggle = p.onTogglePlay;
  const compare = p.compare;
  const tap = useTapGesture({
    maxDuration: 250,
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled) scheduleOnRN(toggle);
    },
  });
  const pan = usePanGesture({
    enabled: compare,
    minDistance: 2,
    onUpdate: (e) => {
      'worklet';
      if (w > 0) split.value = Math.min(1, Math.max(0, e.x / w));
    },
  });
  const gesture = useExclusiveGestures(pan, tap);

  const handleStyle = useAnimatedStyle(() => ({
    opacity: split.value >= 0 ? 1 : 0,
    transform: [{ translateX: Math.max(0, split.value) * w - 16 }],
  }));

  return (
    <View onLayout={onLayout} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: g.viewer }}>
      {w > 0 && h > 0 ? (
        <GestureDetector gesture={gesture}>
          <View style={{ width: w, height: h }} accessible accessibilityRole="image" accessibilityLabel="Prévia do vídeo com o look aplicado" accessibilityHint="Toque para reproduzir ou pausar">
            <GradedVideo
              uri={p.uri}
              width={w}
              height={h}
              aspect={p.aspect}
              lut={p.lut}
              effects={p.effects}
              paused={p.paused}
              seek={p.seek}
              muted={p.volume}
              time={p.time}
              split={p.split}
              falseColor={p.falseColor}
              zebra={p.zebra ? 0.95 : 0}
              trimStart={p.trimStart}
              trimEnd={p.trimEnd}
              onInfo={p.onInfo}
            />
            {p.compare ? (
              <>
                <Animated.View pointerEvents="none" style={[{ position: 'absolute', top: h / 2 - 16, left: 0, width: 32, height: 32, borderRadius: 16, backgroundColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center', boxShadow: '0 2px 8px rgba(0,0,0,0.4)' }, handleStyle]}>
                  <Icon name="compare" size={16} color="#000000" weight="semibold" />
                </Animated.View>
                <View pointerEvents="none" style={{ position: 'absolute', top: space.s, left: space.s, flexDirection: 'row', gap: space.xs }}>
                  <Pill label="Original" />
                </View>
                <View pointerEvents="none" style={{ position: 'absolute', top: space.s, right: space.s }}>
                  <Pill label="Com look" />
                </View>
              </>
            ) : null}
            {p.badge ? (
              <View pointerEvents="none" style={{ position: 'absolute', left: space.s, bottom: space.s }}>
                <Pill label={p.badge} />
              </View>
            ) : null}
            {p.isPaused ? (
              <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(100)} pointerEvents="none" style={{ position: 'absolute', left: w / 2 - 28, top: h / 2 - 28, width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="play" size={24} color="#FFFFFF" />
              </Animated.View>
            ) : null}
            {p.scopes ? (
              <View pointerEvents="none" style={{ position: 'absolute', right: space.s, bottom: space.s }}>
                <Scopes uri={p.uri} time={p.time} tex={p.lut?.tex ?? null} mode={p.scopes} tick={p.scopesTick} />
              </View>
            ) : null}
          </View>
        </GestureDetector>
      ) : null}
    </View>
  );
}

function Pill({ label }: { label: string }) {
  return (
    <View style={{ paddingHorizontal: space.s, height: 22, borderRadius: radius.pill, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center' }}>
      <Text variant="caption2" weight="600" color="#FFFFFF">
        {label}
      </Text>
    </View>
  );
}
