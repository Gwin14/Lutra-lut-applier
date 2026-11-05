import { router } from 'expo-router';
import { View } from 'react-native';

import { getProfile } from '../../../color/profiles';
import { haptic } from '../../../lib/haptics';
import { effectiveGrade, useProjects, type Clip, type Project } from '../../../store/projects';
import { space } from '../../../theme/tokens';
import { Button } from '../../../ui/Button';
import { Row, Section, SwitchRow } from '../../../ui/List';
import { InlineNotice } from '../../../ui/States';

export function InputPanel({ project, clip }: { project: Project; clip: Clip }) {
  const profile = getProfile(clip.input);
  const others = project.clips.filter((c) => c.id !== clip.id);
  const mixed = new Set(project.clips.map((c) => c.input)).size > 1;
  const d = clip.detection;

  return (
    <View style={{ gap: space.xl, paddingHorizontal: space.l }}>
      <Section
        title="Perfil de câmera deste clipe"
        footer="A conversão de log para Rec.709 é feita pela matemática oficial de cada fabricante, antes do look. Não precisa de LUT de conversão."
      >
        <Row
          icon="input"
          title={profile.name}
          subtitle={`${profile.brand} · ${profile.gamutLabel}`}
          chevron
          onPress={() => router.push({ pathname: '/profile/[id]', params: { id: project.id, clip: clip.id } })}
        />
      </Section>

      {d ? (
        <InlineNotice
          tone={d.isLog && profile.kind === 'display' ? 'warning' : 'info'}
          title={d.isLog ? `Parece footage em log (${Math.round(d.confidence * 100)}%)` : 'Parece vídeo já corrigido'}
          message={
            d.isLog && profile.kind === 'display'
              ? 'Este clipe tem contraste e saturação típicos de log. Escolha o perfil da câmera para converter corretamente.'
              : d.isLog
                ? 'Detectado pelo contraste e saturação do quadro. Confira se o perfil bate com a câmera.'
                : 'Contraste normal detectado. Mantenha Rec.709 a menos que tenha gravado em log.'
          }
        />
      ) : null}

      {others.length ? (
        <View style={{ gap: space.m }}>
          <Button
            label={`Usar ${profile.name} em todos os ${project.clips.length} clipes`}
            variant="secondary"
            icon="copy"
            disabled={!mixed}
            onPress={() => {
              useProjects.getState().setInputAll(project.id, clip.input);
              haptic.success();
            }}
          />
          <Section footer={project.linked ? 'Look e ajustes valem para todos os clipes. O perfil de câmera continua individual, para misturar câmeras.' : 'Cada clipe tem look e ajustes próprios.'}>
            <SwitchRow
              icon="link"
              title="Mesmo grade em todo o lote"
              value={project.linked}
              onValueChange={(v) => {
                useProjects.getState().setLinked(project.id, v, clip.id);
                haptic.selection();
              }}
            />
          </Section>
          {!project.linked ? (
            <Button
              label="Copiar grade deste clipe para todos"
              variant="secondary"
              icon="paste"
              onPress={() => {
                useProjects.getState().applyGradeToAll(project.id, effectiveGrade(project, clip));
                haptic.success();
              }}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
