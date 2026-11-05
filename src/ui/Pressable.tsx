import { Pressable as RNPressable, type PressableProps, type StyleProp, type ViewStyle } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';

const AnimatedPressable = Animated.createAnimatedComponent(RNPressable);
const EASE = Easing.bezier(0.23, 1, 0.32, 1);

type Props = Omit<PressableProps, 'style'> & {
  style?: StyleProp<ViewStyle>;
  /** scale: buttons & cards (0.97). opacity: bar buttons. none: rows (they highlight instead). */
  feedback?: 'scale' | 'opacity' | 'none';
};

/** Press feedback lands on press-in, 120 ms, strong ease-out. */
export function PressableScale({ feedback = 'scale', style, onPressIn, onPressOut, disabled, ...rest }: Props) {
  const v = useSharedValue(0);
  const reduce = useReducedMotion();
  const anim = useAnimatedStyle(() => {
    if (feedback === 'opacity') return { opacity: 1 - v.value * 0.6 };
    if (feedback === 'scale' && !reduce) return { transform: [{ scale: 1 - v.value * 0.03 }] };
    if (feedback === 'scale') return { opacity: 1 - v.value * 0.2 };
    return {};
  });
  return (
    <AnimatedPressable
      {...rest}
      disabled={disabled}
      onPressIn={(e) => {
        v.value = withTiming(1, { duration: 120, easing: EASE });
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        v.value = withTiming(0, { duration: 160, easing: EASE });
        onPressOut?.(e);
      }}
      style={[style, anim, disabled ? { opacity: 0.4 } : null]}
    />
  );
}
