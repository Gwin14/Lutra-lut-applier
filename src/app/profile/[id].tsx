import { router, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ScrollView } from 'react-native';

import { PROFILES, type ProfileId } from '../../color/profiles';
import { haptic } from '../../lib/haptics';
import { useProjects } from '../../store/projects';
import { useSettings } from '../../store/settings';
import { space } from '../../theme/tokens';
import { Row, Section } from '../../ui/List';

/**
 * Camera profile picker (form sheet). `id` is a project id plus `clip`, or
 * "default" to choose the app-wide preferred log profile.
 */
export default function ProfileSheet() {
  const { id, clip } = useLocalSearchParams<{ id: string; clip?: string }>();
  const project = useProjects((s) => s.projects.find((p) => p.id === id));
  const preferred = useSettings((s) => s.preferredLog);
  const current: ProfileId = id === 'default' ? preferred : (project?.clips.find((c) => c.id === clip)?.input ?? 'rec709');

  const groups = useMemo(() => {
    const map = new Map<string, typeof PROFILES>();
    for (const p of PROFILES) {
      const key = p.kind === 'display' ? 'Sem conversão' : p.kind === 'hdr' ? 'HDR' : p.brand;
      map.set(key, [...(map.get(key) ?? []), p]);
    }
    return [...map.entries()];
  }, []);

  const choose = (pid: ProfileId) => {
    haptic.selection();
    if (id === 'default') useSettings.getState().set('preferredLog', pid);
    else if (project && clip) useProjects.getState().updateClip(project.id, clip, { input: pid });
    router.back();
  };

  return (
    <ScrollView contentContainerStyle={{ padding: space.l, gap: space.xl, paddingBottom: space.xxxl }}>
      {groups.map(([title, list]) => (
        <Section key={title} title={title}>
          {list.map((p) => (
            <Row key={p.id} title={p.name} subtitle={p.gamutLabel} checked={p.id === current} onPress={() => choose(p.id)} />
          ))}
        </Section>
      ))}
      <Section footer="Não achou sua câmera (ex.: D-Log M, Samsung Log)? Use Rec.709 aqui e importe o LUT oficial do fabricante como look." >
        <Row title="Como usar LUTs do fabricante" icon="info" />
      </Section>
    </ScrollView>
  );
}
