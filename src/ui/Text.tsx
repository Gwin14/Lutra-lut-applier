import { Text as RNText, type TextProps } from 'react-native';

import { type as ramp } from '../theme/tokens';
import { usePalette } from '../theme/useTheme';

type Tone = 'primary' | 'secondary' | 'tertiary' | 'accent' | 'danger' | 'onAccent' | 'inherit';

export type AppTextProps = TextProps & {
  variant?: keyof typeof ramp;
  tone?: Tone;
  weight?: '400' | '500' | '600' | '700';
  tabular?: boolean;
  center?: boolean;
  color?: string;
};

export function Text({ variant = 'body', tone = 'primary', weight, tabular, center, color, style, ...rest }: AppTextProps) {
  const c = usePalette();
  const toneColor =
    tone === 'secondary'
      ? c.labelSecondary
      : tone === 'tertiary'
        ? c.labelTertiary
        : tone === 'accent'
          ? c.accentText
          : tone === 'danger'
            ? c.danger
            : tone === 'onAccent'
              ? c.onAccent
              : tone === 'inherit'
                ? undefined
                : c.label;
  return (
    <RNText
      {...rest}
      style={[
        ramp[variant],
        { color: color ?? toneColor },
        weight ? { fontWeight: weight } : null,
        tabular ? { fontVariant: ['tabular-nums'] } : null,
        center ? { textAlign: 'center' } : null,
        style,
      ]}
    />
  );
}
