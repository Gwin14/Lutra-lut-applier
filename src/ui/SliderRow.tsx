import Slider from '@react-native-community/slider';
import { memo, useRef } from 'react';
import { Pressable, View } from 'react-native';

import { haptic } from '../lib/haptics';
import { space } from '../theme/tokens';
import { usePalette } from '../theme/useTheme';
import { Text } from './Text';

type Props = {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  neutral?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  onBegin?: () => void;
  onEnd?: (v: number) => void;
  /** Optional hue track preview for hue sliders. */
  swatch?: string;
};

const defaultFormat = (v: number) => (v > 0 ? `+${Math.round(v)}` : `${Math.round(v)}`);

/**
 * Native slider with the value on the right (tabular), selection tick when the
 * value crosses its neutral point, and double-tap on the label to reset.
 */
export const SliderRow = memo(function SliderRow({ label, value, min, max, step = 1, neutral = 0, format = defaultFormat, onChange, onBegin, onEnd, swatch }: Props) {
  const c = usePalette();
  const lastSide = useRef(Math.sign(value - neutral));
  const lastTap = useRef(0);
  const changed = value !== neutral;

  const reset = () => {
    onBegin?.();
    onChange(neutral);
    onEnd?.(neutral);
    haptic.light();
  };

  return (
    <View style={{ paddingHorizontal: space.l, paddingTop: space.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Pressable
          onPress={() => {
            const now = Date.now();
            if (now - lastTap.current < 320) reset();
            lastTap.current = now;
          }}
          accessibilityRole="button"
          accessibilityHint="Toque duas vezes para redefinir"
          hitSlop={8}
          style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}
        >
          {swatch ? <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: swatch }} /> : null}
          <Text variant="subhead" tone={changed ? 'primary' : 'secondary'}>
            {label}
          </Text>
        </Pressable>
        <Text variant="subhead" tabular tone={changed ? 'accent' : 'tertiary'} selectable>
          {format(value)}
        </Text>
      </View>
      <Slider
        style={{ height: 36, marginHorizontal: process.env.EXPO_OS === 'android' ? -12 : 0 }}
        minimumValue={min}
        maximumValue={max}
        step={step}
        value={value}
        minimumTrackTintColor={c.accent}
        maximumTrackTintColor={c.fillStrong}
        thumbTintColor={process.env.EXPO_OS === 'ios' ? undefined : c.accent}
        onSlidingStart={() => onBegin?.()}
        onValueChange={(v) => {
          const side = Math.sign(v - neutral);
          if (side !== lastSide.current) {
            lastSide.current = side;
            haptic.selection();
          }
          onChange(v);
        }}
        onSlidingComplete={(v) => onEnd?.(v)}
        accessibilityLabel={label}
      />
    </View>
  );
});
