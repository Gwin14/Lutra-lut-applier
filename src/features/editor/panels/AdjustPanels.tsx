import { useCallback } from 'react';
import { View } from 'react-native';

import { DEFAULT_ADJUSTMENTS, DEFAULT_EFFECTS, hueOffset, type Adjustments, type Effects, type Grade } from '../../../color/grade';
import type { AspectId } from '../../../engine/protocol';
import { haptic } from '../../../lib/haptics';
import { useProjects, type Clip, type Project } from '../../../store/projects';
import { grade as g, radius, space } from '../../../theme/tokens';
import { Button } from '../../../ui/Button';
import { PressableScale } from '../../../ui/Pressable';
import { SliderRow } from '../../../ui/SliderRow';
import { Text } from '../../../ui/Text';

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: 2 }}>
      <Text variant="footnote" color={g.labelSecondary} style={{ paddingHorizontal: space.l, textTransform: 'uppercase', marginBottom: 2 }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

const ev = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2).replace(/\.?0+$/, '').replace('.', ',')} EV`;
const deg = (v: number) => `${Math.round(v)}°`;
const pct = (v: number) => `${Math.round(v)}%`;

function hueColor(h: number) {
  const [r, gg, b] = hueOffset(h);
  const to = (v: number) => Math.round(Math.min(1, Math.max(0, 0.5 + v * 0.9)) * 255);
  return `rgb(${to(r)},${to(gg)},${to(b)})`;
}

export function AdjustPanel({ project, clip, grade }: { project: Project; clip: Clip; grade: Grade }) {
  const a = grade.adjust;
  const store = useProjects.getState();
  const begin = useCallback(() => store.checkpoint(project.id, clip.id), [store, project.id, clip.id]);
  const set = useCallback((patch: Partial<Adjustments>) => store.editAdjust(project.id, clip.id, patch), [store, project.id, clip.id]);
  const row = (key: keyof Adjustments, label: string, min = -100, max = 100, extra: Partial<React.ComponentProps<typeof SliderRow>> = {}) => (
    <SliderRow key={key} label={label} value={a[key]} min={min} max={max} neutral={DEFAULT_ADJUSTMENTS[key]} onBegin={begin} onChange={(v) => set({ [key]: v } as Partial<Adjustments>)} {...extra} />
  );
  const changed = (Object.keys(DEFAULT_ADJUSTMENTS) as (keyof Adjustments)[]).some((k) => a[k] !== DEFAULT_ADJUSTMENTS[k]);

  return (
    <View style={{ gap: space.xl }}>
      <Group title="Luz">
        {row('exposure', 'Exposição', -3, 3, { step: 0.05, format: ev })}
        {row('contrast', 'Contraste')}
        {row('highlights', 'Altas luzes')}
        {row('shadows', 'Sombras')}
        {row('whites', 'Brancos')}
        {row('blacks', 'Pretos')}
      </Group>
      <Group title="Cor">
        {row('temperature', 'Temperatura')}
        {row('tint', 'Matiz')}
        {row('saturation', 'Saturação')}
        {row('vibrance', 'Vibração')}
      </Group>
      <Group title="Split toning">
        {row('shadowHue', 'Cor das sombras', 0, 360, { neutral: DEFAULT_ADJUSTMENTS.shadowHue, format: deg, swatch: hueColor(a.shadowHue) })}
        {row('shadowAmount', 'Intensidade nas sombras', 0, 100, { format: pct })}
        {row('highlightHue', 'Cor das altas luzes', 0, 360, { neutral: DEFAULT_ADJUSTMENTS.highlightHue, format: deg, swatch: hueColor(a.highlightHue) })}
        {row('highlightAmount', 'Intensidade nas altas', 0, 100, { format: pct })}
      </Group>
      <Group title="Acabamento">{row('fade', 'Fade (pretos lavados)', 0, 100, { format: pct })}</Group>
      <View style={{ paddingHorizontal: space.l }}>
        <Button
          label="Redefinir ajustes"
          icon="reset"
          variant="secondary"
          disabled={!changed}
          onPress={() => {
            begin();
            store.editGrade(project.id, clip.id, { adjust: DEFAULT_ADJUSTMENTS });
            haptic.light();
          }}
        />
      </View>
    </View>
  );
}

export function EffectsPanel({ project, clip, grade }: { project: Project; clip: Clip; grade: Grade }) {
  const e = grade.effects;
  const store = useProjects.getState();
  const begin = () => store.checkpoint(project.id, clip.id);
  const set = (patch: Partial<Effects>) => store.editEffects(project.id, clip.id, patch);
  return (
    <View style={{ gap: space.xl }}>
      <Group title="Óptica">
        <SliderRow label="Vinheta" value={e.vignette} min={-100} max={100} onBegin={begin} onChange={(v) => set({ vignette: v })} />
        <SliderRow label="Nitidez" value={e.sharpen} min={0} max={100} format={pct} onBegin={begin} onChange={(v) => set({ sharpen: v })} />
      </Group>
      <Group title="Grão de filme">
        <SliderRow label="Quantidade" value={e.grain} min={0} max={100} format={pct} onBegin={begin} onChange={(v) => set({ grain: v })} />
        <SliderRow
          label="Tamanho"
          value={e.grainSize}
          min={0.6}
          max={3}
          step={0.1}
          neutral={DEFAULT_EFFECTS.grainSize}
          format={(v) => `${v.toFixed(1).replace('.', ',')}×`}
          onBegin={begin}
          onChange={(v) => set({ grainSize: v })}
        />
      </Group>
      <Text variant="footnote" color={g.labelSecondary} style={{ paddingHorizontal: space.l }}>
        O grão é animado e renderizado por quadro na exportação, como em filme.
      </Text>
    </View>
  );
}

const ASPECTS: { id: AspectId; label: string; hint: string }[] = [
  { id: 'original', label: 'Original', hint: 'Sem corte' },
  { id: '16:9', label: '16:9', hint: 'YouTube, TV' },
  { id: '9:16', label: '9:16', hint: 'Reels, Shorts, TikTok' },
  { id: '4:5', label: '4:5', hint: 'Feed vertical' },
  { id: '1:1', label: '1:1', hint: 'Quadrado' },
  { id: '4:3', label: '4:3', hint: 'Clássico' },
  { id: '2.39:1', label: '2.39:1', hint: 'Cinemascope' },
];

export function FramePanel({ project }: { project: Project }) {
  return (
    <View style={{ gap: space.m, paddingHorizontal: space.l }}>
      <Text variant="footnote" color={g.labelSecondary} style={{ textTransform: 'uppercase' }}>
        Enquadramento do lote
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: space.s }}>
        {ASPECTS.map((a) => {
          const selected = project.aspect === a.id;
          return (
            <PressableScale
              key={a.id}
              onPress={() => {
                useProjects.getState().setAspect(project.id, a.id);
                haptic.selection();
              }}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              accessibilityLabel={`${a.label}, ${a.hint}`}
              style={{ width: '31.5%', minHeight: 64, padding: space.m, borderRadius: radius.card, borderCurve: 'continuous', backgroundColor: selected ? g.accentSoft : g.fill, borderWidth: 1.5, borderColor: selected ? g.accent : 'transparent', gap: 2 }}
            >
              <Text variant="headline" color={selected ? g.accentText : g.label} tabular>
                {a.label}
              </Text>
              <Text variant="caption1" color={g.labelSecondary} numberOfLines={1}>
                {a.hint}
              </Text>
            </PressableScale>
          );
        })}
      </View>
      <Text variant="footnote" color={g.labelSecondary}>
        O corte é centralizado e vale para a prévia, os quadros exportados e todos os vídeos do lote.
      </Text>
    </View>
  );
}
