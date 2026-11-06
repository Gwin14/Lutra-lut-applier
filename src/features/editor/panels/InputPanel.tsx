import { router } from 'expo-router';
import { View } from 'react-native';

import { getProfile, type ProfileId } from '../../../color/profiles';
import { useT } from '../../../i18n';
import { profileText } from '../../../i18n/content';
import { haptic } from '../../../lib/haptics';
import { effectiveGrade, useProjects, type Clip, type Project } from '../../../store/projects';
import { space } from '../../../theme/tokens';
import { Button } from '../../../ui/Button';
import { Row, Section, SwitchRow } from '../../../ui/List';
import { InlineNotice } from '../../../ui/States';

/** Says where the profile came from: the file's metadata, the camera brand, or the frame. */
function DetectionNotice({ detection: d, chosen }: { detection: NonNullable<Clip['detection']>; chosen: ProfileId }) {
  const t = useT();
  const l = t.inputPanel;
  const detected = profileText(d.profile ?? chosen, t).name;
  const displayChosen = getProfile(chosen).kind === 'display';
  if (d.source === 'metadata') {
    return <InlineNotice title={l.fromMetadata(detected)} message={l.fromMetadataMessage(d.evidence ?? '', d.camera ?? null)} />;
  }
  if (d.source === 'camera' && d.camera) {
    return (
      <InlineNotice
        tone={d.isLog && displayChosen ? 'warning' : 'info'}
        title={l.fromCamera(d.camera)}
        message={d.isLog && displayChosen ? l.logButDisplay : d.isLog ? l.fromCameraLog(detected) : l.fromCameraNormal}
      />
    );
  }
  if (d.source === 'none') return null;
  return (
    <InlineNotice
      tone={d.isLog && displayChosen ? 'warning' : 'info'}
      title={d.isLog ? l.looksLog(Math.round(d.confidence * 100)) : l.looksCorrected}
      message={d.isLog && displayChosen ? l.logButDisplay : d.source === 'image' ? l.noMetadata : d.isLog ? l.logDetected : l.normalDetected}
    />
  );
}

export function InputPanel({ project, clip }: { project: Project; clip: Clip }) {
  const t = useT();
  const l = t.inputPanel;
  const profile = { kind: getProfile(clip.input).kind, ...profileText(clip.input, t) };
  const others = project.clips.filter((c) => c.id !== clip.id);
  const mixed = new Set(project.clips.map((c) => c.input)).size > 1;
  const d = clip.detection;

  return (
    <View style={{ gap: space.xl, paddingHorizontal: space.l }}>
      <Section
        title={l.section}
        footer={l.footer}
      >
        <Row
          icon="input"
          title={profile.name}
          subtitle={`${profile.brand} · ${profile.gamutLabel}`}
          chevron
          onPress={() => router.push({ pathname: '/profile/[id]', params: { id: project.id, clip: clip.id } })}
        />
      </Section>

      {d ? <DetectionNotice detection={d} chosen={clip.input} /> : null}

      {others.length ? (
        <View style={{ gap: space.m }}>
          <Button
            label={l.useForAll(profile.name, project.clips.length)}
            variant="secondary"
            icon="copy"
            disabled={!mixed}
            onPress={() => {
              useProjects.getState().setInputAll(project.id, clip.input);
              haptic.success();
            }}
          />
          <Section footer={project.linked ? l.linkedFooter : l.unlinkedFooter}>
            <SwitchRow
              icon="link"
              title={l.linked}
              value={project.linked}
              onValueChange={(v) => {
                useProjects.getState().setLinked(project.id, v, clip.id);
                haptic.selection();
              }}
            />
          </Section>
          {!project.linked ? (
            <Button
              label={l.copyToAll}
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
