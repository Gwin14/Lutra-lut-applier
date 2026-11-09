import { DarkTheme, DefaultTheme, Stack, ThemeProvider } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SystemUI from 'expo-system-ui';
import { useEffect, useState } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { EngineProvider } from '../engine/EngineProvider';
import { holdNativeSplash, Splash } from '../features/Splash';
import { useLang, useT } from '../i18n';
import { loadAllUserLuts } from '../lib/userLuts';
import { useLibrary } from '../store/library';
import { initPurchases } from '../store/pro';
import { useSettings, useSettingsHydrated } from '../store/settings';
import { dark, grade, light } from '../theme/tokens';
import { useAppScheme } from '../theme/useTheme';
import { refreshWidgetsLanguage } from '../widgets';

holdNativeSplash();

export default function RootLayout() {
  const [splash, setSplash] = useState(true);
  const hydrated = useSettingsHydrated();
  // Until settings are read, keep the app stack (hidden under the splash) so a
  // returning user never sees a frame of the introduction.
  const onboarded = useSettings((s) => s.onboarded) || !hydrated;
  const scheme = useAppScheme();
  const c = scheme === 'dark' ? dark : light;
  const lutCount = useLibrary((s) => s.userLuts.length);
  const t = useT();
  const lang = useLang();

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(c.bgGrouped).catch(() => {});
  }, [c.bgGrouped]);

  // Widgets can't read the app's language: push freshly localized strings.
  useEffect(() => {
    refreshWidgetsLanguage();
  }, [lang]);

  useEffect(() => {
    loadAllUserLuts().catch(() => {});
  }, [lutCount]);

  useEffect(() => {
    initPurchases();
  }, []);

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
            <Stack.Protected guard={onboarded}>
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
              <Stack.Screen name="export/[id]" options={{ presentation: 'modal', title: t.screens.export }} />
              <Stack.Screen name="paywall" options={{ presentation: 'modal', title: '' }} />
              <Stack.Screen
                name="profile/[id]"
                options={{ presentation: 'formSheet', title: t.screens.profile, sheetAllowedDetents: [0.65, 1], sheetGrabberVisible: true }}
              />
              <Stack.Screen
                name="look/[id]"
                options={{ presentation: 'formSheet', title: '', sheetAllowedDetents: [0.8, 1], sheetGrabberVisible: true }}
              />
              <Stack.Screen
                name="rename/[id]"
                options={{ presentation: 'formSheet', title: t.screens.rename, sheetAllowedDetents: [0.4], sheetGrabberVisible: true }}
              />
            </Stack.Protected>
            {/* Not guarded: on first run it is the only reachable route; later it reopens from Settings. */}
            <Stack.Screen name="onboarding" options={{ headerShown: false, presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }} />
          </Stack>
        </EngineProvider>
        <StatusBar style={splash || scheme === 'dark' ? 'light' : 'dark'} />
      </ThemeProvider>
      {splash ? <Splash onDone={() => setSplash(false)} /> : null}
    </GestureHandlerRootView>
  );
}
