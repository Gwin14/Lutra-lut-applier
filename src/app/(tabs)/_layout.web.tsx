import { Tabs } from 'expo-router';

import { usePalette } from '../../theme/useTheme';
import { Icon, type IconName } from '../../ui/Icon';

/** Web fallback (native tabs are iOS/Android only). Used for previews and QA. */
export default function TabsLayout() {
  const c = usePalette();
  const icon = (name: IconName) =>
    function TabIcon({ color }: { color: import('react-native').ColorValue }) {
      return <Icon name={name} size={24} color={color} />;
    };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentText,
        tabBarInactiveTintColor: c.labelSecondary,
        tabBarStyle: { backgroundColor: c.surface, borderTopColor: c.separator },
      }}
    >
      <Tabs.Screen name="(studio)" options={{ title: 'Estúdio', tabBarIcon: icon('studio') }} />
      <Tabs.Screen name="looks" options={{ title: 'Looks', tabBarIcon: icon('looks') }} />
      <Tabs.Screen name="exports" options={{ title: 'Exportações', tabBarIcon: icon('exports') }} />
      <Tabs.Screen name="settings" options={{ title: 'Ajustes', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
