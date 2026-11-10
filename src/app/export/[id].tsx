import { Image } from 'expo-image';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useEngine } from '../../engine/EngineProvider';
import { estimateBitrate, outputSize } from '../../engine/geometry';
import { estimateJobBytes, prepareJob } from '../../engine/jobs';
import { CONTAINER_CODECS, type ContainerId, type ResolutionId, type VideoCodecId } from '../../engine/protocol';
import { tr, useT } from '../../i18n';
import { formatBytes, formatDayMonth, formatDuration, formatEta, formatResolution } from '../../lib/format';
import { haptic } from '../../lib/haptics';
import { useActiveProgress, useExports } from '../../store/exports';
import { presentPaywall, requirePro, useProLocked, useProStore } from '../../store/pro';
import { exportsLeft, FREE_MONTHLY_EXPORTS, QUOTA_WARN_AT, quotaResetsAt, useExportsLeft } from '../../store/quota';
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
const RESOLUTIONS: { id: ResolutionId; label: string | null }[] = [
  { id: 'source', label: null },
  { id: '2160', label: '4K' },
  { id: '1440', label: '1440p' },
  { id: '1080', label: '1080p' },
  { id: '720', label: '720p' },
  { id: '540', label: '540p' },
];
const PRO_RESOLUTIONS: ResolutionId[] = ['source', '2160', '1440'];
const FPS: (number | 'source')[] = ['source', 24, 25, 30, 50, 60];
const MODES: ExportPreset['mode'][] = ['separate', 'merge'];
const TRANSITIONS: ExportPreset['transition'][] = ['cut', 'fade'];
const QUALITIES: ExportPreset['quality'][] = ['low', 'medium', 'high', 'max'];


