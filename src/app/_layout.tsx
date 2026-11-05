import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { EngineProvider } from '../engine/EngineProvider';
import { loadAllUserLuts } from '../lib/userLuts';
import { useLibrary } from '../store/library';
import { dark, grade, light } from '../theme/tokens';
import { useAppScheme } from '../theme/useTheme';
import { refreshLookWidget } from '../widgets';

export default function RootLayout() {
  const scheme = useAppScheme();
  const c = scheme === 'dark' ? dark : light;
  const lutCount = useLibrary((s) => s.userLuts.length);

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bgGrouped).catch(() => {});
  }, [c.bgGrouped]);

  useEffect(() => {
    refreshLookWidget();
  }, []);

  useEffect(() => {
    loadAllUserLuts().catch(() => {});
  }, [lutCount]);

  const navTheme = scheme === 'dark' ? DarkTheme : DefaultTheme;
  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: c.bgGrouped }}>
      <ThemeProvider
        value={{
          ...navTheme,
          colors: { ...navTheme.colors, primary: c.accentText, background: c.bgGrouped, card: c.surface, text: c.label, border: c.separator },
        }}
      >
        <EngineProvider>
          <Stack screenOptions={{ headerTintColor: c.accentText, contentStyle: { backgroundColor: c.bgGrouped } }}>
            <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
            <Stack.Screen
              name="project/[id]"
              options={{
                title: '',
                headerTintColor: grade.label,
                headerStyle: { backgroundColor: grade.bg },
                headerShadowVisible: false,
                headerBackButtonDisplayMode: 'minimal',
                contentStyle: { backgroundColor: grade.bg },
              }}
            />
            <Stack.Screen name="export/[id]" options={{ presentation: 'modal', title: 'Exportar' }} />
            <Stack.Screen
              name="profile/[id]"
              options={{ presentation: 'formSheet', title: 'Perfil de câmera', sheetAllowedDetents: [0.65, 1], sheetGrabberVisible: true }}
            />
            <Stack.Screen
              name="look/[id]"
              options={{ presentation: 'formSheet', title: '', sheetAllowedDetents: [0.8, 1], sheetGrabberVisible: true }}
            />
            <Stack.Screen
              name="rename/[id]"
              options={{ presentation: 'formSheet', title: 'Renomear', sheetAllowedDetents: [0.4], sheetGrabberVisible: true }}
            />
          </Stack>
        </EngineProvider>
        <StatusBar style={scheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
