import { Canvas, Fill, ImageShader, Shader, type SkImage } from '@shopify/react-native-skia';

import { DEFAULT_EFFECTS, type Effects } from '../color/grade';
import { coverCrop } from '../engine/geometry';
import { fxVector, gradeEffect } from './effect';
import type { BakedLut } from './lutImage';

type Props = {
  image: SkImage | null;
  lut: BakedLut | null;
  width: number;
  height: number;
  effects?: Effects;
};

/** A still frame (thumbnail, reference chart) through the grade shader. */
export function GradedStill({ image, lut, width, height, effects = DEFAULT_EFFECTS }: Props) {
  const effect = gradeEffect();
  if (!effect || !image || !lut) return <Canvas style={{ width, height }} />;
  const iw = image.width();
  const ih = image.height();
  const crop = coverCrop(iw, ih, width / height);
  const t = lut.tex;
  return (
    <Canvas style={{ width, height }}>
      <Fill>
        <Shader
          source={effect}
          uniforms={{
            uOut: [width, height],
            uRaw: [iw, ih],
            uRot: 0,
            uCrop: crop,
            uLut: [t.size, t.cols, t.width, t.height],
            uFx: fxVector(effects),
            uView: [-1, 0, 0, 0],
            uMisc: [0, 1],
          }}
        >
          <ImageShader image={image} tx="clamp" ty="clamp" />
          <ImageShader image={lut.image} tx="clamp" ty="clamp" />
        </Shader>
      </Fill>
    </Canvas>
  );
}
