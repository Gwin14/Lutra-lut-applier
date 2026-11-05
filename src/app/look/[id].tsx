import { useImage } from '@shopify/react-native-skia';
import { router, useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { Alert, ScrollView, useWindowDimensions, View } from 'react-native';

import { DEFAULT_GRADE } from '../../color/grade';
import { LOOK_CATEGORIES, compileBuiltInLook, getBuiltInLook, lookSwatches } from '../../color/looks';
import type { ProfileId } from '../../color/profiles';
import { startNewBatch } from '../../features/importClips';
import { exportGradeCube } from '../../features/editor/extras';
import { LookSwatches } from '../../features/LookSwatches';
import { haptic } from '../../lib/haptics';
import { deleteUserLut } from '../../lib/userLuts';
import { GradedStill } from '../../preview/GradedStill';
import { useGradeLut } from '../../preview/lutImage';
import { referenceChart } from '../../preview/referenceChart';
import { useLibrary } from '../../store/library';
import { useProjects } from '../../store/projects';
import { radius, space } from '../../theme/tokens';
import { usePalette } from '../../theme/useTheme';
import { confirmDestructive, showActions } from '../../ui/actions';
import { Button } from '../../ui/Button';
import { SliderRow } from '../../ui/SliderRow';
import { Text } from '../../ui/Text';

export default function LookSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const c = usePalette();
  const { width } = useWindowDimensions();
  const builtIn = getBuiltInLook(id);
  const user = useLibrary((s) => s.userLuts.find((l) => l.id === id));
  const favorite = useLibrary((s) => s.favorites.includes(id));
  const projects = useProjects((s) => s.projects);
  const latest = projects[0]?.clips[0];
  const clipImage = useImage(latest?.thumb ?? undefined);
  const [strength, setStrength] = useState(100);
  const image = clipImage ?? referenceChart();
  const input: ProfileId = clipImage && latest ? latest.input : 'rec709';
  const grade = useMemo(() => ({ ...DEFAULT_GRADE, lookId: id, lookStrength: strength }), [id, strength]);
  const lut = useGradeLut(input, grade, 33);
  const swatches = useMemo(() => (builtIn ? lookSwatches(compileBuiltInLook(builtIn.id)) : (user?.swatches ?? [])), [builtIn, user]);

  if (!builtIn && !user) return null;
  const name = builtIn?.name ?? user!.name;
  const category = builtIn ? LOOK_CATEGORIES.find((x) => x.id === builtIn.category)?.label : 'Meu LUT';
  const pw = Math.min(width, 700) - space.l * 2;
  const ph = Math.round((pw * 9) / 16);

  const applyTo = () => {
    if (!projects.length) return;
    showActions(
      'Aplicar em qual lote?',
      projects.slice(0, 8).map((p) => ({
        label: p.name,
        onPress: () => {
          const first = p.clips[0];
          if (first) useProjects.getState().editGrade(p.id, first.id, { lookId: id, lookStrength: strength });
          useLibrary.getState().pushRecent(id);
          haptic.success();
          router.dismissAll();
          router.push({ pathname: '/project/[id]', params: { id: p.id } });
        },
      })),
    );
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.l, gap: space.l, paddingBottom: space.xxxl }}>
      <View style={{ gap: space.xs }}>
        <Text variant="caption1" tone="accent" weight="600" style={{ textTransform: 'uppercase' }}>
          {category}
        </Text>
        <Text variant="title2">{name}</Text>
        {builtIn ? (
          <Text variant="subhead" tone="secondary">
            {builtIn.description}
          </Text>
        ) : (
          <Text variant="subhead" tone="secondary">{`LUT .cube ${user!.sourceSize}${user!.kind === '3d' ? '³' : ' (1D)'}`}</Text>
        )}
      </View>
      <View style={{ width: pw, height: ph, borderRadius: radius.card, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill, alignSelf: 'center' }}>
        <GradedStill image={image} lut={lut} width={pw} height={ph} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text variant="footnote" tone="secondary">
          {clipImage ? 'No seu clipe mais recente' : 'Na carta de referência'}
        </Text>
        <LookSwatches colors={swatches} size={14} />
      </View>
      <View style={{ marginHorizontal: -space.l }}>
        <SliderRow label="Intensidade" value={strength} min={0} max={100} neutral={100} format={(v) => `${Math.round(v)}%`} onChange={(v) => setStrength(Math.round(v))} />
      </View>
      <View style={{ gap: space.m }}>
        <Button label="Aplicar em novo lote" icon="add" size="large" stretch onPress={() => { router.back(); startNewBatch({ lookId: id }); }} />
        {projects.length ? <Button label="Aplicar em um lote existente" variant="secondary" stretch onPress={applyTo} /> : null}
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button
            label={favorite ? 'Favorito' : 'Favoritar'}
            icon={favorite ? 'favoriteOn' : 'favorite'}
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => {
              useLibrary.getState().toggleFavorite(id);
              haptic.light();
            }}
          />
          <Button
            label="Exportar .cube"
            icon="cube"
            variant="secondary"
            style={{ flex: 1 }}
            onPress={() => exportGradeCube('rec709', grade, 33, name).catch((e) => Alert.alert('Erro', String(e?.message ?? e)))}
          />
        </View>
        {user ? (
          <Button
            label="Excluir LUT"
            variant="destructive"
            stretch
            onPress={() =>
              confirmDestructive('Excluir este LUT?', 'Lotes que usam este LUT ficam sem look.', 'Excluir', () => {
                deleteUserLut(user);
                router.back();
              })
            }
          />
        ) : null}
      </View>
    </ScrollView>
  );
}
