import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, ScrollView, useWindowDimensions, View } from 'react-native';
import { useAnimatedReaction, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { scheduleOnRN } from 'react-native-worklets';

import { isNeutralGrade } from '../../color/grade';
import { getProfile } from '../../color/profiles';
import type { ScopeMode } from '../../color/scopes';
import { aspectValue } from '../../engine/geometry';
import { addClipsTo, useImportState } from '../../features/importClips';
import { ClipStrip } from '../../features/editor/ClipStrip';
import { exportGradeCube, exportStill } from '../../features/editor/extras';
import { AdjustPanel, EffectsPanel, FramePanel } from '../../features/editor/panels/AdjustPanels';
import { InputPanel } from '../../features/editor/panels/InputPanel';
import { LookPanel } from '../../features/editor/panels/LookPanel';
import { Timeline } from '../../features/editor/Timeline';
import { ToolBar, type Tool } from '../../features/editor/ToolBar';
import { Viewer } from '../../features/editor/Viewer';
import { useT } from '../../i18n';
import { fileExists } from '../../lib/files';
import { haptic } from '../../lib/haptics';
import { useLibrary } from '../../store/library';
import { effectiveGrade, useHistoryState, useProjects, type Clip } from '../../store/projects';
import { previewLutSize, useSettings } from '../../store/settings';
import { useGradeLut } from '../../preview/lutImage';
import type { VideoInfo } from '../../preview/GradedVideo';
import { grade as g, radius, space } from '../../theme/tokens';
import { PaletteScope } from '../../theme/useTheme';
import { confirmDestructive, showActions } from '../../ui/actions';
import { Button, IconButton } from '../../ui/Button';
import { PressableScale } from '../../ui/Pressable';
import { EmptyState, InlineNotice } from '../../ui/States';
import { Text } from '../../ui/Text';

const SCOPE_CYCLE: (ScopeMode | null)[] = [null, 'histogram', 'waveform', 'parade'];

export default function EditorScreen() {
  const t = useT();
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  const [clipId, setClipId] = useState<string | undefined>(project?.clips[0]?.id);
  const clip = project?.clips.find((c) => c.id === clipId) ?? project?.clips[0];

  useEffect(() => {
    if (project && !project.clips.some((c) => c.id === clipId)) setClipId(project.clips[0]?.id);
  }, [project, clipId]);

  if (!project) {
    return (
      <PaletteScope palette={g} scheme="dark">
        <Stack.Screen options={{ title: '' }} />
        <EmptyState icon="library" title={t.editor.notFoundTitle} message={t.editor.notFoundMessage} action={<Button label={t.common.back} onPress={() => router.back()} />} />
      </PaletteScope>
    );
  }
  if (!clip) {
    return (
      <PaletteScope palette={g} scheme="dark">
        <Stack.Screen options={{ title: project.name }} />
        <EmptyState
          icon="add"
          title={t.editor.emptyTitle}
          message={t.editor.emptyMessage}
          action={<Button label={t.editor.addClips} icon="add" onPress={() => addClipsTo(project.id)} />}
        />
      </PaletteScope>
    );
  }
  return <Editor projectId={project.id} clip={clip} onSelectClip={setClipId} />;
}

function Editor({ projectId, clip, onSelectClip }: { projectId: string; clip: Clip; onSelectClip: (id: string) => void }) {
  const t = useT();
  const project = useProjects((s) => s.projects.find((p) => p.id === projectId))!;
  const grade = effectiveGrade(project, clip);
  const quality = useSettings((s) => s.previewQuality);
  const baked = useGradeLut(clip.input, grade, previewLutSize(quality));
  const { canUndo, canRedo } = useHistoryState(projectId, clip.id);
  const adding = useImportState((s) => s.busy);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const wide = width >= 900 && width > height;

  const paused = useSharedValue(false);
  const seek = useSharedValue<number | null>(null);
  const volume = useSharedValue(0);
  const time = useSharedValue(0);
  const split = useSharedValue(-1);
  const [isPaused, setIsPaused] = useState(false);
  const [muted, setMuted] = useState(true);
  const [tool, setTool] = useState<Tool>(getProfile(clip.input).kind === 'display' && clip.detection?.isLog ? 'input' : 'look');
  const [compare, setCompare] = useState(false);
  const [falseColor, setFalseColor] = useState(false);
  const [zebra, setZebra] = useState(false);
  const [scopes, setScopes] = useState<ScopeMode | null>(null);
  const [scopesTick, setScopesTick] = useState(0);
  const [info, setInfo] = useState<VideoInfo | null>(null);
  const missing = useMemo(() => !fileExists(clip.uri), [clip.uri]);

  const displayW = info?.width || clip.width || 16;
  const displayH = info?.height || clip.height || 9;
  const aspect = aspectValue(project.aspect, displayW, displayH);

  // Reset playback when switching clips.
  useEffect(() => {
    setInfo(null);
    seek.value = clip.trim.start * 1000;
    time.value = clip.trim.start;
  }, [clip.id, clip.trim.start, seek, time]);

  useAnimatedReaction(
    () => paused.value,
    (v, prev) => {
      if (v !== prev) scheduleOnRN(setIsPaused, v);
    },
  );

  // Refresh scopes when the grade settles or playback pauses.
  useEffect(() => {
    if (!scopes) return;
    const t = setTimeout(() => setScopesTick((n) => n + 1), 300);
    return () => clearTimeout(t);
  }, [scopes, baked, isPaused]);
  useEffect(() => {
    if (!scopes || isPaused) return;
    const iv = setInterval(() => setScopesTick((n) => n + 1), 2000);
    return () => clearInterval(iv);
  }, [scopes, isPaused]);

  const togglePlay = useCallback(() => {
    paused.value = !paused.value;
    haptic.light();
  }, [paused]);

  const store = useProjects.getState();

  const clipActions = (c: Clip) => {
    const i = project.clips.findIndex((x) => x.id === c.id);
    showActions(c.name, [
      { label: t.editor.cameraProfile, onPress: () => router.push({ pathname: '/profile/[id]', params: { id: project.id, clip: c.id } }) },
      ...(i > 0 ? [{ label: t.editor.moveLeft, onPress: () => store.moveClip(project.id, c.id, -1) }] : []),
      ...(i < project.clips.length - 1 ? [{ label: t.editor.moveRight, onPress: () => store.moveClip(project.id, c.id, 1) }] : []),
      {
        label: t.editor.removeFromBatch,
        destructive: true,
        onPress: () => confirmDestructive(t.editor.removeClipTitle, t.editor.removeClipMessage, t.common.remove, () => store.removeClip(project.id, c.id)),
      },
    ]);
  };

  const moreActions = () =>
    showActions(t.editor.batch, [
      {
        label: t.editor.exportFrame,
        onPress: async () => {
          try {
            const r = await exportStill(clip, grade, project.aspect, time.value, 'png');
            haptic.success();
            Alert.alert(t.editor.frameExported, r.saved ? t.editor.frameSaved(r.width, r.height) : t.editor.frameSavedInApp(r.width, r.height));
          } catch (e) {
            haptic.error();
            Alert.alert(t.editor.frameFailed, (e as Error).message);
          }
        },
      },
      { label: t.editor.exportCube(33), onPress: () => exportGradeCube(clip.input, grade, 33, project.name).catch((e) => Alert.alert(t.common.error, String(e?.message ?? e))) },
      { label: t.editor.exportCube(65), onPress: () => exportGradeCube(clip.input, grade, 65, project.name).catch((e) => Alert.alert(t.common.error, String(e?.message ?? e))) },
      {
        label: t.editor.saveRecipe,
        onPress: () => {
          useLibrary.getState().addRecipe(`${project.name}`, grade, clip.input);
          haptic.success();
        },
      },
      { label: t.editor.renameBatch, onPress: () => router.push({ pathname: '/rename/[id]', params: { id: project.id } }) },
    ]);

  const dots = {
    input: getProfile(clip.input).kind !== 'display',
    look: !!grade.lookId,
    adjust: !isNeutralGrade('rec709', { ...grade, lookId: null }),
    effects: grade.effects.vignette !== 0 || grade.effects.grain !== 0 || grade.effects.sharpen !== 0,
    frame: project.aspect !== 'original',
  };

  const controls = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space.l, paddingVertical: space.s }}>
      <View style={{ flexDirection: 'row', gap: space.s }}>
        <IconButton icon={isPaused ? 'play' : 'pause'} label={isPaused ? t.editor.play : t.editor.pause} onPress={togglePlay} />
        <IconButton
          icon={muted ? 'speakerOff' : 'speaker'}
          label={muted ? t.editor.unmute : t.editor.mute}
          tone="clear"
          color={g.label}
          onPress={() => {
            const m = !muted;
            setMuted(m);
            volume.value = m ? 0 : 1;
          }}
        />
      </View>
      <View style={{ flexDirection: 'row', gap: space.xs }}>
        <IconButton
          icon="compare"
          label={t.editor.compare}
          tone="clear"
          active={compare}
          onPress={() => {
            const v = !compare;
            setCompare(v);
            split.value = v ? 0.5 : -1;
            haptic.selection();
          }}
        />
        <IconButton
          icon="scopes"
          label={scopes ? t.editor.scopesOn({ histogram: t.editor.histogram, waveform: t.editor.waveform, parade: t.editor.parade }[scopes]) : t.editor.showScopes}
          tone="clear"
          active={!!scopes}
          onPress={() => {
            setScopes((s) => SCOPE_CYCLE[(SCOPE_CYCLE.indexOf(s) + 1) % SCOPE_CYCLE.length]);
            haptic.selection();
          }}
        />
        <IconButton icon="falseColor" label={t.editor.falseColor} tone="clear" active={falseColor} onPress={() => setFalseColor((v) => !v)} />
        <IconButton icon="zebra" label={t.editor.zebra} tone="clear" active={zebra} onPress={() => setZebra((v) => !v)} />
      </View>
    </View>
  );

  const panel = (
    <ScrollView key={tool} contentContainerStyle={{ paddingTop: space.l, paddingBottom: insets.bottom + space.xxxl }} keyboardShouldPersistTaps="handled">
      {tool === 'input' ? <InputPanel project={project} clip={clip} /> : null}
      {tool === 'look' ? <LookPanel project={project} clip={clip} grade={grade} /> : null}
      {tool === 'adjust' ? <AdjustPanel project={project} clip={clip} grade={grade} /> : null}
      {tool === 'effects' ? <EffectsPanel project={project} clip={clip} grade={grade} /> : null}
      {tool === 'frame' ? <FramePanel project={project} /> : null}
    </ScrollView>
  );

  const viewer = missing ? (
    <View style={{ flex: 1, justifyContent: 'center', padding: space.l, backgroundColor: g.viewer }}>
      <InlineNotice tone="error" title={t.editor.missingTitle} message={t.editor.missingMessage} />
    </View>
  ) : (
    <Viewer
      key={clip.id}
      uri={clip.uri}
      aspect={aspect}
      lut={baked}
      effects={grade.effects}
      paused={paused}
      seek={seek}
      volume={volume}
      time={time}
      split={split}
      compare={compare}
      falseColor={falseColor}
      zebra={zebra}
      scopes={scopes}
      scopesTick={scopesTick}
      trimStart={clip.trim.start}
      trimEnd={clip.trim.end}
      isPaused={isPaused}
      onTogglePlay={togglePlay}
      onInfo={setInfo}
      badge={falseColor ? t.editor.falseColorBadge : null}
    />
  );

  const timeline = (
    <Timeline
      duration={info?.duration || clip.duration}
      start={clip.trim.start}
      end={clip.trim.end}
      time={time}
      seek={seek}
      paused={paused}
      onScrubStart={() => setIsPaused(true)}
      onTrim={(s, e) => store.updateClip(project.id, clip.id, { trim: { start: s, end: e } })}
    />
  );

  const strip = (
    <ClipStrip clips={project.clips} selectedId={clip.id} onSelect={onSelectClip} onLongPress={clipActions} onAdd={() => addClipsTo(project.id)} adding={adding} />
  );

  return (
    <PaletteScope palette={g} scheme="dark">
      <Stack.Screen
        options={{
          title: project.name,
          headerTitleStyle: { color: g.label },
          headerRight: () => (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.xs }}>
              <IconButton icon="undo" label={t.editor.undo} tone="clear" color={g.label} disabled={!canUndo} onPress={() => store.undo(project.id, clip.id)} size={38} />
              <IconButton icon="redo" label={t.editor.redo} tone="clear" color={g.label} disabled={!canRedo} onPress={() => store.redo(project.id, clip.id)} size={38} />
              <IconButton icon="more" label={t.editor.moreOptions} tone="clear" color={g.label} onPress={moreActions} size={38} />
              <PressableScale
                onPress={() => router.push({ pathname: '/export/[id]', params: { id: project.id } })}
                accessibilityRole="button"
                accessibilityLabel={t.editor.export}
                style={{ height: 34, paddingHorizontal: space.m + 2, borderRadius: radius.pill, backgroundColor: g.accent, justifyContent: 'center', marginLeft: space.xs }}
              >
                <Text variant="subhead" weight="600" color={g.onAccent}>
                  {t.editor.export}
                </Text>
              </PressableScale>
            </View>
          ),
        }}
      />
      {wide ? (
        <View style={{ flex: 1, flexDirection: 'row', backgroundColor: g.bg }}>
          <View style={{ flex: 1, paddingBottom: insets.bottom + space.s, gap: space.s }}>
            {viewer}
            {controls}
            {timeline}
            {strip}
          </View>
          <View style={{ width: 400, borderLeftWidth: 0.5, borderColor: g.separator, backgroundColor: g.surface }}>
            <ToolBar value={tool} onChange={setTool} dots={dots} />
            {panel}
          </View>
        </View>
      ) : (
        <View style={{ flex: 1, backgroundColor: g.bg }}>
          <View style={{ height: Math.min(height * 0.4, width * 1.1) }}>{viewer}</View>
          {controls}
          {timeline}
          <View style={{ paddingVertical: space.s }}>{strip}</View>
          <ToolBar value={tool} onChange={setTool} dots={dots} />
          <View style={{ flex: 1, backgroundColor: g.surface }}>{panel}</View>
        </View>
      )}
    </PaletteScope>
  );
}
