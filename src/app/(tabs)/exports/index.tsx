import { FlashList } from '@shopify/flash-list';
import { Image } from 'expo-image';
import * as Sharing from 'expo-sharing';
import { Alert, Pressable, View } from 'react-native';

import { saveToPhotos, useEngine } from '../../../engine/EngineProvider';
import { deleteFile } from '../../../lib/files';
import { formatBytes, formatDuration, formatEta, formatRelative, formatResolution } from '../../../lib/format';
import { haptic } from '../../../lib/haptics';
import { useActiveProgress, useExports, type ExportRecord } from '../../../store/exports';
import { radius, space } from '../../../theme/tokens';
import { usePalette } from '../../../theme/useTheme';
import { confirmDestructive, showActions } from '../../../ui/actions';
import { Button } from '../../../ui/Button';
import { Icon } from '../../../ui/Icon';
import { EmptyState, ProgressBar } from '../../../ui/States';
import { Text } from '../../../ui/Text';

const CODEC = { avc: 'H.264', hevc: 'HEVC', vp9: 'VP9', av1: 'AV1' } as const;

function ActiveCard() {
  const c = usePalette();
  const p = useActiveProgress();
  const active = useExports((s) => s.active);
  const engine = useEngine();
  if (!p.active || !active) return null;
  const elapsed = (Date.now() - active.startedAt) / 1000;
  const eta = p.progress > 0.02 ? formatEta((elapsed / p.progress) * (1 - p.progress)) : 'preparando…';
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden', marginBottom: space.xl }}>
      <View style={{ aspectRatio: 16 / 9, backgroundColor: '#000' }}>
        {active.preview ? <Image source={{ uri: active.preview }} style={{ flex: 1 }} contentFit="contain" /> : null}
      </View>
      <View style={{ padding: space.l, gap: space.s }}>
        <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
          <Text variant="headline" numberOfLines={1} style={{ flex: 1 }}>
            {active.title}
          </Text>
          <Text variant="headline" tabular tone="accent">{`${Math.round(p.progress * 100)}%`}</Text>
        </View>
        <ProgressBar value={p.progress} height={5} />
        <Text variant="footnote" tone="secondary" tabular>
          {`${Math.min(p.finished + 1, p.count)} de ${p.count} · ${eta}${active.fps ? ` · ${Math.round(active.fps)} quadros/s` : ''}`}
        </Text>
        <Button
          label="Cancelar"
          variant="destructive"
          size="small"
          style={{ alignSelf: 'flex-start', marginTop: space.xs }}
          onPress={() => confirmDestructive('Cancelar exportação?', 'Os arquivos já finalizados são mantidos.', 'Cancelar exportação', () => engine.cancel())}
        />
      </View>
    </View>
  );
}

async function share(r: ExportRecord) {
  if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(r.uri, { dialogTitle: r.name });
}

function RecordRow({ r }: { r: ExportRecord }) {
  const c = usePalette();
  const done = r.status === 'done';
  const meta =
    r.status === 'done'
      ? [formatResolution(r.width, r.height), formatDuration(r.duration), formatBytes(r.size), r.codec ? CODEC[r.codec] : null, r.container.toUpperCase()].filter(Boolean).join(' · ')
      : r.status === 'failed'
        ? r.error ?? 'Falhou'
        : r.status === 'canceled'
          ? 'Cancelado'
          : r.status === 'rendering'
            ? `Renderizando · ${Math.round(r.progress * 100)}%`
            : 'Na fila';
  const actions = () =>
    showActions(r.name, [
      ...(done ? [{ label: 'Compartilhar', onPress: () => share(r) }] : []),
      ...(done && r.container !== 'webm'
        ? [
            {
              label: r.savedToPhotos ? 'Salvar na Galeria de novo' : 'Salvar na Galeria',
              onPress: async () => {
                const ok = await saveToPhotos(r.uri);
                if (ok) {
                  haptic.success();
                  useExports.getState().patchRecord(r.id, { savedToPhotos: true });
                } else Alert.alert('Sem acesso à Galeria', 'Permita o acesso a Fotos nos Ajustes do sistema.');
              },
            },
          ]
        : []),
      {
        label: 'Excluir do app',
        destructive: true,
        onPress: () =>
          confirmDestructive('Excluir exportação?', r.savedToPhotos ? 'A cópia na Galeria continua lá.' : 'O arquivo será apagado do aparelho.', 'Excluir', () => {
            deleteFile(r.uri);
            useExports.getState().removeRecord(r.id);
          }),
      },
    ]);
  return (
    <Pressable
      onPress={done ? () => share(r) : actions}
      onLongPress={actions}
      accessibilityRole="button"
      accessibilityLabel={`${r.name}, ${meta}`}
      accessibilityHint="Toque para compartilhar, segure para mais opções"
      style={({ pressed }) => ({ flexDirection: 'row', gap: space.m, alignItems: 'center', paddingVertical: space.m, paddingHorizontal: space.l, backgroundColor: pressed ? c.fill : c.surface })}
    >
      <View style={{ width: 72, height: 48, borderRadius: radius.media, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
        {r.thumb ? <Image source={{ uri: r.thumb }} style={{ width: 72, height: 48 }} contentFit="cover" recyclingKey={r.id} /> : <Icon name={r.status === 'failed' ? 'error' : 'clock'} size={20} color={r.status === 'failed' ? c.danger : c.labelTertiary} />}
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="body" numberOfLines={1}>
          {r.name}
        </Text>
        <Text variant="footnote" tone={r.status === 'failed' ? 'danger' : 'secondary'} numberOfLines={2} tabular>
          {meta}
        </Text>
        <View style={{ flexDirection: 'row', gap: space.s, alignItems: 'center' }}>
          <Text variant="caption1" tone="tertiary">
            {formatRelative(r.finishedAt ?? r.createdAt)}
          </Text>
          {r.savedToPhotos ? (
            <Text variant="caption1" tone="accent">
              Na Galeria
            </Text>
          ) : null}
        </View>
      </View>
      {r.status === 'rendering' ? <Text variant="subhead" tabular tone="accent">{`${Math.round(r.progress * 100)}%`}</Text> : <Icon name="more" size={18} color={c.labelTertiary} />}
    </Pressable>
  );
}

export default function ExportsScreen() {
  const c = usePalette();
  const records = useExports((s) => s.records);
  return (
    <FlashList
      data={records}
      keyExtractor={(r) => r.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: space.l, paddingBottom: space.xxxl * 2 }}
      ListHeaderComponent={<ActiveCard />}
      renderItem={({ item, index }) => {
        const first = index === 0;
        const last = index === records.length - 1;
        return (
          <View style={{ backgroundColor: c.surface, borderTopLeftRadius: first ? radius.card : 0, borderTopRightRadius: first ? radius.card : 0, borderBottomLeftRadius: last ? radius.card : 0, borderBottomRightRadius: last ? radius.card : 0, borderCurve: 'continuous', overflow: 'hidden' }}>
            <RecordRow r={item} />
            {!last ? <View style={{ height: 0.5, backgroundColor: c.separator, marginLeft: space.l + 72 + space.m }} /> : null}
          </View>
        );
      }}
      ListEmptyComponent={<EmptyState icon="exports" title="Nada exportado ainda" message="Abra um lote, escolha um look e toque em Exportar. O progresso aparece aqui e na tela bloqueada." />}
    />
  );
}
