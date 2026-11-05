import SegmentedControlBase, { type SegmentedControlProps } from '@react-native-segmented-control/segmented-control';
import type { ComponentType } from 'react';
import { View } from 'react-native';

import { haptic } from '../lib/haptics';
import { space } from '../theme/tokens';
import { usePalette, useScheme } from '../theme/useTheme';

// React 19.3 typings reject the library's class component JSX signature.
const SegmentedControl = SegmentedControlBase as unknown as ComponentType<SegmentedControlProps>;

/** Native segmented control (UISegmentedControl on iOS), themed. */
export function Segmented<T extends string>({ values, labels, value, onChange }: { values: T[]; labels: string[]; value: T; onChange: (v: T) => void }) {
  const c = usePalette();
  const scheme = useScheme();
  const ios = process.env.EXPO_OS === 'ios';
  return (
    <View style={{ paddingHorizontal: space.l, paddingVertical: space.m }}>
      <SegmentedControl
        values={labels}
        selectedIndex={Math.max(0, values.indexOf(value))}
        onChange={(e) => {
          haptic.selection();
          onChange(values[e.nativeEvent.selectedSegmentIndex]);
        }}
        appearance={scheme}
        tintColor={ios ? undefined : c.accent}
        fontStyle={{ color: c.label }}
        activeFontStyle={{ color: ios ? c.label : c.onAccent, fontWeight: '600' }}
      />
    </View>
  );
}
