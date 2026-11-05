/**
 * iOS widgets + Live Activity, rendered by WidgetKit through expo-widgets.
 * Functions marked with the 'widget' directive are serialized at build time and
 * evaluated inside the widget extension, where the SwiftUI components below are
 * globals. This module is ONLY required when the native module exists (never in
 * Expo Go) — see ./index.ts.
 */
import { Capsule, Circle, Gauge, HStack, Image, Spacer, Text, VStack, ZStack } from '@expo/ui/swift-ui';
import { containerBackground, font, foregroundStyle, frame, gaugeStyle, padding, widgetURL } from '@expo/ui/swift-ui/modifiers';
import { createLiveActivity, createWidget, type LiveActivityEnvironment, type WidgetEnvironment } from 'expo-widgets';

export type RenderWidgetProps = {
  state: 'idle' | 'rendering' | 'done' | 'failed';
  progress: number; // 0..1
  title: string;
  detail: string;
  finished: number;
  total: number;
  exportedToday: number;
};

export type LookWidgetProps = {
  lookId: string;
  name: string;
  category: string;
  swatches: string[];
  description: string;
};

export type RenderActivityProps = {
  title: string;
  progress: number;
  finished: number;
  total: number;
  eta: string;
};

const RenderStatus = (props: RenderWidgetProps, env: WidgetEnvironment) => {
  'widget';
  const pct = Math.round(props.progress * 100);
  const busy = props.state === 'rendering';
  const url = busy || props.state === 'done' ? 'lutra:///exports' : 'lutra:///?action=new';

  if (env.widgetFamily === 'accessoryInline') {
    return (
      <Text modifiers={[widgetURL(url)]}>
        {busy ? `Lutra ${pct}% · ${props.finished}/${props.total}` : props.exportedToday > 0 ? `Lutra · ${props.exportedToday} exportados hoje` : 'Lutra · novo lote'}
      </Text>
    );
  }

  if (env.widgetFamily === 'accessoryCircular') {
    return busy ? (
      <Gauge value={props.progress} modifiers={[gaugeStyle('circularCapacity'), widgetURL(url)]} currentValueLabel={<Text>{`${pct}`}</Text>}>
        <Image systemName="film.stack" />
      </Gauge>
    ) : (
      <ZStack modifiers={[widgetURL(url)]}>
        <Circle modifiers={[foregroundStyle('#FFFFFF33')]} />
        <Image systemName={props.state === 'done' ? 'checkmark' : 'camera.filters'} size={22} />
      </ZStack>
    );
  }

  if (env.widgetFamily === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={2} modifiers={[widgetURL(url)]}>
        <HStack spacing={4}>
          <Image systemName={busy ? 'film.stack' : props.state === 'done' ? 'checkmark.circle' : 'camera.filters'} size={12} />
          <Text modifiers={[font({ size: 13, weight: 'semibold' })]}>{busy ? 'Exportando' : props.state === 'done' ? 'Exportado' : 'Lutra'}</Text>
        </HStack>
        <Text modifiers={[font({ size: 13 })]}>{busy ? props.title : props.detail}</Text>
        {busy ? <Gauge value={props.progress} modifiers={[gaugeStyle('linearCapacity')]} /> : null}
        {busy ? <Text modifiers={[font({ size: 11 })]}>{`${pct}% · ${props.finished}/${props.total} · ${props.detail}`}</Text> : null}
      </VStack>
    );
  }

  // Home screen (systemSmall)
  return (
    <VStack alignment="leading" spacing={6} modifiers={[padding({ all: 2 }), containerBackground('#111113', 'widget'), widgetURL(url)]}>
      <HStack>
        <Image systemName="camera.filters" size={16} color="#FFB23F" />
        <Spacer />
        <Text modifiers={[font({ size: 12, weight: 'medium' }), foregroundStyle('#FFFFFF99')]}>{busy ? `${props.finished}/${props.total}` : 'Lutra'}</Text>
      </HStack>
      <Spacer />
      <Text modifiers={[font({ size: 34, weight: 'bold', design: 'rounded' }), foregroundStyle('#FFFFFF')]}>{busy ? `${pct}%` : `${props.exportedToday}`}</Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle('#FFFFFFB3')]}>{busy ? props.title : props.exportedToday === 1 ? 'vídeo exportado hoje' : 'vídeos exportados hoje'}</Text>
      {busy ? <Gauge value={props.progress} modifiers={[gaugeStyle('linearCapacity')]} /> : null}
    </VStack>
  );
};

