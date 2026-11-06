import { Tabs } from 'expo-router';

import { useT } from '../../i18n';
import { usePalette } from '../../theme/useTheme';
import { Icon, type IconName } from '../../ui/Icon';

/** Web fallback (native tabs are iOS/Android only). Used for previews and QA. */
export default function TabsLayout() {
  const c = usePalette();
  const t = useT();
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
      <Tabs.Screen name="(studio)" options={{ title: t.tabs.studio, tabBarIcon: icon('studio') }} />
      <Tabs.Screen name="looks" options={{ title: t.tabs.looks, tabBarIcon: icon('looks') }} />
      <Tabs.Screen name="exports" options={{ title: t.tabs.exports, tabBarIcon: icon('exports') }} />
      <Tabs.Screen name="settings" options={{ title: t.tabs.settings, tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}
