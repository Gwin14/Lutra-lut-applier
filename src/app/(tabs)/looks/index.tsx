import { FlashList } from '@shopify/flash-list';
import { useImage } from '@shopify/react-native-skia';
import { router, Stack } from 'expo-router';
import { memo, useMemo, useState } from 'react';
import { Alert, useWindowDimensions, View } from 'react-native';

import { DEFAULT_GRADE } from '../../../color/grade';
import { BUILT_IN_LOOKS, LOOK_CATEGORIES } from '../../../color/looks';
import type { ProfileId } from '../../../color/profiles';
import { haptic } from '../../../lib/haptics';
import { importCubeFiles } from '../../../lib/userLuts';
import { GradedStill } from '../../../preview/GradedStill';
import { useThumbLut } from '../../../preview/lutImage';
import { referenceChart } from '../../../preview/referenceChart';
import { useLibrary } from '../../../store/library';
import { useProjects } from '../../../store/projects';
import { radius, space } from '../../../theme/tokens';
import { usePalette } from '../../../theme/useTheme';
import { Button, IconButton } from '../../../ui/Button';
import { PressableScale } from '../../../ui/Pressable';
import { EmptyState } from '../../../ui/States';
import { Text } from '../../../ui/Text';

type Item = { type: 'header'; title: string; action?: 'import' } | { type: 'look'; id: string; name: string; subtitle: string } | { type: 'empty' };

const LookCard = memo(function LookCard({ id, name, subtitle, width, input, image, favorite }: { id: string; name: string; subtitle: string; width: number; input: ProfileId; image: ReturnType<typeof useImage>; favorite: boolean }) {
  const c = usePalette();
  const grade = useMemo(() => ({ ...DEFAULT_GRADE, lookId: id }), [id]);
  const lut = useThumbLut(input, grade);
  const h = Math.round((width * 9) / 16);
  return (
    <PressableScale
      onPress={() => router.push({ pathname: '/look/[id]', params: { id } })}
      accessibilityRole="button"
      accessibilityLabel={`${name}${favorite ? ', favorito' : ''}`}
      style={{ width, gap: space.s }}
    >
      <View style={{ width, height: h, borderRadius: radius.media, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: c.fill }}>
        <GradedStill image={image} lut={lut} width={width} height={h} />
      </View>
      <View style={{ gap: 1 }}>
        <Text variant="subhead" weight="600" numberOfLines={1}>
          {name}
        </Text>
        <Text variant="caption1" tone="secondary" numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
    </PressableScale>
  );
});

export default function LooksScreen() {
  const { width } = useWindowDimensions();
  const cols = width >= 1000 ? 4 : width >= 680 ? 3 : 2;
  const cardW = Math.floor((width - space.l * 2 - space.l * (cols - 1)) / cols);
  const userLuts = useLibrary((s) => s.userLuts);
  const favorites = useLibrary((s) => s.favorites);
  const latest = useProjects((s) => s.projects[0]?.clips[0]);
  const [source, setSource] = useState<'clip' | 'chart'>('clip');
  const clipImage = useImage(latest?.thumb ?? undefined);
  const useClip = source === 'clip' && !!latest?.thumb && !!clipImage;
  const image = useClip ? clipImage : referenceChart();
  const input: ProfileId = useClip ? latest!.input : 'rec709';

  const items = useMemo<Item[]>(() => {
    const out: Item[] = [{ type: 'header', title: 'Meus LUTs', action: 'import' }];
    if (userLuts.length) for (const l of userLuts) out.push({ type: 'look', id: l.id, name: l.name, subtitle: `.cube · ${l.sourceSize}${l.kind === '3d' ? '³' : ' (1D)'}` });
    else out.push({ type: 'empty' });
    if (favorites.length) {
      out.push({ type: 'header', title: 'Favoritos' });
      for (const id of favorites) {
        const b = BUILT_IN_LOOKS.find((l) => l.id === id);
        const u = userLuts.find((l) => l.id === id);
        if (b) out.push({ type: 'look', id: b.id, name: b.name, subtitle: LOOK_CATEGORIES.find((c) => c.id === b.category)?.label ?? '' });
        else if (u) out.push({ type: 'look', id: u.id, name: u.name, subtitle: 'Meu LUT' });
      }
    }
    for (const cat of LOOK_CATEGORIES) {
      out.push({ type: 'header', title: cat.label });
      for (const l of BUILT_IN_LOOKS.filter((x) => x.category === cat.id)) out.push({ type: 'look', id: l.id, name: l.name, subtitle: l.description });
    }
    return out;
  }, [userLuts, favorites]);

  const doImport = async () => {
    const res = await importCubeFiles();
    if (res.imported.length) haptic.success();
    if (res.errors.length) Alert.alert('Alguns arquivos não foram importados', res.errors.join('\n'));
  };

  return (
    <>
      <Stack.Screen options={{ headerRight: () => <IconButton icon="import" label="Importar LUT .cube" tone="clear" onPress={doImport} /> }} />
      <FlashList
        data={items}
        numColumns={cols}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={{ paddingHorizontal: space.l, paddingBottom: space.xxxl * 2 }}
        getItemType={(i) => i.type}
        overrideItemLayout={(layout, item) => {
          if (item.type !== 'look') layout.span = cols;
        }}
        keyExtractor={(i, idx) => (i.type === 'look' ? `${i.id}:${idx}` : `${i.type}:${idx}`)}
        ListHeaderComponent={
          latest?.thumb ? (
            <View style={{ flexDirection: 'row', gap: space.s, paddingTop: space.s }}>
              <Button label="No meu clipe" size="small" variant={source === 'clip' ? 'primary' : 'secondary'} onPress={() => setSource('clip')} />
              <Button label="Carta de referência" size="small" variant={source === 'chart' ? 'primary' : 'secondary'} onPress={() => setSource('chart')} />
            </View>
          ) : null
        }
        renderItem={({ item }) => {
          if (item.type === 'header')
            return (
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space.xxl, paddingBottom: space.m }}>
                <Text variant="title3">{item.title}</Text>
                {item.action ? <Button label="Importar" icon="import" variant="plain" size="small" onPress={doImport} /> : null}
              </View>
            );
          if (item.type === 'empty')
            return (
              <EmptyState
                icon="cube"
                title="Traga seus LUTs"
                message="Importe arquivos .cube (33³, 65³ ou 1D) do app Arquivos, iCloud ou Drive. Eles aparecem aqui e no editor."
                style={{ paddingVertical: space.xl }}
              />
            );
          return (
            <View style={{ marginBottom: space.xl }}>
              <LookCard id={item.id} name={item.name} subtitle={item.subtitle} width={cardW} input={input} image={image} favorite={favorites.includes(item.id)} />
            </View>
          );
        }}
      />
    </>
  );
}
