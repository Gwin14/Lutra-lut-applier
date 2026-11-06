import { Pressable, View } from 'react-native';

import { useT } from '../../i18n';
import { haptic } from '../../lib/haptics';
import { grade as g, space } from '../../theme/tokens';
import { Icon, type IconName } from '../../ui/Icon';
import { Text } from '../../ui/Text';

export type Tool = 'input' | 'look' | 'adjust' | 'effects' | 'frame';

const TOOLS: { id: Tool; icon: IconName }[] = [
  { id: 'input', icon: 'input' },
  { id: 'look', icon: 'look' },
  { id: 'adjust', icon: 'adjust' },
  { id: 'effects', icon: 'effects' },
  { id: 'frame', icon: 'frame' },
];

/** Tool switcher: peers, so no animation between them (frequency gate). */
export function ToolBar({ value, onChange, dots }: { value: Tool; onChange: (t: Tool) => void; dots: Partial<Record<Tool, boolean>> }) {
  const t = useT();
  return (
    <View accessibilityRole="tablist" style={{ flexDirection: 'row', paddingHorizontal: space.s, borderTopWidth: 0.5, borderBottomWidth: 0.5, borderColor: g.separator }}>
      {TOOLS.map((tool) => {
        const label = t.tools[tool.id];
        const active = tool.id === value;
        const color = active ? g.accentText : g.labelSecondary;
        return (
          <Pressable
            key={tool.id}
            onPress={() => {
              if (!active) haptic.selection();
              onChange(tool.id);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            accessibilityLabel={label}
            style={{ flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', gap: 3 }}
          >
            <View>
              <Icon name={tool.icon} size={21} color={color} weight={active ? 'semibold' : 'regular'} />
              {dots[tool.id] ? <View style={{ position: 'absolute', right: -5, top: -2, width: 6, height: 6, borderRadius: 3, backgroundColor: g.accent }} /> : null}
            </View>
            <Text variant="caption2" weight={active ? '600' : '400'} color={color}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
