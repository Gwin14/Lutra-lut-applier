import { useCallback, useEffect, useState } from 'react';
import { View } from 'react-native';
import { GestureDetector, usePanGesture } from 'react-native-gesture-handler';
import Animated, { useAnimatedReaction, useAnimatedStyle, useSharedValue, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useT } from '../../i18n';
import { haptic } from '../../lib/haptics';
import { formatTimecode } from '../../lib/format';
import { grade as g, radius, space } from '../../theme/tokens';
import { Text } from '../../ui/Text';

type Props = {
  duration: number;
  start: number;
  end: number;
  time: SharedValue<number>;
  seek: SharedValue<number | null>;
  paused: SharedValue<boolean>;
  onTrim: (start: number, end: number) => void;
  onScrubStart: () => void;
};

const HANDLE = 14;
const MIN_LEN = 0.5;

/** Trim range with draggable in/out handles, playhead and scrubbing. */
export function Timeline({ duration, start, end, time, seek, paused, onTrim, onScrubStart }: Props) {
  const t = useT();
  const [width, setWidth] = useState(0);
  const [label, setLabel] = useState('0:00.0');
  const s = useSharedValue(start);
  const e = useSharedValue(end || duration);
  const grab = useSharedValue(0);
  const dur = Math.max(duration, 0.001);
  const track = Math.max(1, width - HANDLE * 2);

  useEffect(() => {
    s.value = start;
    e.value = end || duration;
  }, [start, end, duration, s, e]);

  // formatTimecode is plain JS: format on the RN thread, not inside the worklet.
  const updateLabel = useCallback((tenths: number) => setLabel(formatTimecode(tenths / 10)), []);
  useAnimatedReaction(
    () => Math.floor(time.value * 10),
    (v, prev) => {
      if (v !== prev) scheduleOnRN(updateLabel, v);
    },
  );

  const commit = () => onTrim(Math.max(0, s.value), Math.min(dur, e.value));
  const tick = () => haptic.light();

  const startPan = usePanGesture({
    minDistance: 0,
    onBegin: () => {
      'worklet';
      grab.value = s.value;
      paused.value = true;
      scheduleOnRN(onScrubStart);
      scheduleOnRN(tick);
    },
    onUpdate: (ev) => {
      'worklet';
      const v = Math.min(Math.max(grab.value + (ev.translationX / track) * dur, 0), e.value - MIN_LEN);
      s.value = v;
      seek.value = v * 1000;
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(commit);
    },
  });

  const endPan = usePanGesture({
    minDistance: 0,
    onBegin: () => {
      'worklet';
      grab.value = e.value;
      paused.value = true;
      scheduleOnRN(onScrubStart);
      scheduleOnRN(tick);
    },
    onUpdate: (ev) => {
      'worklet';
      const v = Math.max(Math.min(grab.value + (ev.translationX / track) * dur, dur), s.value + MIN_LEN);
      e.value = v;
      seek.value = v * 1000;
    },
    onDeactivate: () => {
      'worklet';
      scheduleOnRN(commit);
    },
  });

  const scrub = usePanGesture({
    minDistance: 0,
    onBegin: (ev) => {
      'worklet';
      paused.value = true;
      scheduleOnRN(onScrubStart);
      const t = Math.min(Math.max(((ev.x - HANDLE) / track) * dur, s.value), e.value);
      seek.value = t * 1000;
      time.value = t;
    },
    onUpdate: (ev) => {
      'worklet';
      const t = Math.min(Math.max(((ev.x - HANDLE) / track) * dur, s.value), e.value);
      seek.value = t * 1000;
      time.value = t;
    },
  });

  const rangeStyle = useAnimatedStyle(() => ({
    left: (s.value / dur) * track,
    width: ((e.value - s.value) / dur) * track + HANDLE * 2,
  }));
  const headStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: HANDLE + (Math.min(Math.max(time.value, 0), dur) / dur) * track - 1 }],
  }));

  return (
    <View style={{ paddingHorizontal: space.l, gap: space.xs }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text variant="caption1" tabular color={g.label}>
          {label}
        </Text>
        <Text variant="caption1" tabular color={g.labelSecondary}>
          {`${formatTimecode(start)} – ${formatTimecode(end || duration)}`}
        </Text>
      </View>
      <GestureDetector gesture={scrub}>
        <View onLayout={(ev) => setWidth(ev.nativeEvent.layout.width)} style={{ height: 40, justifyContent: 'center' }} accessibilityLabel={t.editor.timeline} accessibilityHint={t.editor.timelineHint}>
          <View style={{ position: 'absolute', left: HANDLE, right: HANDLE, height: 28, borderRadius: radius.input, backgroundColor: g.fill }} />
          <Animated.View style={[{ position: 'absolute', top: 6, height: 28, borderRadius: radius.input, borderWidth: 2, borderColor: g.accent, borderCurve: 'continuous' }, rangeStyle]}>
            <GestureDetector gesture={startPan}>
              <View hitSlop={{ left: 14, right: 6, top: 8, bottom: 8 }} accessibilityLabel={t.editor.trimStart} style={{ position: 'absolute', left: -2, top: -2, bottom: -2, width: HANDLE, borderTopLeftRadius: radius.input, borderBottomLeftRadius: radius.input, backgroundColor: g.accent, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: g.onAccent }} />
              </View>
            </GestureDetector>
            <GestureDetector gesture={endPan}>
              <View hitSlop={{ left: 6, right: 14, top: 8, bottom: 8 }} accessibilityLabel={t.editor.trimEnd} style={{ position: 'absolute', right: -2, top: -2, bottom: -2, width: HANDLE, borderTopRightRadius: radius.input, borderBottomRightRadius: radius.input, backgroundColor: g.accent, alignItems: 'center', justifyContent: 'center' }}>
                <View style={{ width: 2, height: 12, borderRadius: 1, backgroundColor: g.onAccent }} />
              </View>
            </GestureDetector>
          </Animated.View>
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: 0, top: 2, width: 2, height: 36, borderRadius: 1, backgroundColor: '#FFFFFF' }, headStyle]} />
        </View>
      </GestureDetector>
    </View>
  );
}
