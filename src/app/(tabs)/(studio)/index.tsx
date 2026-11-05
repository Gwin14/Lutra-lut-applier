import { FlashList } from '@shopify/flash-list';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useRef } from 'react';
import { useWindowDimensions, View } from 'react-native';

import { compileBuiltInLook, lookSwatches } from '../../../color/looks';
import { lookName } from '../../../engine/jobs';
import { startNewBatch, useImportState } from '../../../features/importClips';
import { LookSwatches } from '../../../features/LookSwatches';
import { useT } from '../../../i18n';
import { lookText, profileText } from '../../../i18n/content';
import { formatDuration, formatRelative } from '../../../lib/format';
import { GradedThumb } from '../../../preview/GradedThumb';
import { effectiveGrade, useProjects, type Project } from '../../../store/projects';
import { radius, space } from '../../../theme/tokens';
import { usePalette } from '../../../theme/useTheme';
import { confirmDestructive, showActions } from '../../../ui/actions';
import { Button } from '../../../ui/Button';
import { Icon } from '../../../ui/Icon';
import { PressableScale } from '../../../ui/Pressable';
import { EmptyState, InlineNotice, ProgressBar } from '../../../ui/States';
import { Text } from '../../../ui/Text';
import { lookOfTheDay } from '../../../widgets';

function NewBatchCard() {
  const c = usePalette();
  const t = useT();
  const busy = useImportState((s) => s.busy);
  const done = useImportState((s) => s.done);
  const total = useImportState((s) => s.total);
  return (
    <View style={{ backgroundColor: c.surface, borderRadius: radius.card, borderCurve: 'continuous', padding: space.xl, gap: space.l }}>
      <View style={{ gap: space.xs }}>
        <Text variant="title3">{t.studio.newBatchTitle}</Text>
        <Text variant="subhead" tone="secondary">
          {t.studio.newBatchBody}
        </Text>
      </View>
      {busy ? (
        <View style={{ gap: space.s }}>
          <Text variant="footnote" tone="secondary" tabular>{t.studio.analyzing(Math.min(done + 1, total), total)}</Text>
          <ProgressBar value={total ? done / total : 0} />
        </View>
      ) : (
        <Button label={t.studio.chooseVideos} icon="add" size="large" onPress={() => startNewBatch()} stretch />
      )}
    </View>
  );
}

function LookOfDayCard() {
  const c = usePalette();
  const t = useT();
  const look = lookOfTheDay();
  const text = lookText(look, t);
  // One card, five samples: cheap enough to compute per render.
  const sw = lookSwatches(compileBuiltInLook(look.id));
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/look/[id]', params: { id: look.id } })}
      accessibilityRole="button"
      accessibilityLabel={t.studio.lookOfDayA11y(text.name)}
      style={{ backgroundColor: c.surface, borderRadius: radius.card, borderCurve: 'continuous', padding: space.l, flexDirection: 'row', alignItems: 'center', gap: space.m }}
    >
      <View style={{ flex: 1, gap: 4 }}>
        <Text variant="caption1" tone="accent" weight="600" style={{ textTransform: 'uppercase' }}>
          {t.studio.lookOfDay}
        </Text>
        <Text variant="headline">{text.name}</Text>
        <Text variant="footnote" tone="secondary" numberOfLines={1}>
          {text.description}
        </Text>
      </View>
      <LookSwatches colors={sw} size={14} />
      <Icon name="chevron" size={14} color={c.labelTertiary} weight="semibold" />
    </PressableScale>
  );
}

