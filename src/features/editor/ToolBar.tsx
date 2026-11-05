import { Pressable, View } from 'react-native';

import { haptic } from '../../lib/haptics';
import { grade as g, space } from '../../theme/tokens';
import { Icon, type IconName } from '../../ui/Icon';
import { Text } from '../../ui/Text';

export type Tool = 'input' | 'look' | 'adjust' | 'effects' | 'frame';

const TOOLS: { id: Tool; label: string; icon: IconName }[] = [
  { id: 'input', label: 'Entrada', icon: 'input' },
  { id: 'look', label: 'Look', icon: 'look' },
  { id: 'adjust', label: 'Ajustes', icon: 'adjust' },
  { id: 'effects', label: 'Efeitos', icon: 'effects' },
  { id: 'frame', label: 'Quadro', icon: 'frame' },
];

/** Tool switcher: peers, so no animation between them (frequency gate). */
export function ToolBar({ value, onChange, dots }: { value: Tool; onChange: (t: Tool) => void; dots: Partial<Record<Tool, boolean>> }) {
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', paddingHorizontal: space.s, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: g.separator }}>
      {TOOLS.map((t) => {
        const active = t.id === value;
        const color = active ? g.accentText : g.labelSecondary;
        return (
          <Pressable
            key={t.id}
            onPress={() => {
              if (!active) haptic.selection();
              onChange(t.id);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={t.label}
            style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }}
          >
            <View>
              <Icon name={t.icon} size={21} color={color} weight={active ? 'semibold' : 'regular'} />
              {dots[t.id] ? <View style={{ position: 'absolute', right: -5, top: -2, width: 6, height: 6, borderRadius: 3, backgroundColor: g.accent }} /> : null}
            </View>
            <Text variant="caption2" weight={active ? '600' : '400'} color={color}>
              {t.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
