import { useImage } from '@shopify/react-native-skia';
import { useState } from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';

import type { Grade } from '../color/grade';
import type { ProfileId } from '../color/profiles';
import { GradedStill } from './GradedStill';
import { useThumbLut } from './lutImage';

/** A clip thumbnail shown through its grade; sizes itself to its container. */
export function GradedThumb({ uri, input, grade, style }: { uri: string | null; input: ProfileId; grade: Grade; style?: StyleProp<ViewStyle> }) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  const image = useImage(uri ?? undefined);
  const lut = useThumbLut(input, grade);
  return (
    <View style={style} onLayout={(e) => setSize({ w: Math.round(e.nativeEvent.layout.width), h: Math.round(e.nativeEvent.layout.height) })}>
      {size.w > 0 && size.h > 0 ? <GradedStill image={image} lut={lut} width={size.w} height={size.h} effects={grade.effects} /> : null}
    </View>
  );
}
