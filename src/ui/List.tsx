import { Children, isValidElement, type ReactNode } from 'react';
import { Pressable, Switch, View, type StyleProp, type ViewStyle } from 'react-native';

import { radius, space } from '../theme/tokens';
import { usePalette } from '../theme/useTheme';
import { Icon, type IconName } from './Icon';
import { Text } from './Text';

/** Inset grouped section (Settings-style). */
export function Section({ title, footer, children, style }: { title?: string; footer?: string; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const c = usePalette();
  const items = Children.toArray(children).filter(isValidElement);
  return (
    <View style={[{ gap: space.s }, style]}>
      {title ? (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.l, textTransform: 'uppercase' }}>
          {title}
        </Text>
      ) : null}
      <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' }}>
        {items.map((child, i) => (
          <View key={i}>
            {child}
            {i < items.length - 1 ? <View style={{ height: 0.5, backgroundColor: c.separator, marginLeft: space.l }} /> : null}
          </View>
        ))}
      </View>
      {footer ? (
        <Text variant="footnote" tone="secondary" style={{ paddingHorizontal: space.l }}>
          {footer}
        </Text>
      ) : null}
    </View>
  );
}

type RowProps = {
  title: string;
  subtitle?: string;
  value?: string;
  icon?: IconName;
  onPress?: () => void;
  onLongPress?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  checked?: boolean;
  right?: ReactNode;
  left?: ReactNode;
  disabled?: boolean;
};

/** List rows highlight their background on press (rows never scale). */
export function Row({ title, subtitle, value, icon, onPress, onLongPress, chevron, destructive, checked, right, left, disabled }: RowProps) {
  const c = usePalette();
  const body = (
    <View style={{ minHeight: 48, paddingHorizontal: space.l, paddingVertical: space.m - 2, flexDirection: 'row', alignItems: 'center', gap: space.m }}>
      {left}
      {icon ? <Icon name={icon} size={22} color={destructive ? c.danger : c.accentText} /> : null}
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" tone={destructive ? 'danger' : 'primary'} numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text variant="footnote" tone="secondary" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {value ? (
        <Text variant="body" tone="secondary" numberOfLines={1} tabular style={{ maxWidth: '45%' }}>
          {value}
        </Text>
      ) : null}
      {right}
      {checked ? <Icon name="check" size={18} color={c.accentText} weight="semibold" /> : null}
      {chevron ? <Icon name="chevron" size={14} color={c.labelTertiary} weight="semibold" /> : null}
    </View>
  );
  if (!onPress && !onLongPress) return body;
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected: !!checked, disabled: !!disabled }}
      style={({ pressed }) => ({ backgroundColor: pressed ? c.fill : 'transparent', opacity: disabled ? 0.4 : 1 })}
    >
      {body}
    </Pressable>
  );
}

export function SwitchRow({ title, subtitle, value, onValueChange, icon, disabled }: { title: string; subtitle?: string; value: boolean; onValueChange: (v: boolean) => void; icon?: IconName; disabled?: boolean }) {
  const c = usePalette();
  return (
    <Row
      title={title}
      subtitle={subtitle}
      icon={icon}
      disabled={disabled}
      right={
        <Switch
          value={value}
          onValueChange={onValueChange}
          disabled={disabled}
          trackColor={{ true: c.accent, false: undefined }}
          thumbColor={process.env.EXPO_OS === 'ios' ? undefined : '#FFFFFF'}
          accessibilityLabel={title}
        />
      }
    />
  );
}
