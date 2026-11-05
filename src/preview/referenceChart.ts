import { AlphaType, ColorType, Skia, type SkImage } from '@shopify/react-native-skia';

let chart: SkImage | null = null;

/**
 * A generated reference chart (hue sweep, memory colours, grey ramp) used to
 * preview looks when no clip is at hand. Rec.709 display values.
 */
export function referenceChart(): SkImage | null {
  if (chart) return chart;
  const w = 192;
  const h = 108;
  const px = new Uint8Array(w * h * 4);
  const patches: [number, number, number][] = [
    [194, 150, 130], // light skin
    [115, 82, 68], // dark skin
    [98, 122, 157], // blue sky
    [87, 108, 67], // foliage
    [214, 126, 44], // orange
    [80, 91, 166], // purplish blue
    [193, 90, 99], // moderate red
    [157, 188, 64], // yellow green
  ];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      let r: number;
      let g: number;
      let b: number;
      if (y < 36) {
        // hue sweep with a vertical value ramp
        const hue = (x / w) * 360;
        const v = 0.55 + 0.45 * (1 - y / 36);
        const c = v * 0.8;
        const hp = hue / 60;
        const xx = c * (1 - Math.abs((hp % 2) - 1));
        const m = v - c;
        const [r1, g1, b1] =
          hp < 1 ? [c, xx, 0] : hp < 2 ? [xx, c, 0] : hp < 3 ? [0, c, xx] : hp < 4 ? [0, xx, c] : hp < 5 ? [xx, 0, c] : [c, 0, xx];
        r = (r1 + m) * 255;
        g = (g1 + m) * 255;
        b = (b1 + m) * 255;
      } else if (y < 80) {
        const p = patches[Math.min(patches.length - 1, Math.floor((x / w) * patches.length))];
        [r, g, b] = p;
      } else {
        const v = Math.round((x / (w - 1)) * 10) / 10;
        r = g = b = v * 255;
      }
      px[i] = r;
      px[i + 1] = g;
      px[i + 2] = b;
      px[i + 3] = 255;
    }
  }
  chart = Skia.Image.MakeImage(
    { width: w, height: h, colorType: ColorType.RGBA_8888, alphaType: AlphaType.Opaque },
    Skia.Data.fromBytes(px),
    w * 4,
  );
  return chart;
}
