import { AlphaType, Canvas, ColorType, Image as SkImageView, Path, Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { SharedValue } from 'react-native-reanimated';

import { sampleTexture, type LutTexture } from '../../color/lut';
import { computeHistogram, computeWaveform, type ScopeMode } from '../../color/scopes';
import { readPixels, thumbnailAt } from '../../lib/media';
import { radius, space } from '../../theme/tokens';
import { Text } from '../../ui/Text';

const W = 176;
const H = 96;

type Frame = { pixels: Uint8Array; width: number; height: number };

function gradePixels(src: Frame, tex: LutTexture): Frame {
  const out = new Uint8Array(src.pixels.length);
  const rgb = new Float64Array(3);
  for (let i = 0; i < src.pixels.length; i += 4) {
    rgb[0] = src.pixels[i] / 255;
    rgb[1] = src.pixels[i + 1] / 255;
    rgb[2] = src.pixels[i + 2] / 255;
    sampleTexture(tex, rgb);
    out[i] = rgb[0] * 255;
    out[i + 1] = rgb[1] * 255;
    out[i + 2] = rgb[2] * 255;
    out[i + 3] = 255;
  }
  return { pixels: out, width: src.width, height: src.height };
}

function waveformImage(frame: Frame, mode: 'waveform' | 'parade'): SkImage | null {
  const levels = 64;
  const channels = mode === 'parade' ? (['r', 'g', 'b'] as const) : (['l'] as const);
  const cols = frame.width;
  const w = cols * channels.length;
  const px = new Uint8Array(w * levels * 4);
  channels.forEach((ch, ci) => {
    const { grid } = computeWaveform(frame.pixels, frame.width, frame.height, levels, ch);
    const tint = ch === 'r' ? [255, 90, 80] : ch === 'g' ? [90, 230, 120] : ch === 'b' ? [90, 150, 255] : [235, 235, 235];
    for (let x = 0; x < cols; x++)
      for (let l = 0; l < levels; l++) {
        const v = grid[x * levels + l];
        const o = ((levels - 1 - l) * w + ci * cols + x) * 4;
        px[o] = tint[0];
        px[o + 1] = tint[1];
        px[o + 2] = tint[2];
        px[o + 3] = Math.round(Math.min(1, v * 1.4) * 255);
      }
  });
  return Skia.Image.MakeImage({ width: w, height: levels, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Unpremul }, Skia.Data.fromBytes(px), w * 4);
}

function histogramPaths(frame: Frame) {
  const h = computeHistogram(frame.pixels, 64);
  const make = (arr: Float32Array) => {
    const b = Skia.PathBuilder.Make();
    b.moveTo(0, H);
    arr.forEach((v, i) => b.lineTo((i / (arr.length - 1)) * W, H - v * (H - 6)));
    b.lineTo(W, H);
    b.close();
    return b.build();
  };
  return { r: make(h.r), g: make(h.g), b: make(h.b), l: make(h.l) };
}

/**
 * Scopes read the frame at the playhead (a fresh thumbnail, so they work
 * paused or playing) graded through the exact LUT the viewer uses.
 */
export function Scopes({ uri, time, tex, mode, tick }: { uri: string; time: SharedValue<number>; tex: LutTexture | null; mode: ScopeMode; tick: number }) {
  const [source, setSource] = useState<Frame | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const t = await thumbnailAt(uri, time.value, 0.5);
      if (!t || !alive) return;
      const px = await readPixels(t.uri, 120);
      if (alive && px) setSource(px);
    })();
    return () => {
      alive = false;
    };
  }, [uri, tick, time]);

  const graded = useMemo(() => (source && tex ? gradePixels(source, tex) : null), [source, tex]);
  const drawn = useMemo(() => {
    if (!graded) return null;
    if (mode === 'histogram') return { kind: 'h' as const, paths: histogramPaths(graded) };
    return { kind: 'w' as const, image: waveformImage(graded, mode) };
  }, [graded, mode]);

  return (
    <View
      style={{ width: W + space.s * 2, padding: space.s, borderRadius: radius.media, borderCurve: 'continuous', backgroundColor: 'rgba(0,0,0,0.62)' }}
      accessibilityLabel={mode === 'histogram' ? 'Histograma' : mode === 'waveform' ? 'Forma de onda' : 'Parade RGB'}
    >
      <Canvas style={{ width: W, height: H }}>
        {[0.25, 0.5, 0.75].map((g) => (
          <Path key={g} path={Skia.Path.MakeFromSVGString(`M0 ${H * g} L${W} ${H * g}`)!} style="stroke" strokeWidth={0.5} color="rgba(255,255,255,0.18)" />
        ))}
        {drawn?.kind === 'h' ? (
          <>
            <Path path={drawn.paths.r} color="rgba(255,80,70,0.45)" blendMode="screen" />
            <Path path={drawn.paths.g} color="rgba(80,230,110,0.45)" blendMode="screen" />
            <Path path={drawn.paths.b} color="rgba(80,140,255,0.45)" blendMode="screen" />
            <Path path={drawn.paths.l} color="rgba(255,255,255,0.8)" style="stroke" strokeWidth={1} />
          </>
        ) : drawn?.kind === 'w' && drawn.image ? (
          <SkImageView image={drawn.image} x={0} y={0} width={W} height={H} fit="fill" />
        ) : null}
      </Canvas>
      {!drawn ? (
        <Text variant="caption2" color="rgba(255,255,255,0.6)" style={{ position: 'absolute', left: space.m, top: space.m }}>
          Lendo quadro…
        </Text>
      ) : null}
    </View>
  );
}
