import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEngine } from '../../engine/EngineProvider';
import { estimateBitrate, outputSize } from '../../engine/geometry';
import { estimateJobBytes, prepareJob } from '../../engine/jobs';
import { CONTAINER_CODECS, type ContainerId, type ResolutionId, type VideoCodecId } from '../../engine/protocol';
import { formatBytes, formatDuration, formatEta, formatResolution, plural } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { useActiveProgress, useExports } from '../../store/exports';
import { useProjects } from '../../store/projects';
import { useSettings, type ExportPreset } from '../../store/settings';
import { radius, space } from '../../theme/tokens';
import { usePalette, useScheme } from '../../theme/useTheme';
import { confirmDestructive } from '../../ui/actions';
import { Button } from '../../ui/Button';
import { Row, Section, SwitchRow } from '../../ui/List';
import { Chip, InlineNotice, ProgressBar } from '../../ui/States';
import { Segmented } from '../../ui/Segmented';
import { Text } from '../../ui/Text';

const CODEC_LABEL: Record<VideoCodecId, string> = { avc: 'H.264', hevc: 'HEVC', av1: 'AV1', vp9: 'VP9' };
const CONTAINERS: ContainerId[] = ['mp4', 'mov', 'webm'];
const RESOLUTIONS: { id: ResolutionId; label: string }[] = [
  { id: 'source', label: 'Original' },
  { id: '2160', label: '4K' },
  { id: '1440', label: '1440p' },
  { id: '1080', label: '1080p' },
  { id: '720', label: '720p' },
  { id: '540', label: '540p' },
];
const FPS: (number | 'source')[] = ['source', 24, 25, 30, 50, 60];
const MODES: ExportPreset['mode'][] = ['separate', 'merge'];
const TRANSITIONS: ExportPreset['transition'][] = ['cut', 'fade'];
const QUALITIES: ExportPreset['quality'][] = ['low', 'medium', 'high', 'max'];
const QUALITY_LABEL = { low: 'Leve', medium: 'Média', high: 'Alta', max: 'Máxima' };


