import { View } from 'react-native';

/** Five memory-colour chips (skin, sky, foliage, warm light, shadow) through a look. */
export function LookSwatches({ colors, size = 12, gap = 3 }: { colors: string[]; size?: number; gap?: number }) {
  return (
    <View style={{ flexDirection: 'row', gap }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      {colors.map((c, i) => (
        <View key={i} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: c }} />
      ))}
    </View>
  );
}