function Progress({ onDone }: { onDone: () => void }) {
  const c = usePalette();
  const t = useT();
  const p = useActiveProgress();
  const active = useExports((s) => s.active);
  const engine = useEngine();
  if (!p.active || !active) {
    return (
      <View style={{ alignItems: 'center', gap: space.l, padding: space.xxl }}>
        <Text variant="title3">{t.exportSheet.done}</Text>
        <Button label={t.exportSheet.viewExports} onPress={onDone} />
        <QuotaNotice />
      </View>
    );
  }
  const elapsed = (Date.now() - active.startedAt) / 1000;
  const eta = p.progress > 0.02 ? formatEta((elapsed / p.progress) * (1 - p.progress)) : t.format.preparing;
  return (
    <View style={{ gap: space.xl, padding: space.l }}>
      <View style={{ aspectRatio: 16 / 9, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill, alignItems: 'center', justifyContent: 'center' }}>
        {active.preview ? <Image source={{ uri: active.preview }} style={{ width: '100%', height: '100%' }} contentFit="contain" /> : <ActivityIndicator />}
      </View>
      <View style={{ gap: space.s }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <Text variant="title1" tabular>{`${Math.round(p.progress * 100)}%`}</Text>
          <Text variant="subhead" tone="secondary" tabular>
            {active.fps > 0 ? t.format.framesPerSecond(Math.round(active.fps)) : ''}
          </Text>
        </View>
        <ProgressBar value={p.progress} height={6} />
        <Text variant="subhead" tone="secondary" tabular>
          {`${p.current?.name ?? ''} · ${t.common.xOfY(Math.min(p.finished + 1, p.count), p.count)} · ${eta}`}
        </Text>
      </View>
      <InlineNotice title={t.exportSheet.keepOpenTitle} message={t.exportSheet.keepOpenMessage} />
      <View style={{ gap: space.m }}>
        <Button label={t.exportSheet.keepEditing} variant="secondary" onPress={() => router.back()} stretch />
        <Button
          label={t.exports.cancelConfirm}
          variant="destructive"
          onPress={() => confirmDestructive(t.exports.cancelTitle, t.exports.cancelMessage, t.exports.cancelConfirm, () => engine.cancel())}
          stretch
        />
      </View>
    </View>
  );
}

export default function ExportScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  const saved = useSettings((s) => s.exportPreset);
  const saveToPhotos = useSettings((s) => s.saveToPhotos);
  const albumName = useSettings((s) => s.albumName);
  const caps = useExports((s) => s.caps);
  const engineReady = useExports((s) => s.engineReady);
  const busy = useExports((s) => !!s.active);
  const engine = useEngine();
  const insets = useSafeAreaInsets();
  const isPro = useProStore((s) => s.isPro);
  const locked = useProLocked();
  const left = useExportsLeft();
  const [preset, setPreset] = useState<ExportPreset>(() => (!useProStore.getState().isPro && PRO_RESOLUTIONS.includes(saved.resolution) ? { ...saved, resolution: '1080' } : saved));
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
    if (PRO_RESOLUTIONS.includes(preset.resolution) && !requirePro()) return;
    if (!quotaAllows(files)) return;
    setError(null);
    setPhase('preparing');
    try {
      const final = { ...preset, container, codec };
      useSettings.getState().setExportPreset(final);
      const prepared = await prepareJob(project, selected, final);
      engine.enqueue(prepared, preset.mode === 'merge' ? project.name : t.exports.jobTitle(project.name, prepared.records.length), project.id);
      haptic.medium();
      setPhase('running');
    } catch (e) {
      haptic.error();
      setError((e as Error).message);
      setPhase('form');
    }
  };

  const unsupported = caps && caps.backend !== 'native' && !caps.webcodecs;

  return (
    <>
      <Stack.Screen
        options={{
          title: phase === 'running' ? t.screens.exporting : t.screens.export,
          headerLeft: () => <Button label={phase === 'running' ? t.common.close : t.common.cancel} variant="plain" size="small" onPress={() => router.back()} />,
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
              <InlineNotice title={t.exportSheet.startingEngine} message={t.exportSheet.startingEngineMessage} />
            ) : unsupported ? (
              <InlineNotice
                tone="error"
                title={t.exportSheet.unsupportedTitle}
                message={t.exportSheet.unsupportedMessage}
              />
            ) : null}
            {error ? <InlineNotice tone="error" title={t.exportSheet.startFailed} message={error} /> : null}
            <QuotaNotice />

            <Section title={t.exportSheet.output}>
              <Segmented values={MODES} labels={[t.exportSheet.modeSeparate, t.exportSheet.modeMerge]} value={preset.mode} onChange={(mode) => set({ mode })} />
              {preset.mode === 'merge' ? (
                <Segmented values={TRANSITIONS} labels={[t.exportSheet.transitionCut, t.exportSheet.transitionFade]} value={preset.transition} onChange={(transition) => set({ transition })} />
              ) : null}
              {preset.mode === 'merge' ? <SwitchRow title={t.exportSheet.fadeEnds} value={preset.fadeEnds} onValueChange={(fadeEnds) => set({ fadeEnds })} /> : null}
            </Section>

            <Section title={t.exportSheet.clipsSection(chosen.length, clips.length)} footer={preset.mode === 'merge' ? t.exportSheet.mergeOrder : undefined}>
              {clips.map((c) => (
                <Row
                  key={c.id}
                  title={c.name}
                  subtitle={`${formatDuration(Math.max(0, c.trim.end - c.trim.start))}${c.trim.start > 0 || c.trim.end < c.duration ? t.exportSheet.trimmed : ''}`}
                  checked={selected.includes(c.id)}
                  onPress={() => {
                    haptic.selection();
                    setSelected((s) => (s.includes(c.id) ? s.filter((x) => x !== c.id) : [...s, c.id]));
                  }}
                />
              ))}
            </Section>

            <Section title={t.exportSheet.format}>
              <Segmented
                values={containers.length ? containers : (['mp4'] as ContainerId[])}
                labels={(containers.length ? containers : ['mp4']).map((ct) => ct.toUpperCase())}
                value={container}
                onChange={(ct) => set({ container: ct, codec: CONTAINER_CODECS[ct].find(codecOk) ?? CONTAINER_CODECS[ct][0] })}
              />
              {codecs.length > 1 ? (
                <Segmented values={codecs} labels={codecs.map((cd) => CODEC_LABEL[cd])} value={codec} onChange={(cd) => set({ codec: cd })} />
              ) : (
                <Row title={t.exportSheet.codec} value={CODEC_LABEL[codec]} />
              )}
              <SwitchRow title={t.exportSheet.includeAudio} subtitle={t.exportSheet.includeAudioHint} value={preset.audio} onValueChange={(audio) => set({ audio })} />
            </Section>

            <Section title={t.exportSheet.resolution} footer={isPro ? undefined : t.pro.freeLimit}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, padding: space.l }}>
                {RESOLUTIONS.map((r) => (
                  <Chip key={r.id} label={r.label ?? t.common.original} selected={preset.resolution === r.id} pro={locked && PRO_RESOLUTIONS.includes(r.id)} onPress={() => { if (!PRO_RESOLUTIONS.includes(r.id) || requirePro()) set({ resolution: r.id }); }} />
                ))}
              </View>
            </Section>

            <Section title={t.exportSheet.fps}>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s, padding: space.l }}>
                {FPS.map((f) => (
                  <Chip key={String(f)} label={f === 'source' ? t.common.original : `${f}`} selected={preset.fps === f} onPress={() => set({ fps: f })} />
                ))}
              </View>
            </Section>

            <Section title={t.exportSheet.quality} footer={preset.lutPrecision === 65 ? t.exportSheet.quality65 : t.exportSheet.quality33}>
              <Segmented values={QUALITIES} labels={QUALITIES.map((q) => ({ low: t.exportSheet.qualityLow, medium: t.exportSheet.qualityMedium, high: t.exportSheet.qualityHigh, max: t.exportSheet.qualityMax })[q])} value={preset.quality} onChange={(quality) => set({ quality })} />
              <Segmented values={['65', '33']} labels={[t.exportSheet.colorMax, t.exportSheet.colorFast]} value={String(preset.lutPrecision)} onChange={(v) => set({ lutPrecision: Number(v) as 33 | 65 })} />
            </Section>

            <Section footer={saveToPhotos ? (container === 'webm' ? t.exportSheet.webmNotInPhotos : t.exportSheet.savedToAlbum(albumName || 'Lutra')) : t.exportSheet.keptInExports}>
              <SwitchRow title={t.exportSheet.saveToPhotos} value={saveToPhotos} onValueChange={(v) => useSettings.getState().set('saveToPhotos', v)} />
            </Section>
          </ScrollView>

          <ExportBar
            quota={left !== null && left > QUOTA_WARN_AT ? t.pro.quotaLeft(left, FREE_MONTHLY_EXPORTS) : null}
            summary={`${t.common.files(files)} · ${firstSize ? formatResolution(firstSize.width, firstSize.height) : ''} · ${formatDuration(totalDuration)} · ≈ ${formatBytes(bytes)}`}
            label={preset.mode === 'merge' ? t.exportSheet.exportSingle : t.exportSheet.exportN(files)}
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

