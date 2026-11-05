import { Stack } from 'expo-router';

import { usePalette } from '../theme/useTheme';

/** Each tab keeps its own native stack with a collapsing large title. */
export function TabStack({ title }: { title: string }) {
  const c = usePalette();
  const ios = process.env.EXPO_OS === 'ios';
  return (
    <Stack
      screenOptions={{
        headerLargeTitle: true,
        headerTransparent: ios,
        headerBlurEffect: ios ? 'systemChromeMaterial' : undefined,
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
