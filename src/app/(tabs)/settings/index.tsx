import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { LANG_NAMES, useT } from '../../../i18n';
import { profileText } from '../../../i18n/content';
import { dirs, directorySize } from '../../../lib/files';
import { formatBytes } from '../../../lib/format';
import { haptic } from '../../../lib/haptics';
import { useExports } from '../../../store/exports';
import { useSettings, type Settings } from '../../../store/settings';
import { space } from '../../../theme/tokens';
import { usePalette, useScheme } from '../../../theme/useTheme';
import { confirmDestructive } from '../../../ui/actions';
import { Row, Section, SwitchRow } from '../../../ui/List';
import { Segmented } from '../../../ui/Segmented';
import { Text } from '../../../ui/Text';
import { widgetsAvailable } from '../../../widgets';


export default function SettingsScreen() {
  const s = useSettings();
  const t = useT();
  const caps = useExports((x) => x.caps);
  const records = useExports((x) => x.records);
  const [storageTick, setStorageTick] = useState(0);
  const storage = useMemo(() => directorySize(dirs.exports), [storageTick, records.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const isExpoGo = Constants.executionEnvironment === 'storeClient';

  const codecLine = caps
    ? (['avc', 'hevc', 'av1', 'vp9'] as const)
        .filter((k) => caps.video[k].hd)
        .map((k) => `${{ avc: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' }[k]}${caps.video[k].uhd ? ' 4K' : ''}`)
        .join(', ') || t.settings.none
    : t.settings.checking;

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.xxl, paddingBottom: space.xxxl * 2 }}>
      <Section title={t.settings.language}>
        <Segmented<Settings['language']> values={['system', 'pt', 'en']} labels={[t.settings.languageSystem, LANG_NAMES.pt, LANG_NAMES.en]} value={s.language} onChange={(v) => s.set('language', v)} />
      </Section>

      <Section title={t.settings.appearance}>
        <Segmented<Settings['theme']> values={['system', 'light', 'dark']} labels={[t.settings.themeSystem, t.settings.themeLight, t.settings.themeDark]} value={s.theme} onChange={(v) => s.set('theme', v)} />
      </Section>

      <Section title={t.settings.preview} footer={t.settings.previewFooter}>
        <Segmented<Settings['previewQuality']> values={['fast', 'balanced', 'max']} labels={[t.settings.previewFast, t.settings.previewBalanced, t.settings.previewMax]} value={s.previewQuality} onChange={(v) => s.set('previewQuality', v)} />
        <SwitchRow title={t.settings.haptics} subtitle={t.settings.hapticsHint} value={s.haptics} onValueChange={(v) => s.set('haptics', v)} />
      </Section>

      <Section title={t.settings.log} footer={t.settings.logFooter}>
        <SwitchRow title={t.settings.detectLog} value={s.autoDetectLog} onValueChange={(v) => s.set('autoDetectLog', v)} />
        <Row
          title={t.settings.defaultLog}
          value={profileText(s.preferredLog, t).name}
          chevron
          onPress={() => router.push({ pathname: '/profile/[id]', params: { id: 'default' } })}
        />
      </Section>

      <Section title={t.settings.export}>
        <SwitchRow title={t.settings.saveToPhotos} subtitle={t.settings.album(s.albumName)} value={s.saveToPhotos} onValueChange={(v) => s.set('saveToPhotos', v)} />
        <Row title={t.settings.filesInApp} value={formatBytes(storage)} />
        <Row
          title={t.settings.clearExports}
          destructive
          onPress={() =>
            confirmDestructive(t.settings.clearTitle, t.settings.clearMessage, t.settings.clearConfirm, () => {
              try {
                const d = dirs.exports();
                d.delete();
              } catch {}
              const st = useExports.getState();
              for (const r of st.records) if (r.status !== 'rendering' && r.status !== 'queued') st.removeRecord(r.id);
              setStorageTick((n) => n + 1);
              haptic.success();
            })
          }
        />
      </Section>

      <Section
        title={t.settings.widgets}
        footer={
          widgetsAvailable
            ? t.settings.widgetsOn
            : isExpoGo
              ? t.settings.widgetsExpoGo
              : process.env.EXPO_OS === 'android'
                ? t.settings.widgetsAndroid
                : t.settings.widgetsOff
        }
      >
        <Row icon="widgets" title={t.settings.widgetsRow} value={widgetsAvailable ? t.settings.active : t.settings.unavailablePlural} />
      </Section>

      <Section title={t.settings.engine} footer={t.settings.engineFooter}>
        <Row icon="engine" title="WebCodecs" value={caps ? (caps.webcodecs ? t.settings.available : t.settings.unavailable) : '…'} />
        <Row title={t.settings.videoCodecs} subtitle={codecLine} />
        <Row title={t.settings.audio} value={caps ? [caps.audio.aac && 'AAC', caps.audio.opus && 'Opus'].filter(Boolean).join(', ') || t.settings.directCopy : '…'} />
        <Row title="WebGL" value={caps ? (caps.webgl ? `WebGL ${caps.webgl}` : t.settings.unavailable) : '…'} />
      </Section>

      <Section title={t.settings.about}>
        <Row title={t.settings.version} value={Constants.expoConfig?.version ?? '1.0.0'} />
        <Row
          title={t.settings.licenses}
          chevron
          onPress={() =>
            Alert.alert(t.settings.licensesTitle, t.settings.licensesBody)
          }
        />
      </Section>
      <Text variant="footnote" tone="tertiary" center>
        {t.settings.tagline}
      </Text>
    </ScrollView>
  );
}
