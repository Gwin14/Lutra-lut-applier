import { View } from 'react-native';
import { GestureDetector, useExclusiveGestures, usePanGesture, useTapGesture } from 'react-native-gesture-handler';
import { cancelAnimation, Easing, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { scheduleOnRN } from 'react-native-worklets';

import { useT } from '../../i18n';
import { grade as g, space } from '../../theme/tokens';

export const PANEL_EASE = Easing.bezier(0.23, 1, 0.32, 1);
export const PANEL_MS = 300;

type Props = {
  /** 'y': grabber above the controls (portrait). 'x': grip on the panel's left edge (two columns). */
  axis: 'x' | 'y';
  /** 0 = normal, 1 = large. Driven live while dragging. */
  progress: SharedValue<number>;
  /** Pixels of drag that take progress from 0 to 1. */
  range: number;
  expanded: boolean;
  onChange: (expanded: boolean) => void;
};

/**
 * Resize affordance for the editing controls: drag it (up / left) to grow the
 * controls area, or tap to toggle between the normal and large sizes.
 */
export function PanelHandle({ axis, progress, range, expanded, onChange }: Props) {
  const t = useT();
  const toggle = () => onChange(!expanded);
  const span = Math.max(1, range);
  const vel = useSharedValue(0);

  const pan = usePanGesture({
    minDistance: 4,
    onActivate: () => {
      'worklet';
      cancelAnimation(progress);
      vel.set(0);
    },
    onUpdate: (e) => {
      'worklet';
      const d = axis === 'y' ? -e.changeY : -e.changeX;
      progress.set(Math.min(1, Math.max(0, progress.value + d / span)));
      vel.set(axis === 'y' ? -e.velocityY : -e.velocityX);
    },
    onDeactivate: () => {
      'worklet';
      const v = vel.value;
      const target = v > 400 ? 1 : v < -400 ? 0 : progress.value > 0.5 ? 1 : 0;
      progress.set(withTiming(target, { duration: PANEL_MS, easing: PANEL_EASE }));
      scheduleOnRN(onChange, target === 1);
    },
  });
  const tap = useTapGesture({
    maxDuration: 300,
    onDeactivate: (e) => {
      'worklet';
      if (!e.canceled) scheduleOnRN(toggle);
    },
  });
  const gesture = useExclusiveGestures(pan, tap);

  const a11y = {
    accessible: true,
    accessibilityRole: 'button' as const,
    accessibilityLabel: expanded ? t.editor.shrinkPanel : t.editor.enlargePanel,
    accessibilityHint: t.editor.panelHandleHint,
    accessibilityState: { expanded },
    accessibilityActions: [{ name: 'activate' as const }],
    onAccessibilityAction: toggle,
  };

  if (axis === 'y') {
    return (
      <GestureDetector gesture={gesture}>
        <View {...a11y} hitSlop={{ top: 6, bottom: 4 }} style={{ height: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: g.bg }}>
          <View style={{ width: 36, height: 5, borderRadius: 3, backgroundColor: g.fillStrong }} />
        </View>
      </GestureDetector>
    );
  }
  return (
    <GestureDetector gesture={gesture}>
      <View
        {...a11y}
        style={{ position: 'absolute', left: -space.m, top: 0, bottom: 0, width: space.m * 2, alignItems: 'center', justifyContent: 'center', zIndex: 10 }}
      >
        <View style={{ width: 5, height: 40, borderRadius: 3, backgroundColor: g.fillStrong }} />
      </View>
    </GestureDetector>
  );
}
