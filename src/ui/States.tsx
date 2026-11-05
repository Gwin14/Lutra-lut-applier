import type { ReactNode } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '../theme/tokens';
import { usePalette } from '../theme/useTheme';
import { Icon, type IconName } from './Icon';
import { PressableScale } from './Pressable';
import { Text } from './Text';

/** Composed empty state: says what is missing and how to fill it. */
export function EmptyState({ icon, title, message, action, style }: { icon: IconName; title: string; message: string; action?: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  return (
    <View style={[{ alignItems: 'center', paddingVertical: space.xxxl, paddingHorizontal: space.xxl, gap: space.m }, style]}>
      <View style={{ width: 64, height: 64, borderRadius: 32, backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name={icon} size={28} color={c.labelSecondary} />
      </View>
      <Text variant="title3" center>
        {title}
      </Text>
      <Text variant="subhead" tone="secondary" center style={{ maxWidth: 320 }}>
        {message}
      </Text>
      {action ? <View style={{ marginTop: space.s }}>{action}</View> : null}
    </View>
  );
}

/** Inline, specific error that stays until fixed. */
export function InlineNotice({ tone = 'info', title, message, action }: { tone?: 'info' | 'error' | 'warning'; title: string; message?: string; action?: ReactNode }) {
  const c = usePalette();
  const color = tone === 'error' ? c.danger : tone === 'warning' ? c.accentText : c.labelSecondary;
  return (
    <View
      style={{
        flexDirection: 'row',
        gap: space.m,
        padding: space.l,
        borderRadius: radius.card,
        borderCurve: 'continuous',
        backgroundColor: tone === 'info' ? c.fill : tone === 'warning' ? c.accentSoft : 'rgba(255,69,58,0.12)',
      }}
    >
      <Icon name={tone === 'info' ? 'info' : 'error'} size={20} color={color} />
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="subhead" weight="600">
          {title}
        </Text>
        {message ? (
          <Text variant="footnote" tone="secondary" selectable>
            {message}
          </Text>
        ) : null}
        {action}
      </View>
    </View>
  );
}

export function ProgressBar({ value, height = 4, track }: { value: number; height?: number; track?: string }) {
  const c = usePalette();
  return (
    <View style={{ height, borderRadius: height / 2, backgroundColor: track ?? c.fillStrong, overflow: 'hidden' }} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: Math.round(value * 100) }}>
      <View style={{ width: `${Math.max(0, Math.min(1, value)) * 100}%`, height, borderRadius: height / 2, backgroundColor: c.accent }} />
    </View>
  );
}

/** Pill chip used for filters and choices. */
export function Chip({ label, selected, onPress, icon }: { label: string; selected?: boolean; onPress?: () => void; icon?: IconName }) {
  const c = usePalette();
  return (
    <PressableScale
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      style={{
        height: 34,
        paddingHorizontal: space.m + 2,
        borderRadius: radius.pill,
        backgroundColor: selected ? c.accent : c.fill,
        flexDirection: 'row',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {icon ? <Icon name={icon} size={15} color={selected ? c.onAccent : c.label} weight="semibold" /> : null}
      <Text variant="subhead" weight="600" color={selected ? c.onAccent : c.label}>
        {label}
      </Text>
    </PressableScale>
  );
}
