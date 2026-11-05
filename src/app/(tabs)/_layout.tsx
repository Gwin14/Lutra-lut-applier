import { Image } from 'expo-image';
import { router } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { View } from 'react-native';

import { useT } from '../../i18n';
import { formatEta } from '../../lib/format';
import { useActiveProgress, useExports } from '../../store/exports';
import { space } from '../../theme/tokens';
import { usePalette } from '../../theme/useTheme';
import { PressableScale } from '../../ui/Pressable';
import { ProgressBar } from '../../ui/States';
import { Text } from '../../ui/Text';

/** iOS 26 bottom accessory: live render progress, like a mini player. */
function RenderAccessory() {
  const c = usePalette();
  const t = useT();
  const p = useActiveProgress();
  const active = useExports((s) => s.active);
  if (!p.active || !active) return null;
  const elapsed = (Date.now() - active.startedAt) / 1000;
  const eta = p.progress > 0.02 ? formatEta((elapsed / p.progress) * (1 - p.progress)) : t.format.preparing;
  return (
    <PressableScale
      feedback="opacity"
      onPress={() => router.navigate('/exports')}
      accessibilityRole="button"
      accessibilityLabel={t.accessory.a11y(Math.round(p.progress * 100))}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.m, paddingHorizontal: space.l }}
    >
      {active.preview ? (
        <Image source={{ uri: active.preview }} style={{ width: 36, height: 24, borderRadius: 4 }} contentFit="cover" />
      ) : (
        <View style={{ width: 36, height: 24, borderRadius: 4, backgroundColor: c.fill }} />
      )}
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="footnote" weight="600" numberOfLines={1}>
          {t.accessory.line(Math.min(p.finished + 1, p.count), p.count, eta)}
        </Text>
        <ProgressBar value={p.progress} height={3} />
      </View>
      <Text variant="footnote" tabular tone="secondary">{`${Math.round(p.progress * 100)}%`}</Text>
    </PressableScale>
  );
}

export default function TabsLayout() {
  const c = usePalette();
  const t = useT();
  const rendering = useExports((s) => !!s.active);
  return (
    <NativeTabs tintColor={c.accentText} minimizeBehavior="onScrollDown">
      <NativeTabs.Trigger name="(studio)">
        <NativeTabs.Trigger.Icon sf={{ default: 'film.stack', selected: 'film.stack.fill' }} md="movie" />
        <NativeTabs.Trigger.Label>{t.tabs.studio}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="looks">
        <NativeTabs.Trigger.Icon sf="camera.filters" md="palette" />
        <NativeTabs.Trigger.Label>{t.tabs.looks}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="exports">
        <NativeTabs.Trigger.Icon sf={{ default: 'square.and.arrow.up.on.square', selected: 'square.and.arrow.up.on.square.fill' }} md="ios_share" />
        <NativeTabs.Trigger.Label>{t.tabs.exports}</NativeTabs.Trigger.Label>
        {rendering ? <NativeTabs.Trigger.Badge> </NativeTabs.Trigger.Badge> : null}
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} md="settings" />
        <NativeTabs.Trigger.Label>{t.tabs.settings}</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      {rendering && process.env.EXPO_OS === 'ios' ? (
        <NativeTabs.BottomAccessory>
          <RenderAccessory />
        </NativeTabs.BottomAccessory>
      ) : null}
    </NativeTabs>
  );
}
