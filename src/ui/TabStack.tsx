import { Stack } from 'expo-router';
import { Platform } from 'react-native';

import { usePalette } from '../theme/useTheme';

const ios = process.env.EXPO_OS === 'ios';
// iOS 26 draws its own scroll-edge effect; a custom blur on top of it hides the large title at the top.
const legacyBlur = ios && parseInt(String(Platform.Version), 10) < 26;

/** Each tab keeps its own native stack with a collapsing large title. */
export function TabStack({ title }: { title: string }) {
  const c = usePalette();
  return (
    <Stack
      screenOptions={{
        headerLargeTitleEnabled: true,
        headerTransparent: ios,
        headerBlurEffect: legacyBlur ? 'systemChromeMaterial' : undefined,
        headerLargeTitleShadowVisible: false,
        headerShadowVisible: false,
        headerTintColor: c.accentText,
        headerTitleStyle: { color: c.label },
        headerLargeTitleStyle: { color: c.label },
        headerStyle: ios ? undefined : { backgroundColor: c.bgGrouped },
        contentStyle: { backgroundColor: c.bgGrouped },
      }}
    >
      <Stack.Screen name="index" options={{ title }} />
    </Stack>
  );
}
