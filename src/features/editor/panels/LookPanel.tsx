import { useImage, type SkImage } from '@shopify/react-native-skia';
import { FlashList } from '@shopify/flash-list';
import { memo, useMemo, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import type { Grade } from '../../../color/grade';
import { BUILT_IN_LOOKS, LOOK_CATEGORIES, type LookCategory } from '../../../color/looks';
import type { ProfileId } from '../../../color/profiles';
import { haptic } from '../../../lib/haptics';
import { importCubeFiles } from '../../../lib/userLuts';
import { GradedStill } from '../../../preview/GradedStill';
import { useThumbLut } from '../../../preview/lutImage';
import { useLibrary } from '../../../store/library';
import { useProjects, type Clip, type Project } from '../../../store/projects';
import { grade as g, radius, space } from '../../../theme/tokens';
import { showActions } from '../../../ui/actions';
import { Button } from '../../../ui/Button';
import { PressableScale } from '../../../ui/Pressable';
import { SliderRow } from '../../../ui/SliderRow';
import { Chip } from '../../../ui/States';
import { Text } from '../../../ui/Text';

const TW = 112;
const TH = 63;

type Filter = 'all' | 'fav' | 'mine' | LookCategory;

const LookTile = memo(function LookTile({ id, name, image, input, base, selected, onPress }: { id: string | null; name: string; image: SkImage | null; input: ProfileId; base: Grade; selected: boolean; onPress: () => void }) {
  const grade = useMemo(() => ({ ...base, lookId: id, lookStrength: 100 }), [base, id]);
  const lut = useThumbLut(input, grade);
  return (
    <PressableScale onPress={onPress} accessibilityRole="button" accessibilityState={{ selected }} accessibilityLabel={name} style={{ width: TW, gap: 6 }}>
      <View style={{ width: TW, height: TH, borderRadius: radius.media, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: g.fill, borderWidth: 2, borderColor: selected ? g.accent : 'transparent' }}>
        <GradedStill image={image} lut={lut} width={TW - 4} height={TH - 4} />
      </View>
      <Text variant="caption1" weight={selected ? '600' : '400'} color={selected ? g.accentText : g.labelSecondary} numberOfLines={1}>
        {name}
      </Text>
    </PressableScale>
  );
});

export function LookPanel({ project, clip, grade }: { project: Project; clip: Clip; grade: Grade }) {
  const image = useImage(clip.thumb ?? undefined);
  const [filter, setFilter] = useState<Filter>('all');
  const favorites = useLibrary((s) => s.favorites);
  const userLuts = useLibrary((s) => s.userLuts);
  const recipes = useLibrary((s) => s.recipes);
  const store = useProjects.getState();
  // Thumbnails show each look on top of the current balance, at full strength.
  const base = useMemo(() => ({ ...grade, lookStrength: 100 }), [grade]);

  const items = useMemo(() => {
    const builtIn = BUILT_IN_LOOKS.map((l) => ({ id: l.id, name: l.name, category: l.category as string }));
    const mine = userLuts.map((l) => ({ id: l.id, name: l.name, category: 'mine' }));
    const all = [...mine, ...builtIn];
    if (filter === 'all') return all;
    if (filter === 'fav') return all.filter((l) => favorites.includes(l.id));
    if (filter === 'mine') return mine;
    return builtIn.filter((l) => l.category === filter);
  }, [filter, favorites, userLuts]);

  const select = (lookId: string | null) => {
    store.checkpoint(project.id, clip.id);
    store.editGrade(project.id, clip.id, { lookId, lookStrength: grade.lookId ? grade.lookStrength : 100 });
    if (lookId) useLibrary.getState().pushRecent(lookId);
    haptic.selection();
  };

  const importLuts = async () => {
    const res = await importCubeFiles();
    if (res.imported.length) {
      haptic.success();
      setFilter('mine');
      select(res.imported[0].id);
    }
    if (res.errors.length) Alert.alert('Alguns arquivos não foram importados', res.errors.join('\n'));
  };

  const saveRecipe = () => {
    const suggested = `Receita ${recipes.length + 1}`;
    const save = (name?: string) => {
      useLibrary.getState().addRecipe(name?.trim() || suggested, grade, clip.input);
      haptic.success();
    };
    if (process.env.EXPO_OS === 'ios') Alert.prompt('Salvar receita', 'Guarda look, intensidade, ajustes e efeitos para reaplicar em outros lotes.', save, 'plain-text', suggested);
    else save();
  };

  return (
    <View style={{ gap: space.l }}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.l, gap: space.s }}>
        <Chip label="Todos" selected={filter === 'all'} onPress={() => setFilter('all')} />
        {favorites.length ? <Chip label="Favoritos" icon="favoriteOn" selected={filter === 'fav'} onPress={() => setFilter('fav')} /> : null}
        {userLuts.length ? <Chip label="Meus LUTs" selected={filter === 'mine'} onPress={() => setFilter('mine')} /> : null}
        {LOOK_CATEGORIES.map((c) => (
          <Chip key={c.id} label={c.label} selected={filter === c.id} onPress={() => setFilter(c.id)} />
        ))}
      </ScrollView>

      <View style={{ height: TH + 26 }}>
        <FlashList
          horizontal
          data={[{ id: null as string | null, name: 'Sem look' }, ...items]}
          keyExtractor={(l) => l.id ?? 'none'}
          extraData={`${grade.lookId}|${clip.input}`}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ paddingHorizontal: space.l }}
          ItemSeparatorComponent={() => <View style={{ width: space.m }} />}
          renderItem={({ item }) => (
            <LookTile id={item.id} name={item.name} image={image} input={clip.input} base={base} selected={grade.lookId === item.id} onPress={() => select(item.id)} />
          )}
        />
      </View>

      {grade.lookId ? (
        <SliderRow
          label="Intensidade do look"
          value={grade.lookStrength}
          min={0}
          max={100}
          neutral={100}
          format={(v) => `${Math.round(v)}%`}
          onBegin={() => store.checkpoint(project.id, clip.id)}
          onChange={(v) => store.editGrade(project.id, clip.id, { lookStrength: Math.round(v) })}
        />
      ) : null}

      <View style={{ paddingHorizontal: space.l, gap: space.m }}>
        <View style={{ flexDirection: 'row', gap: space.s }}>
          <Button label="Importar .cube" icon="import" variant="secondary" size="small" onPress={importLuts} />
          <Button label="Salvar receita" icon="recipe" variant="secondary" size="small" onPress={saveRecipe} />
          {grade.lookId ? (
            <Button
              label={favorites.includes(grade.lookId) ? 'Favorito' : 'Favoritar'}
              icon={favorites.includes(grade.lookId) ? 'favoriteOn' : 'favorite'}
              variant="secondary"
              size="small"
              onPress={() => {
                useLibrary.getState().toggleFavorite(grade.lookId!);
                haptic.light();
              }}
            />
          ) : null}
        </View>
        {recipes.length ? (
          <View style={{ gap: space.s }}>
            <Text variant="footnote" color={g.labelSecondary} style={{ textTransform: 'uppercase' }}>
              Receitas
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: space.s }}>
              {recipes.map((r) => (
                <PressableScale
                  key={r.id}
                  onPress={() => {
                    store.checkpoint(project.id, clip.id);
                    store.editGrade(project.id, clip.id, r.grade);
                    haptic.selection();
                  }}
                  onLongPress={() =>
                    showActions(r.name, [{ label: 'Excluir receita', destructive: true, onPress: () => useLibrary.getState().removeRecipe(r.id) }])
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Aplicar receita ${r.name}`}
                  style={{ height: 34, paddingHorizontal: space.m, borderRadius: radius.pill, backgroundColor: g.fill, justifyContent: 'center' }}
                >
                  <Text variant="subhead" weight="600" color={g.label}>
                    {r.name}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>
          </View>
        ) : null}
      </View>
    </View>
  );
}