function ExportBar({ summary, quota, label, disabled, loading, onPress, bottom }: { summary: string; quota: string | null; label: string; disabled: boolean; loading: boolean; onPress: () => void; bottom: number }) {
  const c = usePalette();
  const t = useT();
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: space.l, paddingTop: space.m, paddingBottom: Math.max(bottom, space.l), gap: space.s, backgroundColor: c.bgGrouped, borderTopWidth: 0.5, borderColor: c.separator }}>
      <Text variant="footnote" tone="secondary" center tabular numberOfLines={1}>
        {loading ? t.exportSheet.preparingColors : summary}
      </Text>
      <Button label={label} size="large" onPress={onPress} disabled={disabled} loading={loading} stretch icon="exports" />
      {quota ? (
        <Text variant="caption1" tone="secondary" center numberOfLines={1}>
          {quota}
        </Text>
      ) : null}
    </View>
  );
}

/** Heads-up shown well before the free limit, so it never comes as a surprise. */
function QuotaNotice() {
  const t = useT();
  const left = useExportsLeft();
  if (left === null || left > QUOTA_WARN_AT) return null;
  const date = formatDayMonth(quotaResetsAt());
  return (
    <InlineNotice
      tone="warning"
      title={left === 0 ? t.pro.quotaOutTitle : t.pro.quotaWarnTitle(left)}
      message={left === 0 ? t.pro.quotaOutMessage(FREE_MONTHLY_EXPORTS, date) : t.pro.quotaWarnMessage(date)}
      action={<Button label={t.pro.seePro} variant="plain" size="small" onPress={presentPaywall} style={{ alignSelf: 'flex-start', paddingHorizontal: 0 }} />}
    />
  );
}

/** Free plan check before a render: explains the limit instead of just walling it off. */
function quotaAllows(files: number) {
  const left = exportsLeft();
  if (left === null || files <= left) return true;
  const t = tr();
  const date = formatDayMonth(quotaResetsAt());
  const [title, message] = left === 0 ? [t.pro.quotaOutTitle, t.pro.quotaOutMessage(FREE_MONTHLY_EXPORTS, date)] : [t.pro.quotaTooManyTitle(left), t.pro.quotaTooManyMessage(files, left)];
  haptic.warning();
  Alert.alert(title, message, [
    { text: t.pro.notNow, style: 'cancel' },
    { text: t.pro.seePro, onPress: presentPaywall },
  ]);
  return false;
}
