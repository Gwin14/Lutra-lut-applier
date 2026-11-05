import { Skia } from '@shopify/react-native-skia';

import type { Effects } from '../color/grade';
import { SKSL_SOURCE } from '../engine/shader';

let effect: ReturnType<typeof Skia.RuntimeEffect.Make> | undefined;

export function gradeEffect() {
  if (effect === undefined) {
    effect = Skia.RuntimeEffect.Make(SKSL_SOURCE);
    if (!effect) console.warn('[lutra] SkSL grade effect failed to compile');
  }
  return effect;
}

export type ViewOptions = {
  split: number; // <0 off, else 0..1
  falseColor: boolean;
  zebra: number; // 0 off, else luma threshold
};

export const NO_VIEW: ViewOptions = { split: -1, falseColor: false, zebra: 0 };

export function fxVector(e: Effects): [number, number, number, number] {
  return [e.vignette / 100, e.grain / 100, e.grainSize, e.sharpen / 100];
}
