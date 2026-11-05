import { Canvas, Fill, ImageShader, Shader, useVideo } from '@shopify/react-native-skia';
import { useEffect } from 'react';
import { useAnimatedReaction, useDerivedValue, type SharedValue } from 'react-native-reanimated';

import type { Effects } from '../color/grade';
import { coverCrop } from '../engine/geometry';
import { fxVector, gradeEffect } from './effect';
import type { BakedLut } from './lutImage';

export type VideoInfo = { duration: number; width: number; height: number; rotation: number; framerate: number };

type Props = {
  uri: string;
  width: number;
  height: number;
  aspect: number; // target aspect of the canvas (crop)
  lut: BakedLut | null;
  effects: Effects;
  paused: SharedValue<boolean>;
  seek: SharedValue<number | null>;
  muted: SharedValue<number>;
  /** Mirrors playback time in seconds for the scrubber. */
  time: SharedValue<number>;
  split: SharedValue<number>;
  falseColor: boolean;
  zebra: number;
  trimStart: number;
  trimEnd: number;
  onInfo?: (info: VideoInfo) => void;
};

/**
 * Real-time graded playback: the decoded frame and the baked LUT are child
 * shaders of one SkSL runtime effect (same program as the export engine).
 */
export function GradedVideo(p: Props) {
  const { currentFrame, currentTime, duration, size, rotation, framerate } = useVideo(p.uri, {
    paused: p.paused,
    seek: p.seek,
    looping: true,
    volume: p.muted,
  });
  const effect = gradeEffect();
  const swap = rotation === 90 || rotation === 270;
  const displayW = swap ? size.height : size.width;
  const displayH = swap ? size.width : size.height;
  const crop = displayW > 0 ? coverCrop(displayW, displayH, p.aspect) : ([0, 0, 1, 1] as const);
  const { onInfo } = p;

  useEffect(() => {
    if (size.width > 0) onInfo?.({ duration: duration / 1000, width: displayW, height: displayH, rotation, framerate });
  }, [duration, size.width, size.height, rotation, framerate, displayW, displayH, onInfo]);

  const trimStart = p.trimStart;
  const trimEnd = p.trimEnd;
  const time = p.time;
  const seek = p.seek;
  // Keep playback inside the trim range and mirror time for the UI.
  useAnimatedReaction(
    () => currentTime.value,
    (ms) => {
      const t = ms / 1000;
      time.value = t;
      if (trimEnd > trimStart && (t > trimEnd || t < trimStart - 0.25)) seek.value = trimStart * 1000;
    },
  );

  const lutTex = p.lut?.tex;
  const fx = fxVector(p.effects);
  const fc = p.falseColor ? 1 : 0;
  const zebra = p.zebra;
  const w = p.width;
  const h = p.height;
  const split = p.split;
  const uniforms = useDerivedValue(() => ({
    uOut: [w, h],
    uRaw: [Math.max(size.width, 1), Math.max(size.height, 1)],
    uRot: rotation / 90,
    uCrop: [crop[0], crop[1], crop[2], crop[3]],
    uLut: lutTex ? [lutTex.size, lutTex.cols, lutTex.width, lutTex.height] : [2, 2, 4, 2],
    uFx: fx,
    uView: [split.value, fc, zebra, 0],
    uMisc: [currentTime.value / 1000, 1],
  }));

  if (!effect || !p.lut) return <Canvas style={{ width: w, height: h }} />;
  return (
    <Canvas style={{ width: w, height: h }}>
      <Fill>
        <Shader source={effect} uniforms={uniforms}>
          <ImageShader image={currentFrame} tx="clamp" ty="clamp" />
          <ImageShader image={p.lut.image} tx="clamp" ty="clamp" />
        </Shader>
      </Fill>
    </Canvas>
  );
}
