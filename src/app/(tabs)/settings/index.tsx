import Constants from 'expo-constants';
import { router } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { getProfile } from '../../../color/profiles';
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
  const caps = useExports((x) => x.caps);
  const records = useExports((x) => x.records);
  const [storageTick, setStorageTick] = useState(0);
  const storage = useMemo(() => directorySize(dirs.exports), [storageTick, records.length]); // eslint-disable-line react-hooks/exhaustive-deps
  const isExpoGo = Constants.executionEnvironment === 'storeClient';

  const codecLine = caps
    ? (['avc', 'hevc', 'av1', 'vp9'] as const)
        .filter((k) => caps.video[k].hd)
        .map((k) => `${{ avc: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' }[k]}${caps.video[k].uhd ? ' 4K' : ''}`)
        .join(', ') || 'nenhum'
    : 'verificando…';

  return (
    <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.xxl, paddingBottom: space.xxxl * 2 }}>
      <Section title="Aparência">
        <Segmented<Settings['theme']> values={['system', 'light', 'dark']} labels={['Sistema', 'Claro', 'Escuro']} value={s.theme} onChange={(v) => s.set('theme', v)} />
      </Section>

      <Section title="Prévia" footer="Precisão do LUT na prévia ao vivo. A exportação sempre usa a precisão escolhida na tela de exportar.">
        <Segmented<Settings['previewQuality']> values={['fast', 'balanced', 'max']} labels={['Rápida 17³', 'Equilibrada 25³', 'Máxima 33³']} value={s.previewQuality} onChange={(v) => s.set('previewQuality', v)} />
        <SwitchRow title="Vibração" subtitle="Toques sutis em sliders, seleções e fim de exportação" value={s.haptics} onValueChange={(v) => s.set('haptics', v)} />
      </Section>

      <Section title="Log" footer="A detecção analisa contraste e saturação do primeiro quadro e o nome do arquivo (ex.: C0001 → Sony, DJI_ → DJI).">
        <SwitchRow title="Detectar footage em log" value={s.autoDetectLog} onValueChange={(v) => s.set('autoDetectLog', v)} />
        <Row
          title="Perfil log padrão"
          value={getProfile(s.preferredLog).name}
          chevron
          onPress={() => router.push({ pathname: '/profile/[id]', params: { id: 'default' } })}
        />
      </Section>

      <Section title="Exportação">
        <SwitchRow title="Salvar na Galeria" subtitle={`Álbum "${s.albumName}"`} value={s.saveToPhotos} onValueChange={(v) => s.set('saveToPhotos', v)} />
        <Row title="Arquivos no app" value={formatBytes(storage)} />
        <Row
          title="Apagar exportações do app"
          destructive
          onPress={() =>
            confirmDestructive('Apagar exportações?', 'Os vídeos salvos na Galeria continuam lá. Os demais serão apagados.', 'Apagar', () => {
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
        title="Widgets"
        footer={
          widgetsAvailable
            ? 'Toque e segure a tela bloqueada, toque em Personalizar e adicione "Lutra": progresso da exportação, look do dia e atalho para novo lote. Durante exportações aparece uma Live Activity.'
            : isExpoGo
              ? 'Widgets de tela bloqueada e Live Activity precisam de um build de desenvolvimento (npx expo run:ios). No Expo Go o resto do app funciona normalmente.'
              : process.env.EXPO_OS === 'android'
                ? 'Os widgets de tela bloqueada são do iOS. No Android, o progresso aparece aqui e na aba Exportações.'
                : 'Widgets indisponíveis neste build.'
        }
      >
        <Row icon="widgets" title="Tela bloqueada e Live Activity" value={widgetsAvailable ? 'Ativos' : 'Indisponíveis'} />
      </Section>

      <Section title="Motor de renderização" footer="Decodificação, cor e codificação rodam no hardware de vídeo do aparelho via WebCodecs, sem módulos nativos extras — compatível com o Expo Go.">
        <Row icon="engine" title="WebCodecs" value={caps ? (caps.webcodecs ? 'Disponível' : 'Indisponível') : '…'} />
        <Row title="Codecs de vídeo" subtitle={codecLine} />
        <Row title="Áudio" value={caps ? [caps.audio.aac && 'AAC', caps.audio.opus && 'Opus'].filter(Boolean).join(', ') || 'cópia direta' : '…'} />
        <Row title="WebGL" value={caps ? (caps.webgl ? `WebGL ${caps.webgl}` : 'Indisponível') : '…'} />
      </Section>

      <Section title="Sobre">
        <Row title="Versão" value={Constants.expoConfig?.version ?? '1.0.0'} />
        <Row
          title="Licenças de terceiros"
          chevron
          onPress={() =>
            Alert.alert(
              'Licenças',
              'mediabunny (MPL-2.0) — mux/demux de vídeo no motor de exportação.\nReact Native Skia (MIT), Expo (MIT), Zustand (MIT).\nCurvas log e gamuts conforme documentação pública de Sony, Panasonic, Canon, ARRI, Fujifilm, Nikon, DJI, Apple, Blackmagic e GoPro.',
            )
          }
        />
      </Section>
      <Text variant="footnote" tone="tertiary" center>
        Lutra · feito para quem grava em log
      </Text>
    </ScrollView>
  );
}
