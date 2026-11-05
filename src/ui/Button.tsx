import { ActivityIndicator, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '../theme/tokens';
import { usePalette } from '../theme/useTheme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './Pressable';
import { Text } from './Text';

type Props = {
  label: string;
  onPress?: () => void;
  icon?: IconName;
  variant?: 'primary' | 'secondary' | 'plain' | 'destructive';
  size?: 'large' | 'regular' | 'small';
  disabled?: boolean;
  loading?: boolean;
  style?: StyleProp<ViewStyle>;
  stretch?: boolean;
  accessibilityHint?: string;
};

/** Actions are pills. Primary = the one accent; secondary = neutral fill. */
export function Button({ label, onPress, icon, variant = 'primary', size = 'regular', disabled, loading, style, stretch, accessibilityHint }: Props) {
  const c = usePalette();
  const bg =
    variant === 'primary' ? c.accent : variant === 'secondary' ? c.fill : variant === 'destructive' ? c.fill : 'transparent';
  const fg =
    variant === 'primary' ? c.onAccent : variant === 'destructive' ? c.danger : variant === 'plain' ? c.accentText : c.label;
  const height = size === 'large' ? 52 : size === 'regular' ? 44 : 34;
  const textVariant = size === 'small' ? 'subhead' : 'headline';
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={accessibilityHint}
      style={[
        {
          height,
          minWidth: 44,
          paddingHorizontal: size === 'small' ? space.m : space.xl,
          borderRadius: radius.pill,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
          alignSelf: stretch ? 'stretch' : 'auto',
        },
        style,
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
        {loading ? <ActivityIndicator color={fg} /> : icon ? <Icon name={icon} size={size === 'small' ? 16 : 19} color={fg} weight="semibold" /> : null}
        <Text variant={textVariant} weight="600" color={fg} numberOfLines={1}>
          {label}
        </Text>
      </View>
    </PressableScale>
  );
}

/** Round icon-only control (≥44pt hit area). */
export function IconButton({
  icon,
  onPress,
  label,
  tone = 'neutral',
  size = 44,
  active,
  disabled,
  color,
}: {
  icon: IconName;
  onPress?: () => void;
  label: string;
  tone?: 'neutral' | 'clear' | 'accent';
  size?: number;
  active?: boolean;
  disabled?: boolean;
  color?: string;
}) {
  const c = usePalette();
  const bg = active ? c.accent : tone === 'neutral' ? c.fill : tone === 'accent' ? c.accent : 'transparent';
  const fg = color ?? (active || tone === 'accent' ? c.onAccent : c.label);
  return (
    <PressableScale
      onPress={onPress}
      disabled={disabled}
      feedback={tone === 'clear' ? 'opacity' : 'scale'}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active, disabled: !!disabled }}
      hitSlop={size < 44 ? (44 - size) / 2 : 0}
      style={{ width: size, height: size, borderRadius: radius.pill, backgroundColor: bg, alignItems: 'center', justifyContent: 'center' }}
    >
      <Icon name={icon} size={Math.round(size * 0.45)} color={fg} weight="semibold" />
    </PressableScale>
  );
}
