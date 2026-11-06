import { Image } from 'expo-image';
import { ActivityIndicator, ScrollView, View } from 'react-native';

import { useT } from '../../i18n';
import { profileText } from '../../i18n/content';
import { formatDuration } from '../../lib/format';
import { useFileStatus } from '../../store/fileStatus';
import type { Clip } from '../../store/projects';
import { useCopyState } from '../importClips';
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
  const t = useT();
  const status = useFileStatus((s) => s.status);
  const copying = useCopyState((s) => s.copying);
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: space.l, gap: space.s }}>
      {clips.map((clip, i) => {
        const selected = clip.id === selectedId;
        const profile = { id: clip.input, ...profileText(clip.input, t) };
        const missing = status[clip.id] === 'missing';
        const ref = !!clip.ref;
        const state = missing ? `, ${clip.ref ? t.editor.refMissingA11y : t.editor.missingTitle}` : ref ? `, ${t.editor.refBadgeA11y}` : '';
        return (
          <PressableScale
            key={clip.id}
            onPress={() => onSelect(clip.id)}
            onLongPress={() => onLongPress(clip)}
            accessibilityRole="button"
            accessibilityState={{ selected }}
            accessibilityLabel={t.editor.clipA11y(i + 1, clip.name, profile.name) + state}
            accessibilityHint={t.editor.clipHint}
            style={{ width: W, height: H, borderRadius: radius.media, borderCurve: 'continuous', overflow: 'hidden', backgroundColor: g.fill, borderWidth: 2, borderColor: selected ? g.accent : 'transparent' }}
          >
            {clip.thumb ? <Image source={{ uri: clip.thumb }} style={{ flex: 1, opacity: missing ? 0.35 : 1 }} contentFit="cover" transition={120} /> : null}
            {ref || missing ? (
              // Subtle: a referenced clip wears a small link glyph; a missing file swaps it for a warning.
              <View pointerEvents="none" style={{ position: 'absolute', top: 3, right: 3, width: 16, height: 16, borderRadius: 8, backgroundColor: missing ? g.danger : 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' }}>
                {copying[clip.id] ? <ActivityIndicator size="small" color="#FFFFFF" style={{ transform: [{ scale: 0.55 }] }} /> : <Icon name={missing ? 'linkOff' : 'reference'} size={9} color="#FFFFFF" weight="bold" />}
              </View>
            ) : null}
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
        accessibilityLabel={t.editor.addClipsA11y}
        style={{ width: H, height: H, borderRadius: radius.media, borderCurve: 'continuous', backgroundColor: g.fill, alignItems: 'center', justifyContent: 'center' }}
      >
        <Icon name="add" size={22} color={g.label} weight="semibold" />
      </PressableScale>
    </ScrollView>
  );
}
