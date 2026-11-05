import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';
import { useEffect, useMemo, useRef, useState } from 'react';

import { bakeGradeTexture } from '../color/bake';
import type { Grade } from '../color/grade';
import type { LutTexture } from '../color/lut';
import type { ProfileId } from '../color/profiles';
import { useLibrary } from '../store/library';
import { isUserLutLoaded, loadUserLut, userLookResolver } from '../lib/userLuts';

export type BakedLut = { image: SkImage; tex: LutTexture };

const cache = new Map<string, BakedLut>();
const MAX = 48;

export function textureToImage(tex: LutTexture): SkImage | null {
  return Skia.Image.MakeImage(
    { width: tex.width, height: tex.height, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque },
    Skia.Data.fromBytes(tex.bytes),
    tex.width * 4,
  );
}

export function gradeKey(input: ProfileId, grade: Grade) {
  return `${input}|${grade.lookId}|${grade.lookStrength}|${JSON.stringify(grade.adjust)}`;
}

export function bakeCached(input: ProfileId, grade: Grade, size: number): BakedLut | null {
  const key = `${gradeKey(input, grade)}|${size}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const tex = bakeGradeTexture(input, grade, size, userLookResolver);
  const image = textureToImage(tex);
  if (!image) return null;
  const baked = { image, tex };
  cache.set(key, baked);
  if (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return baked;
}

async function ensureLook(lookId: string | null) {
  if (!lookId?.startsWith('user:') || isUserLutLoaded(lookId)) return;
  const entry = useLibrary.getState().userLuts.find((l) => l.id === lookId);
  if (entry) await loadUserLut(entry).catch(() => null);
}

/**
 * Live LUT for the editor: a coarse 17³ bake on the next frame (keeps slider
 * drags at display rate), then the full-quality bake once input settles.
 */
export function useGradeLut(input: ProfileId, grade: Grade, size: number) {
  const [baked, setBaked] = useState<BakedLut | null>(null);
  const key = useMemo(() => gradeKey(input, grade), [input, grade]);
  const latest = useRef({ input, grade });
  latest.current = { input, grade };

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let timer: ReturnType<typeof setTimeout> | null = null;
    ensureLook(grade.lookId).then(() => {
      if (!alive) return;
      const exact = cache.get(`${key}|${size}`);
      if (exact) {
        setBaked(exact);
        return;
      }
      raf = requestAnimationFrame(() => {
        if (!alive) return;
        const { input: i, grade: g } = latest.current;
        const coarse = bakeCached(i, g, 17);
        if (coarse) setBaked(coarse);
        if (size > 17) {
          timer = setTimeout(() => {
            if (!alive) return;
            const fine = bakeCached(i, g, size);
            if (fine) setBaked(fine);
          }, 240);
        }
      });
    });
    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      if (timer) clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, size]);

  return baked;
}

/** Lazily bakes small LUTs for thumbnail strips, one per frame, so scrolling never hitches. */
const queue: (() => void)[] = [];
let pumping = false;
function pump() {
  if (pumping) return;
  pumping = true;
  const step = () => {
    const job = queue.shift();
    if (!job) {
      pumping = false;
      return;
    }
    job();
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function useThumbLut(input: ProfileId, grade: Grade | null) {
  const [baked, setBaked] = useState<BakedLut | null>(null);
  const key = grade ? gradeKey(input, grade) : null;
  useEffect(() => {
    if (!grade) return;
    let alive = true;
    const hit = cache.get(`${key}|17`);
    if (hit) {
      setBaked(hit);
      return;
    }
    ensureLook(grade.lookId).then(() => {
      queue.push(() => {
        if (alive) setBaked(bakeCached(input, grade, 17));
      });
      pump();
    });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return baked;
}