function Progress({ onDone }: { onDone: () => void }) {
  const c = usePalette();
  const p = useActiveProgress();
  const active = useExports((s) => s.active);
  const engine = useEngine();
  if (!p.active || !active) {
    return (
      <View style={{ alignItems: 'center', gap: space.l, padding: space.xxl }}>
        <Text variant="title3">Exportação concluída</Text>
        <Button label="Ver exportações" onPress={onDone} />
      </View>
    );
  }
  const elapsed = (Date.now() - active.startedAt) / 1000;
  const eta = p.progress > 0.02 ? formatEta((elapsed / p.progress) * (1 - p.progress)) : 'preparando…';
  return (
    <View style={{ gap: space.xl, padding: space.l }}>
      <View style={{ aspectRatio: 16 / 9, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
        {active.preview ? <Image source={{ uri: active.preview }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : <ActivityIndicator />}
      </View>
      <View style={{ gap: space.s }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="title1" tabular>{`${Math.round(p.progress * 100)}%`}</Text>
          <Text variant="subhead" tone="secondary" tabular>
            {active.fps > 0 ? `${Math.round(active.fps)} quadros/s` : ''}
          </Text>
        </View>
        <ProgressBar value={p.progress} height={6} />
        <Text variant="subhead" tone="secondary" tabular>
          {`${p.current?.name ?? ''} · ${Math.min(p.finished + 1, p.count)} de ${p.count} · ${eta}`}
        </Text>
      </View>
      <InlineNotice title="Mantenha o Lutra aberto" message="A codificação usa o hardware de vídeo do aparelho e pausa se o app for para segundo plano. A tela não vai apagar sozinha." />
      <View style={{ gap: space.m }}>
        <Button label="Continuar editando" variant="secondary" onPress={() => router.back()} stretch />
        <Button
          label="Cancelar exportação"
          variant="destructive"
          onPress={() => confirmDestructive('Cancelar exportação?', 'Os arquivos já finalizados são mantidos.', 'Cancelar exportação', () => engine.cancel())}
          stretch
        />
      </View>
    </View>
  );
}

export default function ExportScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  const saved = useSettings((s) => s.exportPreset);
  const saveToPhotos = useSettings((s) => s.saveToPhotos);
  const caps = useExports((s) => s.caps);
  const engineReady = useExports((s) => s.engineReady);
  const busy = useExports((s) => !!s.active);
  const engine = useEngine();
  const insets = useSafeAreaInsets();
  const [preset, setPreset] = useState<ExportPreset>(saved);
  const [selected, setSelected] = useState<string[]>(() => project?.clips.map((c) => c.id) ?? []);
  const [phase, setPhase] = useState<'form' | 'preparing' | 'running'>(busy ? 'running' : 'form');
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<ExportPreset>) => setPreset((p) => ({ ...p, ...patch }));

  const codecOk = (codec: VideoCodecId) => {
    if (!caps) return codec === 'avc';
    const uhd = preset.resolution === '2160' || preset.resolution === 'source';
    return uhd ? caps.video[codec].uhd || caps.video[codec].hd : caps.video[codec].hd;
  };
  const containerOk = (ct: ContainerId) => CONTAINER_CODECS[ct].some(codecOk);
  const containers = CONTAINERS.filter(containerOk);
  const container = containers.includes(preset.container) ? preset.container : (containers[0] ?? 'mp4');
  const codecs = CONTAINER_CODECS[container].filter(codecOk);
  const codec = codecs.includes(preset.codec) ? preset.codec : (codecs[0] ?? 'avc');

  const clips = project?.clips ?? [];
  const chosen = clips.filter((c) => selected.includes(c.id));
  const totalDuration = chosen.reduce((n, c) => n + Math.max(0, c.trim.end - c.trim.start), 0);
  const first = chosen[0];
  const firstSize = first ? outputSize(first.width || 1920, first.height || 1080, project!.aspect, preset.resolution) : null;
  const bytes = useMemo(
    () =>
      project
        ? estimateJobBytes(project, selected, (w, h) => {
            const s = outputSize(w || 1920, h || 1080, project.aspect, preset.resolution);
            return estimateBitrate(s.width, s.height, preset.fps === 'source' ? 30 : preset.fps, preset.quality, codec);
          })
        : 0,
    [project, selected, preset.resolution, preset.fps, preset.quality, codec],
  );

  if (!project) return null;
  const files = preset.mode === 'merge' ? 1 : chosen.length;

  const start = async () => {
    setError(null);
    setPhase('preparing');
    try {
      const final = { ...preset, container, codec };
      useSettings.getState().setExportPreset(final);
      const prepared = await prepareJob(project, selected, final);
      engine.enqueue(prepared, preset.mode === 'merge' ? project.name : `${project.name} · ${plural(prepared.records.length, 'vídeo', 'vídeos')}`, project.id);
      haptic.medium();
      setPhase('running');
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
      setPhase('form');
    }
  };

  const unsupported = caps && !caps.webcodecs;

  return (
    <>
      <Stack.Screen
        options={{
          title: phase === 'running' ? 'Exportando' : 'Exportar',
          headerLeft: () => <Button label={phase === 'running' ? 'Fechar' : 'Cancelar'} variant="plain" size="small" onPress={() => router.back()} />,
        }}
      />
      {phase === 'running' ? (
        <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ paddingBottom: insets.bottom + space.xl }}>
          <Progress onDone={() => router.dismissTo('/exports')} />
        </ScrollView>
      ) : (
        <View style={{ flex: 1 }}>
          <ScrollView contentInsetAdjustmentBehavior="automatic" contentContainerStyle={{ padding: space.l, gap: space.xl, paddingBottom: 140 }}>
            {!engineReady || !caps ? (
              <InlineNotice title="Iniciando o motor de vídeo…" message="Verificando quais codecs este aparelho consegue codificar." />
            ) : unsupported ? (
              <InlineNotice
                tone="error"
                title="Este sistema não oferece codificação de vídeo pela WebView"
                message="O Lutra usa WebCodecs (iOS 16.4+ ou Android System WebView 94+). Atualize o sistema ou a WebView do Android pela Play Store."
              />
            ) : null}
            {error ? <InlineNotice tone="error" title="Não foi possível iniciar" message={error} /> : null}

            <Section title="Saída">
              <Segmented values={MODES} labels={['Um arquivo por clipe', 'Juntar em um vídeo']} value={preset.mode} onChange={(mode) => set({ mode })} />
              {preset.mode === 'merge' ? (
                <Segmented values={TRANSITIONS} labels={['Corte seco', 'Fade entre clipes']} value={preset.transition} onChange={(transition) => set({ transition })} />
              ) : null}
              {preset.mode === 'merge' ? <SwitchRow title="Fade no início e no fim" value={preset.fadeEnds} onValueChange={(fadeEnds) => set({ fadeEnds })} /> : null}
            </Section>

            <Section title={`Clipes · ${chosen.length} de ${clips.length}`} footer={preset.mode === 'merge' ? 'A ordem do vídeo final segue a ordem do lote no editor.' : undefined}>
              {clips.map((c) => (
                <Row
                  key={c.id}
                  title={c.name}
                  subtitle={`${formatDuration(Math.max(0, c.trim.end - c.trim.start))}${c.trim.start > 0 || c.trim.end < c.duration ? ' (cortado)' : ''}`}
                  checked={selected.includes(c.id)}
                  onPress={() => {
                    haptic.selection();
                    setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]));
                  }}
                />
              ))}
            </Section>

            <Section title="Formato">
              <Segmented
                values={containers.length ? containers : (['mp4'] as ContainerId[])}
                labels={(containers.length ? containers : ['mp4']).map((ct) => ct.toUpperCase())}
                value={container}
                onChange={(ct) => set({ container: ct, codec: CONTAINER_CODECS[ct].find(codecOk) ?? CONTAINER_CODECS[ct][0] })}
              />
              {codecs.length > 1 ? (
                <Segmented values={codecs} labels={codecs.map((cd) => CODEC_LABEL[cd])} value={codec} onChange={(cd) => set({ codec: cd })} />
              ) : (
                <Row title="Codec" value={CODEC_LABEL[codec]} />
              )}
              <SwitchRow title="Incluir áudio" subtitle="Copiado sem recompressão quando possível" value={preset.audio} onValueChange={(audio) => set({ audio })} />
            </Section>

            <Section title="Resolução">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, padding: space.l }}>
                {RESOLUTIONS.map((r) => (
                  <Chip key={r.id} label={r.label} selected={preset.resolution === r.id} onPress={() => set({ resolution: r.id })} />
                ))}
              </View>
            </Section>

            <Section title="Quadros por segundo">
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, padding: space.l }}>
                {FPS.map((f) => (
                  <Chip key={String(f)} label={f === 'source' ? 'Original' : `${f}`} selected={preset.fps === f} onPress={() => set({ fps: f })} />
                ))}
              </View>
            </Section>

            <Section title="Qualidade" footer={preset.lutPrecision === 65 ? 'LUT 65³: máxima fidelidade de cor (recomendado para log).' : 'LUT 33³: preparação mais rápida.'}>
              <Segmented values={QUALITIES} labels={QUALITIES.map((q) => QUALITY_LABEL[q])} value={preset.quality} onChange={(quality) => set({ quality })} />
              <Segmented values={['65', '33']} labels={['Cor: precisão máxima', 'Cor: rápida']} value={String(preset.lutPrecision)} onChange={(v) => set({ lutPrecision: Number(v) as 33 | 65 })} />
            </Section>

            <Section footer={saveToPhotos ? (container === 'webm' ? 'WebM não é aceito pela Galeria: o arquivo fica em Exportações para compartilhar.' : 'Os vídeos são salvos no álbum "Lutra" da Galeria.') : 'Os vídeos ficam em Exportações; você pode salvá-los depois.'}>
              <SwitchRow title="Salvar na Galeria" value={saveToPhotos} onValueChange={(v) => useSettings.getState().set('saveToPhotos', v)} />
            </Section>
          </ScrollView>

          <ExportBar
            summary={`${plural(files, 'arquivo', 'arquivos')} · ${firstSize ? formatResolution(firstSize.width, firstSize.height) : ''} · ${formatDuration(totalDuration)} · ≈ ${formatBytes(bytes)}`}
            label={preset.mode === 'merge' ? 'Exportar vídeo único' : `Exportar ${plural(files, 'vídeo', 'vídeos')}`}
            disabled={!chosen.length || !engineReady || !caps || !!unsupported}
            loading={phase === 'preparing'}
            onPress={start}
            bottom={insets.bottom}
          />
        </View>
      )}
    </>
  );
}

function ExportBar({ summary, label, disabled, loading, onPress, bottom }: { summary: string; label: string; disabled: boolean; loading: boolean; onPress: () => void; bottom: number }) {
  const c = usePalette();
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: Math.max(bottom, space.l), gap: space.s, backgroundColor: c.bgGrouped, borderTopWidth: 0.5, borderColor: c.separator }}>
      <Text variant="footnote" tone="secondary" center tabular numberOfLines={1}>
        {loading ? 'Preparando cores do lote…' : summary}
      </Text>
      <Button label={label} size="large" onPress={onPress} disabled={disabled} loading={loading} stretch icon="exports" />
    </View>
  );
}
