import { router, useLocalSearchParams } from 'expo-router';
import { useRef } from 'react';
import { TextInput, View } from 'react-native';

import { haptic } from '../../lib/haptics';
import { useProjects } from '../../store/projects';
import { radius, space, type as ramp } from '../../theme/tokens';
import { usePalette } from '../../theme/useTheme';
import { Button } from '../../ui/Button';

export default function RenameSheet() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  const c = usePalette();
  // Uncontrolled input: typing never re-renders the tree.
  const value = useRef(project?.name ?? '');
  if (!project) return null;
  const save = () => {
    useProjects.getState().rename(project.id, value.current);
    haptic.success();
    router.back();
  };
  return (
    <View style={{ padding: space.l, gap: space.l }}>
      <TextInput
        defaultValue={project.name}
        onChangeText={(t) => (value.current = t)}
        autoFocus
        selectTextOnFocus
        returnKeyType="done"
        onSubmitEditing={save}
        maxLength={60}
        accessibilityLabel="Nome do lote"
        placeholder="Nome do lote"
        placeholderTextColor={c.labelTertiary}
        style={[ramp.body, { color: c.label, backgroundColor: c.fill, borderRadius: radius.input, paddingHorizontal: space.m, height: 48 }]}
      />
      <Button label="Salvar" size="large" onPress={save} stretch />
    </View>
  );
}
