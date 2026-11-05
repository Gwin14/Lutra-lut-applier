import { Image } from 'expo-image';
import { ScrollView, View } from 'react-native';

import { getProfile } from '../../color/profiles';
import { formatDuration } from '../../lib/format';
import type { Clip } from '../../store/projects';
import { grade as g, radius, space } from '../../theme/tokens';
import { Icon } from '../../ui/Icon';
import { PressableScale } from '../../ui/Pressable';
import { Text } from '../../ui/Text';

type Props = {
  clips: Clip[];
  selectedId: string | undefined;
  onSelect: (id: string) => void;
  onLongPress: (clip: Clip) => void;
  onAdd: () => void;
  adding: boolean;
};

const W = 92;
const H = 56;

export function ClipStrip({ clips, selectedId, onSelect, onLongPress, onAdd, adding }: Props) {
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.l, gap: space.s }}>
      {clips.map((clip, i) => {
        const selected = clip.id === selectedId;
        const profile = getProfile(clip.input);
        return (
          <PressableScale
            key={clip.id}
            onPress={() => onSelect(clip.id)}
            onLongPress={() => onLongPress(clip)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={`Clipe ${i + 1}, ${clip.name}, ${profile.name}`}
            accessibilityHint="Toque e segure para opções do clipe"
            style={{ width: W, height: H, borderRadius: radius.media, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: g.fill, borderWidth: 2, borderColor: selected ? g.accent : 'transparent' }}
          >
            {clip.thumb ? <Image source={{ uri: clip.thumb }} style={{ flex: 1 }} contentFit="cover" transition={120} /> : null}
            <View style={{ position: 'absolute', left: 4, bottom: 3, right: 4, flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text variant="caption2" weight="600" color="#FFFFFF" numberOfLines={1} style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 }}>
                {profile.id === 'rec709' ? '709' : profile.name}
              </Text>
              <Text variant="caption2" tabular color="#FFFFFF" style={{ textShadowColor: 'rgba(0,0,0,0.8)', textShadowRadius: 3 }}>
                {formatDuration(Math.max(0, clip.trim.end - clip.trim.start))}
              </Text>
            </View>
          </PressableScale>
        );
      })}
      <PressableScale
        onPress={onAdd}
        disabled={adding}
        accessibilityRole="button"
        accessibilityLabel="Adicionar clipes ao lote"
        style={{ width: H, height: H, borderRadius: radius.media, borderCurve: 'continuous', backgroundColor: g.fill, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="add" size={22} color={g.label} weight="semibold" />
      </PressableScale>
    </ScrollView>
  );
}