function ProjectCard({ project }: { project: Project }) {
  const c = usePalette();
  const t = useT();
  const thumbs = project.clips.slice(0, 3).map((cl) => cl.thumb);
  const duration = project.clips.reduce((n, cl) => n + Math.max(0, cl.trim.end - cl.trim.start), 0);
  const profiles = [...new Set(project.clips.map((cl) => profileText(cl.input, t).name))];
  const look = lookName(project.grade.lookId);
  const open = () => router.push({ pathname: '/project/[id]', params: { id: project.id } });
  const actions = () =>
    showActions(project.name, [
      { label: t.studio.rename, onPress: () => router.push({ pathname: '/rename/[id]', params: { id: project.id } }) },
      { label: t.studio.duplicate, onPress: () => useProjects.getState().duplicate(project.id) },
      {
        label: t.studio.deleteBatch,
        destructive: true,
        onPress: () =>
          confirmDestructive(t.studio.deleteBatchTitle, t.studio.deleteBatchMessage, t.common.delete, () => useProjects.getState().remove(project.id)),
      },
    ]);
  return (
    <PressableScale
      onPress={open}
      onLongPress={actions}
      accessibilityRole="button"
      accessibilityLabel={`${project.name}, ${t.common.clips(project.clips.length)}`}
      accessibilityHint={t.studio.longPressHint}
      style={{ backgroundColor: c.surface, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden' }}
    >
      <View style={{ flexDirection: 'row', height: 120, gap: 2 }}>
        {thumbs.length ? (
          project.clips.slice(0, 3).map((cl, i) => (
            <GradedThumb key={cl.id} uri={cl.thumb} input={cl.input} grade={effectiveGrade(project, cl)} style={{ flex: i === 0 ? 2 : 1, backgroundColor: c.fill }} />
          ))
        ) : (
          <View style={{ flex: 1, backgroundColor: c.fill }} />
        )}
      </View>
      <View style={{ padding: space.l, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.s }}>
          <Text variant="headline" style={{ flex: 1 }} numberOfLines={1}>
            {project.name}
          </Text>
          <Text variant="footnote" tone="tertiary">
            {formatRelative(project.updatedAt)}
          </Text>
        </View>
        <Text variant="footnote" tone="secondary" numberOfLines={1} tabular>
          {[t.common.clips(project.clips.length), formatDuration(duration), profiles.slice(0, 2).join(', '), look].filter(Boolean).join(' · ')}
        </Text>
      </View>
    </PressableScale>
  );
}

export default function StudioScreen() {
  const t = useT();
  const projects = useProjects((s) => s.projects);
  const error = useImportState((s) => s.error);
  const { width } = useWindowDimensions();
  const columns = width >= 1100 ? 3 : width >= 700 ? 2 : 1;
  const params = useLocalSearchParams<{ action?: string; look?: string }>();
  const handled = useRef<string | null>(null);

  // Widget deep link: lutra:///?action=new&look=<id>
  useEffect(() => {
    const token = `${params.action}:${params.look}`;
    if (params.action === 'new' && handled.current !== token) {
      handled.current = token;
      startNewBatch({ lookId: params.look });
    }
  }, [params.action, params.look]);

  const header = (
    <View style={{ gap: space.l, paddingBottom: space.l }}>
      <NewBatchCard />
      {error ? <InlineNotice tone="error" title={t.studio.importFailed} message={error} /> : null}
      <LookOfDayCard />
      {projects.length ? (
        <Text variant="title3" style={{ marginTop: space.s }}>
          {t.studio.recent}
        </Text>
      ) : null}
    </View>
  );

  return (
    <FlashList
      data={projects}
      key={columns}
      numColumns={columns}
      keyExtractor={(p) => p.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={{ padding: space.l, paddingBottom: space.xxxl * 2 }}
      ListHeaderComponent={header}
      ItemSeparatorComponent={() => <View style={{ height: space.l }} />}
      renderItem={({ item, index }) => (
        <View style={{ flex: 1, paddingLeft: columns > 1 && index % columns ? space.l / 2 : 0, paddingRight: columns > 1 && index % columns < columns - 1 ? space.l / 2 : 0 }}>
          <ProjectCard project={item} />
        </View>
      )}
      ListEmptyComponent={
        <EmptyState
          icon="library"
          title={t.studio.emptyTitle}
          message={t.studio.emptyMessage}
        />
      }
    />
  );
}