const LookOfDay = (props: LookWidgetProps, env: WidgetEnvironment) => {
  'widget';
  const url = `lutra:///?action=new&look=${props.lookId}`;
  const dots = props.swatches.map((c, i) => <Circle key={`s${i}`} modifiers={[foregroundStyle(c), frame({ width: 14, height: 14 })]} />);
  if (env.widgetFamily === 'accessoryRectangular') {
    return (
      <VStack alignment="leading" spacing={3} modifiers={[widgetURL(url)]}>
        <Text modifiers={[font({ size: 11, weight: 'semibold' })]}>LOOK DO DIA</Text>
        <Text modifiers={[font({ size: 15, weight: 'bold' })]}>{props.name}</Text>
        <HStack spacing={3}>{dots}</HStack>
      </VStack>
    );
  }
  return (
    <VStack alignment="leading" spacing={6} modifiers={[containerBackground('#111113', 'widget'), widgetURL(url)]}>
      <Text modifiers={[font({ size: 11, weight: 'semibold' }), foregroundStyle('#FFB23F')]}>LOOK DO DIA</Text>
      <Text modifiers={[font({ size: 20, weight: 'bold' }), foregroundStyle('#FFFFFF')]}>{props.name}</Text>
      <Text modifiers={[font({ size: 12 }), foregroundStyle('#FFFFFFB3')]}>{props.description}</Text>
      <Spacer />
      <HStack spacing={4}>{dots}</HStack>
      <Capsule modifiers={[foregroundStyle('#FFFFFF1A'), frame({ height: 1 })]} />
      <Text modifiers={[font({ size: 11 }), foregroundStyle('#FFFFFF99')]}>{props.category}</Text>
    </VStack>
  );
};

const RenderActivity = (props: RenderActivityProps, _env: LiveActivityEnvironment) => {
  'widget';
  const pct = `${Math.round(props.progress * 100)}%`;
  return {
    banner: (
      <VStack alignment="leading" spacing={8} modifiers={[padding({ all: 16 })]}>
        <HStack spacing={8}>
          <Image systemName="film.stack" color="#FFB23F" />
          <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.title}</Text>
          <Spacer />
          <Text modifiers={[font({ size: 15, weight: 'bold' })]}>{pct}</Text>
        </HStack>
        <Gauge value={props.progress} modifiers={[gaugeStyle('linearCapacity')]} />
        <Text modifiers={[font({ size: 12 }), foregroundStyle('#FFFFFFB3')]}>{`${props.finished} de ${props.total} prontos · ${props.eta}`}</Text>
      </VStack>
    ),
    compactLeading: <Image systemName="film.stack" color="#FFB23F" />,
    compactTrailing: <Text modifiers={[font({ size: 14, weight: 'semibold' })]}>{pct}</Text>,
    minimal: <Gauge value={props.progress} modifiers={[gaugeStyle('circularCapacity')]} />,
    expandedLeading: <Image systemName="film.stack" color="#FFB23F" />,
    expandedTrailing: <Text modifiers={[font({ size: 17, weight: 'bold' })]}>{pct}</Text>,
    expandedCenter: <Text modifiers={[font({ size: 15, weight: 'semibold' })]}>{props.title}</Text>,
    expandedBottom: (
      <VStack spacing={6}>
        <Gauge value={props.progress} modifiers={[gaugeStyle('linearCapacity')]} />
        <Text modifiers={[font({ size: 12 })]}>{`${props.finished} de ${props.total} prontos · ${props.eta}`}</Text>
      </VStack>
    ),
  };
};

export const renderStatusWidget = createWidget<RenderWidgetProps>('RenderStatus', RenderStatus, {
  state: 'idle',
  progress: 0,
  title: '',
  detail: 'Toque para criar um lote',
  finished: 0,
  total: 0,
  exportedToday: 0,
});

export const lookOfDayWidget = createWidget<LookWidgetProps>('LookOfDay', LookOfDay);

export const renderActivity = createLiveActivity<RenderActivityProps>('RenderActivity', RenderActivity);
